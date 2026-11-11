import * as THREE from 'three';

const MAX_SPARKS = 650;
const MAX_PUFFS = 460;
const MAX_TRAIL_SEGS = 680;
const MAX_SHOCKWAVES = 22;
const MAX_LIGHTS = 6;

export class VFXSystem {
  constructor(scene, textures, qualityManager) {
    this.scene = scene;
    this.textures = textures;
    this.quality = qualityManager;

    this._dummy = new THREE.Object3D();
    this._upVec = new THREE.Vector3(0, 1, 0);
    this._tempVec = new THREE.Vector3();
    this._tempColor = new THREE.Color();

    this._initSparks();
    this._initSmokeAndSpray();
    this._initRibbonSegments();
    this._initShockwaves();
    this._initDynamicLights();
  }

  _initSparks() {
    const sparkGeo = new THREE.BoxGeometry(0.055, 0.055, 0.68);
    const sparkMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });

    this.sparkInst = new THREE.InstancedMesh(sparkGeo, sparkMat, MAX_SPARKS);
    this.sparkInst.frustumCulled = false;
    this.sparkPool = [];
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const baseCol = new THREE.Color(0xffb85c);

    for (let i = 0; i < MAX_SPARKS; i++) {
      this.sparkInst.setMatrixAt(i, zero);
      this.sparkInst.setColorAt(i, baseCol);
      this.sparkPool.push({
        active: false,
        age: 0,
        life: 0.5,
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

  _initSmokeAndSpray() {
    const puffGeo = new THREE.PlaneGeometry(1, 1);
    const puffMat = new THREE.MeshBasicMaterial({
      map: this.textures.softParticle,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });

    this.puffInst = new THREE.InstancedMesh(puffGeo, puffMat, MAX_PUFFS);
    this.puffInst.frustumCulled = false;
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

  _initRibbonSegments() {
    // Oriented smoke/plasma cylinder segments connecting missile & railgun paths
    const segGeo = new THREE.CylinderGeometry(0.16, 0.24, 1.0, 6, 1, true);
    segGeo.rotateX(Math.PI * 0.5);
    const segMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.trailInst = new THREE.InstancedMesh(segGeo, segMat, MAX_TRAIL_SEGS);
    this.trailInst.frustumCulled = false;
    this.trailPool = [];
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const col = new THREE.Color(0xd8e2ec);

    for (let i = 0; i < MAX_TRAIL_SEGS; i++) {
      this.trailInst.setMatrixAt(i, zero);
      this.trailInst.setColorAt(i, col);
      this.trailPool.push({
        active: false,
        age: 0,
        life: 0.65,
        mid: new THREE.Vector3(),
        quat: new THREE.Quaternion(),
        length: 1.0,
        radius: 1.0,
        startColor: new THREE.Color(0xffa448),
        endColor: new THREE.Color(0x4c5a68),
      });
    }
    this.trailInst.instanceMatrix.needsUpdate = true;
    this.trailInst.instanceColor.needsUpdate = true;
    this.scene.add(this.trailInst);
    this._trailCursor = 0;
  }

  _initShockwaves() {
    const sphereGeo = new THREE.SphereGeometry(1, 28, 18);
    this.shockwaves = [];
    for (let i = 0; i < MAX_SHOCKWAVES; i++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uColor: { value: new THREE.Color(0xffaa44) },
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
            float shell = pow(clamp(rim, 0.0, 1.0), 3.2);
            gl_FragColor = vec4(uColor * 1.4, shell * uOpacity);
          }
        `,
      });
      const mesh = new THREE.Mesh(sphereGeo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.shockwaves.push({
        mesh,
        mat,
        active: false,
        age: 0,
        life: 0.35,
        startRadius: 0.5,
        endRadius: 6.0,
        flatY: 1.0,
      });
    }
    this._shockCursor = 0;
  }

  _initDynamicLights() {
    this.lights = [];
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const light = new THREE.PointLight(0xff9436, 0, 26, 1.6);
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
      const s = this.sparkPool[this._sparkCursor];
      this._sparkCursor = (this._sparkCursor + 1) % MAX_SPARKS;
      s.active = true;
      s.age = 0;
      s.life = 0.24 + Math.random() * 0.36;
      s.pos.copy(pos);

      const speed = (10 + Math.random() * 22) * speedScale;
      const dx = (normalOrDir ? normalOrDir.x * 0.65 : 0) + (Math.random() - 0.5) * 1.6;
      const dy = (normalOrDir ? Math.abs(normalOrDir.y) * 0.5 : 0.35) + Math.random() * 1.1;
      const dz = (normalOrDir ? normalOrDir.z * 0.65 : 0) + (Math.random() - 0.5) * 1.6;
      s.vel.set(dx, dy, dz).normalize().multiplyScalar(speed);
      s.len = 0.65 + Math.random() * 1.15;

      this.sparkInst.setColorAt((this._sparkCursor + MAX_SPARKS - 1) % MAX_SPARKS, this._tempColor);
    }
    this.sparkInst.instanceColor.needsUpdate = true;
  }

  spawnPuff(pos, vel, startScale, endScale, life, colorHex) {
    const p = this.puffPool[this._puffCursor];
    const idx = this._puffCursor;
    this._puffCursor = (this._puffCursor + 1) % MAX_PUFFS;

    p.active = true;
    p.age = 0;
    p.life = life;
    p.pos.copy(pos);
    p.vel.copy(vel);
    p.startScale = startScale;
    p.endScale = endScale;
    p.baseColor.setHex(colorHex);
    this.puffInst.setColorAt(idx, p.baseColor);
    this.puffInst.instanceColor.needsUpdate = true;
  }

  spawnWaterSplash(x, z, scale = 1.0) {
    const count = Math.max(2, Math.round(4 * scale * this.quality.config.debrisMultiplier));
    for (let i = 0; i < count; i++) {
      const origin = new THREE.Vector3(
        x + (Math.random() - 0.5) * 1.1 * scale,
        0.25,
        z + (Math.random() - 0.5) * 1.1 * scale
      );
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 3.8 * scale,
        (3.4 + Math.random() * 4.5) * scale,
        (Math.random() - 0.5) * 3.8 * scale
      );
      this.spawnPuff(origin, vel, 0.9 * scale, 3.2 * scale, 0.55 + Math.random() * 0.25, 0xbfd4e6);
    }
  }

  spawnSteamPlume(x, z, scale = 1.0) {
    const origin = new THREE.Vector3(x + (Math.random() - 0.5) * 0.8, 0.35, z + (Math.random() - 0.5) * 0.8);
    const vel = new THREE.Vector3((Math.random() - 0.5) * 1.8, 4.2 + Math.random() * 3.5, (Math.random() - 0.5) * 1.8);
    this.spawnPuff(origin, vel, 1.3 * scale, 5.2 * scale, 0.85 + Math.random() * 0.35, 0xd8e6f2);
  }

  spawnConcreteCollapse(pos, scale = 1.0) {
    const count = Math.max(5, Math.round(11 * scale * this.quality.config.debrisMultiplier));
    for (let i = 0; i < count; i++) {
      const p = pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3.2, (Math.random() - 0.5) * 2.5, (Math.random() - 0.5) * 3.2));
      const v = new THREE.Vector3((Math.random() - 0.5) * 7.5, 1.5 + Math.random() * 4.5, (Math.random() - 0.5) * 7.5);
      this.spawnPuff(p, v, 2.2 * scale, 7.2 * scale, 1.1 + Math.random() * 0.5, 0x5c6670);
    }
    this.spawnSparks(pos, this._upVec, 18, 0xffaa4c, 1.15);
  }

  spawnShockwave(pos, startRadius = 0.6, endRadius = 7.5, life = 0.32, colorHex = 0xff9d3b, flatY = 1.0) {
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
    this.spawnLightFlash(pos, colorHex, 34 * scale, 38 * scale, 0.26);
    this.spawnShockwave(pos, 0.7 * scale, 8.5 * scale, 0.34, colorHex, 1.0);
    this.spawnShockwave(pos, 1.0 * scale, 12.0 * scale, 0.42, 0xffd28a, 0.16);
    this.spawnSparks(pos, this._upVec, Math.round(28 * scale), 0xffca72, 1.35 * scale);

    const smokeCount = Math.max(4, Math.round(9 * scale * this.quality.config.debrisMultiplier));
    for (let i = 0; i < smokeCount; i++) {
      const origin = pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.8 * scale, (Math.random() - 0.5) * 1.4 * scale, (Math.random() - 0.5) * 1.8 * scale));
      const vel = new THREE.Vector3((Math.random() - 0.5) * 8 * scale, (2.5 + Math.random() * 6.5) * scale, (Math.random() - 0.5) * 8 * scale);
      const col = i < 3 ? 0xff9838 : 0x2c333a;
      this.spawnPuff(origin, vel, 1.6 * scale, 6.2 * scale, 0.7 + Math.random() * 0.55, col);
    }
  }

  spawnTrailSegment(fromPos, toPos, radius = 0.55, life = 0.55, startHex = 0xffa64c, endHex = 0x52606e) {
    const delta = this._tempVec.subVectors(toPos, fromPos);
    const len = delta.length();
    if (len < 0.04) return;

    const slot = this.trailPool[this._trailCursor];
    this._trailCursor = (this._trailCursor + 1) % MAX_TRAIL_SEGS;
    slot.active = true;
    slot.age = 0;
    slot.life = life;
    slot.mid.addVectors(fromPos, toPos).multiplyScalar(0.5);
    slot.length = len * 1.08;
    slot.radius = radius;
    slot.startColor.setHex(startHex);
    slot.endColor.setHex(endHex);

    this._dummy.position.copy(fromPos);
    this._dummy.lookAt(toPos);
    slot.quat.copy(this._dummy.quaternion);
  }

  spawnRailBeam(startPos, endPos) {
    const totalVec = new THREE.Vector3().subVectors(endPos, startPos);
    const dist = totalVec.length();
    const steps = Math.max(4, Math.min(28, Math.ceil(dist / 4.5)));
    const prev = startPos.clone();
    const curr = new THREE.Vector3();

    for (let i = 1; i <= steps; i++) {
      curr.copy(startPos).addScaledVector(totalVec, i / steps);
      this.spawnTrailSegment(prev, curr, 1.05, 0.42, 0xffe29a, 0xff6a14);
      if (i % 3 === 0) {
        this.spawnShockwave(curr, 0.35, 2.8, 0.24, 0xffb858, 1.0);
      }
      prev.copy(curr);
    }
  }

  update(dt, camera) {
    const zeroScale = 0.00001;

    // 1. Update sparks
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
      this._dummy.scale.set(fade, fade, s.len * (0.4 + fade * 0.8));
      this._dummy.updateMatrix();
      this.sparkInst.setMatrixAt(i, this._dummy.matrix);
      sparkDirty = true;
    }
    if (sparkDirty) this.sparkInst.instanceMatrix.needsUpdate = true;

    // 2. Update billboarded smoke, dust & water spray puffs
    let puffDirty = false;
    let puffColorDirty = false;
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
      this._dummy.scale.setScalar(scale * (1.0 - t * 0.25));
      this._dummy.updateMatrix();
      this.puffInst.setMatrixAt(i, this._dummy.matrix);

      this._tempColor.copy(p.baseColor).multiplyScalar(1.0 - t);
      this.puffInst.setColorAt(i, this._tempColor);
      puffDirty = true;
      puffColorDirty = true;
    }
    if (puffDirty) this.puffInst.instanceMatrix.needsUpdate = true;
    if (puffColorDirty) this.puffInst.instanceColor.needsUpdate = true;

    // 3. Update missile & railgun ribbon trail segments
    let trailDirty = false;
    let trailColorDirty = false;
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
      const rad = seg.radius * (0.65 + t * 1.4) * (1.0 - t * 0.65);
      this._dummy.position.copy(seg.mid);
      this._dummy.quaternion.copy(seg.quat);
      this._dummy.scale.set(rad, rad, seg.length);
      this._dummy.updateMatrix();
      this.trailInst.setMatrixAt(i, this._dummy.matrix);

      this._tempColor.copy(seg.startColor).lerp(seg.endColor, Math.min(1, t * 1.5)).multiplyScalar(1.0 - t);
      this.trailInst.setColorAt(i, this._tempColor);
      trailDirty = true;
      trailColorDirty = true;
    }
    if (trailDirty) this.trailInst.instanceMatrix.needsUpdate = true;
    if (trailColorDirty) this.trailInst.instanceColor.needsUpdate = true;

    // 4. Update shockwaves
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
      sw.mat.uniforms.uOpacity.value = (1.0 - t) * 0.92;
    }

    // 5. Update pooled dynamic point lights
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
