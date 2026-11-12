import * as THREE from 'three';

const MAX_SPARKS = 700;
const MAX_FIREBALLS = 260;
const MAX_PUFFS = 480;
const MAX_TRAIL_SEGS = 760;
const MAX_SHOCKWAVES = 18;
const MAX_LIGHTS = 6;

export class VFXSystem {
  constructor(scene, textures, qualityManager) {
    this.scene = scene;
    this.textures = textures;
    this.quality = qualityManager;
    this.time = 0;

    this._dummy = new THREE.Object3D();
    this._upVec = new THREE.Vector3(0, 1, 0);
    this._tempVec = new THREE.Vector3();
    this._tempColor = new THREE.Color();

    this._initSparks();
    this._initBlackbodyFireballs();
    this._initSmokeAndSpray();
    this._initRibbonSegments();
    this._initShockwaves();
    this._initDynamicLights();
  }

  _initSparks() {
    // Razor-sharp motion-blurred ballistic metal sparks
    const sparkGeo = new THREE.PlaneGeometry(0.055, 0.78);
    sparkGeo.rotateX(Math.PI * 0.5);
    const sparkMat = new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vColor;
        void main() {
          vUv = uv;
          #ifdef USE_INSTANCING_COLOR
            vColor = instanceColor;
          #else
            vColor = vec3(1.0, 0.75, 0.35);
          #endif
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vColor;
        void main() {
          float core = (1.0 - smoothstep(0.05, 0.5, abs(vUv.x - 0.5))) * sin(vUv.y * 3.14159);
          vec3 hdrCol = mix(vColor * 1.8, vec3(4.8, 4.2, 3.0), pow(core, 2.0));
          if (core < 0.02) discard;
          gl_FragColor = vec4(hdrCol, core);
        }
      `,
    });

    this.sparkInst = new THREE.InstancedMesh(sparkGeo, sparkMat, MAX_SPARKS);
    this.sparkInst.frustumCulled = false;
    this.sparkInst.userData.excludeAO = true;
    this.sparkPool = [];
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const baseCol = new THREE.Color(0xffb85c);

    for (let i = 0; i < MAX_SPARKS; i++) {
      this.sparkInst.setMatrixAt(i, zero);
      this.sparkInst.setColorAt(i, baseCol);
      this.sparkPool.push({
        active: false,
        age: 0,
        life: 0.45,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        len: 1.0,
      });
    }
    this.sparkInst.instanceMatrix.needsUpdate = true;
    this.sparkInst.instanceColor.needsUpdate = true;
    this.scene.add(this.sparkInst);
    this._sparkCursor = 0;
  }

  /**
   * AAA Volumetric Blackbody Pyroclastic Fireball & Soot Plume System:
   * Maps temperature 4200K (searing white-gold) -> 1800K (amber-orange) -> 900K (crimson) -> dark char smoke
   * with scrolling Perlin-Worley cauliflower billow erosion!
   */
  _initBlackbodyFireballs() {
    const baseGeo = new THREE.PlaneGeometry(1, 1);
    const instGeo = new THREE.InstancedBufferGeometry();
    instGeo.index = baseGeo.index;
    instGeo.attributes.position = baseGeo.attributes.position;
    instGeo.attributes.uv = baseGeo.attributes.uv;

    // x: normalized age [0..1], y: random seed [0..1], z: initial heat boost [0.5..1.5]
    this.fireMetaArray = new Float32Array(MAX_FIREBALLS * 3);
    this.fireMetaAttr = new THREE.InstancedBufferAttribute(this.fireMetaArray, 3);
    this.fireMetaAttr.setUsage(THREE.DynamicDrawUsage);
    instGeo.setAttribute('aFireMeta', this.fireMetaAttr);

    const fireMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uPyroNoise: { value: this.textures.pyroNoise },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aFireMeta;
        varying vec2 vUv;
        varying vec3 vMeta;
        void main() {
          vUv = uv;
          vMeta = aFireMeta;
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform sampler2D uPyroNoise;
        varying vec2 vUv;
        varying vec3 vMeta;

        // Physically inspired blackbody radiation curve (HDR linear RGB)
        vec3 blackbodyColor(float temp) {
          vec3 soot = vec3(0.055, 0.062, 0.072);
          vec3 crimson = vec3(1.15, 0.16, 0.03);
          vec3 orange = vec3(3.2, 1.15, 0.18);
          vec3 whiteGold = vec3(5.6, 4.6, 3.1);

          vec3 c = mix(soot, crimson, smoothstep(0.14, 0.38, temp));
          c = mix(c, orange, smoothstep(0.36, 0.68, temp));
          c = mix(c, whiteGold, smoothstep(0.68, 0.96, temp));
          return c;
        }

        void main() {
          float age = clamp(vMeta.x, 0.0, 1.0);
          float seed = vMeta.y;
          float heatScale = vMeta.z;

          vec2 p = vUv * 2.0 - 1.0;
          float r = length(p);
          if (r > 1.0) discard;

          // Scroll multi-scale Worley cauliflower lobes outward & upward
          float rot = seed * 6.28318;
          mat2 mRot = mat2(cos(rot), -sin(rot), sin(rot), cos(rot));
          vec2 uv1 = (mRot * p) * 0.48 + 0.5 + vec2(seed * 3.1, -age * 0.42);
          vec2 uv2 = p * 0.95 + 0.5 + vec2(-seed * 1.7, -uTime * 0.18);

          vec4 n1 = texture2D(uPyroNoise, uv1);
          vec4 n2 = texture2D(uPyroNoise, uv2);

          // Worley cauliflower lobe density
          float billow = n1.g * 0.62 + n2.b * 0.38;
          float sphereProfile = sqrt(max(0.0, 1.0 - r * r));
          float density = sphereProfile * (0.45 + billow * 0.88);

          // Erode edges progressively as fireball cools and dissipates into storm smoke
          float erosionThreshold = mix(0.14, 0.68, pow(age, 0.85));
          float alpha = smoothstep(erosionThreshold, erosionThreshold + 0.26, density) * (1.0 - smoothstep(0.78, 1.0, age));
          if (alpha < 0.01) discard;

          // Hot fissures sit deeper inside lobes; outer cauliflower rinds cool rapidly into dark char smoke!
          float coreHeat = (1.0 - r * 0.78) * (0.35 + (1.0 - n1.g) * 0.55 + n2.r * 0.35);
          float temperature = coreHeat * pow(max(0.0, 1.0 - age * 1.18), 1.35) * heatScale;

          vec3 col = blackbodyColor(clamp(temperature, 0.0, 1.1));
          // Subtle storm sky rim lighting on cooled dark smoke lobes
          float topRim = clamp(-p.y * 0.5 + 0.5, 0.0, 1.0) * (1.0 - smoothstep(0.05, 0.4, temperature));
          col += vec3(0.09, 0.12, 0.16) * topRim;

          gl_FragColor = vec4(col, alpha * 0.94);
        }
      `,
    });

