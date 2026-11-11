import * as THREE from 'three';

const MAX_BOLTS = 160;
const MAX_MISSILES = 64;

export class WeaponSystem {
  constructor(scene, arena, water, vfx, audio, onPlayerHitmarker) {
    this.scene = scene;
    this.arena = arena;
    this.water = water;
    this.vfx = vfx;
    this.audio = audio;
    this.onHitmarker = onPlayerHitmarker;

    // Player weapon timers & states
    this.rotaryCooldown = 0;
    this.rotaryFiring = false;
    this.rotarySpread = 0.012;

    this.railCharge = 0; // 0..1
    this.railCooldown = 0;
    this.railRecoil = 0;
    this._wasMouseR = false;

    this.maxMissileCells = 12;
    this.missileAmmo = 12;
    this.missileReloadTimer = 0;
    this.isLocking = false;
    this.lockTargets = []; // array of enemy refs (can contain duplicates for multi-lock!)
    this._lockTickTimer = 0;
    this._wasMissileHold = false;

    this.pulseCooldown = 0;
    this.pulseMaxCooldown = 9.0;

    this._dummy = new THREE.Object3D();
    this._tempVec = new THREE.Vector3();
    this._tempVec2 = new THREE.Vector3();

    this._initKineticBolts();
    this._initMissiles();
  }

