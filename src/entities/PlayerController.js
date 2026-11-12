import * as THREE from 'three';
import { MechRig } from './MechRig.js';

export class PlayerController {
  constructor(scene, camera, textures, arena, water, vfx, audio, postPipeline) {
    this.scene = scene;
    this.camera = camera;
    this.arena = arena;
    this.water = water;
    this.vfx = vfx;
    this.audio = audio;
    this.post = postPipeline;

    this.mech = new MechRig(textures.armor, {
      armorColor: 0xbac7d4,
      trimColor: 0x6c7a88,
      visorColor: 0xff821c,
      thrusterColor: 0xff8f2e,
      scale: 1.0,
      role: 'PLAYER',
    });
    this.scene.add(this.mech.root);

    this.radius = 1.75;
    this.hitRadius = 2.15;
    this.maxAp = 10000;
    this.ap = this.maxAp;
    this.maxEn = 100;
    this.en = 100;
    this.heat = 18; // 0..100

    this.pos = new THREE.Vector3(0, this.arena.floorY, 32);
    this.vel = new THREE.Vector3();
    this.chassisYaw = 0;
    this.camYaw = 0;
    this.camPitch = -0.06;

    this.isSkating = false;
    this.isAirborne = false;
    this.quickBoostTimer = 0;
    this.invulnTimer = 0;
    this.cameraShake = 0;
    this._skateWakeTimer = 0;

    // Input state
    this.keys = new Set();
    this.mouseDownL = false;
    this.mouseDownR = false;
    this.missileHold = false;
    this.pulseRequested = false;

    this._camPivotPos = new THREE.Vector3(0, 4.2, 38);
    this._aimPoint = new THREE.Vector3();
    this._raycaster = new THREE.Raycaster();
    this._centerNdc = new THREE.Vector2(0, 0);
    this._lastClientX = null;
    this._lastClientY = null;

    this._bindInputs();
    this.reset();
  }

  _bindInputs() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const code = e.code;
      this.keys.add(code);