    this.fireballInst = new THREE.InstancedMesh(instGeo, fireMat, MAX_FIREBALLS);
    this.fireballInst.frustumCulled = false;
    this.fireballInst.renderOrder = 4;
    this.fireballInst.userData.excludeAO = true;
    this.fireballPool = [];
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);

    for (let i = 0; i < MAX_FIREBALLS; i++) {
      this.fireballInst.setMatrixAt(i, zero);
      this.fireballPool.push({
        active: false,
        age: 0,
        life: 0.9,
        seed: Math.random(),
        heatScale: 1.0,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        startScale: 1.2,
        endScale: 4.5,
      });
    }
    this.fireballInst.instanceMatrix.needsUpdate = true;
    this.scene.add(this.fireballInst);
    this._fireCursor = 0;
  }

  _initSmokeAndSpray() {
    // Organic Worley-eroded storm water spray, steam curtains & concrete dust plumes
    const baseGeo = new THREE.PlaneGeometry(1, 1);
    const instGeo = new THREE.InstancedBufferGeometry();
    instGeo.index = baseGeo.index;
    instGeo.attributes.position = baseGeo.attributes.position;
    instGeo.attributes.uv = baseGeo.attributes.uv;

    this.puffMetaArray = new Float32Array(MAX_PUFFS * 2); // x: ageRatio, y: seed
    this.puffMetaAttr = new THREE.InstancedBufferAttribute(this.puffMetaArray, 2);
    this.puffMetaAttr.setUsage(THREE.DynamicDrawUsage);
    instGeo.setAttribute('aPuffMeta', this.puffMetaAttr);

    const puffMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uPyroNoise: { value: this.textures.pyroNoise },
      },
      vertexShader: /* glsl */ `
        attribute vec2 aPuffMeta;
        varying vec2 vUv;
        varying vec2 vMeta;
        varying vec3 vColor;
        void main() {
          vUv = uv;
          vMeta = aPuffMeta;
          #ifdef USE_INSTANCING_COLOR
            vColor = instanceColor;
          #else
            vColor = vec3(0.75, 0.82, 0.88);
          #endif
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uPyroNoise;
        varying vec2 vUv;
        varying vec2 vMeta;
        varying vec3 vColor;
        void main() {
          float age = clamp(vMeta.x, 0.0, 1.0);
          float seed = vMeta.y;
          vec2 p = vUv * 2.0 - 1.0;
          float r = length(p);
          if (r > 1.0) discard;

          vec2 nUv1 = p * 0.65 + 0.5 + vec2(seed * 4.3, -age * 0.36);
          vec2 nUv2 = p * 1.35 + 0.5 + vec2(-seed * 2.7, age * 0.24);
          vec4 nw1 = texture2D(uPyroNoise, nUv1);
          vec4 nw2 = texture2D(uPyroNoise, nUv2);
          float wisp = nw1.g * 0.55 + nw2.a * 0.45;
          float mask = pow(max(0.0, 1.0 - r), 1.65) * smoothstep(0.28 + age * 0.38, 0.88, wisp);
          float alpha = mask * (1.0 - age) * 0.42;
          if (alpha < 0.006) discard;

          // Turbulent 3D billow self-shadowing: dark crevices, storm-lit upper rims
          float shade = 0.52 + (-p.y * 0.26) + nw1.g * 0.36 + nw2.r * 0.14;
          gl_FragColor = vec4(vColor * shade, alpha);
        }
      `,
    });

    this.puffInst = new THREE.InstancedMesh(instGeo, puffMat, MAX_PUFFS);
    this.puffInst.frustumCulled = false;
    this.puffInst.renderOrder = 3;
    this.puffInst.userData.excludeAO = true;
    this.puffPool = [];
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const white = new THREE.Color(0xffffff);

    for (let i = 0; i < MAX_PUFFS; i++) {
      this.puffInst.setMatrixAt(i, zero);
      this.puffInst.setColorAt(i, white);
      this.puffPool.push({
        active: false,
        age: 0,
        life: 1.0,
        seed: Math.random(),
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        startScale: 1.0,
        endScale: 3.5,
        baseColor: new THREE.Color(0xffffff),
      });
    }
    this.puffInst.instanceMatrix.needsUpdate = true;
    this.puffInst.instanceColor.needsUpdate = true;
    this.scene.add(this.puffInst);
    this._puffCursor = 0;
  }

  /**
   * Crossed-Quad Volumetric Smoke & Rocket Exhaust Ribbon Trails:
   * Eliminates solid yellow cylinder sticks! Fresh segments near rocket motor show searing exhaust,
   * then immediately cool into turbulent Worley-eroded storm-grey missile smoke!
   */
  _initRibbonSegments() {
    // Two orthogonal planes intersecting along Z axis [0..1] for 360-degree view-independent ribbon volume
    const p1 = new THREE.PlaneGeometry(1.0, 1.0);
    p1.rotateX(Math.PI * 0.5);
    const p2 = new THREE.PlaneGeometry(1.0, 1.0);
    p2.rotateX(Math.PI * 0.5);
    p2.rotateZ(Math.PI * 0.5);

    // Manually merge 2 simple quads
    const posArr = new Float32Array(24);
    posArr.set(p1.attributes.position.array, 0);
    posArr.set(p2.attributes.position.array, 12);
    const uvArr = new Float32Array(16);
    uvArr.set(p1.attributes.uv.array, 0);
    uvArr.set(p2.attributes.uv.array, 8);
    const idxArr = new Uint16Array([0, 1, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7]);
    p1.dispose();
    p2.dispose();

    const instGeo = new THREE.InstancedBufferGeometry();
    instGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    instGeo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
    instGeo.setIndex(new THREE.BufferAttribute(idxArr, 1));

    // x: ageRatio [0..1], y: seed, z: mode (0 = missile smoke, 1 = railgun plasma)
    this.trailMetaArray = new Float32Array(MAX_TRAIL_SEGS * 3);
    this.trailMetaAttr = new THREE.InstancedBufferAttribute(this.trailMetaArray, 3);
    this.trailMetaAttr.setUsage(THREE.DynamicDrawUsage);
    instGeo.setAttribute('aTrailMeta', this.trailMetaAttr);

    const segMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uPyroNoise: { value: this.textures.pyroNoise },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aTrailMeta;
        varying vec2 vUv;
        varying vec3 vMeta;
        varying vec3 vTint;
        void main() {
          vUv = uv;
          vMeta = aTrailMeta;
          #ifdef USE_INSTANCING_COLOR
            vTint = instanceColor;
          #else
            vTint = vec3(1.0);
          #endif
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uPyroNoise;
        varying vec2 vUv;
        varying vec3 vMeta;
        varying vec3 vTint;

        void main() {
          float age = clamp(vMeta.x, 0.0, 1.0);
          float seed = vMeta.y;
          float isPlasma = vMeta.z;

          float radial = 1.0 - abs(vUv.x - 0.5) * 2.0;
          if (radial <= 0.02) discard;

          vec2 nUv = vec2(vUv.y * 0.65 + seed * 3.7, vUv.x * 0.8 + age * 0.45);
          vec4 nw = texture2D(uPyroNoise, nUv);

          if (isPlasma > 0.5) {
            // Hyper-velocity tungsten railgun ionized plasma wake
            float core = pow(radial, 3.2);
            float vapor = pow(radial, 1.4) * nw.g;
            vec3 col = mix(vTint * 2.2, vec3(5.2, 4.4, 3.0), core) * (1.0 - age * 0.6);
            float alpha = clamp((core + vapor * 0.65) * (1.0 - age), 0.0, 0.95);
            if (alpha < 0.01) discard;
            gl_FragColor = vec4(col, alpha);
          } else {
            // Tactical micro-missile: compact hot ignition right behind nozzle -> billowing slate-white smoke!
            float ignition = exp(-age * 13.0) * pow(radial, 2.4);
            float smokeTurb = nw.b * 0.62 + nw.g * 0.38;
            float smokeMask = pow(radial, 1.35) * smoothstep(0.16 + age * 0.42, 0.82, smokeTurb);

            vec3 smokeColor = mix(vec3(0.62, 0.70, 0.78), vec3(0.30, 0.36, 0.43), min(1.0, age * 1.4));
            vec3 hotExhaust = vTint * 3.4;
            vec3 col = smokeColor + hotExhaust * ignition;
            float alpha = clamp((smokeMask * 0.56 + ignition * 0.85) * (1.0 - pow(age, 1.5)), 0.0, 0.85);
            if (alpha < 0.008) discard;
            gl_FragColor = vec4(col, alpha);
          }
        }
      `,
    });

    this.trailInst = new THREE.InstancedMesh(instGeo, segMat, MAX_TRAIL_SEGS);
    this.trailInst.frustumCulled = false;
    this.trailInst.renderOrder = 2;
    this.trailInst.userData.excludeAO = true;
    this.trailPool = [];
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const col = new THREE.Color(0xffae52);

    for (let i = 0; i < MAX_TRAIL_SEGS; i++) {
      this.trailInst.setMatrixAt(i, zero);
      this.trailInst.setColorAt(i, col);
      this.trailPool.push({
        active: false,
        age: 0,
        life: 0.75,
        seed: Math.random(),
        isPlasma: 0,
        mid: new THREE.Vector3(),
        quat: new THREE.Quaternion(),
        length: 1.0,
        radius: 0.35,
      });
    }
    this.trailInst.instanceMatrix.needsUpdate = true;
    this.trailInst.instanceColor.needsUpdate = true;
    this.scene.add(this.trailInst);
    this._trailCursor = 0;
  }

  _initShockwaves() {
    // Razor-thin supersonic vapor condensation shell (subtle mist ring, NEVER giant orange spheres!)
    const sphereGeo = new THREE.SphereGeometry(1, 32, 20);
    this.shockwaves = [];
    for (let i = 0; i < MAX_SHOCKWAVES; i++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uColor: { value: new THREE.Color(0xd8ecff) },
          uOpacity: { value: 0.0 },
        },
        vertexShader: /* glsl */ `
          varying vec3 vWorldNormal;
          varying vec3 vViewDir;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorldNormal = normalize(mat3(modelMatrix) * normal);
            vViewDir = normalize(cameraPosition - wp.xyz);
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uOpacity;
          varying vec3 vWorldNormal;
          varying vec3 vViewDir;
          void main() {
            float rim = 1.0 - abs(dot(normalize(vWorldNormal), normalize(vViewDir)));
            // High exponent creates a razor-thin Mach condensation ring instead of a solid bubble!
            float shell = pow(clamp(rim, 0.0, 1.0), 9.0);
            float alpha = shell * uOpacity;
            if (alpha < 0.004) discard;
            gl_FragColor = vec4(uColor, alpha);
          }
        `,
      });
      const mesh = new THREE.Mesh(sphereGeo, mat);
      mesh.visible = false;
      mesh.userData.excludeAO = true;
      this.scene.add(mesh);
      this.shockwaves.push({
        mesh,
        mat,
        active: false,
        age: 0,
        life: 0.22,
        startRadius: 0.5,
        endRadius: 5.5,
        flatY: 1.0,
      });
    }
    this._shockCursor = 0;
  }

  _initDynamicLights() {
    this.lights = [];
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const light = new THREE.PointLight(0xff9436, 0, 26, 1.7);
      this.scene.add(light);
      this.lights.push({ light, age: 0, life: 0.15, peak: 0 });
    }
    this._lightCursor = 0;
  }

  spawnLightFlash(pos, colorHex = 0xff9638, intensity = 18, distance = 26, duration = 0.14) {
    const slot = this.lights[this._lightCursor];
    this._lightCursor = (this._lightCursor + 1) % MAX_LIGHTS;
    slot.light.position.copy(pos);
    slot.light.color.setHex(colorHex);
    slot.light.distance = distance;
    slot.light.intensity = intensity;
    slot.peak = intensity;
    slot.age = 0;
    slot.life = duration;
  }

  spawnSparks(pos, normalOrDir, count = 14, colorHex = 0xffb858, speedScale = 1.0) {
    const n = Math.max(3, Math.round(count * this.quality.config.debrisMultiplier));
    this._tempColor.setHex(colorHex);

    for (let i = 0; i < n; i++) {
      const idx = this._sparkCursor;
      const s = this.sparkPool[idx];
      this._sparkCursor = (this._sparkCursor + 1) % MAX_SPARKS;
      s.active = true;
      s.age = 0;
      s.life = 0.22 + Math.random() * 0.34;
      s.pos.copy(pos);

      const speed = (11 + Math.random() * 24) * speedScale;
      const dx = (normalOrDir ? normalOrDir.x * 0.65 : 0) + (Math.random() - 0.5) * 1.6;
      const dy = (normalOrDir ? Math.abs(normalOrDir.y) * 0.5 : 0.35) + Math.random() * 1.1;
      const dz = (normalOrDir ? normalOrDir.z * 0.65 : 0) + (Math.random() - 0.5) * 1.6;
      s.vel.set(dx, dy, dz).normalize().multiplyScalar(speed);
      s.len = 0.55 + Math.random() * 1.05;

      this.sparkInst.setColorAt(idx, this._tempColor);
    }
    this.sparkInst.instanceColor.needsUpdate = true;
  }

  spawnFireballLobe(pos, vel, startScale, endScale, life, heatScale = 1.0) {
    const idx = this._fireCursor;
    const f = this.fireballPool[idx];
    this._fireCursor = (this._fireCursor + 1) % MAX_FIREBALLS;

    f.active = true;
    f.age = 0;
    f.life = life;
    f.seed = Math.random();
    f.heatScale = heatScale;
    f.pos.copy(pos);
    f.vel.copy(vel);
    f.startScale = startScale;
    f.endScale = endScale;
  }

  spawnPuff(pos, vel, startScale, endScale, life, colorHex) {
    const idx = this._puffCursor;
    const p = this.puffPool[idx];
    this._puffCursor = (this._puffCursor + 1) % MAX_PUFFS;

    p.active = true;
    p.age = 0;
    p.life = life;
    p.seed = Math.random();
    p.pos.copy(pos);
    p.vel.copy(vel);
    p.startScale = startScale;
    p.endScale = endScale;
    p.baseColor.setHex(colorHex);
    this.puffInst.setColorAt(idx, p.baseColor);
    this.puffInst.instanceColor.needsUpdate = true;
  }

  spawnWaterSplash(x, z, scale = 1.0) {
    const count = Math.max(3, Math.round(5 * scale * this.quality.config.debrisMultiplier));
    for (let i = 0; i < count; i++) {
      const origin = new THREE.Vector3(
        x + (Math.random() - 0.5) * 1.0 * scale,
        0.22,
        z + (Math.random() - 0.5) * 1.0 * scale
      );
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 3.6 * scale,
        (3.2 + Math.random() * 4.8) * scale,
        (Math.random() - 0.5) * 3.6 * scale
      );
      this.spawnPuff(origin, vel, 0.85 * scale, 2.9 * scale, 0.5 + Math.random() * 0.25, 0xc8dcf0);
    }
  }

  spawnSteamPlume(x, z, scale = 1.0) {
    const origin = new THREE.Vector3(x + (Math.random() - 0.5) * 0.8, 0.35, z + (Math.random() - 0.5) * 0.8);
    const vel = new THREE.Vector3((Math.random() - 0.5) * 1.8, 4.5 + Math.random() * 3.8, (Math.random() - 0.5) * 1.8);
    this.spawnPuff(origin, vel, 1.2 * scale, 4.8 * scale, 0.85 + Math.random() * 0.35, 0xd8e8f6);
  }

  spawnConcreteCollapse(pos, scale = 1.0) {
    const count = Math.max(5, Math.round(11 * scale * this.quality.config.debrisMultiplier));
    for (let i = 0; i < count; i++) {
      const p = pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3.0, (Math.random() - 0.5) * 2.2, (Math.random() - 0.5) * 3.0));
      const v = new THREE.Vector3((Math.random() - 0.5) * 7.0, 1.5 + Math.random() * 4.2, (Math.random() - 0.5) * 7.0);
      this.spawnPuff(p, v, 2.0 * scale, 6.4 * scale, 1.05 + Math.random() * 0.45, 0x626e7a);
    }
    this.spawnSparks(pos, this._upVec, 18, 0xffb252, 1.15);
  }

  spawnShockwave(pos, startRadius = 0.6, endRadius = 5.8, life = 0.22, colorHex = 0xd8ecff, flatY = 1.0) {
    const sw = this.shockwaves[this._shockCursor];
    this._shockCursor = (this._shockCursor + 1) % MAX_SHOCKWAVES;
    sw.active = true;
    sw.age = 0;
    sw.life = life;
    sw.startRadius = startRadius;
    sw.endRadius = endRadius;
    sw.flatY = flatY;
    sw.mat.uniforms.uColor.value.setHex(colorHex);
    sw.mesh.position.copy(pos);
    sw.mesh.visible = true;
  }

  spawnExplosion(pos, scale = 1.0, colorHex = 0xff8424) {
    this.spawnLightFlash(pos, colorHex, 28 * scale, 34 * scale, 0.24);
    // Crisp, fast atmospheric vapor shock-ring (subtle, never blocking view!)
    this.spawnShockwave(pos, 0.5 * scale, 5.2 * scale, 0.20, 0xdceeff, 0.24);
    this.spawnSparks(pos, this._upVec, Math.round(26 * scale), 0xffcf78, 1.3 * scale);

    // Volumetric multi-lobe blackbody pyroclastic fireball + rolling soot plume!
    const lobeCount = Math.max(5, Math.round(9 * scale * this.quality.config.debrisMultiplier));
    for (let i = 0; i < lobeCount; i++) {
      const isCore = i < 3;
      const offset = new THREE.Vector3(
        (Math.random() - 0.5) * 1.4 * scale,
        (Math.random() - 0.35) * 1.2 * scale,
        (Math.random() - 0.5) * 1.4 * scale
      );
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 5.5 * scale,
        (2.4 + Math.random() * 5.8) * scale,
        (Math.random() - 0.5) * 5.5 * scale
      );
      const s0 = (isCore ? 1.5 : 1.1) * scale;
      const s1 = (isCore ? 4.4 : 5.6) * scale;
      const life = isCore ? (0.48 + Math.random() * 0.24) : (0.78 + Math.random() * 0.45);
      const heat = isCore ? 1.35 : (0.85 + Math.random() * 0.3);
      this.spawnFireballLobe(pos.clone().add(offset), vel, s0, s1, life, heat);
    }
  }

  spawnTrailSegment(fromPos, toPos, radius = 0.32, life = 0.65, startHex = 0xffa64c, _endHex = 0x52606e, isPlasma = false) {
    const delta = this._tempVec.subVectors(toPos, fromPos);
    const len = delta.length();
    if (len < 0.03) return;

    const idx = this._trailCursor;
    const slot = this.trailPool[idx];
    this._trailCursor = (this._trailCursor + 1) % MAX_TRAIL_SEGS;
    slot.active = true;
    slot.age = 0;
    slot.life = life;
    slot.seed = Math.random();
    slot.isPlasma = isPlasma ? 1.0 : 0.0;
    slot.mid.addVectors(fromPos, toPos).multiplyScalar(0.5);
    slot.length = len * 1.12;
    slot.radius = radius;

    this._tempColor.setHex(startHex);
    this.trailInst.setColorAt(idx, this._tempColor);
    this.trailInst.instanceColor.needsUpdate = true;

    this._dummy.position.copy(fromPos);
    this._dummy.lookAt(toPos);
    slot.quat.copy(this._dummy.quaternion);
  }

  spawnRailBeam(startPos, endPos) {
    const totalVec = new THREE.Vector3().subVectors(endPos, startPos);
    const dist = totalVec.length();
    const steps = Math.max(5, Math.min(32, Math.ceil(dist / 4.2)));
    const prev = startPos.clone();
    const curr = new THREE.Vector3();

    for (let i = 1; i <= steps; i++) {
      curr.copy(startPos).addScaledVector(totalVec, i / steps);
      this.spawnTrailSegment(prev, curr, 0.62, 0.38, 0xffcf75, 0xff6a14, true);
      if (i % 4 === 0) {
        this.spawnShockwave(curr, 0.25, 2.1, 0.18, 0xffe4b5, 1.0);
      }
      prev.copy(curr);
    }
  }

  update(dt, camera) {
    this.time += dt;
    const zeroScale = 0.00001;

    // 1. Update ballistic sparks
    let sparkDirty = false;
    for (let i = 0; i < MAX_SPARKS; i++) {
      const s = this.sparkPool[i];
      if (!s.active) continue;
      s.age += dt;
      if (s.age >= s.life) {
        s.active = false;
        this._dummy.scale.setScalar(zeroScale);
        this._dummy.updateMatrix();
        this.sparkInst.setMatrixAt(i, this._dummy.matrix);
        sparkDirty = true;
        continue;
      }

      s.vel.y -= 24.0 * dt;
      s.pos.addScaledVector(s.vel, dt);
      if (s.pos.y < 0.02 && s.vel.y < 0) {
        s.pos.y = 0.02;
        s.vel.y *= -0.45;
        s.vel.x *= 0.75;
        s.vel.z *= 0.75;
      }

      const fade = 1.0 - s.age / s.life;
      this._dummy.position.copy(s.pos);
      this._tempVec.copy(s.pos).add(s.vel);
      this._dummy.lookAt(this._tempVec);
      this._dummy.scale.set(fade, fade, s.len * (0.45 + fade * 0.85));
      this._dummy.updateMatrix();
      this.sparkInst.setMatrixAt(i, this._dummy.matrix);
      sparkDirty = true;
    }
    if (sparkDirty) this.sparkInst.instanceMatrix.needsUpdate = true;

    // 2. Update volumetric blackbody pyroclastic fireballs
    this.fireballInst.material.uniforms.uTime.value = this.time;
    let fireDirty = false;
    for (let i = 0; i < MAX_FIREBALLS; i++) {
      const f = this.fireballPool[i];
      if (!f.active) continue;
      f.age += dt;
      if (f.age >= f.life) {
        f.active = false;
        this._dummy.scale.setScalar(zeroScale);
        this._dummy.updateMatrix();
        this.fireballInst.setMatrixAt(i, this._dummy.matrix);
        this.fireMetaArray[i * 3] = 1.0;
        fireDirty = true;
        continue;
      }

      const t = f.age / f.life;
      // Rapid explosive expansion followed by buoyant smoke deceleration
      f.vel.multiplyScalar(Math.max(0, 1.0 - dt * 2.8));
      f.vel.y += 2.2 * dt;
      f.pos.addScaledVector(f.vel, dt);

      const expand = 1.0 - Math.pow(1.0 - t, 2.6);
      const scale = THREE.MathUtils.lerp(f.startScale, f.endScale, expand);

      this._dummy.position.copy(f.pos);
      this._dummy.quaternion.copy(camera.quaternion);
      this._dummy.scale.setScalar(scale);
      this._dummy.updateMatrix();
      this.fireballInst.setMatrixAt(i, this._dummy.matrix);

      this.fireMetaArray[i * 3] = t;
      this.fireMetaArray[i * 3 + 1] = f.seed;
      this.fireMetaArray[i * 3 + 2] = f.heatScale;
      fireDirty = true;
    }
    if (fireDirty) {
      this.fireballInst.instanceMatrix.needsUpdate = true;
      this.fireMetaAttr.needsUpdate = true;
    }

    // 3. Update Worley-eroded storm spray, steam & dust puffs
    let puffDirty = false;
    for (let i = 0; i < MAX_PUFFS; i++) {
      const p = this.puffPool[i];
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        this._dummy.scale.setScalar(zeroScale);
        this._dummy.updateMatrix();
        this.puffInst.setMatrixAt(i, this._dummy.matrix);
        puffDirty = true;
        continue;
      }

      const t = p.age / p.life;
      p.vel.multiplyScalar(Math.max(0, 1.0 - dt * 2.1));
      p.pos.addScaledVector(p.vel, dt);

      const scale = THREE.MathUtils.lerp(p.startScale, p.endScale, 1.0 - Math.pow(1.0 - t, 2));
      this._dummy.position.copy(p.pos);
      this._dummy.quaternion.copy(camera.quaternion);
      this._dummy.scale.setScalar(scale);
      this._dummy.updateMatrix();
      this.puffInst.setMatrixAt(i, this._dummy.matrix);

      this.puffMetaArray[i * 2] = t;
      this.puffMetaArray[i * 2 + 1] = p.seed;
      puffDirty = true;
    }
    if (puffDirty) {
      this.puffInst.instanceMatrix.needsUpdate = true;
      this.puffMetaAttr.needsUpdate = true;
    }

    // 4. Update volumetric smoke & plasma ribbon trails
    let trailDirty = false;
    for (let i = 0; i < MAX_TRAIL_SEGS; i++) {
      const seg = this.trailPool[i];
      if (!seg.active) continue;
      seg.age += dt;
      if (seg.age >= seg.life) {
        seg.active = false;
        this._dummy.scale.setScalar(zeroScale);
        this._dummy.updateMatrix();
        this.trailInst.setMatrixAt(i, this._dummy.matrix);
        trailDirty = true;
        continue;
      }

      const t = seg.age / seg.life;
      // Smoke expands naturally behind rocket motor while plasma pinches cleanly
      const widthScale = seg.isPlasma > 0.5
        ? seg.radius * (1.0 - t * 0.65)
        : seg.radius * (0.55 + t * 2.1);

      this._dummy.position.copy(seg.mid);
      this._dummy.quaternion.copy(seg.quat);
      this._dummy.scale.set(widthScale, widthScale, seg.length);
      this._dummy.updateMatrix();
      this.trailInst.setMatrixAt(i, this._dummy.matrix);

      this.trailMetaArray[i * 3] = t;
      this.trailMetaArray[i * 3 + 1] = seg.seed;
      this.trailMetaArray[i * 3 + 2] = seg.isPlasma;
      trailDirty = true;
    }
    if (trailDirty) {
      this.trailInst.instanceMatrix.needsUpdate = true;
      this.trailMetaAttr.needsUpdate = true;
    }

    // 5. Update supersonic vapor shock-rings
    for (let i = 0; i < MAX_SHOCKWAVES; i++) {
      const sw = this.shockwaves[i];
      if (!sw.active) continue;
      sw.age += dt;
      if (sw.age >= sw.life) {
        sw.active = false;
        sw.mesh.visible = false;
        continue;
      }
      const t = sw.age / sw.life;
      const ease = 1.0 - Math.pow(1.0 - t, 3);
      const r = THREE.MathUtils.lerp(sw.startRadius, sw.endRadius, ease);
      sw.mesh.scale.set(r, r * sw.flatY, r);
      sw.mat.uniforms.uOpacity.value = (1.0 - t) * 0.34;
    }

    // 6. Update pooled dynamic point lights
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = this.lights[i];
      if (l.light.intensity <= 0.01) continue;
      l.age += dt;
      if (l.age >= l.life) {
        l.light.intensity = 0;
      } else {
        l.light.intensity = l.peak * (1.0 - l.age / l.life);
      }
    }
  }
}