  _initKineticBolts() {
    const boltGeo = new THREE.BoxGeometry(0.09, 0.09, 2.2);
    const boltMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });

    this.boltInst = new THREE.InstancedMesh(boltGeo, boltMat, MAX_BOLTS);
    this.boltInst.frustumCulled = false;
    this.bolts = [];
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const col = new THREE.Color(0xffbe64);

    for (let i = 0; i < MAX_BOLTS; i++) {
      this.boltInst.setMatrixAt(i, zero);
      this.boltInst.setColorAt(i, col);
      this.bolts.push({
        active: false,
        isPlayer: true,
        damage: 16,
        age: 0,
        life: 1.4,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
      });
    }
    this.boltInst.instanceMatrix.needsUpdate = true;
    this.boltInst.instanceColor.needsUpdate = true;
    this.scene.add(this.boltInst);
    this._boltCursor = 0;
  }

  _initMissiles() {
    const mGeo = new THREE.ConeGeometry(0.18, 0.95, 6);
    mGeo.rotateX(Math.PI * 0.5);
    const mMat = new THREE.MeshStandardMaterial({
      color: 0xd8dee4,
      emissive: new THREE.Color(0xff6b18),
      emissiveIntensity: 2.8,
      roughness: 0.3,
    });

    this.missileInst = new THREE.InstancedMesh(mGeo, mMat, MAX_MISSILES);
    this.missileInst.frustumCulled = false;
    this.missiles = [];
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);

    for (let i = 0; i < MAX_MISSILES; i++) {
      this.missileInst.setMatrixAt(i, zero);
      this.missiles.push({
        active: false,
        isPlayer: true,
        target: null,
        targetPos: new THREE.Vector3(),
        pos: new THREE.Vector3(),
        prevPos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        speed: 44,
        turnRate: 6.5,
        corkscrewPhase: 0,
        corkscrewAmp: 1.0,
        damage: 52,
        age: 0,
        life: 5.5,
        trailTimer: 0,
      });
    }
    this.missileInst.instanceMatrix.needsUpdate = true;
    this.scene.add(this.missileInst);
    this._missileCursor = 0;
  }

  reset() {
    this.rotaryCooldown = 0;
    this.rotaryFiring = false;
    this.railCharge = 0;
    this.railCooldown = 0;
    this.railRecoil = 0;
    this.missileAmmo = this.maxMissileCells;
    this.missileReloadTimer = 0;
    this.lockTargets.length = 0;
    this.pulseCooldown = 0;

    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX_BOLTS; i++) {
      this.bolts[i].active = false;
      this.boltInst.setMatrixAt(i, zero);
    }
    for (let i = 0; i < MAX_MISSILES; i++) {
      this.missiles[i].active = false;
      this.missileInst.setMatrixAt(i, zero);
    }
    this.boltInst.instanceMatrix.needsUpdate = true;
    this.missileInst.instanceMatrix.needsUpdate = true;
  }

  spawnBolt(origin, dir, speed, damage, isPlayer = true, colorHex = 0xffc66d) {
    const idx = this._boltCursor;
    this._boltCursor = (this._boltCursor + 1) % MAX_BOLTS;
    const b = this.bolts[idx];
    b.active = true;
    b.isPlayer = isPlayer;
    b.damage = damage;
    b.age = 0;
    b.life = 1.35;
    b.pos.copy(origin);
    b.vel.copy(dir).normalize().multiplyScalar(speed);
    this.boltInst.setColorAt(idx, new THREE.Color(colorHex));
    this.boltInst.instanceColor.needsUpdate = true;
  }

  spawnMissile({ origin, launchVel, target, fallbackPos, isPlayer = true, damage = 54, speed = 46 }) {
    const idx = this._missileCursor;
    this._missileCursor = (this._missileCursor + 1) % MAX_MISSILES;
    const m = this.missiles[idx];

    m.active = true;
    m.isPlayer = isPlayer;
    m.target = target || null;
    if (fallbackPos) m.targetPos.copy(fallbackPos);
    else if (target) m.targetPos.copy(target.getTargetPoint());

    m.pos.copy(origin);
    m.prevPos.copy(origin);
    m.vel.copy(launchVel);
    m.speed = speed;
    m.turnRate = isPlayer ? 7.4 : 4.2;
    m.corkscrewPhase = Math.random() * Math.PI * 2;
    m.corkscrewAmp = isPlayer ? (12.0 + Math.random() * 8.0) : 6.0;
    m.damage = damage;
    m.age = 0;
    m.life = 5.2;
    m.trailTimer = 0;
  }

  countIncomingEnemyMissiles() {
    let c = 0;
    for (let i = 0; i < MAX_MISSILES; i++) {
      if (this.missiles[i].active && !this.missiles[i].isPlayer) c++;
    }
    return c;
  }

  _fireRailCannon(player, aimPoint, chargeFactor, enemies) {
    const muzzle = player.mech.getLeftMuzzleWorldPos(new THREE.Vector3());
    const dir = new THREE.Vector3().subVectors(aimPoint, muzzle).normalize();
    const maxDist = 175.0;
    let hitDist = maxDist;
    let hitCover = null;
    const damage = Math.round(75 + 135 * chargeFactor);

    // Check first concrete pillar intersection
    for (let i = 0; i < this.arena.covers.length; i++) {
      const c = this.arena.covers[i];
      if (!c.alive) continue;
      const toC = new THREE.Vector3(c.x - muzzle.x, 0, c.z - muzzle.z);
      const horizDirLen = Math.hypot(dir.x, dir.z) || 1e-4;
      const t = (toC.x * dir.x + toC.z * dir.z) / (horizDirLen * horizDirLen);
      if (t > 0.5 && t < hitDist) {
        const p = muzzle.clone().addScaledVector(dir, t);
        if (Math.hypot(p.x - c.x, p.z - c.z) <= c.colliderRadius && p.y <= c.height && p.y >= -0.6) {
          hitDist = t;
          hitCover = c;
        }
      }
    }

    // Water plane check
    if (dir.y < -0.01) {
      const tw = -muzzle.y / dir.y;
      if (tw > 1.0 && tw < hitDist) {
        hitDist = tw;
        hitCover = null;
      }
    }

    const endPoint = muzzle.clone().addScaledVector(dir, hitDist);

    // Pierce ALL enemies along the hyper-velocity slug line up to hitDist!
    let hitAnyEnemy = false;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.alive) continue;
      const ep = e.getTargetPoint();
      const toE = ep.clone().sub(muzzle);
      const proj = toE.dot(dir);
      if (proj > 0.5 && proj <= hitDist + 2.0) {
        const closest = muzzle.clone().addScaledVector(dir, proj);
        if (closest.distanceTo(ep) <= e.hitRadius * 1.35) {
          e.takeDamage(damage, closest, dir);
          this.vfx.spawnExplosion(closest, 0.85, 0xff9f38);
          hitAnyEnemy = true;
        }
      }
    }

    if (hitCover) {
      this.arena.damageCover(hitCover, damage * 1.15, endPoint, dir, this.vfx, this.audio);
    } else if (endPoint.y <= 0.15) {
      this.water.spawnRipple(endPoint.x, endPoint.z, 1.75);
      this.vfx.spawnWaterSplash(endPoint.x, endPoint.z, 1.6);
    }

    this.vfx.spawnLightFlash(muzzle, 0xffba58, 28, 30, 0.18);
    this.vfx.spawnRailBeam(muzzle, endPoint);
    this.vfx.spawnExplosion(endPoint, 0.78, 0xffaa44);
    this.audio?.playRailCannon(chargeFactor);
    player.addCameraShake(0.32 * (0.5 + chargeFactor * 0.5));
    this.railRecoil = 1.0;

    if (hitAnyEnemy) this.onHitmarker?.(true);
  }

  _triggerPulseArmor(player, enemies) {
    this.pulseCooldown = this.pulseMaxCooldown;
    const center = player.getCenterChestPos();

    this.vfx.spawnShockwave(center, 1.2, 17.5, 0.48, 0x7fd8ff, 1.0);
    this.vfx.spawnShockwave(center, 1.5, 19.0, 0.55, 0xffb258, 0.18);
    this.vfx.spawnLightFlash(center, 0x9be4ff, 36, 42, 0.32);
    this.water.spawnRipple(center.x, center.z, 2.1);
    this.vfx.spawnWaterSplash(center.x, center.z, 1.85);
    this.audio?.playPulseArmor();
    player.addCameraShake(0.35);

    // Vaporize incoming enemy bolts & missiles within 18.5m
    const radSq = 18.5 * 18.5;
    for (let i = 0; i < MAX_BOLTS; i++) {
      const b = this.bolts[i];
      if (b.active && !b.isPlayer && b.pos.distanceToSquared(center) <= radSq) {
        b.active = false;
        this.vfx.spawnSparks(b.pos, null, 6, 0x8ce2ff, 0.7);
      }
    }
    for (let i = 0; i < MAX_MISSILES; i++) {
      const m = this.missiles[i];
      if (m.active && !m.isPlayer && m.pos.distanceToSquared(center) <= radSq) {
        m.active = false;
        this.vfx.spawnExplosion(m.pos, 0.55, 0x8ce2ff);
      }
    }

    // Stagger & EMP-damage close hostiles
    for (const e of enemies) {
      if (!e.alive) continue;
      const ep = e.getTargetPoint();
      const d = ep.distanceTo(center);
      if (d <= 17.5) {
        const push = ep.clone().sub(center).normalize();
        e.takeDamage(95, ep, push);
        if (e.vel) e.vel.addScaledVector(push, 22.0);
        this.onHitmarker?.(true);
      }
    }
  }

  _acquireLockCandidate(camera, enemies) {
    const alive = enemies.filter((e) => e.alive);
    if (alive.length === 0) return null;

    // Score enemies inside forward camera cone, cycling evenly across visible targets
    const scored = [];
    const proj = new THREE.Vector3();
    for (const e of alive) {
      proj.copy(e.getTargetPoint()).project(camera);
      if (proj.z > 1.0 || proj.z < -1.0) continue;
      const screenDist = Math.hypot(proj.x, proj.y);
      if (screenDist < 0.72) {
        const existingCount = this.lockTargets.filter((t) => t === e).length;
        scored.push({ enemy: e, score: screenDist + existingCount * 0.35 });
      }
    }
    if (scored.length === 0) return null;
    scored.sort((a, b) => a.score - b.score);
    return scored[0].enemy;
  }

  _launchMissileBarrage(player, enemies) {
    // If player tapped Q/E quickly before painting locks, auto-snap up to 6 locks onto best target!
    if (this.lockTargets.length === 0 && this.missileAmmo > 0) {
      const quickTarget = this._acquireLockCandidate(player.camera, enemies);
      if (quickTarget) {
        const snapCount = Math.min(6, this.missileAmmo);
        for (let i = 0; i < snapCount; i++) this.lockTargets.push(quickTarget);
      }
    }

    const count = Math.min(this.lockTargets.length, this.missileAmmo);
    if (count === 0) {
      this.lockTargets.length = 0;
      return;
    }

    const chest = player.getCenterChestPos();
    const rightAxis = new THREE.Vector3(Math.cos(player.camYaw), 0, -Math.sin(player.camYaw));
    const fwdAxis = new THREE.Vector3(-Math.sin(player.camYaw), 0, -Math.cos(player.camYaw));

    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const origin = chest
        .clone()
        .addScaledVector(rightAxis, side * (1.25 + (i % 3) * 0.16))
        .add(new THREE.Vector3(0, 1.35, 0));

      // High-angle VLS fan launch for authentic Itano Circus arcing trajectories
      const fanAngle = side * (0.45 + (i / count) * 0.65);
      const launchVel = new THREE.Vector3()
        .addScaledVector(rightAxis, Math.sin(fanAngle) * 18.0)
        .addScaledVector(fwdAxis, 12.0)
        .add(new THREE.Vector3(0, 18.0 + (i % 4) * 3.5, 0));

      this.spawnMissile({
        origin,
        launchVel,
        target: this.lockTargets[i],
        isPlayer: true,
        damage: 54,
        speed: 48 + (i % 3) * 3,
      });

      this.vfx.spawnPuff(origin, new THREE.Vector3(side * 3, 4, 0), 0.7, 2.4, 0.45, 0xc8d4e0);
    }

    this.vfx.spawnLightFlash(chest.clone().setY(chest.y + 1.5), 0xff9436, 20, 22, 0.22);
    this.audio?.playMissileLaunch(count);
    player.addCameraShake(0.16);

    this.missileAmmo -= count;
    this.lockTargets.length = 0;
    if (this.missileAmmo <= 0) {
      this.missileReloadTimer = 4.2;
    }
  }

  update(dt, player, enemies, allowPlayerInput = true) {
    const aimPoint = player.computeAimPoint(enemies);

    // 1. Rotary Autocannon (LMB)
    this.rotaryCooldown = Math.max(0, this.rotaryCooldown - dt);
    this.rotaryFiring = allowPlayerInput && player.mouseDownL && player.heat < 98;
    if (this.rotaryFiring) {
      this.rotarySpread = Math.min(0.032, this.rotarySpread + dt * 0.025);
      if (this.rotaryCooldown <= 0) {
        this.rotaryCooldown = 0.074;
        const muzzle = player.mech.getRightMuzzleWorldPos(new THREE.Vector3());
        const dir = new THREE.Vector3().subVectors(aimPoint, muzzle).normalize();
        dir.x += (Math.random() - 0.5) * this.rotarySpread;
        dir.y += (Math.random() - 0.5) * this.rotarySpread;
        dir.z += (Math.random() - 0.5) * this.rotarySpread;
        dir.normalize();

        this.spawnBolt(muzzle, dir, 155, 19, true, 0xffc86b);
        this.vfx.spawnLightFlash(muzzle, 0xff9e3d, 10, 14, 0.055);
        this.vfx.spawnSparks(muzzle, dir, 4, 0xffd07a, 0.65);
        this.audio?.playAutocannon();
      }
    } else {
      this.rotarySpread = Math.max(0.01, this.rotarySpread - dt * 0.06);
    }

    // 2. Charged Tungsten Rail-Cannon (RMB)
    this.railCooldown = Math.max(0, this.railCooldown - dt);
    this.railRecoil = Math.max(0, this.railRecoil - dt * 3.8);

    if (allowPlayerInput && player.mouseDownR && this.railCooldown <= 0) {
      if (this.railCharge === 0) this.audio?.playRailCharge();
      this.railCharge = Math.min(1.0, this.railCharge + dt / 0.46);
      if (this.railCharge >= 1.0) {
        // Auto-release hyper-velocity slug at peak capacitor charge
        this._fireRailCannon(player, aimPoint, 1.0, enemies);
        this.railCharge = 0;
        this.railCooldown = 1.65;
      }
    } else if (this._wasMouseR && !player.mouseDownR && this.railCharge >= 0.28 && this.railCooldown <= 0) {
      this._fireRailCannon(player, aimPoint, this.railCharge, enemies);
      this.railCharge = 0;
      this.railCooldown = 1.35;
    } else if (!player.mouseDownR) {
      this.railCharge = Math.max(0, this.railCharge - dt * 3.5);
    }
    this._wasMouseR = allowPlayerInput && player.mouseDownR;

    // 3. Multi-Lock Homing Micro-Missiles (Q / E)
    if (this.missileReloadTimer > 0) {
      this.missileReloadTimer -= dt;
      if (this.missileReloadTimer <= 0) {
        this.missileAmmo = this.maxMissileCells;
      }
    } else if (this.missileAmmo < this.maxMissileCells && !player.missileHold) {
      // Passive cell replenishment when pods idle
      this._cellRegenAccum = (this._cellRegenAccum || 0) + dt;
      if (this._cellRegenAccum >= 0.65) {
        this._cellRegenAccum = 0;
        this.missileAmmo = Math.min(this.maxMissileCells, this.missileAmmo + 1);
      }
    }

    const holdingMissiles = allowPlayerInput && player.missileHold && this.missileAmmo > 0;
    this.isLocking = holdingMissiles;
    player.mech.setMissilePodsOpen(holdingMissiles ? 1.0 : 0.0);

    if (holdingMissiles) {
      this._lockTickTimer -= dt;
      if (this._lockTickTimer <= 0 && this.lockTargets.length < this.missileAmmo) {
        this._lockTickTimer = 0.085;
        const candidate = this._acquireLockCandidate(player.camera, enemies);
        if (candidate) {
          this.lockTargets.push(candidate);
          this.audio?.playLockChirp(this.lockTargets.length);
        }
      }
    } else if (this._wasMissileHold && !holdingMissiles) {
      this._launchMissileBarrage(player, enemies);
    }
    this._wasMissileHold = holdingMissiles;

    // 4. AEGIS Pulse Armor (F)
    this.pulseCooldown = Math.max(0, this.pulseCooldown - dt);
    if (player.pulseRequested) {
      player.pulseRequested = false;
      if (allowPlayerInput && this.pulseCooldown <= 0) {
        this._triggerPulseArmor(player, enemies);
      }
    }

    // 5. Simulate all Kinetic Bolts
    this._updateBolts(dt, player, enemies);

    // 6. Simulate all Corkscrew Homing Missiles
    this._updateMissiles(dt, player, enemies);
  }

  _updateBolts(dt, player, enemies) {
    const zeroScale = 0.00001;
    let dirty = false;

    for (let i = 0; i < MAX_BOLTS; i++) {
      const b = this.bolts[i];
      if (!b.active) continue;

      b.age += dt;
      if (b.age >= b.life) {
        b.active = false;
        this._dummy.scale.setScalar(zeroScale);
        this._dummy.updateMatrix();
        this.boltInst.setMatrixAt(i, this._dummy.matrix);
        dirty = true;
        continue;
      }

      b.pos.addScaledVector(b.vel, dt);
      let consumed = false;

      // Water impact
      if (b.pos.y <= 0.02) {
        consumed = true;
        if (Math.random() < 0.45) this.water.spawnRipple(b.pos.x, b.pos.z, 0.42);
        this.vfx.spawnWaterSplash(b.pos.x, b.pos.z, 0.45);
      }

      // Cover impact
      if (!consumed) {
        for (let cIdx = 0; cIdx < this.arena.covers.length; cIdx++) {
          const c = this.arena.covers[cIdx];
          if (!c.alive || b.pos.y > c.height) continue;
          const dx = b.pos.x - c.x;
          const dz = b.pos.z - c.z;
          if (dx * dx + dz * dz <= c.colliderRadius * c.colliderRadius) {
            consumed = true;
            this.arena.damageCover(c, b.damage * 0.55, b.pos, b.vel, this.vfx, this.audio);
            this.vfx.spawnSparks(b.pos, this._tempVec.set(dx, 0.4, dz).normalize(), 6, 0xffbc62, 0.7);
            break;
          }
        }
      }

      // Entity hit check
      if (!consumed) {
        if (b.isPlayer) {
          for (let eIdx = 0; eIdx < enemies.length; eIdx++) {
            const e = enemies[eIdx];
            if (!e.alive) continue;
            const ep = e.getTargetPoint();
            if (b.pos.distanceToSquared(ep) <= e.hitRadius * e.hitRadius) {
              consumed = true;
              e.takeDamage(b.damage, b.pos, b.vel);
              this.vfx.spawnSparks(b.pos, b.vel.clone().negate().normalize(), 9, 0xffca72, 0.85);
              this.onHitmarker?.(false);
              break;
            }
          }
        } else {
          const pc = player.getCenterChestPos(this._tempVec2);
          if (b.pos.distanceToSquared(pc) <= player.hitRadius * player.hitRadius) {
            consumed = true;
            player.takeDamage(b.damage);
            this.vfx.spawnSparks(b.pos, null, 10, 0xff6b3d, 0.85);
          }
        }
      }

      if (consumed) {
        b.active = false;
        this._dummy.scale.setScalar(zeroScale);
      } else {
        this._dummy.position.copy(b.pos);
        this._tempVec.copy(b.pos).add(b.vel);
        this._dummy.lookAt(this._tempVec);
        this._dummy.scale.set(1, 1, 1);
      }
      this._dummy.updateMatrix();
      this.boltInst.setMatrixAt(i, this._dummy.matrix);
      dirty = true;
    }

    if (dirty) this.boltInst.instanceMatrix.needsUpdate = true;
  }

  _updateMissiles(dt, player, enemies) {
    const zeroScale = 0.00001;
    let dirty = false;

    for (let i = 0; i < MAX_MISSILES; i++) {
      const m = this.missiles[i];
      if (!m.active) continue;

      m.age += dt;
      if (m.age >= m.life) {
        m.active = false;
        this.vfx.spawnExplosion(m.pos, 0.65, 0xff8a2b);
        this._dummy.scale.setScalar(zeroScale);
        this._dummy.updateMatrix();
        this.missileInst.setMatrixAt(i, this._dummy.matrix);
        dirty = true;
        continue;
      }

      // Update desired homing point
      if (m.isPlayer) {
        if (m.target && m.target.alive) {
          m.targetPos.copy(m.target.getTargetPoint());
        } else {
          // Retarget surviving enemy if original died mid-flight!
          const next = enemies.find((e) => e.alive);
          if (next) {
            m.target = next;
            m.targetPos.copy(next.getTargetPoint());
          }
        }
      } else {
        player.getCenterChestPos(m.targetPos);
      }

      const toTarget = this._tempVec.subVectors(m.targetPos, m.pos);
      const dist = toTarget.length();

      // Corkscrew homing steering after initial 0.14s vertical boost clearance
      if (m.age > 0.14 && dist > 0.1) {
        const desiredDir = toTarget.divideScalar(dist);
        const curDir = m.vel.clone().normalize();
        curDir.lerp(desiredDir, Math.min(1, dt * m.turnRate)).normalize();

        // Helical Itano Circus weave perpendicular to flight path, tightening near target
        m.corkscrewPhase += dt * 15.0;
        const weaveFade = THREE.MathUtils.clamp(dist / 22.0, 0.0, 1.0);
        const side = new THREE.Vector3(-curDir.z, 0, curDir.x).normalize();
        const up = new THREE.Vector3().crossVectors(side, curDir).normalize();

        m.vel.copy(curDir).multiplyScalar(m.speed);
        m.vel.addScaledVector(side, Math.cos(m.corkscrewPhase) * m.corkscrewAmp * weaveFade);
        m.vel.addScaledVector(up, Math.sin(m.corkscrewPhase) * m.corkscrewAmp * 0.65 * weaveFade);
      }

      m.pos.addScaledVector(m.vel, dt);

      // Emit GPU ribbon smoke trail segment
      m.trailTimer -= dt;
      if (m.trailTimer <= 0) {
        m.trailTimer = 0.026;
        const startCol = m.isPlayer ? 0xffae52 : 0xff5a36;
        this.vfx.spawnTrailSegment(m.prevPos, m.pos, 0.42, 0.52, startCol, 0x566472);
        m.prevPos.copy(m.pos);
      }

      let detonated = false;

      if (m.pos.y <= 0.05) {
        detonated = true;
        this.water.spawnRipple(m.pos.x, m.pos.z, 1.25);
        this.vfx.spawnWaterSplash(m.pos.x, m.pos.z, 1.15);
      }

      // Cover collision
      if (!detonated) {
        for (let cIdx = 0; cIdx < this.arena.covers.length; cIdx++) {
          const c = this.arena.covers[cIdx];
          if (!c.alive || m.pos.y > c.height) continue;
          const dx = m.pos.x - c.x;
          const dz = m.pos.z - c.z;
          if (dx * dx + dz * dz <= c.colliderRadius * c.colliderRadius) {
            detonated = true;
            this.arena.damageCover(c, m.damage * 0.9, m.pos, m.vel, this.vfx, this.audio);
            break;
          }
        }
      }

      // Entity detonation
      if (!detonated) {
        if (m.isPlayer) {
          for (let eIdx = 0; eIdx < enemies.length; eIdx++) {
            const e = enemies[eIdx];
            if (!e.alive) continue;
            if (m.pos.distanceTo(e.getTargetPoint()) <= e.hitRadius + 1.15) {
              detonated = true;
              e.takeDamage(m.damage, m.pos, m.vel);
              this.onHitmarker?.(true);
              break;
            }
          }
        } else {
          const pc = player.getCenterChestPos(this._tempVec2);
          if (m.pos.distanceTo(pc) <= player.hitRadius + 0.9) {
            detonated = true;
            player.takeDamage(m.damage);
          }
        }
      }

      if (detonated) {
        m.active = false;
        this.vfx.spawnExplosion(m.pos, 0.85, m.isPlayer ? 0xff8d2c : 0xff4e24);
        this.audio?.playExplosion(0.55);
        this._dummy.scale.setScalar(zeroScale);
      } else {
        this._dummy.position.copy(m.pos);
        this._tempVec.copy(m.pos).add(m.vel);
        this._dummy.lookAt(this._tempVec);
        this._dummy.scale.set(1, 1, 1);
      }
      this._dummy.updateMatrix();
      this.missileInst.setMatrixAt(i, this._dummy.matrix);
      dirty = true;
    }

    if (dirty) this.missileInst.instanceMatrix.needsUpdate = true;
  }
}
