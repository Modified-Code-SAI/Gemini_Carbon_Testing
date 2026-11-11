import * as THREE from 'three';
import { MechRig } from '../entities/MechRig.js';

class MechEnemy {
  constructor(type, scene, textures, arena, water, vfx, audio, spawnPos) {
    this.type = type; // 'STRIKER' | 'BASTION' | 'BOSS'
    this.scene = scene;
    this.arena = arena;
    this.water = water;
    this.vfx = vfx;
    this.audio = audio;

    const isBoss = type === 'BOSS';
    const isBastion = type === 'BASTION';

    this.callsign = isBoss ? 'LEVIATHAN' : (isBastion ? 'BASTION' : 'STRIKER');
    this.scale = isBoss ? 2.15 : (isBastion ? 1.26 : 0.96);
    this.radius = 1.65 * this.scale;
    this.hitRadius = (isBoss ? 2.35 : 2.15) * this.scale;
    this.maxAp = isBoss ? 2400 : (isBastion ? 440 : 210);
    this.ap = this.maxAp;
    this.alive = true;

    this.mech = new MechRig(textures.armor, {
      armorColor: isBoss ? 0x262c33 : (isBastion ? 0x4b4239 : 0x36403e),
      trimColor: isBoss ? 0x5c2618 : (isBastion ? 0x2a2622 : 0x22292a),
      visorColor: isBoss ? 0xff4814 : 0xff3b1c,
      thrusterColor: isBoss ? 0xff6218 : 0xff7728,
      scale: this.scale,
      role: type,
    });

    this.pos = spawnPos.clone();
    this.pos.y = this.arena.getGroundHeight(this.pos.x, this.pos.z);
    this.vel = new THREE.Vector3();
    this.yaw = Math.atan2(-this.pos.x, -this.pos.z);

    this.mech.root.position.copy(this.pos);
    this.mech.root.rotation.y = this.yaw;
    this.scene.add(this.mech.root);

    this._strafeDir = Math.random() < 0.5 ? -1 : 1;
    this._aiTimer = 1.0 + Math.random() * 1.5;
    this._fireCooldown = 0.8 + Math.random() * 0.9;
    this._missileCooldown = isBoss ? 3.5 : 4.8 + Math.random() * 2.0;
    this._wakeTimer = 0;

    // Boss sweeping thermal laser state
    this.laserState = 'IDLE'; // 'IDLE' | 'CHARGE' | 'SWEEP'
    this.laserTimer = 6.5;
    this.laserSweepYaw = 0;
    if (isBoss) {
      this._initBossThermalBeam();
    }
  }

