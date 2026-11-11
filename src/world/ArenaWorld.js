import * as THREE from 'three';

const MAX_RUBBLE_CHUNKS = 320;

export class ArenaWorld {
  constructor(scene, textures, qualityManager, waterSystem, onCoverShattered) {
    this.scene = scene;
    this.textures = textures;
    this.quality = qualityManager;
    this.water = waterSystem;
    this.onCoverShattered = onCoverShattered;

    this.arenaRadius = 72.0;
    this.floorY = -0.55;
    this.covers = [];
    this.staticColliders = [];
    this.shatteredCount = 0;

    this._initMaterials();
    this._buildBasinAndColosseum();
    this._buildMonolithicArches();
    this._buildOuterSkylineSpires();
    this._buildDestructibleCover();
    this._initRubbleSimulation();
  }

  _initMaterials() {
    const c = this.textures.concrete;

    const repeatArch = c.albedoTex.clone();
    repeatArch.needsUpdate = true;
    repeatArch.repeat.set(3, 6);

    const normArch = c.normalTex.clone();
    normArch.needsUpdate = true;
    normArch.repeat.set(3, 6);

    const roughArch = c.roughTex.clone();
    roughArch.needsUpdate = true;
    roughArch.repeat.set(3, 6);

    this.concreteMat = new THREE.MeshStandardMaterial({
      color: 0x6f7880,
      map: c.albedoTex,
      normalMap: c.normalTex,
      normalScale: new THREE.Vector2(1.65, 1.65),
      roughnessMap: c.roughTex,
      roughness: 0.44, // rain-slicked concrete sheen
      metalness: 0.08,
      envMapIntensity: 1.35,
    });

    this.archConcreteMat = new THREE.MeshStandardMaterial({
      color: 0x5d666e,
      map: repeatArch,
      normalMap: normArch,
      normalScale: new THREE.Vector2(1.8, 1.8),
      roughnessMap: roughArch,
      roughness: 0.48,
      metalness: 0.1,
      envMapIntensity: 1.25,
    });

    this.darkBasinMat = new THREE.MeshStandardMaterial({
      color: 0x262d34,
      map: c.albedoTex,
      normalMap: c.normalTex,
      roughness: 0.65,
      metalness: 0.12,
    });

    this.rebarMat = new THREE.MeshStandardMaterial({
      color: 0x4a3228,
      roughness: 0.62,
      metalness: 0.78,
    });

    this.beaconMat = new THREE.MeshStandardMaterial({
      color: 0xff8822,
      emissive: new THREE.Color(0xff6a14),
      emissiveIntensity: 4.2,
      roughness: 0.2,
    });
  }

  _buildBasinAndColosseum() {
    const worldGroup = new THREE.Group();

    // Submerged stone colosseum floor beneath water y = 0
    const floorGeo = new THREE.CylinderGeometry(96, 96, 1.2, 64);
    const floorMesh = new THREE.Mesh(floorGeo, this.darkBasinMat);
    floorMesh.position.y = this.floorY - 0.6;
    floorMesh.receiveShadow = true;
    worldGroup.add(floorMesh);

    // Central raised tactical reactor dais (slightly emerges from water)
    const daisOuter = new THREE.Mesh(
      new THREE.CylinderGeometry(9.5, 11.2, 0.85, 16),
      this.concreteMat
    );
    daisOuter.position.y = -0.18;
    daisOuter.receiveShadow = true;
    daisOuter.castShadow = true;
    worldGroup.add(daisOuter);

    const daisInner = new THREE.Mesh(
      new THREE.CylinderGeometry(5.2, 6.0, 0.55, 8),
      this.archConcreteMat
    );
    daisInner.position.y = 0.12;
    daisInner.receiveShadow = true;
    worldGroup.add(daisInner);

    // Tiered sunken brutalist amphitheater steps surrounding the flooded basin
    // Leave 4 grand floodgate sluiceways at cardinal angles (0, PI/2, PI, 3PI/2)
    const tierCount = 6;
    const sectorCount = 24;
    const sectorArc = (Math.PI * 2) / sectorCount;

    for (let s = 0; s < sectorCount; s++) {
      // Cardinal sluiceway openings every 6 sectors (especially North -Z at s = 18)
      if (s % 6 === 0) continue;

      const angle = s * sectorArc;
      const sectorGroup = new THREE.Group();
      sectorGroup.rotation.y = -angle;

      for (let t = 0; t < tierCount; t++) {
        const radius = 74.5 + t * 3.1;
        const stepHeight = 1.35 + t * 1.45;
        const width = (2 * Math.PI * radius) / sectorCount * 0.94;
        const stepGeo = new THREE.BoxGeometry(3.3, stepHeight, width);
        const step = new THREE.Mesh(stepGeo, this.archConcreteMat);
        step.position.set(radius, stepHeight * 0.5 - 0.55, 0);
        step.castShadow = true;
        step.receiveShadow = true;
        sectorGroup.add(step);
      }

      // Brutalist sloped buttress rib separating amphitheater bays
      if (s % 2 === 1) {
        const ribGeo = new THREE.BoxGeometry(20.0, 13.5, 2.4);
        const rib = new THREE.Mesh(ribGeo, this.concreteMat);
        rib.position.set(83.5, 4.8, 0);
        rib.rotation.z = 0.28;
        rib.castShadow = true;
        rib.receiveShadow = true;
        sectorGroup.add(rib);
      }

      worldGroup.add(sectorGroup);
    }

    this.scene.add(worldGroup);
  }

