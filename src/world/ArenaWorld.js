import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const MAX_RUBBLE_CHUNKS = 320;

/**
 * Creates an angular cleaved concrete fragment geometry by slicing a subdivided polyhedron
 * against several random fracture planes so rubble looks like real shattered masonry slabs.
 */
function createFracturedConcreteGeometry() {
  const base = new THREE.IcosahedronGeometry(0.42, 2);
  const pos = base.attributes.position;
  const planes = [
    { n: new THREE.Vector3(0.82, 0.48, 0.31).normalize(), d: 0.24 },
    { n: new THREE.Vector3(-0.75, 0.52, -0.40).normalize(), d: 0.25 },
    { n: new THREE.Vector3(0.18, -0.92, 0.35).normalize(), d: 0.20 },
    { n: new THREE.Vector3(-0.32, -0.28, 0.90).normalize(), d: 0.26 },
    { n: new THREE.Vector3(0.45, 0.22, -0.86).normalize(), d: 0.24 },
    { n: new THREE.Vector3(0.05, 0.96, -0.26).normalize(), d: 0.21 },
  ];

  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // Deterministic rough aggregate surface perturbation
    const hash = Math.sin(v.x * 19.3 + v.y * 31.7 + v.z * 23.1) * 0.038;
    v.multiplyScalar(1.0 + hash);

    for (const p of planes) {
      const dist = v.dot(p.n);
      if (dist > p.d) {
        v.addScaledVector(p.n, p.d - dist);
      }
    }
    pos.setXYZ(i, v.x, v.y, v.z);
  }

  const nonIndexed = base.toNonIndexed();
  nonIndexed.computeVertexNormals();
  base.dispose();
  return nonIndexed;
}

/**
 * Builds a true monumental vaulted brutalist arch bay with a semicircular cutout via ExtrudeGeometry.
 */
function createMonolithicArchBayGeometry(bayWidth, totalHeight, archRadius, pierStartH, depth) {
  const halfW = bayWidth * 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(-halfW, 0);
  shape.lineTo(halfW, 0);
  shape.lineTo(halfW, totalHeight);
  shape.lineTo(-halfW, totalHeight);
  shape.closePath();

  // Carve clean vaulted portal hole through the monolithic concrete wall
  const hole = new THREE.Path();
  const r = Math.min(archRadius, halfW - 1.35);
  hole.moveTo(-r, 0);
  hole.lineTo(-r, pierStartH);
  hole.absarc(0, pierStartH, r, Math.PI, 0, true);
  hole.lineTo(r, 0);
  hole.closePath();
  shape.holes.push(hole);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.26,
    bevelSize: 0.22,
    bevelSegments: 2,
    curveSegments: 20,
  });
  geo.translate(0, 0, -depth * 0.5);
  return geo;
}

/**
 * Builds a sloped brutalist amphitheater buttress cheek-wall profile.
 */
function createSlopedButtressGeometry(length, heightBack, heightFront, thickness) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(length, 0);
  shape.lineTo(length, heightBack);
  shape.lineTo(length * 0.78, heightBack);
  shape.lineTo(0, heightFront);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: 0.16,
    bevelSize: 0.14,
    bevelSegments: 2,
  });
  geo.translate(0, 0, -thickness * 0.5);
  return geo;
}

export class ArenaWorld {
  constructor(scene, textures, qualityManager, waterSystem, onCoverShattered) {
    this.scene = scene;
    this.textures = textures;
    this.quality = qualityManager;
    this.water = waterSystem;
    this.onCoverShattered = onCoverShattered;

    this.arenaRadius = 68.5;
    this.floorY = -0.55;
    this.covers = [];
    this.shatteredCount = 0;
    this._triplanarUniforms = {
      uRainWetness: { value: 0.9 },
      uPyroNoise: { value: textures.pyroNoise },
    };

    this._initMaterials();
    this._buildBasinAndColosseum();
    this._buildMonolithicArches();
    this._buildOuterSkylineSpires();
    this._buildDestructibleCover();
    this._initRubbleSimulation();
  }