  _initBossThermalBeam() {
    const beamGeo = new THREE.CylinderGeometry(0.42, 0.68, 1, 12, 1, true);
    beamGeo.translate(0, 0.5, 0);
    beamGeo.rotateX(Math.PI * 0.5);

    this.beamMat = new THREE.MeshBasicMaterial({
      color: 0xff7a22,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.beamMesh = new THREE.Mesh(beamGeo, this.beamMat);
    this.beamMesh.visible = false;
    this.beamMesh.frustumCulled = false;
    this.scene.add(this.beamMesh);

    const coreGeo = new THREE.CylinderGeometry(0.14, 0.22, 1, 8, 1, true);
    coreGeo.translate(0, 0.5, 0);
    coreGeo.rotateX(Math.PI * 0.5);
    this.beamCoreMat = new THREE.MeshBasicMaterial({
      color: 0xfff0cc,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.beamCore = new THREE.Mesh(coreGeo, this.beamCoreMat);
    this.beamMesh.add(this.beamCore);
  }

  getTargetPoint(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + 2.75 * this.scale, this.pos.z);
  }

  takeDamage(amount, hitPos, hitDir) {
    if (!this.alive) return;
    this.ap -= amount;
    this.mech.flashHit();
    if (this.ap <= 0) {
      this.destroy(hitDir);
    }
  }

  destroy(hitDir) {
    if (!this.alive) return;
    this.alive = false;
    const center = this.getTargetPoint();
    const blastScale = this.type === 'BOSS' ? 2.6 : (this.type === 'BASTION' ? 1.45 : 1.15);

    this.vfx.spawnExplosion(center, blastScale, 0xff7e21);
    this.arena.spawnRubbleBurst(center, hitDir, this.type === 'BOSS' ? 26 : 10, 12.5);
    this.water.spawnRipple(this.pos.x, this.pos.z, 1.9);
    this.vfx.spawnWaterSplash(this.pos.x, this.pos.z, 1.6 * this.scale);
    this.audio?.playExplosion(this.type === 'BOSS' ? 1.3 : 0.9);

    this.scene.remove(this.mech.root);
    if (this.beamMesh) {
      this.scene.remove(this.beamMesh);
    }
  }

  dispose() {
    this.scene.remove(this.mech.root);
    if (this.beamMesh) this.scene.remove(this.beamMesh);
  }

  update(dt, elapsed, player, weapons) {
    if (!this.alive) return;

    const playerPos = player.getCenterChestPos();
    const myChest = this.getTargetPoint();
    const toPlayer = new THREE.Vector3().subVectors(playerPos, myChest);
    const horizDist = Math.hypot(toPlayer.x, toPlayer.z);
    const desiredYaw = Math.atan2(-toPlayer.x, -toPlayer.z);

    this._aiTimer -= dt;
    if (this._aiTimer <= 0) {
      this._aiTimer = 1.4 + Math.random() * 1.8;
      if (Math.random() < 0.55) this._strafeDir *= -1;
    }

    const isBoss = this.type === 'BOSS';
    const isStriker = this.type === 'STRIKER';
    const maxSpeed = isBoss ? 8.2 : (isStriker ? 18.5 : 9.8);
    const preferredRange = isBoss ? 34.0 : (isStriker ? 24.0 : 38.0);

    // Allow Boss to wade inside from outer North floodgate before clamping to arenaRadius
    const insideArena = Math.hypot(this.pos.x, this.pos.z) < this.arena.arenaRadius - 4.0;

    const fwd = new THREE.Vector3(toPlayer.x, 0, toPlayer.z).normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);

    let moveForward = 0;
    if (!insideArena) moveForward = 1.0;
    else if (horizDist > preferredRange + 7) moveForward = 0.85;
    else if (horizDist < preferredRange - 8) moveForward = -0.65;

    const strafeWeight = this.laserState === 'SWEEP' ? 0.0 : (isStriker ? 0.95 : 0.45);
    const desiredVel = new THREE.Vector3()
      .addScaledVector(fwd, moveForward * maxSpeed)
      .addScaledVector(right, this._strafeDir * strafeWeight * maxSpeed);

    this.vel.x = THREE.MathUtils.lerp(this.vel.x, desiredVel.x, Math.min(1, dt * 5.5));
    this.vel.z = THREE.MathUtils.lerp(this.vel.z, desiredVel.z, Math.min(1, dt * 5.5));

    this.pos.addScaledVector(this.vel, dt);
    this.arena.resolveHorizontalCollision(this.pos, this.radius, insideArena);
    this.pos.y = this.arena.getGroundHeight(this.pos.x, this.pos.z);

    // Smooth yaw turn
    const turnSpeed = this.laserState === 'SWEEP' ? 1.2 : (isBoss ? 2.6 : 6.0);
    const yawDiff = Math.atan2(Math.sin(desiredYaw - this.yaw), Math.cos(desiredYaw - this.yaw));
    this.yaw += yawDiff * Math.min(1, dt * turnSpeed);

    this.mech.root.position.copy(this.pos);
    this.mech.root.rotation.y = this.yaw;

    const speed = Math.hypot(this.vel.x, this.vel.z);
    const skating = isStriker && speed > 10.5;

    if (skating && this.pos.y <= 0.08) {
      this._wakeTimer -= dt;
      if (this._wakeTimer <= 0) {
        this._wakeTimer = 0.09;
        this.water.spawnRipple(this.pos.x, this.pos.z, 0.55);
      }
    }

    // Standard kinetic bursts
    this._fireCooldown -= dt;
    let rotaryActive = false;
    if (this._fireCooldown <= 0 && horizDist < 95 && this.laserState === 'IDLE') {
      rotaryActive = true;
      const muzzle = this.mech.getRightMuzzleWorldPos(new THREE.Vector3());
      const aimDir = new THREE.Vector3().subVectors(playerPos, muzzle).normalize();
      aimDir.x += (Math.random() - 0.5) * 0.055;
      aimDir.y += (Math.random() - 0.5) * 0.035;
      aimDir.z += (Math.random() - 0.5) * 0.055;
      aimDir.normalize();

      const boltDmg = isBoss ? 88 : (isStriker ? 52 : 68);
      weapons.spawnBolt(muzzle, aimDir, isBoss ? 112 : 96, boltDmg, false, 0xff5528);
      this.vfx.spawnLightFlash(muzzle, 0xff5a28, 8, 12, 0.05);
      this._fireCooldown = isBoss ? 0.16 : (isStriker ? 0.28 : 0.36);
    }

    // Arcing Homing Missile Salvos (Bastion & Leviathan Boss)
    if (this.type === 'BASTION' || isBoss) {
      this._missileCooldown -= dt;
      this.mech.setMissilePodsOpen(this._missileCooldown < 1.1 ? 1.0 : 0.0);
      if (this._missileCooldown <= 0 && horizDist < 105) {
        const count = isBoss ? 10 : 3;
        for (let i = 0; i < count; i++) {
          const side = i % 2 === 0 ? -1 : 1;
          const origin = myChest.clone().add(new THREE.Vector3(side * 1.4 * this.scale, 1.5 * this.scale, 0));
          const launchVel = new THREE.Vector3(
            (Math.random() - 0.5) * 18 + side * 10,
            19 + (i % 4) * 3,
            (Math.random() - 0.5) * 14
          );
          weapons.spawnMissile({
            origin,
            launchVel,
            target: null,
            fallbackPos: playerPos,
            isPlayer: false,
            damage: isBoss ? 125 : 95,
            speed: isBoss ? 34 : 31,
          });
        }
        this.audio?.playMissileLaunch(count);
        this._missileCooldown = isBoss ? 7.2 : 6.8 + Math.random() * 2.0;
      }
    }

    // Boss Sweeping Thermal Laser Attack (boils floodwater & shatters cover!)
    if (isBoss) {
      this._updateBossLaser(dt, player, playerPos);
    }

    const aimPitch = -Math.atan2(toPlayer.y, Math.max(horizDist, 1.0));
    this.mech.updateAnimation(dt, elapsed, {
      speed,
      lateralSpeed: 0,
      forwardSpeed: speed,
      isSkating: skating,
      isAirborne: false,
      aimYawOffset: THREE.MathUtils.clamp(yawDiff, -0.8, 0.8),
      aimPitch,
      rotaryFiring: rotaryActive,
      railRecoil: 0,
      heatRatio: isBoss ? 0.78 : 0.35,
      boostRatio: skating ? 0.7 : 0.2,
      onFootstep: (fp) => {
        if (this.pos.y <= 0.1) {
          this.water.spawnRipple(fp.x, fp.z, isBoss ? 1.35 : 0.55);
          if (isBoss) {
            this.vfx.spawnWaterSplash(fp.x, fp.z, 1.25);
            player.addCameraShake(Math.max(0, 0.12 * (1 - horizDist / 85)));
          }
        }
      },
    });
  }

  _updateBossLaser(dt, player, playerPos) {
    this.laserTimer -= dt;

    if (this.laserState === 'IDLE' && this.laserTimer <= 0) {
      this.laserState = 'CHARGE';
      this.laserTimer = 1.15;
      const muzzle = this.mech.getLeftMuzzleWorldPos(new THREE.Vector3());
      const toP = new THREE.Vector3().subVectors(playerPos, muzzle);
      this.laserSweepYaw = Math.atan2(toP.x, toP.z) - 0.52;
      this.beamMesh.visible = true;
      this.audio?.playRailCharge();
    } else if (this.laserState === 'CHARGE') {
      const muzzle = this.mech.getLeftMuzzleWorldPos(new THREE.Vector3());
      const dir = new THREE.Vector3(Math.sin(this.laserSweepYaw), -0.09, Math.cos(this.laserSweepYaw)).normalize();
      const targetPt = muzzle.clone().addScaledVector(dir, 85);

      this.beamMesh.position.copy(muzzle);
      this.beamMesh.lookAt(targetPt);
      this.beamMesh.scale.set(0.18, 0.18, 85);
      this.beamMat.opacity = 0.45;
      this.beamCoreMat.opacity = 0.65;

      if (this.laserTimer <= 0) {
        this.laserState = 'SWEEP';
        this.laserTimer = 2.4;
        this.audio?.playRailCannon(1.0);
      }
    } else if (this.laserState === 'SWEEP') {
      this.laserSweepYaw += dt * 0.48;
      const muzzle = this.mech.getLeftMuzzleWorldPos(new THREE.Vector3());
      const dir = new THREE.Vector3(Math.sin(this.laserSweepYaw), -0.095, Math.cos(this.laserSweepYaw)).normalize();

      let maxLen = 92.0;
      if (dir.y < -0.01) {
        const tWater = -muzzle.y / dir.y;
        if (tWater > 2 && tWater < maxLen) maxLen = tWater;
      }

      // Check destructible cover hit along beam
      for (const c of this.arena.covers) {
        if (!c.alive) continue;
        const toC = new THREE.Vector3(c.x - muzzle.x, 0, c.z - muzzle.z);
        const proj = toC.x * dir.x + toC.z * dir.z;
        if (proj > 1 && proj < maxLen) {
          const pt = muzzle.clone().addScaledVector(dir, proj);
          if (Math.hypot(pt.x - c.x, pt.z - c.z) <= c.colliderRadius + 0.5 && pt.y <= c.height) {
            maxLen = proj;
            this.arena.damageCover(c, 220 * dt, pt, dir, this.vfx, this.audio);
          }
        }
      }

      const endPt = muzzle.clone().addScaledVector(dir, maxLen);
      this.beamMesh.position.copy(muzzle);
      this.beamMesh.lookAt(endPt);
      this.beamMesh.scale.set(1.25, 1.25, maxLen);
      this.beamMat.opacity = 0.88;
      this.beamCoreMat.opacity = 0.98;

      // Boil floodwater with rising steam walls & ripples where thermal laser strikes!
      if (endPt.y <= 0.25) {
        this._steamTick = (this._steamTick || 0) - dt;
        if (this._steamTick <= 0) {
          this._steamTick = 0.055;
          this.water.spawnRipple(endPt.x, endPt.z, 0.95);
          this.vfx.spawnSteamPlume(endPt.x, endPt.z, 1.25);
          this.vfx.spawnSparks(endPt, null, 4, 0xffaa44, 0.8);
        }
      }

      // Check player laser hit (can jump over or hide behind column!)
      const pCenter = player.getCenterChestPos();
      const toP = pCenter.clone().sub(muzzle);
      const projP = toP.dot(dir);
      if (projP > 1 && projP < maxLen + 1.0) {
        const closest = muzzle.clone().addScaledVector(dir, projP);
        if (closest.distanceTo(pCenter) <= player.hitRadius + 0.7) {
          this._laserHitTick = (this._laserHitTick || 0) - dt;
          if (this._laserHitTick <= 0) {
            this._laserHitTick = 0.14;
            player.takeDamage(95);
          }
        }
      }

      if (this.laserTimer <= 0) {
        this.laserState = 'IDLE';
        this.laserTimer = 7.5;
        this.beamMesh.visible = false;
      }
    }
  }
}

class VTOLDroneEnemy {
  constructor(scene, textures, water, vfx, audio, spawnPos) {
    this.type = 'VTOL';
    this.callsign = 'VTOL-HUNTER';
    this.scene = scene;
    this.water = water;
    this.vfx = vfx;
    this.audio = audio;

    this.hitRadius = 1.65;
    this.maxAp = 115;
    this.ap = this.maxAp;
    this.alive = true;

    this.pos = spawnPos.clone();
    this.vel = new THREE.Vector3();
    this._orbitAngle = Math.atan2(spawnPos.z, spawnPos.x);
    this._orbitDir = Math.random() < 0.5 ? 1 : -1;
    this._orbitRadius = 30 + Math.random() * 20;
    this._altitude = 12.5 + Math.random() * 5.5;
    this._fireTimer = 1.2 + Math.random() * 1.4;

    this.root = new THREE.Group();
    const hullMat = new THREE.MeshStandardMaterial({
      color: 0x2f3840,
      map: textures.armor.albedoTex,
      normalMap: textures.armor.normalTex,
      roughness: 0.35,
      metalness: 0.85,
    });
    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0xff461c,
      emissive: new THREE.Color(0xff4218),
      emissiveIntensity: 4.5,
    });

    const fuselage = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.65, 2.4), hullMat);
    fuselage.castShadow = true;
    this.root.add(fuselage);

    for (const side of [-1, 1]) {
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 0.32, 12), hullMat);
      pod.position.set(side * 1.45, 0.1, 0.1);
      this.root.add(pod);
    }

    const sensor = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.18, 0.2), eyeMat);
    sensor.position.set(0, -0.05, -1.22);
    this.root.add(sensor);

    // Volumetric rain-piercing searchlight cone
    const coneGeo = new THREE.ConeGeometry(3.8, 18, 14, 1, true);
    coneGeo.translate(0, -9, 0);
    coneGeo.rotateX(-Math.PI * 0.32);
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0xffb066,
      transparent: true,
      opacity: 0.09,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.searchCone = new THREE.Mesh(coneGeo, coneMat);
    this.searchCone.position.set(0, -0.3, -0.8);
    this.root.add(this.searchCone);

    this.root.position.copy(this.pos);
    this.scene.add(this.root);
  }

  getTargetPoint(out = new THREE.Vector3()) {
    return out.copy(this.pos);
  }

  takeDamage(amount) {
    if (!this.alive) return;
    this.ap -= amount;
    if (this.ap <= 0) {
      this.alive = false;
      this.vfx.spawnExplosion(this.pos, 1.05, 0xff8c2b);
      this.water.spawnRipple(this.pos.x, this.pos.z, 1.1);
      this.audio?.playExplosion(0.7);
      this.scene.remove(this.root);
    }
  }

  dispose() {
    this.scene.remove(this.root);
  }

  update(dt, elapsed, player, weapons) {
    if (!this.alive) return;
    this._orbitAngle += this._orbitDir * dt * 0.42;
    const tx = Math.cos(this._orbitAngle) * this._orbitRadius;
    const tz = Math.sin(this._orbitAngle) * this._orbitRadius;
    const ty = this._altitude + Math.sin(elapsed * 2.4 + this._orbitRadius) * 1.1;

    this.pos.x = THREE.MathUtils.lerp(this.pos.x, tx, Math.min(1, dt * 2.5));
    this.pos.z = THREE.MathUtils.lerp(this.pos.z, tz, Math.min(1, dt * 2.5));
    this.pos.y = THREE.MathUtils.lerp(this.pos.y, ty, Math.min(1, dt * 3.0));

    this.root.position.copy(this.pos);
    const pCenter = player.getCenterChestPos();
    this.root.lookAt(pCenter.x, this.pos.y - 2.2, pCenter.z);

    this._fireTimer -= dt;
    if (this._fireTimer <= 0) {
      this._fireTimer = 1.45 + Math.random() * 0.85;
      const dir = new THREE.Vector3().subVectors(pCenter, this.pos).normalize();
      weapons.spawnBolt(this.pos, dir, 92, 42, false, 0xff6630);
      this.vfx.spawnLightFlash(this.pos, 0xff6630, 6, 12, 0.05);
    }
  }
}