      if (code === 'ShiftLeft' || code === 'ShiftRight') {
        this._triggerQuickBoost();
      }
      if (code === 'KeyQ' || code === 'KeyE') {
        this.missileHold = true;
      }
      if (code === 'KeyF') {
        this.pulseRequested = true;
      }
    });

    window.addEventListener('keyup', (e) => {
      const code = e.code;
      this.keys.delete(code);
      if (code === 'KeyQ' || code === 'KeyE') {
        this.missileHold = false;
      }
    });

    window.addEventListener('mousedown', (e) => {
      const onCanvas = e.target && e.target.id === 'game-canvas';
      if (document.pointerLockElement !== document.body && !onCanvas) return;
      if (e.button === 0) this.mouseDownL = true;
      if (e.button === 2) this.mouseDownR = true;
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDownL = false;
      if (e.button === 2) this.mouseDownR = false;
    });

    window.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('mousemove', (e) => {
      const sens = 0.0021;
      if (document.pointerLockElement === document.body) {
        this.camYaw -= e.movementX * sens;
        this.camPitch = THREE.MathUtils.clamp(this.camPitch - e.movementY * sens, -0.68, 0.58);
      } else if (window.__IRON_DELUGE__?.state === 'PLAYING') {
        if (this._lastClientX !== null) {
          const dx = e.clientX - this._lastClientX;
          const dy = e.clientY - this._lastClientY;
          this.camYaw -= dx * sens;
          this.camPitch = THREE.MathUtils.clamp(this.camPitch - dy * sens, -0.68, 0.58);
        }
        this._lastClientX = e.clientX;
        this._lastClientY = e.clientY;
      }
    });
  }

  clearTransientInputs() {
    this.keys.clear();
    this.mouseDownL = false;
    this.mouseDownR = false;
    this.missileHold = false;
    this.pulseRequested = false;
  }

  reset() {
    this.ap = this.maxAp;
    this.en = this.maxEn;
    this.heat = 18;
    this.pos.set(0, this.arena.getGroundHeight(0, 34), 34);
    this.vel.set(0, 0, 0);
    this.chassisYaw = 0;
    this.camYaw = 0;
    this.camPitch = -0.05;
    this.isSkating = false;
    this.isAirborne = false;
    this.quickBoostTimer = 0;
    this.invulnTimer = 0;
    this.cameraShake = 0;
    this.mech.root.position.copy(this.pos);
    this.mech.root.rotation.y = this.chassisYaw;
    this._camPivotPos.set(0, 4.5, 42);
  }

  _triggerQuickBoost() {
    if (this.en < 18 || this.quickBoostTimer > 0.08) return;
    this.en = Math.max(0, this.en - 18);
    this.heat = Math.min(100, this.heat + 8);
    this.quickBoostTimer = 0.28;
    this.invulnTimer = 0.24;

    const moveVec = this._getMoveInputVector();
    if (moveVec.lengthSq() < 0.01) {
      moveVec.set(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
    } else {
      moveVec.normalize();
    }

    this.vel.x = moveVec.x * 38.0;
    this.vel.z = moveVec.z * 38.0;

    const waistPos = this.pos.clone().setY(this.pos.y + 2.2);
    this.vfx.spawnShockwave(waistPos, 0.8, 5.2, 0.25, 0xff9f3f, 1.0);
    this.vfx.spawnSparks(waistPos, moveVec.clone().negate(), 16, 0xffbe68, 0.9);
    if (this.pos.y <= 0.25) {
      this.water.spawnRipple(this.pos.x, this.pos.z, 1.45);
      this.vfx.spawnWaterSplash(this.pos.x, this.pos.z, 1.25);
    }
    this.audio?.playQuickBoost();
    this.addCameraShake(0.26);
  }

  _getMoveInputVector() {
    let ix = 0;
    let iz = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) iz -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) iz += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) ix -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) ix += 1;

    // Optional Gamepad polling
    const pads = navigator.getGamepads ? navigator.getGamepads() : null;
    if (pads && pads[0]) {
      const gp = pads[0];
      if (Math.abs(gp.axes[0]) > 0.16) ix += gp.axes[0];
      if (Math.abs(gp.axes[1]) > 0.16) iz += gp.axes[1];
      if (Math.abs(gp.axes[2]) > 0.16) this.camYaw -= gp.axes[2] * 0.042;
      if (Math.abs(gp.axes[3]) > 0.16) {
        this.camPitch = THREE.MathUtils.clamp(this.camPitch - gp.axes[3] * 0.032, -0.68, 0.58);
      }
    }

    const forward = new THREE.Vector3(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
    const right = new THREE.Vector3(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
    return new THREE.Vector3()
      .addScaledVector(forward, -iz)
      .addScaledVector(right, ix);
  }

  addCameraShake(amount) {
    this.cameraShake = Math.min(1.0, this.cameraShake + amount);
  }

  takeDamage(amount) {
    if (this.invulnTimer > 0 || this.ap <= 0) return false;
    this.ap = Math.max(0, this.ap - amount);
    this.mech.flashHit();
    this.addCameraShake(Math.min(0.55, amount / 900));
    this.post.addImpactShock(Math.min(0.65, amount / 800));
    this.audio?.playArmorHit();
    return true;
  }

  getCenterChestPos(target = new THREE.Vector3()) {
    return target.set(this.pos.x, this.pos.y + 3.25, this.pos.z);
  }

  /**
   * Computes world-space target point under the center reticle against enemies & cover.
   */
  computeAimPoint(enemies) {
    this._raycaster.setFromCamera(this._centerNdc, this.camera);
    const ray = this._raycaster.ray;

    let bestT = 165.0;

    // Check intact destructible cover cylinders
    for (let i = 0; i < this.arena.covers.length; i++) {
      const c = this.arena.covers[i];
      if (!c.alive) continue;
      // Approximate ray-sphere/cylinder check along column
      const center = new THREE.Vector3(c.x, c.height * 0.5, c.z);
      const toC = center.sub(ray.origin);
      const proj = toC.dot(ray.direction);
      if (proj > 4 && proj < bestT) {
        const closest = ray.origin.clone().addScaledVector(ray.direction, proj);
        const horizDist = Math.hypot(closest.x - c.x, closest.z - c.z);
        if (horizDist < c.colliderRadius && closest.y >= -0.5 && closest.y <= c.height) {
          bestT = proj;
        }
      }
    }

    // Check active enemies (magnetic aim assist within hitRadius * 1.15)
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.alive) continue;
      const eCenter = e.getTargetPoint();
      const toE = eCenter.clone().sub(ray.origin);
      const proj = toE.dot(ray.direction);
      if (proj > 3 && proj < bestT) {
        const closest = ray.origin.clone().addScaledVector(ray.direction, proj);
        if (closest.distanceTo(eCenter) <= e.hitRadius * 1.2) {
          bestT = proj;
        }
      }
    }

    // Check floodwater plane y = 0 if looking downward
    if (ray.direction.y < -0.02) {
      const tWater = -ray.origin.y / ray.direction.y;
      if (tWater > 4 && tWater < bestT) {
        bestT = tWater;
      }
    }

    return this._aimPoint.copy(ray.origin).addScaledVector(ray.direction, bestT);
  }

  update(dt, elapsed, combatState = {}) {
    const moveVec = this._getMoveInputVector();
    const hasMove = moveVec.lengthSq() > 0.01;
    if (hasMove) moveVec.normalize();

    const shiftHeld = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const jumpHeld = this.keys.has('Space');

    if (this.quickBoostTimer > 0) this.quickBoostTimer = Math.max(0, this.quickBoostTimer - dt);
    if (this.invulnTimer > 0) this.invulnTimer = Math.max(0, this.invulnTimer - dt);

    // Determine hydro-skate state
    this.isSkating = (shiftHeld && hasMove && this.en > 4) || this.quickBoostTimer > 0;

    if (this.quickBoostTimer <= 0) {
      const maxSpeed = this.isSkating ? 24.5 : 12.2;
      const accel = this.isSkating ? 11.5 : 14.0;
      const targetVx = hasMove ? moveVec.x * maxSpeed : 0;
      const targetVz = hasMove ? moveVec.z * maxSpeed : 0;

      this.vel.x = THREE.MathUtils.lerp(this.vel.x, targetVx, Math.min(1, dt * accel));
      this.vel.z = THREE.MathUtils.lerp(this.vel.z, targetVz, Math.min(1, dt * accel));
    }

    // Vertical Assault Jump & Hover Jets
    const groundY = this.arena.getGroundHeight(this.pos.x, this.pos.z);
    if (jumpHeld && this.en > 5) {
      if (!this.isAirborne) {
        this.vel.y = 13.5;
        this.isAirborne = true;
        this.en = Math.max(0, this.en - 10);
        if (this.pos.y <= 0.2) {
          this.water.spawnRipple(this.pos.x, this.pos.z, 1.3);
          this.vfx.spawnWaterSplash(this.pos.x, this.pos.z, 1.1);
        }
        this.audio?.playQuickBoost();
      } else {
        this.vel.y = Math.min(11.0, this.vel.y + 34.0 * dt);
        this.en = Math.max(0, this.en - 22.0 * dt);
        this.heat = Math.min(100, this.heat + 7.5 * dt);
      }
    } else {
      this.vel.y -= 28.0 * dt;
    }

    // Energy drain & regeneration
    if (this.isSkating && this.quickBoostTimer <= 0) {
      this.en = Math.max(0, this.en - 12.5 * dt);
      this.heat = Math.min(100, this.heat + 4.5 * dt);
    } else if (!jumpHeld && this.quickBoostTimer <= 0) {
      const regenRate = this.isAirborne ? 11.0 : 28.0;
      this.en = Math.min(this.maxEn, this.en + regenRate * dt);
    }

    // Thermal cooling
    const firingHeat = combatState.rotaryFiring ? 10.5 : -16.5;
    this.heat = THREE.MathUtils.clamp(this.heat + firingHeat * dt, 14, 100);

    // Integrate position & resolve arena / pillar collisions
    this.pos.addScaledVector(this.vel, dt);
    this.arena.resolveHorizontalCollision(this.pos, this.radius, true);

    if (this.pos.y <= groundY) {
      if (this.isAirborne && this.vel.y < -6.0) {
        // Heavy armored landing impact in floodwater
        if (groundY <= 0.05) {
          this.water.spawnRipple(this.pos.x, this.pos.z, 1.65);
          this.vfx.spawnWaterSplash(this.pos.x, this.pos.z, 1.45);
        }
        this.audio?.playFootstep(1.35);
        this.addCameraShake(0.18);
      }
      this.pos.y = groundY;
      this.vel.y = 0;
      this.isAirborne = false;
    } else {
      this.isAirborne = true;
    }

    // Orient lower chassis smoothly toward movement or camera heading
    const horizSpeed = Math.hypot(this.vel.x, this.vel.z);
    let desiredChassisYaw = this.camYaw;
    if (horizSpeed > 1.8 && !this.isSkating) {
      desiredChassisYaw = Math.atan2(-this.vel.x, -this.vel.z);
      // Keep legs within +-95 deg of camera so mech walks backward when retreating
      let diff = desiredChassisYaw - this.camYaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      if (Math.abs(diff) > Math.PI * 0.58) {
        desiredChassisYaw += Math.PI;
      }
    }
    let yawDelta = Math.atan2(
      Math.sin(desiredChassisYaw - this.chassisYaw),
      Math.cos(desiredChassisYaw - this.chassisYaw)
    );
    this.chassisYaw += yawDelta * Math.min(1, dt * 10.5);

    this.mech.root.position.copy(this.pos);
    this.mech.root.rotation.y = this.chassisYaw;

    // Continuous hydro-skate water rooster-tail wakes
    if (!this.isAirborne && this.pos.y <= 0.1 && (this.isSkating || horizSpeed > 14.0)) {
      this._skateWakeTimer -= dt;
      if (this._skateWakeTimer <= 0) {
        this._skateWakeTimer = 0.065;
        this.water.spawnRipple(this.pos.x, this.pos.z, 0.72);
        this.vfx.spawnWaterSplash(this.pos.x, this.pos.z, 0.62);
      }
    }

    // Local velocity components for procedural leg/pelvis banking
    const sinY = Math.sin(this.chassisYaw);
    const cosY = Math.cos(this.chassisYaw);
    const forwardSpeed = -(this.vel.x * sinY + this.vel.z * cosY);
    const lateralSpeed = this.vel.x * cosY - this.vel.z * sinY;

    let aimYawOffset = Math.atan2(
      Math.sin(this.camYaw - this.chassisYaw),
      Math.cos(this.camYaw - this.chassisYaw)
    );
    aimYawOffset = THREE.MathUtils.clamp(aimYawOffset, -1.35, 1.35);

    this.mech.updateAnimation(dt, elapsed, {
      speed: horizSpeed,
      lateralSpeed,
      forwardSpeed,
      isSkating: this.isSkating,
      isAirborne: this.isAirborne,
      aimYawOffset,
      aimPitch: this.camPitch,
      rotaryFiring: Boolean(combatState.rotaryFiring),
      railRecoil: combatState.railRecoil || 0,
      heatRatio: this.heat / 100,
      boostRatio: this.quickBoostTimer > 0 ? 1.0 : (this.isSkating ? 0.6 : 0.0),
      onFootstep: (footPos) => {
        if (this.pos.y <= 0.1) {
          this.water.spawnRipple(footPos.x, footPos.z, 0.62);
          this.vfx.spawnWaterSplash(footPos.x, footPos.z, 0.52);
        }
        this.audio?.playFootstep(0.85);
        this.addCameraShake(0.035);
      },
    });

    // Update turbine whine audio
    this.audio?.setThrusterLevel(this.quickBoostTimer > 0 ? 1.0 : (this.isSkating ? 0.65 : horizSpeed / 30));

    // Update PostFX boost streak intensity
    const targetBoostFX = this.quickBoostTimer > 0 ? 0.95 : (this.isSkating ? 0.32 : 0.0);
    this.post.boostIntensity = THREE.MathUtils.lerp(this.post.boostIntensity, targetBoostFX, Math.min(1, dt * 10));

    this._updateThirdPersonCamera(dt, horizSpeed);
  }

  _updateThirdPersonCamera(dt, horizSpeed) {
    // Dynamic FOV kick during hydro-skate & Quick-Boost
    const targetFov = this.quickBoostTimer > 0 ? 78 : (this.isSkating ? 70 : 62);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, Math.min(1, dt * 8.5));
      this.camera.updateProjectionMatrix();
    }

    // Over-the-shoulder offset in camera gimbal frame
    const camQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.camPitch, this.camYaw, 0, 'YXZ'));
    const shoulderOffset = new THREE.Vector3(1.48, 0.66, 8.65).applyQuaternion(camQuat);
    const anchor = new THREE.Vector3(this.pos.x, this.pos.y + 4.02, this.pos.z);
    const desiredCamPos = anchor.clone().add(shoulderOffset);

    // Prevent camera from dipping under floodwater or clipping outside colosseum steps
    desiredCamPos.y = Math.max(0.85, desiredCamPos.y);
    const camRad = Math.hypot(desiredCamPos.x, desiredCamPos.z);
    if (camRad > 66.8) {
      const s = 66.8 / camRad;
      desiredCamPos.x *= s;
      desiredCamPos.z *= s;
    }

    this._camPivotPos.lerp(desiredCamPos, Math.min(1, dt * 16.0));
    this.camera.position.copy(this._camPivotPos);
    this.camera.quaternion.copy(camQuat);

    // Apply trauma shake
    if (this.cameraShake > 0.001) {
      const s = this.cameraShake * this.cameraShake * 0.36;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.cameraShake = Math.max(0, this.cameraShake - dt * 2.9);
    }
  }
}
