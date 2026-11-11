import * as THREE from 'three';

const MAX_RAIN = 12000;

const WEATHER_PROFILES = {
  MONSOON: {
    label: 'MONSOON SQUALL',
    fogColor: new THREE.Color(0x101820),
    fogDensity: 0.0082,
    skyTop: new THREE.Color(0x070c12),
    skyHorizon: new THREE.Color(0x1b2836),
    sunColor: new THREE.Color(0x9bb8d4),
    sunIntensity: 2.1,
    hemiSky: new THREE.Color(0x3a5068),
    hemiGround: new THREE.Color(0x0d1318),
    hemiIntensity: 1.05,
    rainIntensity: 0.92,
    godRayOpacity: 0.0,
    lightningInterval: [5.5, 11.0],
    envKey: 'monsoon',
  },
  SUNBREAK: {
    label: 'AMBER STORM BREACH',
    fogColor: new THREE.Color(0x1f1d1c),
    fogDensity: 0.0064,
    skyTop: new THREE.Color(0x0e1621),
    skyHorizon: new THREE.Color(0x523c2a),
    sunColor: new THREE.Color(0xffb469),
    sunIntensity: 4.3,
    hemiSky: new THREE.Color(0x6d6862),
    hemiGround: new THREE.Color(0x191512),
    hemiIntensity: 1.25,
    rainIntensity: 0.34,
    godRayOpacity: 0.22,
    lightningInterval: [14.0, 24.0],
    envKey: 'sunbreak',
  },
  SUPERCELL: {
    label: 'SUPERCELL TEMPEST',
    fogColor: new THREE.Color(0x0b1118),
    fogDensity: 0.0094,
    skyTop: new THREE.Color(0x04070b),
    skyHorizon: new THREE.Color(0x14202e),
    sunColor: new THREE.Color(0x88acd0),
    sunIntensity: 1.75,
    hemiSky: new THREE.Color(0x2d4156),
    hemiGround: new THREE.Color(0x080c10),
    hemiIntensity: 0.92,
    rainIntensity: 1.0,
    godRayOpacity: 0.0,
    lightningInterval: [2.4, 5.2],
    envKey: 'supercell',
  },
};

export class WeatherSystem {
  constructor(renderer, scene, qualityManager, softMistTex, onThunderCallback) {
    this.renderer = renderer;
    this.scene = scene;
    this.quality = qualityManager;
    this.softMistTex = softMistTex;
    this.onThunder = onThunderCallback;

    this.currentMode = 'MONSOON';
    this.targetProfile = WEATHER_PROFILES.MONSOON;
    this.blend = 1.0;

    this.rainIntensity = 0.9;
    this.lightningFlash = 0.0;
    this._nextLightningTimer = 3.2;
    this._modeCycleTimer = 28.0;
    this.lockedToWave = false;

    this.sunDirection = new THREE.Vector3(0.48, 0.44, -0.75).normalize();
    this.sunColor = WEATHER_PROFILES.MONSOON.sunColor.clone();
    this.skyHorizonColor = WEATHER_PROFILES.MONSOON.skyHorizon.clone();
    this.skyTopColor = WEATHER_PROFILES.MONSOON.skyTop.clone();

    this.scene.fog = new THREE.FogExp2(0x101820, 0.0082);

    this._setupLights();
    this._setupSkyDome();
    this._bakePMREMEnvironments();
    this._setupRainGPU();
    this._setupMistAndGodRays();
    this._setupLightningBolt();
  }

  _setupLights() {
    const cfg = this.quality.config;

    this.hemiLight = new THREE.HemisphereLight(0x4c6682, 0x18222c, 1.48);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0x9bb8d4, 2.4);
    this.sunLight.position.copy(this.sunDirection).multiplyScalar(115);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(cfg.shadowMapSize, cfg.shadowMapSize);
    this.sunLight.shadow.camera.near = 15;
    this.sunLight.shadow.camera.far = 250;
    const d = 88;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.00045;
    this.sunLight.shadow.normalBias = 0.035;
    this.scene.add(this.sunLight);