  /**
   * Injects World-Space Triplanar PBR mapping + Rain-Drip Streaks + Submerged Waterline Porosity
   * so concrete textures NEVER stretch regardless of mesh scale or ExtrudeGeometry topology.
   */
  _applyWorldTriplanarPBR(material, tileScale = 0.21, normalStrength = 1.55) {
    const sharedU = this._triplanarUniforms;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTriScale = { value: tileScale };
      shader.uniforms.uTriNormStr = { value: normalStrength };
      shader.uniforms.uRainWetness = sharedU.uRainWetness;
      shader.uniforms.uPyroNoise = sharedU.uPyroNoise;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          varying vec3 vTriWorldPos;
          varying vec3 vTriWorldNormal;
          `
        )
        .replace(
          '#include <worldpos_vertex>',
          /* glsl */ `
          #include <worldpos_vertex>
          vec4 triWp = vec4(transformed, 1.0);
          vec3 triWn = objectNormal;
          #ifdef USE_INSTANCING
            triWp = instanceMatrix * triWp;
            triWn = mat3(instanceMatrix) * triWn;
          #endif
          triWp = modelMatrix * triWp;
          triWn = normalize(mat3(modelMatrix) * triWn);
          vTriWorldPos = triWp.xyz;
          vTriWorldNormal = triWn;
          `
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `
          #include <common>
          uniform float uTriScale;
          uniform float uTriNormStr;
          uniform float uRainWetness;
          uniform sampler2D uPyroNoise;
          varying vec3 vTriWorldPos;
          varying vec3 vTriWorldNormal;

          vec3 getTriWeights(vec3 wn) {
            vec3 w = pow(abs(wn), vec3(4.5));
            return w / max(w.x + w.y + w.z, 1e-4);
          }
          `
        )
        .replace(
          '#include <map_fragment>',
          /* glsl */ `
          #ifdef USE_MAP
            vec3 triW = getTriWeights(normalize(vTriWorldNormal));
            vec2 uvX = vTriWorldPos.zy * uTriScale;
            vec2 uvY = vTriWorldPos.xz * uTriScale;
            vec2 uvZ = vTriWorldPos.xy * uTriScale;

            vec4 colX = texture2D(map, uvX);
            vec4 colY = texture2D(map, uvY);
            vec4 colZ = texture2D(map, uvZ);
            vec4 sampledDiffuseColor = colX * triW.x + colY * triW.y + colZ * triW.z;

            // Macro weathering & vertical rain-runoff streaks from Perlin-Worley map
            float macroWeather = texture2D(uPyroNoise, vTriWorldPos.xz * 0.018 + vTriWorldPos.y * 0.012).r;
            float dripStreak = texture2D(uPyroNoise, vec2(vTriWorldPos.x + vTriWorldPos.z, vTriWorldPos.y * 0.16) * 0.18).g;
            float weatherMod = 0.82 + macroWeather * 0.34 - (1.0 - dripStreak) * 0.12 * uRainWetness;

            // Physical porosity darkening near floodwater splash zone (y < 1.9m)
            float splashZone = 1.0 - smoothstep(-0.15, 2.15, vTriWorldPos.y);
            float wetDarken = mix(1.0, 0.56, splashZone * (0.65 + uRainWetness * 0.35));

            sampledDiffuseColor.rgb *= weatherMod * wetDarken;
            diffuseColor *= sampledDiffuseColor;
          #endif
          `
        )
        .replace(
          '#include <roughnessmap_fragment>',
          /* glsl */ `
          float roughnessFactor = roughness;
          #ifdef USE_ROUGHNESSMAP
            vec3 rTriW = getTriWeights(normalize(vTriWorldNormal));
            float rX = texture2D(roughnessMap, vTriWorldPos.zy * uTriScale).g;
            float rY = texture2D(roughnessMap, vTriWorldPos.xz * uTriScale).g;
            float rZ = texture2D(roughnessMap, vTriWorldPos.xy * uTriScale).g;
            float triRough = rX * rTriW.x + rY * rTriW.y + rZ * rTriW.z;
            roughnessFactor *= triRough;

            // Rain-slicked horizontal surfaces & splash-zone concrete become mirror-glossy
            float upFacing = clamp(normalize(vTriWorldNormal).y, 0.0, 1.0);
            float splashGloss = 1.0 - smoothstep(-0.1, 2.0, vTriWorldPos.y);
            float dripGloss = texture2D(uPyroNoise, vec2(vTriWorldPos.x - vTriWorldPos.z, vTriWorldPos.y * 0.14) * 0.22).b;
            roughnessFactor = mix(roughnessFactor, 0.14, clamp((upFacing * 0.55 + splashGloss * 0.72 + dripGloss * 0.22) * uRainWetness, 0.0, 0.86));
          #endif
          `
        )
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `
          #ifdef USE_NORMALMAP_TANGENTSPACE
            vec3 wnBase = normalize(vTriWorldNormal);
            vec3 nTriW = getTriWeights(wnBase);

            vec3 tnX = texture2D(normalMap, vTriWorldPos.zy * uTriScale).xyz * 2.0 - 1.0;
            vec3 tnY = texture2D(normalMap, vTriWorldPos.xz * uTriScale).xyz * 2.0 - 1.0;
            vec3 tnZ = texture2D(normalMap, vTriWorldPos.xy * uTriScale).xyz * 2.0 - 1.0;

            tnX.xy *= uTriNormStr;
            tnY.xy *= uTriNormStr;
            tnZ.xy *= uTriNormStr;

            // Whiteout world-space triplanar normal projection
            vec3 worldPerturb = normalize(
              vec3(0.0, tnX.y, tnX.x) * nTriW.x +
              vec3(tnY.x, 0.0, tnY.y) * nTriW.y +
              vec3(tnZ.x, tnZ.y, 0.0) * nTriW.z +
              wnBase
            );
            vec3 viewPerturb = normalize((viewMatrix * vec4(worldPerturb, 0.0)).xyz);
            normal = normalize(mix(normal, viewPerturb, 0.88));
          #endif
          `
        );
    };
    material.customProgramCacheKey = () => `triplanar-concrete-${tileScale}-${normalStrength}`;
  }

  _initMaterials() {
    const c = this.textures.concrete;
    const a = this.textures.armor;

    this.concreteMat = new THREE.MeshStandardMaterial({
      color: 0xb6c0c8,
      map: c.albedoTex,
      normalMap: c.normalTex,
      normalScale: new THREE.Vector2(1.5, 1.5),
      roughnessMap: c.roughTex,
      roughness: 0.78,
      metalness: 0.06,
      envMapIntensity: 1.35,
    });
    this._applyWorldTriplanarPBR(this.concreteMat, 0.22, 1.55);

    this.archConcreteMat = new THREE.MeshStandardMaterial({
      color: 0xa2adb6,
      map: c.albedoTex,
      normalMap: c.normalTex,
      normalScale: new THREE.Vector2(1.6, 1.6),
      roughnessMap: c.roughTex,
      roughness: 0.82,
      metalness: 0.08,
      envMapIntensity: 1.3,
    });
    this._applyWorldTriplanarPBR(this.archConcreteMat, 0.18, 1.65);

    this.darkBasinMat = new THREE.MeshStandardMaterial({
      color: 0x6e7a86,
      map: c.albedoTex,
      normalMap: c.normalTex,
      roughnessMap: c.roughTex,
      roughness: 0.85,
      metalness: 0.1,
      envMapIntensity: 1.15,
    });
    this._applyWorldTriplanarPBR(this.darkBasinMat, 0.14, 1.35);

    this.structuralSteelMat = new THREE.MeshStandardMaterial({
      color: 0x525e6a,
      map: a.albedoTex,
      normalMap: a.normalTex,
      roughnessMap: a.roughTex,
      roughness: 0.36,
      metalness: 0.84,
      envMapIntensity: 1.55,
    });

    this.rebarMat = new THREE.MeshStandardMaterial({
      color: 0x5a3e30,
      roughness: 0.56,
      metalness: 0.82,
      envMapIntensity: 1.2,
    });

    this.beaconMat = new THREE.MeshStandardMaterial({
      color: 0xff8c28,
      emissive: new THREE.Color(0xff6e18),
      emissiveIntensity: 3.8,
      roughness: 0.2,
    });

    this.deckMarkerMat = new THREE.MeshStandardMaterial({
      color: 0xff9a38,
      emissive: new THREE.Color(0xff7b1c),
      emissiveIntensity: 2.4,
      roughness: 0.25,
    });
  }

  _buildBasinAndColosseum() {
    const worldGroup = new THREE.Group();

    // 1. Submerged stone basin floor
    const floorGeo = new THREE.CylinderGeometry(118, 118, 1.2, 64);
    const floorMesh = new THREE.Mesh(floorGeo, this.darkBasinMat);
    floorMesh.position.y = this.floorY - 0.6;
    floorMesh.receiveShadow = true;
    worldGroup.add(floorMesh);

    // 2. Sculpted Central Octagonal Tactical Reactor Dais (with armored steel rim & deck lights)
    const daisOuter = new THREE.Mesh(
      new THREE.CylinderGeometry(9.6, 11.4, 0.9, 16),
      this.concreteMat
    );
    daisOuter.position.y = -0.18;
    daisOuter.receiveShadow = true;
    daisOuter.castShadow = true;
    worldGroup.add(daisOuter);

    const daisSteelRing = new THREE.Mesh(
      new THREE.TorusGeometry(9.55, 0.24, 8, 32),
      this.structuralSteelMat
    );
    daisSteelRing.rotation.x = Math.PI * 0.5;
    daisSteelRing.position.y = 0.24;
    daisSteelRing.receiveShadow = true;
    worldGroup.add(daisSteelRing);

    const daisInner = new THREE.Mesh(
      new THREE.CylinderGeometry(5.2, 6.1, 0.56, 8),
      this.archConcreteMat
    );
    daisInner.position.y = 0.14;
    daisInner.receiveShadow = true;
    daisInner.castShadow = true;
    worldGroup.add(daisInner);

    const markerGeo = new THREE.BoxGeometry(0.95, 0.08, 0.18);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const marker = new THREE.Mesh(markerGeo, this.deckMarkerMat);
      marker.position.set(Math.cos(a) * 9.2, 0.28, Math.sin(a) * 9.2);
      marker.rotation.y = -a + Math.PI * 0.5;
      worldGroup.add(marker);
    }

    // 3. Fine-Stepped Brutalist Amphitheater Staircases & Sloped Cheek-Wall Buttresses
    // 24 sectors around the basin; merged into a single static BufferGeometry for 1-draw-call speed!
    const sectorCount = 24;
    const sectorArc = (Math.PI * 2) / sectorCount;
    const stairParts = [];
    const buttressParts = [];

    const stepRisers = 18;
    const baseButtressGeo = createSlopedButtressGeometry(23.5, 15.6, 1.35, 1.9);

    for (let s = 0; s < sectorCount; s++) {
      const angle = s * sectorArc;
      // North (-Z is s = 18 because sin(3*PI/2) = -1 -> z = r*sin(theta) = -r!)
      const isNorthFloodgate = s === 18;
      // East/West/South narrow sluice channels
      const isMinorSluice = s === 0 || s === 6 || s === 12;

      if (!isNorthFloodgate) {
        const widthFactor = isMinorSluice ? 0.52 : 0.94;
        for (let t = 0; t < stepRisers; t++) {
          const radius = 69.2 + t * 1.26;
          const topY = -0.35 + (t + 1) * 0.78;
          const h = topY + 0.85;
          const arcWidth = ((2 * Math.PI * radius) / sectorCount) * widthFactor;

          const treadGeo = new THREE.BoxGeometry(1.42, h, arcWidth);
          const m = new THREE.Matrix4();
          const rot = new THREE.Matrix4().makeRotationY(-angle);
          const trans = new THREE.Matrix4().makeTranslation(radius, topY - h * 0.5, 0);
          m.multiplyMatrices(rot, trans);
          treadGeo.applyMatrix4(m);
          stairParts.push(treadGeo);
        }
      }

      // Monumental sloped brutalist divider buttress walls flanking every amphitheater bay (like key art!)
      const boundaryAngle = (s + 0.5) * sectorArc;
      const bGeo = baseButtressGeo.clone();
      const rotB = new THREE.Matrix4().makeRotationY(-boundaryAngle);
      const transB = new THREE.Matrix4().makeTranslation(68.6, -0.55, 0);
      bGeo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(rotB, transB));
      buttressParts.push(bGeo);
    }
    baseButtressGeo.dispose();

    const mergedStairs = mergeGeometries(stairParts, false);
    stairParts.forEach((g) => g.dispose());
    const stairsMesh = new THREE.Mesh(mergedStairs, this.archConcreteMat);
    stairsMesh.castShadow = true;
    stairsMesh.receiveShadow = true;
    worldGroup.add(stairsMesh);

    const mergedButtresses = mergeGeometries(buttressParts, false);
    buttressParts.forEach((g) => g.dispose());
    const buttressMesh = new THREE.Mesh(mergedButtresses, this.concreteMat);
    buttressMesh.castShadow = true;
    buttressMesh.receiveShadow = true;
    worldGroup.add(buttressMesh);

    // 4. North (-Z) Leviathan Floodgate Bastion Portal (tall overhead lock-bridge & blast pylons)
    const gateGroup = new THREE.Group();
    gateGroup.position.set(0, 0, -76.0);
    for (const side of [-1, 1]) {
      const pylon = new THREE.Mesh(new RoundedBoxGeometry(5.4, 24.0, 9.5, 3, 0.28), this.concreteMat);
      pylon.position.set(side * 11.2, 11.5, 0);
      pylon.castShadow = true;
      pylon.receiveShadow = true;
      gateGroup.add(pylon);

      const steelRib = new THREE.Mesh(new RoundedBoxGeometry(1.2, 22.0, 10.1, 2, 0.12), this.structuralSteelMat);
      steelRib.position.set(side * 8.6, 10.8, 0);
      gateGroup.add(steelRib);

      const gateBeacon = new THREE.Mesh(new THREE.BoxGeometry(0.45, 2.6, 0.45), this.beaconMat);
      gateBeacon.position.set(side * 8.4, 15.5, 5.1);
      gateGroup.add(gateBeacon);
    }
    // Overhead sluice lock lintel at y = 19.5m (clears 10m Leviathan dreadnought!)
    const gateLintel = new THREE.Mesh(new RoundedBoxGeometry(27.5, 5.2, 8.8, 3, 0.28), this.archConcreteMat);
    gateLintel.position.set(0, 20.6, 0);
    gateLintel.castShadow = true;
    gateLintel.receiveShadow = true;
    gateGroup.add(gateLintel);

    worldGroup.add(gateGroup);
    this.scene.add(worldGroup);
  }

  _buildMonolithicArches() {
    // True sculpted vaulted brutalist arcade crowning the amphitheater (matching key art!)
    const archGroup = new THREE.Group();
    const archCount = 24;
    const ringRadius = 89.5;
    const baySpan = (2 * Math.PI * ringRadius) / archCount;

    const bayGeo = createMonolithicArchBayGeometry(baySpan * 1.01, 31.0, baySpan * 0.34, 18.5, 5.2);
    const pilasterGeo = new RoundedBoxGeometry(2.6, 33.2, 6.6, 3, 0.24);
    const corniceGeo = new RoundedBoxGeometry(baySpan * 1.03, 2.2, 6.8, 2, 0.2);

    for (let i = 0; i < archCount; i++) {
      const theta = ((i + 0.5) / archCount) * Math.PI * 2;
      const pierTheta = (i / archCount) * Math.PI * 2;

      const bx = Math.cos(theta) * ringRadius;
      const bz = Math.sin(theta) * ringRadius;

      const bayMesh = new THREE.Mesh(bayGeo, this.archConcreteMat);
      bayMesh.position.set(bx, 11.2, bz);
      // Orient width tangent to ring, depth radially
      bayMesh.rotation.y = -theta + Math.PI * 0.5;
      bayMesh.castShadow = true;
      bayMesh.receiveShadow = true;
      archGroup.add(bayMesh);

      const cornice = new THREE.Mesh(corniceGeo, this.concreteMat);
      cornice.position.set(bx, 42.6, bz);
      cornice.rotation.y = -theta + Math.PI * 0.5;
      cornice.castShadow = true;
      cornice.receiveShadow = true;
      archGroup.add(cornice);

      const px = Math.cos(pierTheta) * ringRadius;
      const pz = Math.sin(pierTheta) * ringRadius;
      const pilaster = new THREE.Mesh(pilasterGeo, this.concreteMat);
      pilaster.position.set(px, 27.6, pz);
      pilaster.rotation.y = -pierTheta + Math.PI * 0.5;
      pilaster.castShadow = true;
      pilaster.receiveShadow = true;
      archGroup.add(pilaster);
    }

    // Second monumental outer aqueduct tier in the storm mist (r = 118m) for deep parallax scale
    const outerCount = 18;
    const outerRadius = 118.0;
    const outerSpan = (2 * Math.PI * outerRadius) / outerCount;
    const outerBayGeo = createMonolithicArchBayGeometry(outerSpan * 1.01, 48.0, outerSpan * 0.33, 29.0, 6.8);

    for (let i = 0; i < outerCount; i++) {
      const theta = (i / outerCount) * Math.PI * 2 + 0.08;
      const ox = Math.cos(theta) * outerRadius;
      const oz = Math.sin(theta) * outerRadius;
      const outerBay = new THREE.Mesh(outerBayGeo, this.darkBasinMat);
      outerBay.position.set(ox, 8.0, oz);
      outerBay.rotation.y = -theta + Math.PI * 0.5;
      archGroup.add(outerBay);
    }

    this.scene.add(archGroup);
  }

  _buildOuterSkylineSpires() {
    const spireGroup = new THREE.Group();
    this.beacons = [];

    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2 + 0.11;
      const dist = 148 + (i % 3) * 22;
      const h = 68 + (i % 4) * 24;
      const w = 13 + (i % 3) * 4.5;

      const citadel = new THREE.Group();
      citadel.position.set(Math.cos(angle) * dist, -4, Math.sin(angle) * dist);
      citadel.rotation.y = -angle + 0.18;

      // Multi-tiered tapered brutalist ziggurat tower
      const lower = new THREE.Mesh(new BoxBufferOrGeo(w * 1.25, h * 0.58, w * 1.35), this.darkBasinMat);
      lower.position.y = h * 0.29;
      citadel.add(lower);

      const upper = new THREE.Mesh(new BoxBufferOrGeo(w * 0.88, h * 0.46, w * 0.96), this.darkBasinMat);
      upper.position.y = h * 0.55 + h * 0.23;
      citadel.add(upper);

      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.35, 14, 6), this.structuralSteelMat);
      mast.position.y = h + 6.0;
      citadel.add(mast);

      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 8), this.beaconMat);
      beacon.position.y = h + 13.0;
      citadel.add(beacon);
      this.beacons.push(beacon);

      spireGroup.add(citadel);
    }

    this.scene.add(spireGroup);
  }

  _createRebarCluster(width, height) {
    const group = new THREE.Group();
    // Thin realistic twisted steel rebar rods (0.028m radius, bent at jagged impact angles)
    const rodGeo = new THREE.CylinderGeometry(0.028, 0.032, height * 0.55, 6);
    const spallGeo = new THREE.DodecahedronGeometry(0.14, 0);
    const count = 11;

    for (let i = 0; i < count; i++) {
      const rodRoot = new THREE.Group();
      const angle = (i / count) * Math.PI * 2 + (i % 3) * 0.2;
      const rad = width * (0.24 + (i % 3) * 0.1);
      rodRoot.position.set(Math.cos(angle) * rad, 0, Math.sin(angle) * rad);
      rodRoot.rotation.set((Math.random() - 0.5) * 0.32, Math.random() * Math.PI, (Math.random() - 0.5) * 0.32);

      const lowerSeg = new THREE.Mesh(rodGeo, this.rebarMat);
      lowerSeg.position.y = height * 0.24;
      rodRoot.add(lowerSeg);

      const upperPivot = new THREE.Group();
      upperPivot.position.y = height * 0.48;
      upperPivot.rotation.set(0.28 + Math.random() * 0.45, Math.random() * 3, (Math.random() - 0.5) * 0.4);
      rodRoot.add(upperPivot);

      const upperSeg = new THREE.Mesh(rodGeo, this.rebarMat);
      upperSeg.position.y = height * 0.22;
      upperPivot.add(upperSeg);

      if (i % 3 === 0) {
        const spall = new THREE.Mesh(spallGeo, this.concreteMat);
        spall.scale.set(1.2, 0.7, 0.9);
        spall.position.y = height * 0.16;
        upperPivot.add(spall);
      }

      group.add(rodRoot);
    }
    return group;
  }

  _buildDestructibleCover() {
    this.coverGroup = new THREE.Group();
    this.scene.add(this.coverGroup);

    const layouts = [];
    // Inner tactical colonnade ring (8 sculpted reinforced pillars)
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
      layouts.push({
        x: Math.cos(angle) * 25.5,
        z: Math.sin(angle) * 25.5,
        rotY: -angle,
        type: 'COLUMN',
      });
    }
    // Mid-outer fortified bunkers & columns (11 structures)
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
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
      const width = isColumn ? 3.3 : 6.4;
      const depth = isColumn ? 3.3 : 2.55;
      const height = isColumn ? 10.6 : 5.6;
      const maxHp = isColumn ? 280 : 210;

      const root = new THREE.Group();
      root.position.set(spec.x, this.floorY, spec.z);
      root.rotation.y = spec.rotY;

      // 1. Beveled Armored Plinth Stump (remains anchored in floodwater)
      const stumpHeight = 1.4;
      const stump = new THREE.Group();
      const plinthBase = new THREE.Mesh(
        new RoundedBoxGeometry(width * 1.14, stumpHeight * 0.65, depth * 1.14, 3, 0.14),
        this.concreteMat
      );
      plinthBase.position.y = stumpHeight * 0.325;
      plinthBase.castShadow = true;
      plinthBase.receiveShadow = true;
      stump.add(plinthBase);

      const plinthCollar = new THREE.Mesh(
        new RoundedBoxGeometry(width * 1.04, stumpHeight * 0.42, depth * 1.04, 2, 0.1),
        this.structuralSteelMat
      );
      plinthCollar.position.y = stumpHeight * 0.8;
      plinthCollar.castShadow = true;
      plinthCollar.receiveShadow = true;
      stump.add(plinthCollar);

      // Subtle amber waterline hazard marker on column plinth
      const strip = new THREE.Mesh(new THREE.BoxGeometry(width * 0.42, 0.09, depth * 1.07), this.deckMarkerMat);
      strip.position.y = 0.92;
      stump.add(strip);
      root.add(stump);

      // 2. Sculpted Mid Section (chamfered concrete core + vertical steel corner pilasters)
      const midHeight = (height - stumpHeight) * 0.56;
      const midGroup = new THREE.Group();
      midGroup.position.y = stumpHeight;

      const midCore = new THREE.Mesh(
        new RoundedBoxGeometry(width, midHeight, depth, 3, 0.16),
        this.concreteMat
      );
      midCore.position.y = midHeight * 0.5;
      midCore.castShadow = true;
      midCore.receiveShadow = true;
      midGroup.add(midCore);

      // Corner structural steel bracing ribs
      const ribGeo = new THREE.BoxGeometry(0.24, midHeight * 0.94, 0.24);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const rib = new THREE.Mesh(ribGeo, this.structuralSteelMat);
          rib.position.set(sx * (width * 0.48), midHeight * 0.5, sz * (depth * 0.48));
          rib.castShadow = true;
          midGroup.add(rib);
        }
      }
      root.add(midGroup);

      // 3. Sculpted Upper Crown Section (chamfered shaft + flared brutalist capital)
      const topHeight = (height - stumpHeight) * 0.44;
      const topGroup = new THREE.Group();
      topGroup.position.y = stumpHeight + midHeight;

      const topCore = new THREE.Mesh(
        new RoundedBoxGeometry(width * 0.96, topHeight * 0.82, depth * 0.96, 3, 0.15),
        this.archConcreteMat
      );
      topCore.position.y = topHeight * 0.41;
      topCore.castShadow = true;
      topCore.receiveShadow = true;
      topGroup.add(topCore);

      const capital = new THREE.Mesh(
        new RoundedBoxGeometry(width * 1.12, topHeight * 0.24, depth * 1.12, 3, 0.14),
        this.concreteMat
      );
      capital.position.y = topHeight * 0.9;
      capital.castShadow = true;
      capital.receiveShadow = true;
      topGroup.add(capital);
      root.add(topGroup);

      // 4. Twisted Steel Rebar Cages (exposed on Stage 1 & Stage 2 fracture)
      const midRebar = this._createRebarCluster(width * 0.78, 1.65);
      midRebar.position.y = stumpHeight + midHeight - 0.18;
      midRebar.visible = false;
      root.add(midRebar);

      const baseRebar = this._createRebarCluster(width * 0.82, 1.55);
      baseRebar.position.y = stumpHeight - 0.15;
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
        stage: 0,
        alive: true,
        root,
        midMesh: midGroup,
        topMesh: topGroup,
        midRebar,
        baseRebar,
      });
    });
  }

  _initRubbleSimulation() {
    const chunkGeo = createFracturedConcreteGeometry();
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

  spawnRubbleBurst(origin, impactDir, count = 14, spread = 9.0) {
    const mult = this.quality.config.debrisMultiplier;
    const actualCount = Math.max(4, Math.round(count * mult));

    for (let i = 0; i < actualCount; i++) {
      const slot = this.rubblePool[this._rubbleCursor];
      this._rubbleCursor = (this._rubbleCursor + 1) % MAX_RUBBLE_CHUNKS;

      slot.active = true;
      slot.settled = false;
      slot.splashed = origin.y <= 0.05;

      slot.pos.set(
        origin.x + (Math.random() - 0.5) * 2.2,
        origin.y + (Math.random() - 0.5) * 1.6,
        origin.z + (Math.random() - 0.5) * 2.2
      );

      const dirX = (impactDir ? impactDir.x * 0.55 : 0) + (Math.random() - 0.5) * 1.5;
      const dirZ = (impactDir ? impactDir.z * 0.55 : 0) + (Math.random() - 0.5) * 1.5;
      slot.vel.set(dirX * spread, 4.2 + Math.random() * 8.2, dirZ * spread);

      slot.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      slot.angVel.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
      // Realistic concrete slab & shard proportions (never giant boulders blocking the camera!)
      slot.scale.set(
        0.42 + Math.random() * 0.68,
        0.25 + Math.random() * 0.45,
        0.42 + Math.random() * 0.72
      );
    }
  }

  damageCover(cover, damage, hitPoint, impactDir, vfx, audio) {
    if (!cover || !cover.alive) return false;
    cover.hp -= damage;

    if (cover.stage === 0 && cover.hp <= cover.maxHp * 0.55 && cover.hp > 0) {
      cover.stage = 1;
      cover.topMesh.visible = false;
      cover.midRebar.visible = true;
      const burstOrigin = new THREE.Vector3(cover.x, cover.height * 0.72, cover.z);
      this.spawnRubbleBurst(burstOrigin, impactDir, 12, 9.5);
      vfx?.spawnConcreteCollapse(burstOrigin, 0.78);
      audio?.playCoverFracture(0.65);
    }

    if (cover.hp <= 0 && cover.stage < 2) {
      cover.stage = 2;
      cover.alive = false;
      cover.topMesh.visible = false;
      cover.midMesh.visible = false;
      cover.midRebar.visible = false;
      cover.baseRebar.visible = true;

      const burstOrigin = new THREE.Vector3(cover.x, cover.height * 0.42, cover.z);
      this.spawnRubbleBurst(burstOrigin, impactDir, 20, 11.5);
      this.water?.spawnRipple(cover.x, cover.z, 1.85);
      vfx?.spawnConcreteCollapse(burstOrigin, 1.3);
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

  getGroundHeight(x, z) {
    const r = Math.hypot(x, z);
    if (r < 5.3) return 0.38;
    if (r < 9.8) return 0.22;
    return this.floorY;
  }

  update(dt, elapsed, vfx, weather = null) {
    if (weather) {
      this._triplanarUniforms.uRainWetness.value = 0.45 + weather.rainIntensity * 0.55;
    }

    const pulse = 2.6 + Math.sin(elapsed * 3.6) * 1.4;
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

      if (!chunk.splashed && chunk.pos.y <= 0.05) {
        chunk.splashed = true;
        chunk.vel.multiplyScalar(0.58);
        if (Math.random() < 0.45) {
          this.water?.spawnRipple(chunk.pos.x, chunk.pos.z, 0.55);
          vfx?.spawnWaterSplash(chunk.pos.x, chunk.pos.z, 0.7);
        }
      }

      const floorH = this.getGroundHeight(chunk.pos.x, chunk.pos.z) + chunk.scale.y * 0.28;
      if (chunk.pos.y <= floorH) {
        chunk.pos.y = floorH;
        chunk.vel.y *= -0.2;
        chunk.vel.x *= 0.6;
        chunk.vel.z *= 0.6;
        chunk.angVel.multiplyScalar(0.52);
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

function BoxBufferOrGeo(w, h, d) {
  return new THREE.BoxGeometry(w, h, d);
}