export class EnemyDirector {
  constructor(scene, textures, arena, water, weather, vfx, audio, callbacks = {}) {
    this.scene = scene;
    this.textures = textures;
    this.arena = arena;
    this.water = water;
    this.weather = weather;
    this.vfx = vfx;
    this.audio = audio;
    this.callbacks = callbacks;

    this.enemies = [];
    this.currentWave = 0;
    this.totalKills = 0;
    this.waveDelayTimer = 0;
    this.bossRef = null;
    this.missionCleared = false;
  }

  clearAll() {
    for (const e of this.enemies) {
      e.dispose();
    }
    this.enemies.length = 0;
    this.bossRef = null;
  }

  startNewSortie() {
    this.clearAll();
    this.currentWave = 0;
    this.totalKills = 0;
    this.missionCleared = false;
    this.weather.lockedToWave = true;
    this._spawnNextWave();
  }

  _spawnNextWave() {
    this.currentWave += 1;

    if (this.currentWave === 1) {
      this.weather.setMode('MONSOON');
      this.callbacks.onWaveBanner?.('ENGAGEMENT PHASE 01', 'RECON STRIKER SQUADRON');

      const angles = [-0.65, 0.0, 0.65];
      for (const a of angles) {
        const sp = new THREE.Vector3(Math.sin(a) * 52, 0, -Math.cos(a) * 52);
        this.enemies.push(new MechEnemy('STRIKER', this.scene, this.textures, this.arena, this.water, this.vfx, this.audio, sp));
      }
      this.enemies.push(new VTOLDroneEnemy(this.scene, this.textures, this.water, this.vfx, this.audio, new THREE.Vector3(-28, 15, -30)));
      this.enemies.push(new VTOLDroneEnemy(this.scene, this.textures, this.water, this.vfx, this.audio, new THREE.Vector3(28, 15, -30)));
    } else if (this.currentWave === 2) {
      this.weather.setMode('SUNBREAK');
      this.callbacks.onWaveBanner?.('ENGAGEMENT PHASE 02 // STORM BREACH', 'HEAVY SIEGE DETACHMENT');

      for (const side of [-1, 1]) {
        const bPos = new THREE.Vector3(side * 26, 0, -48);
        this.enemies.push(new MechEnemy('BASTION', this.scene, this.textures, this.arena, this.water, this.vfx, this.audio, bPos));

        const sPos = new THREE.Vector3(side * 48, 0, -18);
        this.enemies.push(new MechEnemy('STRIKER', this.scene, this.textures, this.arena, this.water, this.vfx, this.audio, sPos));
      }
      this.enemies.push(new VTOLDroneEnemy(this.scene, this.textures, this.water, this.vfx, this.audio, new THREE.Vector3(0, 16, -44)));
    } else if (this.currentWave === 3) {
      this.weather.setMode('SUPERCELL');
      this.callbacks.onWaveBanner?.('WARNING // NORTH FLOODGATE BREACHED', 'COLOSSUS-09 // LEVIATHAN');

      // Spawn Leviathan wading in through the North (-Z) amphitheater sluiceway!
      const bossSpawn = new THREE.Vector3(0, 0, -82);
      const boss = new MechEnemy('BOSS', this.scene, this.textures, this.arena, this.water, this.vfx, this.audio, bossSpawn);
      this.bossRef = boss;
      this.enemies.push(boss);

      for (const side of [-1, 1]) {
        this.enemies.push(new VTOLDroneEnemy(this.scene, this.textures, this.water, this.vfx, this.audio, new THREE.Vector3(side * 34, 16, -50)));
      }
    }
  }