  _buildMonolithicArches() {
    // Towering brutalist concrete colonnade arches ringing the amphitheater (matching key art)
    const archGroup = new THREE.Group();
    const archCount = 24;
    const ringRadius = 92.0;
    const pierHeight = 34.0;
    const spanWidth = (2 * Math.PI * ringRadius) / archCount;

    const pierGeo = new THREE.BoxGeometry(5.6, pierHeight, 4.6);
    const lintelGeo = new THREE.BoxGeometry(6.2, 4.8, spanWidth + 1.2);
    const archVaultGeo = new THREE.TorusGeometry((spanWidth - 4.2) * 0.5, 2.1, 10, 18, Math.PI);

    for (let i = 0; i < archCount; i++) {
      const theta = (i / archCount) * Math.PI * 2;
      const nextTheta = ((i + 0.5) / archCount) * Math.PI * 2;

      const px = Math.cos(theta) * ringRadius;
      const pz = Math.sin(theta) * ringRadius;

      const pier = new THREE.Mesh(pierGeo, this.archConcreteMat);
      pier.position.set(px, pierHeight * 0.5 + 4.0, pz);
      pier.rotation.y = -theta;
      pier.castShadow = true;
      pier.receiveShadow = true;
      archGroup.add(pier);

      // Upper entablature & arched vault spanning between piers
      const mx = Math.cos(nextTheta) * ringRadius;
      const mz = Math.sin(nextTheta) * ringRadius;

      const lintel = new THREE.Mesh(lintelGeo, this.archConcreteMat);
      lintel.position.set(mx, pierHeight + 5.8, mz);
      lintel.rotation.y = -nextTheta;
      lintel.castShadow = true;
      lintel.receiveShadow = true;
      archGroup.add(lintel);

      const vault = new THREE.Mesh(archVaultGeo, this.concreteMat);
      vault.position.set(mx, pierHeight - 2.2, mz);
      vault.rotation.y = -nextTheta + Math.PI * 0.5;
      vault.castShadow = true;
      archGroup.add(vault);
    }

    this.scene.add(archGroup);
  }

