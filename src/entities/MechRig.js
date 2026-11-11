import * as THREE from 'three';

let SHARED_MECH_ASSETS = null;

function getSharedMechAssets(armorTextures) {
  if (SHARED_MECH_ASSETS) return SHARED_MECH_ASSETS;

  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x181d22,
    roughness: 0.44,
    metalness: 0.88,
    envMapIntensity: 1.3,
  });

  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xb6c2cc,
    roughness: 0.16,
    metalness: 0.96,
    envMapIntensity: 1.7,
  });

  const darkGunMat = new THREE.MeshStandardMaterial({
    color: 0x20262c,
    map: armorTextures.albedoTex,
    normalMap: armorTextures.normalTex,
    roughness: 0.36,
    metalness: 0.86,
  });

  SHARED_MECH_ASSETS = {
    frameMat,
    chromeMat,
    darkGunMat,
    boxGeo: new THREE.BoxGeometry(1, 1, 1),
    cylGeo: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
    octGeo: new THREE.CylinderGeometry(0.42, 0.54, 1, 6),
    coneGeo: new THREE.ConeGeometry(0.5, 1.4, 12, 1, true),
  };
  return SHARED_MECH_ASSETS;
}

function addPart(parent, geo, mat, sx, sy, sz, px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, castShadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(px, py, pz);
  if (rx || ry || rz) m.rotation.set(rx, ry, rz);
  m.castShadow = castShadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

export class MechRig {
  /**
   * @param {object} armorTextures - PBR maps from TextureFactory
   * @param {object} options - { palette, visorColor, thrusterColor, scale, role }
   */
  constructor(armorTextures, options = {}) {
    const shared = getSharedMechAssets(armorTextures);
    const {
      armorColor = 0x454f59,
      trimColor = 0x2c343d,
      visorColor = 0xff7b1a,
      thrusterColor = 0xff8c2b,
      scale = 1.0,
      role = 'PLAYER', // 'PLAYER' | 'STRIKER' | 'BASTION' | 'BOSS'
    } = options;

    this.role = role;
    this.scale = scale;
    this.root = new THREE.Group();
    this.root.scale.setScalar(scale);

    this.armorMat = new THREE.MeshPhysicalMaterial({
      color: armorColor,
      map: armorTextures.albedoTex,
      normalMap: armorTextures.normalTex,
      normalScale: new THREE.Vector2(1.55, 1.55),
      roughnessMap: armorTextures.roughTex,
      roughness: 0.32,
      metalness: 0.62,
      clearcoat: 0.38,
      clearcoatRoughness: 0.24,
      envMapIntensity: 1.9,
    });

    this.trimMat = new THREE.MeshStandardMaterial({
      color: trimColor,
      map: armorTextures.albedoTex,
      normalMap: armorTextures.normalTex,
      roughness: 0.38,
      metalness: 0.58,
      envMapIntensity: 1.65,
    });

    this.visorMat = new THREE.MeshStandardMaterial({
      color: visorColor,
      emissive: new THREE.Color(visorColor),
      emissiveIntensity: 4.8,
      roughness: 0.15,
    });

    this.thrusterPlumeMat = new THREE.MeshBasicMaterial({
      color: thrusterColor,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.ventGlowMat = new THREE.MeshStandardMaterial({
      color: 0xff5a14,
      emissive: new THREE.Color(0xff520c),
      emissiveIntensity: 0.3,
      roughness: 0.3,
    });

    this.thrusterCones = [];
    this.ventFins = [];
    this.missilePodDoors = [];

    this._stridePhase = Math.random() * Math.PI * 2;
    this._prevLeftSign = 1;
    this._prevRightSign = -1;
    this._hitFlashTimer = 0;
    this._baseArmorColor = new THREE.Color(armorColor);

    this._buildChassis(shared);
  }

  _buildChassis(s) {
    // 1. Pelvis & Hip Assembly (standing height ~4.6m at scale 1.0)
    this.pelvis = new THREE.Group();
    this.pelvis.position.y = 2.35;
    this.root.add(this.pelvis);

    addPart(this.pelvis, s.boxGeo, this.armorMat, 1.25, 0.52, 0.92, 0, 0, 0);
    // Front armored codpiece bevel
    addPart(this.pelvis, s.octGeo, this.trimMat, 0.56, 0.66, 0.55, 0, -0.08, -0.44, 0.18, 0, 0);
    // Side hip Vernier skirts
    addPart(this.pelvis, s.boxGeo, this.trimMat, 0.24, 0.58, 0.98, -0.74, -0.05, 0, 0, 0, 0.16);
    addPart(this.pelvis, s.boxGeo, this.trimMat, 0.24, 0.58, 0.98, 0.74, -0.05, 0, 0, 0, -0.16);

    // 2. Heavy Articulated Bipedal Legs
    this.leftLeg = this._buildLeg(s, -0.68);
    this.rightLeg = this._buildLeg(s, 0.68);

    // 3. Upper Torso Gimbal (rotates independently to aim)
    this.torsoYaw = new THREE.Group();
    this.torsoYaw.position.y = 0.32;
    this.pelvis.add(this.torsoYaw);

    this.torsoPitch = new THREE.Group();
    this.torsoYaw.add(this.torsoPitch);

    // Hydraulic waist abdomen + chrome pistons
    addPart(this.torsoPitch, s.cylGeo, s.frameMat, 0.82, 0.56, 0.76, 0, 0.24, 0);
    addPart(this.torsoPitch, s.cylGeo, s.chromeMat, 0.14, 0.55, 0.14, -0.34, 0.28, -0.24, 0.1, 0, -0.08);
    addPart(this.torsoPitch, s.cylGeo, s.chromeMat, 0.14, 0.55, 0.14, 0.34, 0.28, -0.24, 0.1, 0, 0.08);

    // Main sloped brutalist chest core
    const isHeavy = this.role === 'BASTION' || this.role === 'BOSS';
    const chestW = isHeavy ? 1.95 : 1.68;
    addPart(this.torsoPitch, s.boxGeo, this.armorMat, chestW, 0.96, 1.24, 0, 0.92, 0);
    // Angled front glacis chest plate
    addPart(this.torsoPitch, s.boxGeo, this.armorMat, chestW * 0.78, 0.76, 0.48, 0, 0.88, -0.62, -0.26, 0, 0);
    // Collar armor guards flanking head
    addPart(this.torsoPitch, s.boxGeo, this.trimMat, 0.32, 0.42, 0.88, -0.52, 1.44, -0.06, 0, 0, -0.2);
    addPart(this.torsoPitch, s.boxGeo, this.trimMat, 0.32, 0.42, 0.88, 0.52, 1.44, -0.06, 0, 0, 0.2);

    // 4. Recessed Industrial Helmet & Glowing T-Slit Optical Visor (matching key art)
    this.head = new THREE.Group();
    this.head.position.set(0, 1.52, -0.14);
    this.torsoPitch.add(this.head);

    addPart(this.head, s.octGeo, this.armorMat, 0.68, 0.44, 0.74, 0, 0.08, 0, 0, Math.PI / 6, 0);
    // Horizontal visor bar + vertical T-slit
    addPart(this.head, s.boxGeo, this.visorMat, 0.48, 0.085, 0.08, 0, 0.11, -0.34, 0, 0, 0, false);
    addPart(this.head, s.boxGeo, this.visorMat, 0.1, 0.16, 0.08, 0, 0.03, -0.34, 0, 0, 0, false);
    // Blade sensor antenna
    addPart(this.head, s.boxGeo, this.trimMat, 0.05, 0.42, 0.16, 0.26, 0.36, 0.1, -0.28, 0, 0.12);

    // 5. Angled Twin Back Turbines, Vernier Thrusters & Thermal Radiator Fins
    this.backpack = new THREE.Group();
    this.backpack.position.set(0, 0.98, 0.72);
    this.torsoPitch.add(this.backpack);

    addPart(this.backpack, s.boxGeo, this.trimMat, 1.16, 0.82, 0.52, 0, 0, 0);

    for (const side of [-1, 1]) {
      const pod = new THREE.Group();
      pod.position.set(side * 0.52, 0.28, 0.16);
      pod.rotation.set(-0.38, 0, side * -0.18);
      this.backpack.add(pod);

      // Cylindrical jet turbine housing (matching key art silhouette)
      addPart(pod, s.cylGeo, this.armorMat, 0.48, 1.18, 0.48, 0, 0.12, 0);
      addPart(pod, s.cylGeo, s.frameMat, 0.38, 0.28, 0.38, 0, -0.52, 0);

      // Animated shock-diamond thruster flame cone
      const plume = new THREE.Mesh(s.coneGeo, this.thrusterPlumeMat);
      plume.scale.set(0.38, 1.15, 0.38);
      plume.position.set(0, -1.25, 0);
      plume.rotation.x = Math.PI;
      pod.add(plume);
      this.thrusterCones.push(plume);

      // Hinged thermal radiator fin
      const finPivot = new THREE.Group();
      finPivot.position.set(side * 0.36, -0.05, 0.24);
      this.backpack.add(finPivot);
      addPart(finPivot, s.boxGeo, this.ventGlowMat, 0.09, 0.54, 0.32, side * 0.08, 0, 0.12, 0, 0, 0, false);
      this.ventFins.push({ pivot: finPivot, side });
    }

    // 6. Dual Hinged VLS Shoulder Missile Pods
    for (const side of [-1, 1]) {
      const podGroup = new THREE.Group();
      podGroup.position.set(side * (chestW * 0.5 + 0.36), 1.48, 0.08);
      this.torsoPitch.add(podGroup);

      addPart(podGroup, s.boxGeo, this.trimMat, 0.62, 0.46, 0.84, 0, 0, 0);
      // Crimson/amber warhead tips inside pod
      addPart(podGroup, s.boxGeo, this.ventGlowMat, 0.48, 0.3, 0.08, 0, 0.02, -0.4, 0, 0, 0, false);

      // Hinged blast door on top/front
      const door = new THREE.Group();
      door.position.set(0, 0.23, -0.38);
      podGroup.add(door);
      addPart(door, s.boxGeo, this.armorMat, 0.6, 0.08, 0.46, 0, 0, 0.2);
      this.missilePodDoors.push(door);
    }

    // 7. Articulated Right Arm + GAU-9 6-Barrel Rotary Autocannon
    this.rightShoulder = new THREE.Group();
    this.rightShoulder.position.set(chestW * 0.5 + 0.34, 1.12, 0);
    this.torsoPitch.add(this.rightShoulder);
    this._buildArmWithRotary(s, this.rightShoulder);

    // 8. Articulated Left Arm + HV-88 Tungsten Rail-Cannon & Ballistic Shield
    this.leftShoulder = new THREE.Group();
    this.leftShoulder.position.set(-(chestW * 0.5 + 0.34), 1.12, 0);
    this.torsoPitch.add(this.leftShoulder);
    this._buildArmWithRailAndShield(s, this.leftShoulder);
  }

  _buildLeg(s, hipX) {
    const hip = new THREE.Group();
    hip.position.set(hipX, -0.14, 0);
    this.pelvis.add(hip);

    // Upper thigh armor & inner piston
    addPart(hip, s.boxGeo, this.armorMat, 0.54, 1.06, 0.64, 0, -0.52, 0);
    addPart(hip, s.cylGeo, s.chromeMat, 0.14, 0.85, 0.14, 0, -0.48, 0.26);

    const knee = new THREE.Group();
    knee.position.set(0, -1.04, -0.04);
    hip.add(knee);

    // Heavy protruding knee shield bevel
    addPart(knee, s.octGeo, this.trimMat, 0.52, 0.52, 0.52, 0, 0.06, -0.26, 0.25, 0, 0);

    // Lower shin greave
    addPart(knee, s.boxGeo, this.armorMat, 0.58, 1.08, 0.72, 0, -0.54, 0.05);
    addPart(knee, s.boxGeo, s.frameMat, 0.42, 0.95, 0.46, 0, -0.56, 0.22);

    // Heel hydro-skate Vernier thruster nozzle + plume
    const heelPlume = new THREE.Mesh(s.coneGeo, this.thrusterPlumeMat);
    heelPlume.scale.set(0.24, 0.75, 0.24);
    heelPlume.position.set(0, -0.88, 0.62);
    heelPlume.rotation.x = -Math.PI * 0.55;
    knee.add(heelPlume);
    this.thrusterCones.push(heelPlume);

    // Wide mechanical stabilizer foot
    const ankle = new THREE.Group();
    ankle.position.set(0, -1.12, 0.04);
    knee.add(ankle);

    addPart(ankle, s.boxGeo, this.trimMat, 0.68, 0.24, 1.06, 0, -0.06, -0.14);
    addPart(ankle, s.boxGeo, this.armorMat, 0.28, 0.2, 0.48, -0.2, -0.08, -0.56, 0.14, 0, 0);
    addPart(ankle, s.boxGeo, this.armorMat, 0.28, 0.2, 0.48, 0.2, -0.08, -0.56, 0.14, 0, 0);

    const footWorldAnchor = new THREE.Object3D();
    footWorldAnchor.position.set(0, -0.16, -0.1);
    ankle.add(footWorldAnchor);

    return { hip, knee, ankle, footWorldAnchor };
  }

  _buildArmWithRotary(s, shoulder) {
    // Heavy curved pauldron
    addPart(shoulder, s.boxGeo, this.armorMat, 0.68, 0.58, 0.86, 0.12, 0.08, 0, 0, 0, -0.18);
    addPart(shoulder, s.cylGeo, s.frameMat, 0.36, 0.78, 0.36, 0.08, -0.45, 0);

    this.rightElbow = new THREE.Group();
    this.rightElbow.position.set(0.1, -0.84, 0);
    shoulder.add(this.rightElbow);
    this.rightElbow.rotation.x = 0.22;

    addPart(this.rightElbow, s.boxGeo, this.armorMat, 0.44, 0.72, 0.52, 0, -0.3, -0.14);

    // Underslung GAU-9 Rotary Minigun Assembly (matching key art)
    const gunRoot = new THREE.Group();
    gunRoot.position.set(0.06, -0.52, -0.55);
    this.rightElbow.add(gunRoot);

    // Receiver & cylindrical drum magazine
    addPart(gunRoot, s.boxGeo, s.darkGunMat, 0.38, 0.42, 0.92, 0, 0, 0);
    addPart(gunRoot, s.cylGeo, this.trimMat, 0.54, 0.38, 0.54, 0.26, -0.08, 0.08, 0, 0, Math.PI * 0.5);

    // Spinning 6-barrel cluster
    this.rotaryBarrelGroup = new THREE.Group();
    this.rotaryBarrelGroup.position.set(0, -0.03, -0.48);
    gunRoot.add(this.rotaryBarrelGroup);

    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const bx = Math.cos(a) * 0.105;
      const by = Math.sin(a) * 0.105;
      addPart(
        this.rotaryBarrelGroup,
        s.cylGeo,
        s.chromeMat,
        0.048,
        1.48,
        0.048,
        bx,
        by,
        -0.72,
        Math.PI * 0.5,
        0,
        0
      );
    }
    // Barrel clamp rings
    addPart(this.rotaryBarrelGroup, s.cylGeo, s.darkGunMat, 0.3, 0.09, 0.3, 0, 0, -0.95, Math.PI * 0.5, 0, 0);
    addPart(this.rotaryBarrelGroup, s.cylGeo, s.darkGunMat, 0.3, 0.09, 0.3, 0, 0, -1.36, Math.PI * 0.5, 0, 0);

    this.rightMuzzle = new THREE.Object3D();
    this.rightMuzzle.position.set(0, -0.03, -2.02);
    gunRoot.add(this.rightMuzzle);
  }

  _buildArmWithRailAndShield(s, shoulder) {
    // Heavy left pauldron
    addPart(shoulder, s.boxGeo, this.armorMat, 0.68, 0.58, 0.86, -0.12, 0.08, 0, 0, 0, 0.18);
    addPart(shoulder, s.cylGeo, s.frameMat, 0.36, 0.78, 0.36, -0.08, -0.45, 0);

    this.leftElbow = new THREE.Group();
    this.leftElbow.position.set(-0.1, -0.84, 0);
    shoulder.add(this.leftElbow);
    this.leftElbow.rotation.x = 0.26;

    addPart(this.leftElbow, s.boxGeo, this.armorMat, 0.44, 0.72, 0.52, 0, -0.3, -0.14);

    // Heavy Angled Ballistic Forearm Shield (matching key art left arm)
    const shield = new THREE.Group();
    shield.position.set(-0.34, -0.26, -0.22);
    shield.rotation.set(0.08, 0.24, 0.12);
    this.leftElbow.add(shield);
    addPart(shield, s.boxGeo, this.armorMat, 0.14, 1.48, 0.88, 0, 0, 0);
    addPart(shield, s.boxGeo, this.trimMat, 0.16, 1.12, 0.52, -0.03, 0.06, -0.16);

    // HV-88 Twin-Rail Electromagnetic Cannon
    this.railGunRoot = new THREE.Group();
    this.railGunRoot.position.set(-0.04, -0.48, -0.58);
    this.leftElbow.add(this.railGunRoot);

    addPart(this.railGunRoot, s.boxGeo, s.darkGunMat, 0.34, 0.38, 0.88, 0, 0, 0);
    // Upper & lower accelerator rails
    addPart(this.railGunRoot, s.boxGeo, this.trimMat, 0.18, 0.11, 1.65, 0, 0.11, -1.12);
    addPart(this.railGunRoot, s.boxGeo, this.trimMat, 0.18, 0.11, 1.65, 0, -0.11, -1.12);
    // Glowing plasma-amber railgun core strip
    addPart(this.railGunRoot, s.boxGeo, this.ventGlowMat, 0.07, 0.08, 1.48, 0, 0, -1.08, 0, 0, 0, false);

    this.leftMuzzle = new THREE.Object3D();
    this.leftMuzzle.position.set(0, 0, -2.0);
    this.railGunRoot.add(this.leftMuzzle);
  }

  flashHit() {
    this._hitFlashTimer = 0.11;
  }

  setMissilePodsOpen(openRatio) {
    const rot = -openRatio * 1.15;
    for (const d of this.missilePodDoors) {
      d.rotation.x = rot;
    }
  }

  getRightMuzzleWorldPos(targetVec) {
    this.rightMuzzle.getWorldPosition(targetVec);
    return targetVec;
  }

  getLeftMuzzleWorldPos(targetVec) {
    this.leftMuzzle.getWorldPosition(targetVec);
    return targetVec;
  }

  /**
   * Animates stride kinematics, hydro-skating posture, torso aim tracking,
   * rotary barrel spin, thruster plumes, and radiator vents.
   */
  updateAnimation(dt, elapsed, state) {
    const {
      speed = 0,
      lateralSpeed = 0,
      forwardSpeed = 0,
      isSkating = false,
      isAirborne = false,
      aimYawOffset = 0,
      aimPitch = 0,
      rotaryFiring = false,
      railRecoil = 0,
      heatRatio = 0.2,
      boostRatio = 0.0,
      onFootstep = null,
    } = state;

    // Hit flash feedback
    if (this._hitFlashTimer > 0) {
      this._hitFlashTimer -= dt;
      this.armorMat.emissive.setHex(0x4a220c);
      this.armorMat.emissiveIntensity = 0.36;
    } else {
      this.armorMat.emissive.setHex(0x000000);
      this.armorMat.emissiveIntensity = 0;
    }

    // Smooth upper-torso aim tracking
    this.torsoYaw.rotation.y = THREE.MathUtils.lerp(this.torsoYaw.rotation.y, aimYawOffset, Math.min(1, dt * 14));
    this.torsoPitch.rotation.x = THREE.MathUtils.lerp(
      this.torsoPitch.rotation.x,
      THREE.MathUtils.clamp(aimPitch, -0.55, 0.55),
      Math.min(1, dt * 14)
    );

    // Rotary barrel spin
    if (rotaryFiring) {
      this.rotaryBarrelGroup.rotation.z += dt * 32.0;
      this.rightElbow.position.z = Math.sin(elapsed * 55.0) * 0.045;
    } else {
      this.rightElbow.position.z = THREE.MathUtils.lerp(this.rightElbow.position.z, 0, Math.min(1, dt * 12));
    }

    // Railgun recoil kick
    this.railGunRoot.position.z = -0.58 + railRecoil * 0.36;

    // Thermal radiator vents open and glow when heat rises
    const ventOpen = THREE.MathUtils.smoothstep(heatRatio, 0.35, 0.95);
    this.ventGlowMat.emissiveIntensity = 0.45 + ventOpen * 5.2;
    for (const v of this.ventFins) {
      v.pivot.rotation.y = v.side * (0.15 + ventOpen * 0.65);
    }

    // Thruster flame cone scaling
    const plumePower = isSkating || isAirborne ? (1.35 + boostRatio * 1.15) : (speed > 1.5 ? 0.55 : 0.26);
    const flicker = 0.9 + Math.sin(elapsed * 62.0) * 0.14;
    this.thrusterCones.forEach((cone, idx) => {
      const baseW = idx < 2 ? 0.38 : 0.24;
      const baseL = idx < 2 ? 1.15 : 0.75;
      cone.scale.set(baseW * (0.8 + plumePower * 0.25), baseL * plumePower * flicker, baseW * (0.8 + plumePower * 0.25));
      cone.visible = plumePower > 0.18;
    });

    // Leg kinematics: Airborne vs Hydro-Skate vs Heavy Bipedal Stride
    if (isAirborne) {
      this.pelvis.position.y = THREE.MathUtils.lerp(this.pelvis.position.y, 2.28, dt * 8);
      this.pelvis.rotation.z = THREE.MathUtils.lerp(this.pelvis.rotation.z, -lateralSpeed * 0.012, dt * 8);
      this.pelvis.rotation.x = THREE.MathUtils.lerp(this.pelvis.rotation.x, forwardSpeed * 0.01, dt * 8);

      this.leftLeg.hip.rotation.x = THREE.MathUtils.lerp(this.leftLeg.hip.rotation.x, -0.35, dt * 8);
      this.leftLeg.knee.rotation.x = THREE.MathUtils.lerp(this.leftLeg.knee.rotation.x, 0.68, dt * 8);
      this.rightLeg.hip.rotation.x = THREE.MathUtils.lerp(this.rightLeg.hip.rotation.x, 0.15, dt * 8);
      this.rightLeg.knee.rotation.x = THREE.MathUtils.lerp(this.rightLeg.knee.rotation.x, 0.48, dt * 8);
    } else if (isSkating) {
      // Aggressive Armored Core crouched hydro-skate stance
      this.pelvis.position.y = THREE.MathUtils.lerp(this.pelvis.position.y, 1.98, dt * 10);
      this.pelvis.rotation.z = THREE.MathUtils.lerp(this.pelvis.rotation.z, -lateralSpeed * 0.016, dt * 10);
      this.pelvis.rotation.x = THREE.MathUtils.lerp(this.pelvis.rotation.x, forwardSpeed * 0.012 + 0.1, dt * 10);

      this.leftLeg.hip.rotation.x = THREE.MathUtils.lerp(this.leftLeg.hip.rotation.x, -0.52, dt * 10);
      this.leftLeg.knee.rotation.x = THREE.MathUtils.lerp(this.leftLeg.knee.rotation.x, 0.82, dt * 10);
      this.leftLeg.ankle.rotation.x = THREE.MathUtils.lerp(this.leftLeg.ankle.rotation.x, -0.28, dt * 10);

      this.rightLeg.hip.rotation.x = THREE.MathUtils.lerp(this.rightLeg.hip.rotation.x, 0.22, dt * 10);
      this.rightLeg.knee.rotation.x = THREE.MathUtils.lerp(this.rightLeg.knee.rotation.x, 0.56, dt * 10);
      this.rightLeg.ankle.rotation.x = THREE.MathUtils.lerp(this.rightLeg.ankle.rotation.x, -0.45, dt * 10);
    } else if (speed > 0.6) {
      // Heavy mechanical bipedal stride with water footstrike detection
      const strideRate = Math.min(8.2, 2.8 + speed * 0.36);
      this._stridePhase += dt * strideRate;

      const sL = Math.sin(this._stridePhase);
      const sR = Math.sin(this._stridePhase + Math.PI);
      const liftL = Math.max(0, Math.cos(this._stridePhase));
      const liftR = Math.max(0, Math.cos(this._stridePhase + Math.PI));

      const bob = Math.abs(Math.cos(this._stridePhase)) * 0.14;
      this.pelvis.position.y = 2.32 - bob;
      this.pelvis.rotation.z = sL * 0.045;
      this.pelvis.rotation.x = THREE.MathUtils.lerp(this.pelvis.rotation.x, 0.04, dt * 8);

      this.leftLeg.hip.rotation.x = -sL * 0.52 - liftL * 0.22;
      this.leftLeg.knee.rotation.x = 0.18 + liftL * 0.68;
      this.leftLeg.ankle.rotation.x = sL * 0.24 - liftL * 0.3;

      this.rightLeg.hip.rotation.x = -sR * 0.52 - liftR * 0.22;
      this.rightLeg.knee.rotation.x = 0.18 + liftR * 0.68;
      this.rightLeg.ankle.rotation.x = sR * 0.24 - liftR * 0.3;

      // Detect foot plant into floodwater when cos crosses from positive to negative
      const cosL = Math.cos(this._stridePhase);
      const cosR = Math.cos(this._stridePhase + Math.PI);
      if (this._prevLeftSign > 0 && cosL <= 0 && onFootstep) {
        const wp = new THREE.Vector3();
        this.leftLeg.footWorldAnchor.getWorldPosition(wp);
        onFootstep(wp);
      }
      if (this._prevRightSign > 0 && cosR <= 0 && onFootstep) {
        const wp = new THREE.Vector3();
        this.rightLeg.footWorldAnchor.getWorldPosition(wp);
        onFootstep(wp);
      }
      this._prevLeftSign = cosL;
      this._prevRightSign = cosR;
    } else {
      // Heavy hydraulic idle breathing
      const breathe = Math.sin(elapsed * 1.8) * 0.035;
      this.pelvis.position.y = THREE.MathUtils.lerp(this.pelvis.position.y, 2.34 + breathe, dt * 6);
      this.pelvis.rotation.z = THREE.MathUtils.lerp(this.pelvis.rotation.z, 0, dt * 6);
      this.pelvis.rotation.x = THREE.MathUtils.lerp(this.pelvis.rotation.x, 0, dt * 6);

      this.leftLeg.hip.rotation.x = THREE.MathUtils.lerp(this.leftLeg.hip.rotation.x, -0.08, dt * 6);
      this.leftLeg.knee.rotation.x = THREE.MathUtils.lerp(this.leftLeg.knee.rotation.x, 0.16, dt * 6);
      this.leftLeg.ankle.rotation.x = THREE.MathUtils.lerp(this.leftLeg.ankle.rotation.x, -0.08, dt * 6);

      this.rightLeg.hip.rotation.x = THREE.MathUtils.lerp(this.rightLeg.hip.rotation.x, 0.06, dt * 6);
      this.rightLeg.knee.rotation.x = THREE.MathUtils.lerp(this.rightLeg.knee.rotation.x, 0.14, dt * 6);
      this.rightLeg.ankle.rotation.x = THREE.MathUtils.lerp(this.rightLeg.ankle.rotation.x, -0.2, dt * 6);
    }
  }
}