    // Cool atmospheric storm fill light so backlit concrete arches & mech bevels retain rich normal detail
    this.fillLight = new THREE.DirectionalLight(0x7ca2c6, 1.35);
    this.fillLight.position.set(-48, 56, 92);
    this.scene.add(this.fillLight);

    // High-contrast fork lightning directional flash light
    this.lightningLight = new THREE.DirectionalLight(0xdbeeff, 0.0);
    this.lightningLight.position.set(-55, 95, -80);
    this.scene.add(this.lightningLight);
  }

  _setupSkyDome() {
    const skyGeo = new THREE.SphereGeometry(260, 36, 24);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uTopColor: { value: this.skyTopColor },
        uHorizonColor: { value: this.skyHorizonColor },
        uSunDir: { value: this.sunDirection },
        uSunColor: { value: this.sunColor },
        uLightning: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldDir;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldDir = normalize(wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uTopColor;
        uniform vec3 uHorizonColor;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uLightning;
        varying vec3 vWorldDir;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
            mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
            u.y
          );
        }

        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 4; i++) {
            v += a * noise(p);
            p = p * 2.07 + vec2(1.7, -1.2);
            a *= 0.5;
          }
          return v;
        }

        void main() {
          vec3 dir = normalize(vWorldDir);
          float h = clamp(dir.y, 0.0, 1.0);
          vec3 sky = mix(uHorizonColor, uTopColor, pow(h, 0.58));

          // Turbulent storm cloud deck projected overhead
          vec2 cloudUv = dir.xz / (dir.y + 0.22) * 1.45 + vec2(uTime * 0.014, -uTime * 0.009);
          float clouds = fbm(cloudUv);
          float cloudDetail = fbm(cloudUv * 2.6 - uTime * 0.02);
          float density = smoothstep(0.28, 0.82, clouds * 0.72 + cloudDetail * 0.35);

          float sunAlign = max(dot(dir, normalize(uSunDir)), 0.0);
          vec3 cloudLit = uSunColor * pow(sunAlign, 4.0) * 0.55 + uHorizonColor * 1.25;
          vec3 cloudDark = uTopColor * 0.55;
          vec3 cloudCol = mix(cloudLit, cloudDark, density);

          sky = mix(sky, cloudCol, smoothstep(0.02, 0.38, h) * 0.85);

          // Atmospheric sunbreak halo
          float sunHalo = pow(sunAlign, 22.0) * 0.55 + pow(sunAlign, 180.0) * 1.4;
          sky += uSunColor * sunHalo * (1.0 - density * 0.65);

          // Supercell lightning illumination inside clouds
          float flashRegion = smoothstep(0.2, 0.9, cloudDetail) * smoothstep(0.04, 0.55, h);
          sky += vec3(0.75, 0.88, 1.0) * uLightning * (0.45 + flashRegion * 1.35);

          gl_FragColor = vec4(sky, 1.0);
        }
      `,
    });

    this.skyMesh = new THREE.Mesh(skyGeo, this.skyMat);
    this.skyMesh.frustumCulled = false;
    this.scene.add(this.skyMesh);
  }

  _bakePMREMEnvironments() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();

    this.envMaps = {};
    const bakeForProfile = (key, prof) => {
      const miniScene = new THREE.Scene();
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(30, 24, 16),
        new THREE.ShaderMaterial({
          side: THREE.BackSide,
          uniforms: {
            uTop: { value: prof.skyTop },
            uHor: { value: prof.skyHorizon },
            uSun: { value: prof.sunColor },
            uSunDir: { value: this.sunDirection },
          },
          vertexShader: `
            varying vec3 vDir;
            void main() {
              vDir = normalize(position);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform vec3 uTop;
            uniform vec3 uHor;
            uniform vec3 uSun;
            uniform vec3 uSunDir;
            varying vec3 vDir;
            void main() {
              vec3 d = normalize(vDir);
              vec3 col = d.y >= 0.0
                ? mix(uHor * 1.35, uTop * 1.2, pow(d.y, 0.55))
                : mix(uHor * 0.55, vec3(0.03, 0.04, 0.05), clamp(-d.y * 2.0, 0.0, 1.0));
              float s = max(dot(d, normalize(uSunDir)), 0.0);
              col += uSun * (pow(s, 14.0) * 0.9 + pow(s, 90.0) * 2.4);
              gl_FragColor = vec4(col, 1.0);
            }
          `,
        })
      );
      miniScene.add(dome);
      const rt = pmrem.fromScene(miniScene, 0.03);
      dome.geometry.dispose();
      dome.material.dispose();
      this.envMaps[key] = rt.texture;
    };

    bakeForProfile('monsoon', WEATHER_PROFILES.MONSOON);
    bakeForProfile('sunbreak', WEATHER_PROFILES.SUNBREAK);
    bakeForProfile('supercell', WEATHER_PROFILES.SUPERCELL);
    pmrem.dispose();

    this.scene.environment = this.envMaps.monsoon;
    this.scene.environmentIntensity = 1.15;
  }

  _setupRainGPU() {
    // Base streak quad stretched vertically
    const baseGeo = new THREE.PlaneGeometry(0.026, 1.55);
    const instGeo = new THREE.InstancedBufferGeometry();
    instGeo.index = baseGeo.index;
    instGeo.attributes.position = baseGeo.attributes.position;
    instGeo.attributes.uv = baseGeo.attributes.uv;

    const offsets = new Float32Array(MAX_RAIN * 4);
    for (let i = 0; i < MAX_RAIN; i++) {
      offsets[i * 4] = (Math.random() - 0.5) * 110;
      offsets[i * 4 + 1] = Math.random() * 48;
      offsets[i * 4 + 2] = (Math.random() - 0.5) * 110;
      offsets[i * 4 + 3] = 0.75 + Math.random() * 0.55; // speed scale
    }
    instGeo.setAttribute('aRainSeed', new THREE.InstancedBufferAttribute(offsets, 4));
    instGeo.instanceCount = this.quality.config.rainCount;

    this.rainMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uCamPos: { value: new THREE.Vector3() },
        uOpacity: { value: 0.34 },
        uTint: { value: new THREE.Color(0x9cb8d4) },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aRainSeed;
        uniform float uTime;
        uniform vec3 uCamPos;
        varying vec2 vUv;
        varying float vDistFade;

        void main() {
          vUv = uv;
          float speed = 34.0 * aRainSeed.w;
          vec3 boxSize = vec3(110.0, 46.0, 110.0);

          // Wrap raindrop coordinates seamlessly around camera
          vec3 worldCenter = aRainSeed.xyz;
          worldCenter.y -= uTime * speed;
          worldCenter.x += uTime * 4.8; // storm wind slant

          vec3 rel = mod(worldCenter - uCamPos + boxSize * 0.5, boxSize) - boxSize * 0.5;
          vec3 dropPos = uCamPos + rel;

          // Billboard horizontally toward camera while preserving slanted fall axis
          vec3 fallAxis = normalize(vec3(0.14, -1.0, 0.04));
          vec3 toCam = normalize(uCamPos - dropPos);
          vec3 sideAxis = normalize(cross(fallAxis, toCam));

          vec3 finalPos = dropPos + sideAxis * position.x + fallAxis * (position.y * aRainSeed.w);
          float d = length(rel.xz);
          vDistFade = smoothstep(54.0, 8.0, d) * smoothstep(1.2, 4.5, d);

          gl_Position = projectionMatrix * viewMatrix * vec4(finalPos, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        uniform vec3 uTint;
        varying vec2 vUv;
        varying float vDistFade;

        void main() {
          float edge = sin(vUv.y * 3.14159) * (1.0 - abs(vUv.x - 0.5) * 2.0);
          float alpha = edge * uOpacity * vDistFade;
          if (alpha < 0.005) discard;
          gl_FragColor = vec4(uTint, alpha);
        }
      `,
    });

    this.rainMesh = new THREE.Mesh(instGeo, this.rainMat);
    this.rainMesh.frustumCulled = false;
    this.rainMesh.renderOrder = 6;
    this.scene.add(this.rainMesh);
  }

  _setupMistAndGodRays() {
    this.mistGroup = new THREE.Group();
    this.mistPlanes = [];
    const mistGeo = new THREE.PlaneGeometry(46, 20);
    this.mistMat = new THREE.MeshBasicMaterial({
      map: this.softMistTex,
      color: 0x3b4d5e,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
    });

    for (let i = 0; i < 44; i++) {
      const m = new THREE.Mesh(mistGeo, this.mistMat);
      const angle = (i / 44) * Math.PI * 2 + Math.random() * 0.2;
      const radius = 52 + Math.random() * 58;
      m.position.set(Math.cos(angle) * radius, 5.5 + Math.random() * 11, Math.sin(angle) * radius);
      m.scale.setScalar(0.8 + Math.random() * 0.9);
      m.userData = {
        baseAngle: angle,
        radius,
        driftSpeed: (0.018 + Math.random() * 0.024) * (i % 2 === 0 ? 1 : -1),
        baseY: m.position.y,
      };
      this.mistGroup.add(m);
      this.mistPlanes.push(m);
    }
    this.scene.add(this.mistGroup);

    // Diagonal sunbreak god-ray shafts
    this.godRayGroup = new THREE.Group();
    const rayGeo = new THREE.PlaneGeometry(18, 95);
    this.godRayMat = new THREE.MeshBasicMaterial({
      map: this.softMistTex,
      color: 0xffb870,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    for (let i = 0; i < 7; i++) {
      const ray = new THREE.Mesh(rayGeo, this.godRayMat);
      ray.position.set((i - 3) * 22 + 12, 36, -42 - (i % 3) * 16);
      ray.rotation.z = -0.46;
      ray.rotation.x = 0.22;
      this.godRayGroup.add(ray);
    }
    this.scene.add(this.godRayGroup);
    this._syncMistQuality();
  }

  _setupLightningBolt() {
    const maxVerts = 42;
    const positions = new Float32Array(maxVerts * 3);
    const boltGeo = new THREE.BufferGeometry();
    boltGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.boltMat = new THREE.LineBasicMaterial({
      color: 0xe6f4ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
    });
    this.boltLine = new THREE.Line(boltGeo, this.boltMat);
    this.boltLine.frustumCulled = false;
    this.scene.add(this.boltLine);
  }

  _triggerLightning() {
    this.lightningFlash = 1.0;

    // Generate jagged fork bolt in the storm sky behind the monoliths
    const attr = this.boltLine.geometry.attributes.position;
    const angle = -Math.PI * 0.5 + (Math.random() - 0.5) * 2.1;
    const dist = 125 + Math.random() * 45;
    let x = Math.cos(angle) * dist;
    let z = Math.sin(angle) * dist;
    let y = 118;

    this.lightningLight.position.set(x, 95, z);

    const count = attr.count;
    for (let i = 0; i < count; i++) {
      attr.setXYZ(i, x, y, z);
      x += (Math.random() - 0.5) * 8.5;
      z += (Math.random() - 0.5) * 8.5;
      y -= 2.8 + Math.random() * 1.4;
    }
    attr.needsUpdate = true;

    const range = this.targetProfile.lightningInterval;
    this._nextLightningTimer = range[0] + Math.random() * (range[1] - range[0]);
    this.onThunder?.(0.75 + Math.random() * 0.35);
  }

  setMode(modeName) {
    if (!WEATHER_PROFILES[modeName] || modeName === this.currentMode) return;
    this.currentMode = modeName;
    this.targetProfile = WEATHER_PROFILES[modeName];
    this.scene.environment = this.envMaps[this.targetProfile.envKey];
  }

  get label() {
    return this.targetProfile.label;
  }

  _syncMistQuality() {
    const limit = this.quality.config.mistCount;
    this.mistPlanes.forEach((m, idx) => {
      m.visible = idx < limit;
    });
  }

  applyQuality() {
    const cfg = this.quality.config;
    this.rainMesh.geometry.instanceCount = cfg.rainCount;
    this.sunLight.shadow.mapSize.set(cfg.shadowMapSize, cfg.shadowMapSize);
    if (this.sunLight.shadow.map) {
      this.sunLight.shadow.map.dispose();
      this.sunLight.shadow.map = null;
    }
    this._syncMistQuality();
  }

  update(dt, elapsed, camera) {
    // Automatic atmospheric cycle when not forced by wave climax
    if (!this.lockedToWave) {
      this._modeCycleTimer -= dt;
      if (this._modeCycleTimer <= 0) {
        const order = ['MONSOON', 'SUNBREAK', 'SUPERCELL'];
        const next = order[(order.indexOf(this.currentMode) + 1) % order.length];
        this.setMode(next);
        this._modeCycleTimer = 26.0;
      }
    }

    const p = this.targetProfile;
    const lerpRate = Math.min(1.0, dt * 0.85);

    this.scene.fog.color.lerp(p.fogColor, lerpRate);
    this.scene.fog.density = THREE.MathUtils.lerp(this.scene.fog.density, p.fogDensity, lerpRate);

    this.skyTopColor.lerp(p.skyTop, lerpRate);
    this.skyHorizonColor.lerp(p.skyHorizon, lerpRate);
    this.sunColor.lerp(p.sunColor, lerpRate);

    this.sunLight.color.copy(this.sunColor);
    this.sunLight.intensity = THREE.MathUtils.lerp(this.sunLight.intensity, p.sunIntensity, lerpRate);
    this.hemiLight.color.lerp(p.hemiSky, lerpRate);
    this.hemiLight.groundColor.lerp(p.hemiGround, lerpRate);
    this.hemiLight.intensity = THREE.MathUtils.lerp(this.hemiLight.intensity, p.hemiIntensity, lerpRate);

    this.rainIntensity = THREE.MathUtils.lerp(this.rainIntensity, p.rainIntensity, lerpRate);
    this.rainMat.uniforms.uTime.value = elapsed;
    this.rainMat.uniforms.uCamPos.value.copy(camera.position);
    this.rainMat.uniforms.uOpacity.value = 0.36 * this.rainIntensity;
    this.rainMat.uniforms.uTint.value.copy(this.sunColor).lerp(new THREE.Color(0xb8d4ee), 0.65);

    this.godRayMat.opacity = THREE.MathUtils.lerp(this.godRayMat.opacity, p.godRayOpacity, lerpRate);
    this.godRayGroup.visible = this.godRayMat.opacity > 0.005;

    // Lightning updates
    this._nextLightningTimer -= dt;
    if (this._nextLightningTimer <= 0) {
      this._triggerLightning();
    }

    if (this.lightningFlash > 0.001) {
      this.lightningFlash = Math.max(0, this.lightningFlash - dt * 3.6);
      const flicker = this.lightningFlash > 0.45 ? (Math.sin(elapsed * 95.0) * 0.35 + 0.85) : this.lightningFlash;
      this.lightningLight.intensity = flicker * 7.5;
      this.boltMat.opacity = Math.min(1.0, flicker * 1.3);
      this.boltLine.visible = true;
    } else {
      this.lightningLight.intensity = 0;
      this.boltLine.visible = false;
    }

    this.skyMesh.position.copy(camera.position);
    this.skyMat.uniforms.uTime.value = elapsed;
    this.skyMat.uniforms.uLightning.value = this.lightningFlash;

    // Billboard low mist sheets toward camera
    this.mistMat.color.copy(this.skyHorizonColor).multiplyScalar(1.35);
    for (let i = 0; i < this.mistPlanes.length; i++) {
      const m = this.mistPlanes[i];
      if (!m.visible) continue;
      m.userData.baseAngle += m.userData.driftSpeed * dt;
      m.position.x = Math.cos(m.userData.baseAngle) * m.userData.radius;
      m.position.z = Math.sin(m.userData.baseAngle) * m.userData.radius;
      m.position.y = m.userData.baseY + Math.sin(elapsed * 0.4 + i) * 0.7;
      m.quaternion.copy(camera.quaternion);
    }
  }
}