  _buildOuterSkylineSpires() {
    const spireGroup = new THREE.Group();
    this.beacons = [];

    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * Math.PI * 2 + 0.13;
      const dist = 138 + (i % 3) * 24;
      const h = 58 + (i % 4) * 22;
      const w = 12 + (i % 3) * 5;

      const tower = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, w * 1.3),
        this.darkBasinMat
      );
      tower.position.set(Math.cos(angle) * dist, h * 0.5 - 4, Math.sin(angle) * dist);
      tower.rotation.y = -angle + 0.2;
      spireGroup.add(tower);

      // Amber storm warning beacon atop megastructures
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.65, 8, 8), this.beaconMat);
      beacon.position.set(
        tower.position.x,
        h - 3.2,
        tower.position.z
      );
      spireGroup.add(beacon);
      this.beacons.push(beacon);
    }

    this.scene.add(spireGroup);
  }

  _createRebarCluster(width, height) {
    const group = new THREE.Group();
    const rodGeo = new THREE.CylinderGeometry(0.055, 0.055, height, 5);
    const count = 7;
    for (let i = 0; i < count; i++) {
      const rod = new THREE.Mesh(rodGeo, this.rebarMat);
      const ox = (Math.random() - 0.5) * width * 0.7;
      const oz = (Math.random() - 0.5) * width * 0.7;
      rod.position.set(ox, height * 0.45, oz);
      rod.rotation.set((Math.random() - 0.5) * 0.38, Math.random() * Math.PI, (Math.random() - 0.5) * 0.38);
      group.add(rod);
    }
    return group;
  }

  _buildDestructibleCover() {
    this.coverGroup = new THREE.Group();
    this.scene.add(this.coverGroup);

    const layouts = [];
    // Inner tactical colonnade ring (8 heavy columns)
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
      layouts.push({
        x: Math.cos(angle) * 25.5,
        z: Math.sin(angle) * 25.5,
        rotY: -angle,
        type: 'COLUMN',
      });
    }
    // Mid-outer bunker walls & pillars (12 tactical structures)
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      // Keep North Leviathan gate path slightly clearer
      if (Math.abs(Math.sin(angle) + 1.0) < 0.08) continue;
      layouts.push({
        x: Math.cos(angle) * 46.5,
        z: Math.sin(angle) * 46.5,
        rotY: -angle + Math.PI * 0.5,
        type: i % 2 === 0 ? 'BUNKER' : 'COLUMN',
      });
    }

    layouts.forEach((spec, id) => {
      const isColumn = spec.type === 'COLUMN';
      const width = isColumn ? 3.4 : 6.4;
      const depth = isColumn ? 3.4 : 2.5;
      const height = isColumn ? 10.5 : 5.6;
      const maxHp = isColumn ? 280 : 210;

      const root = new THREE.Group();
      root.position.set(spec.x, this.floorY, spec.z);
      root.rotation.y = spec.rotY;

      // Base plinth & shattered stump (always stays anchored in floor)
      const stumpHeight = 1.35;
      const stump = new THREE.Mesh(
        new THREE.BoxGeometry(width * 1.08, stumpHeight, depth * 1.08),
        this.concreteMat
      );
      stump.position.y = stumpHeight * 0.5;
      stump.castShadow = true;
      stump.receiveShadow = true;
      root.add(stump);

      // Lower mid-section (survives Stage 1 chip, shatters in Stage 2 collapse)
      const midHeight = (height - stumpHeight) * 0.56;
      const midMesh = new THREE.Mesh(
        new THREE.BoxGeometry(width, midHeight, depth),
        this.concreteMat
      );
      midMesh.position.y = stumpHeight + midHeight * 0.5;
      midMesh.castShadow = true;
      midMesh.receiveShadow = true;
      root.add(midMesh);

      // Upper crown section (shatters in Stage 1 < 55% HP)
      const topHeight = (height - stumpHeight) * 0.44;
      const topMesh = new THREE.Mesh(
        new THREE.BoxGeometry(width * 0.96, topHeight, depth * 0.96),
        this.archConcreteMat
      );
      topMesh.position.y = stumpHeight + midHeight + topHeight * 0.5;
      topMesh.castShadow = true;
      topMesh.receiveShadow = true;
      root.add(topMesh);

      // Exposed steel rebar cages (revealed on Stage 1 & Stage 2)
      const midRebar = this._createRebarCluster(width * 0.8, 2.2);
      midRebar.position.y = stumpHeight + midHeight - 0.3;
      midRebar.visible = false;
      root.add(midRebar);

      const baseRebar = this._createRebarCluster(width * 0.85, 2.0);
      baseRebar.position.y = stumpHeight - 0.2;
      baseRebar.visible = false;
      root.add(baseRebar);

      this.coverGroup.add(root);

      this.covers.push({
        id,
        type: spec.type,
        x: spec.x,
        z: spec.z,
        rotY: spec.rotY,
        width,
        depth,
        height,
        colliderRadius: Math.max(width, depth) * 0.52,
        hp: maxHp,
        maxHp,
        stage: 0, // 0: intact, 1: crown fractured, 2: collapsed
        alive: true,
        root,
        midMesh,
        topMesh,
        midRebar,
        baseRebar,
      });
    });
  }

  _initRubbleSimulation() {
    const chunkGeo = new THREE.DodecahedronGeometry(0.68, 0);
    this.rubbleInst = new THREE.InstancedMesh(chunkGeo, this.concreteMat, MAX_RUBBLE_CHUNKS);
    this.rubbleInst.castShadow = true;
    this.rubbleInst.receiveShadow = true;
    this.rubbleInst.frustumCulled = false;

    this.rubblePool = [];
    const zeroMat = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX_RUBBLE_CHUNKS; i++) {
      this.rubbleInst.setMatrixAt(i, zeroMat);
      this.rubblePool.push({
        active: false,
        settled: false,
        splashed: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        rot: new THREE.Euler(),
        angVel: new THREE.Vector3(),
        scale: new THREE.Vector3(1, 1, 1),
      });
    }
    this.rubbleInst.instanceMatrix.needsUpdate = true;
    this.scene.add(this.rubbleInst);
    this._rubbleCursor = 0;
    this._dummyObj = new THREE.Object3D();
  }

  spawnRubbleBurst(origin, impactDir, count = 12, spread = 8.5) {
    const mult = this.quality.config.debrisMultiplier;
    const actualCount = Math.max(4, Math.round(count * mult));

    for (let i = 0; i < actualCount; i++) {
      const slot = this.rubblePool[this._rubbleCursor];
      this._rubbleCursor = (this._rubbleCursor + 1) % MAX_RUBBLE_CHUNKS;

      slot.active = true;
      slot.settled = false;
      slot.splashed = origin.y <= 0.05;

      slot.pos.set(
        origin.x + (Math.random() - 0.5) * 2.4,
        origin.y + (Math.random() - 0.5) * 1.8,
        origin.z + (Math.random() - 0.5) * 2.4
      );

      const dirX = (impactDir ? impactDir.x * 0.55 : 0) + (Math.random() - 0.5) * 1.5;
      const dirZ = (impactDir ? impactDir.z * 0.55 : 0) + (Math.random() - 0.5) * 1.5;
      slot.vel.set(dirX * spread, 4.5 + Math.random() * 8.5, dirZ * spread);

      slot.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      slot.angVel.set((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9);
      slot.scale.set(
        0.55 + Math.random() * 0.95,
        0.42 + Math.random() * 0.75,
        0.55 + Math.random() * 0.95
      );
    }
  }

  damageCover(cover, damage, hitPoint, impactDir, vfx, audio) {
    if (!cover || !cover.alive) return false;
    cover.hp -= damage;

    // Stage 1: Upper concrete crown shatters exposing rebar
    if (cover.stage === 0 && cover.hp <= cover.maxHp * 0.55 && cover.hp > 0) {
      cover.stage = 1;
      cover.topMesh.visible = false;
      cover.midRebar.visible = true;
      const burstOrigin = new THREE.Vector3(cover.x, cover.height * 0.72, cover.z);
      this.spawnRubbleBurst(burstOrigin, impactDir, 10, 9.5);
      vfx?.spawnConcreteCollapse(burstOrigin, 0.75);
      audio?.playCoverFracture(0.65);
    }

    // Stage 2: Full structural collapse into the floodwater
    if (cover.hp <= 0 && cover.stage < 2) {
      cover.stage = 2;
      cover.alive = false;
      cover.topMesh.visible = false;
      cover.midMesh.visible = false;
      cover.midRebar.visible = false;
      cover.baseRebar.visible = true;

      const burstOrigin = new THREE.Vector3(cover.x, cover.height * 0.42, cover.z);
      this.spawnRubbleBurst(burstOrigin, impactDir, 18, 11.5);
      this.water?.spawnRipple(cover.x, cover.z, 1.85);
      vfx?.spawnConcreteCollapse(burstOrigin, 1.35);
      audio?.playCoverFracture(1.0);
      this.shatteredCount += 1;
      this.onCoverShattered?.(cover);
      return true;
    }
    return false;
  }

  resetArena() {
    this.shatteredCount = 0;
    for (const c of this.covers) {
      c.hp = c.maxHp;
      c.stage = 0;
      c.alive = true;
      c.topMesh.visible = true;
      c.midMesh.visible = true;
      c.midRebar.visible = false;
      c.baseRebar.visible = false;
    }
    const zeroMat = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX_RUBBLE_CHUNKS; i++) {
      this.rubblePool[i].active = false;
      this.rubbleInst.setMatrixAt(i, zeroMat);
    }
    this.rubbleInst.instanceMatrix.needsUpdate = true;
  }

  /**
   * Resolves horizontal circle collision against intact destructible pillars & outer basin wall.
   */
  resolveHorizontalCollision(pos, entityRadius, allowArenaClamp = true) {
    if (allowArenaClamp) {
      const distFromCenter = Math.hypot(pos.x, pos.z);
      const maxR = this.arenaRadius - entityRadius;
      if (distFromCenter > maxR && distFromCenter > 0.001) {
        const scale = maxR / distFromCenter;
        pos.x *= scale;
        pos.z *= scale;
      }
    }

    for (let i = 0; i < this.covers.length; i++) {
      const c = this.covers[i];
      if (!c.alive) {
        // Collapsed stump can be jumped/stepped over if entity is elevated
        if (pos.y > 0.85) continue;
      } else if (pos.y > c.height - 0.4) {
        continue;
      }

      const minDist = (c.alive ? c.colliderRadius : c.colliderRadius * 0.72) + entityRadius;
      const dx = pos.x - c.x;
      const dz = pos.z - c.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < minDist * minDist && dSq > 1e-6) {
        const d = Math.sqrt(dSq);
        const push = (minDist - d) / d;
        pos.x += dx * push;
        pos.z += dz * push;
      }
    }
  }

  /**
   * Returns ground elevation under (x, z), accounting for central reactor dais.
   */
  getGroundHeight(x, z) {
    const r = Math.hypot(x, z);
    if (r < 5.3) return 0.38;
    if (r < 9.8) return 0.22;
    return this.floorY;
  }

  update(dt, elapsed, vfx) {
    // Subtle pulse on skyline storm beacons
    const pulse = 2.8 + Math.sin(elapsed * 3.6) * 1.6;
    this.beaconMat.emissiveIntensity = pulse;

    let matrixDirty = false;
    for (let i = 0; i < MAX_RUBBLE_CHUNKS; i++) {
      const chunk = this.rubblePool[i];
      if (!chunk.active || chunk.settled) continue;

      chunk.vel.y -= 25.0 * dt;
      chunk.pos.addScaledVector(chunk.vel, dt);
      chunk.rot.x += chunk.angVel.x * dt;
      chunk.rot.y += chunk.angVel.y * dt;
      chunk.rot.z += chunk.angVel.z * dt;

      // Water surface splash interaction when falling chunk crosses y = 0
      if (!chunk.splashed && chunk.pos.y <= 0.05) {
        chunk.splashed = true;
        chunk.vel.multiplyScalar(0.58);
        if (Math.random() < 0.45) {
          this.water?.spawnRipple(chunk.pos.x, chunk.pos.z, 0.55);
          vfx?.spawnWaterSplash(chunk.pos.x, chunk.pos.z, 0.7);
        }
      }

      const floorH = this.getGroundHeight(chunk.pos.x, chunk.pos.z) + chunk.scale.y * 0.34;
      if (chunk.pos.y <= floorH) {
        chunk.pos.y = floorH;
        chunk.vel.y *= -0.22;
        chunk.vel.x *= 0.62;
        chunk.vel.z *= 0.62;
        chunk.angVel.multiplyScalar(0.55);
        if (chunk.vel.lengthSq() < 0.12) {
          chunk.settled = true;
        }
      }

      this._dummyObj.position.copy(chunk.pos);
      this._dummyObj.rotation.copy(chunk.rot);
      this._dummyObj.scale.copy(chunk.scale);
      this._dummyObj.updateMatrix();
      this.rubbleInst.setMatrixAt(i, this._dummyObj.matrix);
      matrixDirty = true;
    }

    if (matrixDirty) {
      this.rubbleInst.instanceMatrix.needsUpdate = true;
    }
  }
}