  get aliveCount() {
    let n = 0;
    for (const e of this.enemies) if (e.alive) n++;
    return n;
  }

  get waveLabel() {
    if (this.currentWave === 1) return 'WAVE 01 // RECON SQUADRON';
    if (this.currentWave === 2) return 'WAVE 02 // SIEGE DETACHMENT';
    return 'WAVE 03 // COLOSSUS-09 LEVIATHAN';
  }

  update(dt, elapsed, player, weapons) {
    if (this.missionCleared) return;

    let aliveNow = 0;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (!e.alive) {
        if (!e._countedKill) {
          e._countedKill = true;
          this.totalKills += 1;
          // Combat repair siphon on frame kill
          player.ap = Math.min(player.maxAp, player.ap + (e.type === 'BOSS' ? 2500 : 850));
        }
        continue;
      }
      aliveNow += 1;
      e.update(dt, elapsed, player, weapons);
    }

    if (aliveNow === 0) {
      if (this.currentWave >= 3) {
        this.missionCleared = true;
        this.callbacks.onVictory?.();
      } else {
        if (this.waveDelayTimer <= 0) {
          this.waveDelayTimer = 2.6;
        } else {
          this.waveDelayTimer -= dt;
          if (this.waveDelayTimer <= 0) {
            this._spawnNextWave();
          }
        }
      }
    }
  }
}
