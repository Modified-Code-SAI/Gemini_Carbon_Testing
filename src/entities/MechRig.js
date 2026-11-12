import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

let SHARED_MECH_ASSETS = null;

/**
 * Injects Metric Object-Space Triplanar Weathered Titanium PBR + Procedural Bevel Edge-Wear
 * onto MeshStandardMaterial / MeshPhysicalMaterial so every extruded, lathed, and beveled
 * mech armor plate displays crisp, non-stretched 1K battle-scarred titanium grain, seam grime,
 * rain-wet upper sheen, and chipped bare-metal bevel highlights!
 */
function enhanceMechTitaniumMaterial(mat, { scaleMacro = 0.95, scaleMicro = 3.1, edgeWear = 0.28 } = {}) {
  mat.customProgramCacheKey = () => `mech-triplanar-v4-${scaleMacro}-${edgeWear}`;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        'void main() {',
        /* glsl */ `
        varying vec3 vPartPos;
        varying vec3 vPartNorm;
        varying vec3 vWorldNormalW;
        varying vec3 vViewAxisX;
        varying vec3 vViewAxisY;
        varying vec3 vViewAxisZ;
        void main() {`
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `
        #include <project_vertex>
        vec3 mScale = vec3(
          length(modelMatrix[0].xyz),
          length(modelMatrix[1].xyz),
          length(modelMatrix[2].xyz)
        );
        vPartPos = transformed * mScale;
        vPartNorm = normalize(normal / max(mScale, vec3(0.001)));
        vWorldNormalW = normalize(mat3(modelMatrix) * (normal / max(mScale, vec3(0.001))));
        vViewAxisX = normalize((modelViewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
        vViewAxisY = normalize((modelViewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        vViewAxisZ = normalize((modelViewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        /* glsl */ `
        varying vec3 vPartPos;
        varying vec3 vPartNorm;
        varying vec3 vWorldNormalW;
        varying vec3 vViewAxisX;
        varying vec3 vViewAxisY;
        varying vec3 vViewAxisZ;
        void main() {`
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        #ifdef USE_MAP
          vec3 tpW = pow(abs(normalize(vPartNorm)), vec3(4.5));
          tpW /= max(tpW.x + tpW.y + tpW.z, 1e-4);

          vec2 uvX1 = vPartPos.zy * ${scaleMacro.toFixed(3)};
          vec2 uvY1 = vPartPos.xz * ${scaleMacro.toFixed(3)};
          vec2 uvZ1 = vPartPos.xy * ${scaleMacro.toFixed(3)};

          vec2 uvX2 = vPartPos.zy * ${scaleMicro.toFixed(3)} + vec2(0.37, 0.19);
          vec2 uvY2 = vPartPos.xz * ${scaleMicro.toFixed(3)} + vec2(0.13, 0.71);
          vec2 uvZ2 = vPartPos.xy * ${scaleMicro.toFixed(3)} + vec2(0.61, 0.43);

          vec4 macCol = texture2D(map, uvX1) * tpW.x + texture2D(map, uvY1) * tpW.y + texture2D(map, uvZ1) * tpW.z;
          vec4 micCol = texture2D(map, uvX2) * tpW.x + texture2D(map, uvY2) * tpW.y + texture2D(map, uvZ2) * tpW.z;

          vec4 sampledDiffuseColor = mix(macCol, micCol, 0.36);

          // Procedural bevel / chamfer detection: 1.0 - max(tpW) peaks right along 45-deg rounded armor edges!
          float bevelFactor = clamp((1.0 - max(max(tpW.x, tpW.y), tpW.z)) * 2.25, 0.0, 1.0);
          float chippedSteel = smoothstep(0.24, 0.72, bevelFactor * (0.48 + micCol.r * 0.98));

          // Vertical rainwater / oil grime streak & pitted cast-titanium modulation
          float streakNoise = texture2D(map, vec2(vPartPos.x * 2.2 + vPartPos.z * 1.7, vPartPos.y * 0.42)).r;
          float grimeMod = mix(0.64, 1.26, smoothstep(0.18, 0.82, streakNoise));

          sampledDiffuseColor.rgb *= grimeMod;
          // Brighten chipped bare-titanium chamfers & darken recessed underside crevices
          float topLightMod = mix(0.80, 1.12, clamp(vWorldNormalW.y * 0.5 + 0.5, 0.0, 1.0));
          sampledDiffuseColor.rgb *= topLightMod;
          sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, sampledDiffuseColor.rgb * 1.58 + vec3(0.18, 0.20, 0.22), chippedSteel * ${edgeWear.toFixed(3)});

          diffuseColor *= sampledDiffuseColor;
        #endif`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        float roughnessFactor = roughness;
        #ifdef USE_ROUGHNESSMAP
          vec3 rW = pow(abs(normalize(vPartNorm)), vec3(4.5));
          rW /= max(rW.x + rW.y + rW.z, 1e-4);
          float rTex = texture2D(roughnessMap, vPartPos.zy * ${scaleMacro.toFixed(3)}).g * rW.x
                     + texture2D(roughnessMap, vPartPos.xz * ${scaleMacro.toFixed(3)}).g * rW.y
                     + texture2D(roughnessMap, vPartPos.xy * ${scaleMacro.toFixed(3)}).g * rW.z;
          float rMicro = texture2D(roughnessMap, vPartPos.xy * ${scaleMicro.toFixed(3)}).g;
          roughnessFactor *= mix(0.64, 1.32, rTex * 0.62 + rMicro * 0.38);

          // Rain-drenched upward-facing shoulders/pauldrons gleam with lower roughness!
          float rainWet = smoothstep(0.25, 0.88, vWorldNormalW.y);
          roughnessFactor = mix(roughnessFactor, 0.16, rainWet * 0.48);
          roughnessFactor = clamp(roughnessFactor, 0.12, 0.92);
        #endif`
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `
        #ifdef USE_NORMALMAP_TANGENTSPACE
          vec3 nW = pow(abs(normalize(vPartNorm)), vec3(4.5));
          nW /= max(nW.x + nW.y + nW.z, 1e-4);

          vec3 tnX = (texture2D(normalMap, vPartPos.zy * ${scaleMacro.toFixed(3)}).xyz * 2.0 - 1.0) * 0.68
                   + (texture2D(normalMap, vPartPos.zy * ${scaleMicro.toFixed(3)}).xyz * 2.0 - 1.0) * 0.52;
          vec3 tnY = (texture2D(normalMap, vPartPos.xz * ${scaleMacro.toFixed(3)}).xyz * 2.0 - 1.0) * 0.68
                   + (texture2D(normalMap, vPartPos.xz * ${scaleMicro.toFixed(3)}).xyz * 2.0 - 1.0) * 0.52;
          vec3 tnZ = (texture2D(normalMap, vPartPos.xy * ${scaleMacro.toFixed(3)}).xyz * 2.0 - 1.0) * 0.68
                   + (texture2D(normalMap, vPartPos.xy * ${scaleMicro.toFixed(3)}).xyz * 2.0 - 1.0) * 0.52;

          vec3 objPerturb = vec3(0.0, tnX.y, tnX.x) * nW.x
                          + vec3(tnY.x, 0.0, tnY.y) * nW.y
                          + vec3(tnZ.x, tnZ.y, 0.0) * nW.z;
          vec3 viewPerturb = vViewAxisX * objPerturb.x + vViewAxisY * objPerturb.y + vViewAxisZ * objPerturb.z;
          normal = normalize(normal + viewPerturb * 0.66 * normalScale.x);
        #else
          #include <normal_fragment_maps>
        #endif`
      );
  };
  return mat;
}

function createBeveledExtrude(points2D, depth, bevelSize = 0.045, bevelThickness = 0.05) {
  const shape = new THREE.Shape();
  shape.moveTo(points2D[0][0], points2D[0][1]);
  for (let i = 1; i < points2D.length; i++) {
    shape.lineTo(points2D[i][0], points2D[i][1]);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness,
    bevelSize,
    bevelSegments: 3,
  });
  geo.translate(0, 0, -depth * 0.5);
  return geo;
}

function createShieldGeometry() {
  // Faceted octagonal ballistic siege shield profile (matching key art left arm!)
  const pts = [
    [-0.24, 0.84],
    [0.24, 0.84],
    [0.48, 0.52],
    [0.45, -0.38],
    [0.20, -0.86],
    [-0.20, -0.86],
    [-0.45, -0.38],
    [-0.48, 0.52],
  ];
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();

  const slot = new THREE.Path();
  slot.moveTo(-0.18, 0.44);
  slot.lineTo(0.18, 0.44);
  slot.lineTo(0.15, 0.52);
  slot.lineTo(-0.15, 0.52);
  slot.closePath();
  shape.holes.push(slot);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.1,
    bevelEnabled: true,
    bevelThickness: 0.045,
    bevelSize: 0.04,
    bevelSegments: 2,
  });
  geo.rotateY(Math.PI * 0.5);
  return geo;
}

function createTurbineNacelleGeometry() {
  // Crisp industrial stepped military turbofan pod (flat chamfered intake lip + armor clamp rings + vector nozzle)
  const pts = [
    new THREE.Vector2(0.16, -0.68),
    new THREE.Vector2(0.22, -0.58),
    new THREE.Vector2(0.20, -0.44),
    new THREE.Vector2(0.25, -0.40),
    new THREE.Vector2(0.25, -0.14),
    new THREE.Vector2(0.275, -0.12),
    new THREE.Vector2(0.275, -0.02),
    new THREE.Vector2(0.25, 0.00),
    new THREE.Vector2(0.25, 0.30),
    new THREE.Vector2(0.275, 0.32),
    new THREE.Vector2(0.275, 0.42),
    new THREE.Vector2(0.255, 0.45),
    new THREE.Vector2(0.255, 0.62),
    new THREE.Vector2(0.23, 0.66),
    new THREE.Vector2(0.17, 0.66),
    new THREE.Vector2(0.16, 0.52),
  ];
  return new THREE.LatheGeometry(pts, 16);
}

function createHoseGeometry(side = 1) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(side * 0.42, 0.14, 0.18),
    new THREE.Vector3(side * 0.68, 0.34, 0.02),
    new THREE.Vector3(side * 0.72, 0.58, -0.22),
    new THREE.Vector3(side * 0.48, 0.78, -0.34),
  ]);
  return new THREE.TubeGeometry(curve, 16, 0.062, 8, false);
}

function getSharedMechAssets(armorTextures) {
  if (SHARED_MECH_ASSETS) return SHARED_MECH_ASSETS;

  const frameMat = enhanceMechTitaniumMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x3b444d,
      map: armorTextures.albedoTex,
      normalMap: armorTextures.normalTex,
      roughnessMap: armorTextures.roughTex,
      roughness: 0.48,
      metalness: 0.68,
      envMapIntensity: 1.4,
    }),
    { scaleMacro: 1.3, scaleMicro: 3.6, edgeWear: 0.22 }
  );

  const pistonSteelMat = new THREE.MeshStandardMaterial({
    color: 0x8e9aa6,
    roughness: 0.26,
    metalness: 0.84,
    envMapIntensity: 1.45,
  });

  const darkGunMat = enhanceMechTitaniumMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x4e5862,
      map: armorTextures.albedoTex,
      normalMap: armorTextures.normalTex,
      roughnessMap: armorTextures.roughTex,
      roughness: 0.38,
      metalness: 0.74,
      envMapIntensity: 1.55,
    }),
    { scaleMacro: 1.25, scaleMicro: 3.8, edgeWear: 0.3 }
  );

  const hoseMat = new THREE.MeshStandardMaterial({
    color: 0x22282e,
    roughness: 0.58,
    metalness: 0.48,
    envMapIntensity: 1.1,
  });

  const cavityBlackMat = new THREE.MeshStandardMaterial({
    color: 0x0b0e12,
    roughness: 0.78,
    metalness: 0.25,
  });

  const bevelBox = new RoundedBoxGeometry(1, 1, 1, 3, 0.085);
  const crispPlate = new RoundedBoxGeometry(1, 1, 1, 2, 0.048);

  // Chest sloped prow profile
  const chestGlacisGeo = createBeveledExtrude(
    [
      [-0.58, -0.40],
      [0.34, -0.44],
      [0.72, -0.04],
      [0.48, 0.44],
      [-0.52, 0.46],
    ],
    1.36,
    0.055,
    0.06
  );
  chestGlacisGeo.rotateY(Math.PI * 0.5);

  // Sculpted multi-angle shoulder pauldron shell
  const pauldronGeo = createBeveledExtrude(
    [
      [-0.48, -0.28],
      [-0.38, 0.26],
      [-0.06, 0.40],
      [0.38, 0.28],
      [0.54, -0.14],
      [0.36, -0.30],
      [0.20, -0.08],
      [-0.24, -0.06],
    ],
    0.98,
    0.048,
    0.055
  );

  // Contoured thigh armor shell (swept armored femur plate!)
  const thighArmorGeo = createBeveledExtrude(
    [
      [-0.28, 0.48],
      [0.26, 0.44],
      [0.36, 0.02],
      [0.26, -0.48],
      [-0.26, -0.46],
      [-0.34, 0.04],
    ],
    0.60,
    0.045,
    0.05
  );
  thighArmorGeo.rotateY(Math.PI * 0.5);

  // Swept Armored-Core flared shin greave
  const shinGreaveGeo = createBeveledExtrude(
    [
      [-0.30, 0.54],
      [0.26, 0.48],
      [0.42, -0.16],
      [0.34, -0.54],
      [-0.38, -0.50],
      [-0.44, 0.10],
    ],
    0.58,
    0.048,
    0.052
  );
  shinGreaveGeo.rotateY(Math.PI * 0.5);

  // Protruding knee-breaker armor prow
  const kneeProwGeo = createBeveledExtrude(
    [
      [-0.20, -0.30],
      [0.30, -0.06],
      [0.18, 0.32],
      [-0.22, 0.24],
    ],
    0.46,
    0.038,
    0.042
  );
  kneeProwGeo.rotateY(Math.PI * 0.5);

  // Dual-concentric volumetric supersonic Mach-diamond core + turbulent afterburner sheath
  const coreCone = new THREE.CylinderGeometry(0.145, 0.024, 2.05, 16, 8, true);
  coreCone.translate(0, -1.025, 0);
  const sheathCone = new THREE.CylinderGeometry(0.275, 0.085, 2.55, 16, 8, true);
  sheathCone.translate(0, -1.275, 0);

  const cPos = coreCone.attributes.position.array;
  const sPos = sheathCone.attributes.position.array;
  const cNorm = coreCone.attributes.normal.array;
  const sNorm = sheathCone.attributes.normal.array;
  const cUv = coreCone.attributes.uv.array;
  const sUv = sheathCone.attributes.uv.array;
  const cIdx = coreCone.index.array;
  const sIdx = sheathCone.index.array;
  const vCountA = coreCone.attributes.position.count;
  const vTotal = vCountA + sheathCone.attributes.position.count;

  const pArr = new Float32Array(vTotal * 3);
  pArr.set(cPos, 0);
  pArr.set(sPos, cPos.length);
  const nArr = new Float32Array(vTotal * 3);
  nArr.set(cNorm, 0);
  nArr.set(sNorm, cNorm.length);
  const uArr = new Float32Array(vTotal * 2);
  uArr.set(cUv, 0);
  uArr.set(sUv, cUv.length);
  const shellArr = new Float32Array(vTotal);
  shellArr.fill(1.0, 0, vCountA);
  shellArr.fill(0.0, vCountA, vTotal);
  const iArr = new Uint16Array(cIdx.length + sIdx.length);
  iArr.set(cIdx, 0);
  for (let i = 0; i < sIdx.length; i++) iArr[cIdx.length + i] = sIdx[i] + vCountA;

  const plumeGeo = new THREE.BufferGeometry();
  plumeGeo.setAttribute('position', new THREE.BufferAttribute(pArr, 3));
  plumeGeo.setAttribute('normal', new THREE.BufferAttribute(nArr, 3));
  plumeGeo.setAttribute('uv', new THREE.BufferAttribute(uArr, 2));
  plumeGeo.setAttribute('aShell', new THREE.BufferAttribute(shellArr, 1));
  plumeGeo.setIndex(new THREE.BufferAttribute(iArr, 1));
  coreCone.dispose();
  sheathCone.dispose();

  SHARED_MECH_ASSETS = {
    frameMat,
    pistonSteelMat,
    darkGunMat,
    hoseMat,
    cavityBlackMat,
    bevelBox,
    crispPlate,
    chestGlacisGeo,
    pauldronGeo,
    thighArmorGeo,
    shinGreaveGeo,
    kneeProwGeo,
    shieldGeo: createShieldGeometry(),
    turbineGeo: createTurbineNacelleGeometry(),
    hoseLeftGeo: createHoseGeometry(-1),
    hoseRightGeo: createHoseGeometry(1),
    cylGeo: new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
    hexGeo: new THREE.CylinderGeometry(0.46, 0.52, 1, 6),
    plumeGeo,
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
   * @param {object} armorTextures - 1K PBR maps from TextureFactory
   * @param {object} options - { armorColor, trimColor, visorColor, thrusterColor, scale, role }
   */
  constructor(armorTextures, options = {}) {
    const shared = getSharedMechAssets(armorTextures);
    const {
      armorColor = 0xbac7d4,
      trimColor = 0x72808e,
      visorColor = 0xff841c,
      thrusterColor = 0xff8c2b,
      scale = 1.0,
      role = 'PLAYER',
    } = options;

    this.role = role;
    this.scale = scale;
    this.root = new THREE.Group();
    this.root.scale.setScalar(scale);

    // Battle-scarred cast-titanium warplate: calibrated metalness preserves gritty diffuse relief & bevel chipping in dark storms
    this.armorMat = enhanceMechTitaniumMaterial(
      new THREE.MeshPhysicalMaterial({
        color: armorColor,
        map: armorTextures.albedoTex,
        normalMap: armorTextures.normalTex,
        normalScale: new THREE.Vector2(1.95, 1.95),
        roughnessMap: armorTextures.roughTex,
        roughness: 0.46,
        metalness: 0.36,
        clearcoat: 0.38,
        clearcoatRoughness: 0.22,
        envMapIntensity: 1.75,
      }),
      { scaleMacro: 0.92, scaleMicro: 3.1, edgeWear: 0.48 }
    );

    this.trimMat = enhanceMechTitaniumMaterial(
      new THREE.MeshStandardMaterial({
        color: trimColor,
        map: armorTextures.albedoTex,
        normalMap: armorTextures.normalTex,
        normalScale: new THREE.Vector2(1.75, 1.75),
        roughnessMap: armorTextures.roughTex,
        roughness: 0.48,
        metalness: 0.42,
        envMapIntensity: 1.55,
      }),
      { scaleMacro: 1.05, scaleMicro: 3.4, edgeWear: 0.38 }
    );

    // Razor-sharp recessed HDR optic T-visor (no over-bloomed orange face blob!)
    this.visorMat = new THREE.MeshStandardMaterial({
      color: visorColor,
      emissive: new THREE.Color(visorColor),
      emissiveIntensity: 2.45,
      roughness: 0.12,
    });

    // Dual-shell supersonic Mach-shock-diamond volumetric jet plume shader
    this.thrusterPlumeMat = new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(thrusterColor) },
        uPower: { value: 0.85 },
      },
      vertexShader: /* glsl */ `
        attribute float aShell;
        varying vec2 vUv;
        varying float vShell;
        varying vec3 vWorldNormal;
        varying vec3 vViewDir;
        void main() {
          vUv = uv;
          vShell = aShell;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vec3 mScale = vec3(
            length(modelMatrix[0].xyz),
            length(modelMatrix[1].xyz),
            length(modelMatrix[2].xyz)
          );
          vWorldNormal = normalize(mat3(modelMatrix) * (normal / max(mScale, vec3(0.001))));
          vViewDir = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uColor;
        uniform float uPower;
        varying vec2 vUv;
        varying float vShell;
        varying vec3 vWorldNormal;
        varying vec3 vViewDir;

        void main() {
          float axial = clamp(vUv.y, 0.0, 1.0);
          float rimSoft = clamp(abs(dot(normalize(vWorldNormal), normalize(vViewDir))), 0.0, 1.0);
          float nozzleSeat = 1.0 - smoothstep(0.975, 1.0, axial);
          float powerGain = clamp(0.58 + uPower * 0.56, 0.0, 1.48);

          vec3 col;
          float alpha;

          if (vShell > 0.5) {
            float diamonds = pow(max(0.0, sin((1.0 - axial) * 26.0 - uTime * 42.0)), 3.0) * smoothstep(0.12, 0.94, axial);
            float coreEnv = pow(axial, 0.56) * nozzleSeat;
            vec3 whiteGold = vec3(5.6, 3.9, 1.88);
            vec3 hotAmber = vec3(3.4, 1.18, 0.18) + uColor * 0.85;
            col = mix(hotAmber, whiteGold, clamp(smoothstep(0.32, 0.96, axial) * 0.68 + diamonds * 0.72, 0.0, 1.0));
            alpha = coreEnv * pow(rimSoft, 0.85) * (0.34 + diamonds * 0.24) * powerGain;
          } else {
            float turb = 0.78 + 0.22 * sin((1.0 - axial) * 18.0 - uTime * 31.0 + vUv.x * 12.56637);
            float sheathEnv = pow(axial, 0.78) * nozzleSeat * turb;
            vec3 deepFlame = vec3(2.2, 0.48, 0.05);
            vec3 brightAmber = vec3(3.2, 1.08, 0.15) + uColor * 0.65;
            col = mix(deepFlame, brightAmber, smoothstep(0.18, 0.90, axial));
            alpha = sheathEnv * pow(rimSoft, 1.45) * 0.40 * powerGain;
          }

          if (alpha < 0.004) discard;
          gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
        }
      `,
    });

    this.ventGlowMat = new THREE.MeshStandardMaterial({
      color: 0xff6218,
      emissive: new THREE.Color(0xff5810),
      emissiveIntensity: 0.65,
      roughness: 0.28,
    });

    this.thrusterCones = [];
    this.ventFins = [];
    this.missilePodDoors = [];

    this._stridePhase = Math.random() * Math.PI * 2;
    this._prevLeftSign = 1;
    this._prevRightSign = -1;
    this._hitFlashTimer = 0;

    this._buildChassis(shared, visorColor, thrusterColor);
  }

  _buildChassis(s, visorColor, thrusterColor) {
    const isHeavy = this.role === 'BASTION' || this.role === 'BOSS';
    const isBoss = this.role === 'BOSS';

    // 1. Sculpted Pelvis, Chamfered Armored Codpiece & Articulated Hip Tasset Skirts (8-head heroic height!)
    this.pelvis = new THREE.Group();
    this.pelvis.position.y = 2.74;
    this.root.add(this.pelvis);

    addPart(this.pelvis, s.bevelBox, this.armorMat, 1.28, 0.48, 0.90, 0, 0.06, 0);
    // Horizontal hip axle drum: sy is cylinder axial length (1.54m) rotated horizontal via rz = PI/2
    addPart(this.pelvis, s.cylGeo, s.frameMat, 0.26, 1.54, 0.26, 0, -0.08, 0, 0, 0, Math.PI * 0.5);

    // Clean sloped front & rear armored pelvis blocks (zero hanging blade between thighs!)
    addPart(this.pelvis, s.bevelBox, this.trimMat, 0.50, 0.48, 0.48, 0, -0.04, -0.32, -0.18, 0, 0);
    addPart(this.pelvis, s.crispPlate, this.armorMat, 0.40, 0.34, 0.14, 0, 0.02, -0.56, -0.22, 0, 0);

    // Overlapping front & side Vernier hip-skirt armor plates
    for (const side of [-1, 1]) {
      addPart(this.pelvis, s.crispPlate, this.armorMat, 0.44, 0.48, 0.15, side * 0.46, -0.10, -0.44, -0.22, side * 0.18, side * -0.16);
      addPart(this.pelvis, s.bevelBox, this.trimMat, 0.22, 0.54, 0.96, side * 0.80, 0.0, 0.02, 0, 0, side * -0.22);
    }
    // Compact sloped rear tail stabilizer binder
    addPart(this.pelvis, s.bevelBox, this.trimMat, 0.68, 0.36, 0.44, 0, 0.04, 0.50, 0.24, 0, 0);

    // 2. Sculpted Athletic Heavy Bipedal Legs in Powerful Heroic A-Stance!
    this.leftLeg = this._buildLeg(s, -0.78);
    this.rightLeg = this._buildLeg(s, 0.78);

    // 3. Upper Torso Gimbal & Muscular V-Tapered Segmented Abdominal Armor (zero skinny stick-waist!)
    this.torsoYaw = new THREE.Group();
    this.torsoYaw.position.y = 0.28;
    this.pelvis.add(this.torsoYaw);

    this.torsoPitch = new THREE.Group();
    this.torsoYaw.add(this.torsoPitch);

    // Thick armored abdominal core + 4 overlapping V-chevron rib plates + oblique armor flanks
    addPart(this.torsoPitch, s.cylGeo, s.frameMat, 1.08, 0.66, 0.92, 0, 0.30, 0.02);
    for (let seg = 0; seg < 4; seg++) {
      const w = 0.92 + seg * 0.10;
      addPart(
        this.torsoPitch,
        s.crispPlate,
        seg % 2 === 0 ? this.armorMat : this.trimMat,
        w,
        0.15,
        0.64,
        0,
        0.10 + seg * 0.145,
        -0.22 - seg * 0.035,
        -0.14,
        0,
        0
      );
    }
    // Angled oblique armor rib plates bridging waist cleanly into wide pectoral chest
    for (const side of [-1, 1]) {
      addPart(this.torsoPitch, s.bevelBox, this.trimMat, 0.28, 0.58, 0.74, side * 0.56, 0.36, -0.06, 0.06, side * 0.14, side * -0.26);
      addPart(this.torsoPitch, s.cylGeo, s.pistonSteelMat, 0.10, 0.52, 0.10, side * 0.48, 0.30, -0.32, 0.08, 0, side * -0.14);
    }
    // Heavy braided hydraulic power conduits wrapping waist-to-chest!
    addPart(this.torsoPitch, s.hoseLeftGeo, s.hoseMat, 1, 1, 1, 0, 0, 0);
    addPart(this.torsoPitch, s.hoseRightGeo, s.hoseMat, 1, 1, 1, 0, 0, 0);

    // 4. Sculpted Multi-Faceted Brutalist Chest Core, Angled Pectoral Plates & Collar Cowls
    const chestScaleX = isHeavy ? 1.24 : 1.06;
    addPart(this.torsoPitch, s.bevelBox, this.armorMat, 1.56 * chestScaleX, 0.86, 1.16, 0, 0.96, 0.06);
    addPart(this.torsoPitch, s.chestGlacisGeo, this.armorMat, chestScaleX * 0.96, 0.92, 0.92, 0, 0.94, -0.26);

    // Angled left & right sloped pectoral armor shields + central sternum hatch (breaks up flat chest rectangle!)
    addPart(this.torsoPitch, s.crispPlate, this.trimMat, 0.44, 0.56, 0.26, 0, 0.96, -0.80, -0.22, 0, 0);
    for (const side of [-1, 1]) {
      addPart(
        this.torsoPitch,
        s.bevelBox,
        this.armorMat,
        0.58 * chestScaleX,
        0.54,
        0.32,
        side * 0.48 * chestScaleX,
        0.98,
        -0.66,
        -0.18,
        side * -0.24,
        side * 0.12
      );
      addPart(this.torsoPitch, s.crispPlate, s.cavityBlackMat, 0.36, 0.14, 0.12, side * 0.48 * chestScaleX, 1.15, -0.78, -0.28, side * -0.22, 0);
      // Sloped collar gorget guards flanking helmet
      addPart(this.torsoPitch, s.bevelBox, this.trimMat, 0.28, 0.40, 0.88, side * 0.54, 1.44, -0.06, 0.10, 0, side * 0.26);
    }

    if (isBoss) {
      for (const side of [-1, 1]) {
        addPart(this.torsoPitch, s.bevelBox, this.trimMat, 0.34, 1.25, 0.48, side * 0.92, 1.78, 0.28, -0.24, 0, side * -0.22);
        addPart(this.torsoPitch, s.crispPlate, this.visorMat, 0.08, 0.85, 0.12, side * 0.96, 1.82, 0.04, -0.24, 0, side * -0.22, false);
      }
    }

    // 5. Recessed Armored Dome Helmet & Razor-Sharp Glowing Amber T-Visor (matching key art!)
    this.head = new THREE.Group();
    this.head.position.set(0, 1.48, -0.14);
    this.torsoPitch.add(this.head);

    addPart(this.head, s.bevelBox, s.cavityBlackMat, 0.56, 0.30, 0.62, 0, 0.10, -0.04);
    // Low-profile aggressive sloped brow overhang & angular cheek mandible guards
    addPart(this.head, s.bevelBox, this.armorMat, 0.72, 0.22, 0.76, 0, 0.24, 0.0, 0.14, 0, 0);
    for (const side of [-1, 1]) {
      addPart(this.head, s.crispPlate, this.armorMat, 0.18, 0.26, 0.66, side * 0.31, 0.05, -0.03, 0, side * 0.16, side * -0.14);
      addPart(this.head, s.cylGeo, this.trimMat, 0.16, 0.12, 0.16, side * 0.39, 0.14, 0.06, 0, 0, Math.PI * 0.5);
    }
    // Crisp, recessed T-Slit Visor (horizontal brow bar + narrow vertical nose slit)
    addPart(this.head, s.crispPlate, this.visorMat, 0.44, 0.055, 0.05, 0, 0.135, -0.34, 0, 0, 0, false);
    addPart(this.head, s.crispPlate, this.visorMat, 0.075, 0.13, 0.05, 0, 0.06, -0.34, 0, 0, 0, false);
    // Swept dual blade sensor antennas
    addPart(this.head, s.crispPlate, this.trimMat, 0.04, 0.42, 0.14, 0.28, 0.38, 0.12, -0.32, 0, -0.14);
    addPart(this.head, s.crispPlate, this.armorMat, 0.035, 0.28, 0.10, -0.26, 0.32, 0.14, -0.28, 0, 0.12);

    if (this.role === 'PLAYER') {
      this.visorGlowLight = new THREE.PointLight(visorColor, 0.65, 2.0, 2.0);
      this.visorGlowLight.position.set(0, 0.08, -0.48);
      this.head.add(this.visorGlowLight);
    }

    // 6. Sculpted Dorsal Reactor Pack & High-Canted Military Turbofans (visible over shoulders & roaring through arm gap like key art!)
    this.backpack = new THREE.Group();
    this.backpack.position.set(0, 1.02, 0.66);
    this.torsoPitch.add(this.backpack);

    addPart(this.backpack, s.bevelBox, this.trimMat, 1.18, 0.84, 0.54, 0, 0.02, 0);
    addPart(this.backpack, s.crispPlate, this.armorMat, 0.72, 0.68, 0.26, 0, 0.04, 0.28, -0.12, 0, 0);

    const turbineOffsets = isBoss ? [-0.92, -0.44, 0.44, 0.92] : [-0.82, 0.82];
    for (const tx of turbineOffsets) {
      const side = Math.sign(tx);
      const pod = new THREE.Group();
      pod.position.set(tx, 0.68, 0.20);
      // Canted so intake rises proudly over shoulder & supersonic Mach-diamond flame shoots down-back-outward!
      pod.rotation.set(-0.28, 0, side * 0.24);
      this.backpack.add(pod);

      addPart(pod, s.turbineGeo, this.trimMat, 1.04, 1.06, 1.04, 0, 0.02, 0);
      // Armored outer turbine saddle clamp & recessed dark intake core
      addPart(pod, s.bevelBox, this.armorMat, 0.22, 0.68, 0.42, side * 0.18, 0.08, 0);
      addPart(pod, s.cylGeo, s.cavityBlackMat, 0.34, 0.06, 0.34, 0, 0.66, 0);
      addPart(pod, s.cylGeo, s.darkGunMat, 0.38, 0.18, 0.38, 0, -0.58, 0);
      addPart(pod, s.cylGeo, this.ventGlowMat, 0.30, 0.05, 0.30, 0, -0.68, 0, 0, 0, 0, false);

      const plume = new THREE.Mesh(s.plumeGeo, this.thrusterPlumeMat);
      plume.position.set(0, -0.68, 0);
      plume.userData.excludeAO = true;
      pod.add(plume);
      this.thrusterCones.push(plume);
    }

    for (const side of [-1, 1]) {
      const finPivot = new THREE.Group();
      finPivot.position.set(side * 0.42, -0.06, 0.26);
      this.backpack.add(finPivot);
      addPart(finPivot, s.crispPlate, this.ventGlowMat, 0.08, 0.52, 0.32, side * 0.08, 0, 0.12, 0, 0, 0, false);
      this.ventFins.push({ pivot: finPivot, side });
    }

    if (this.role === 'PLAYER' || isBoss) {
      this.thrusterLight = new THREE.PointLight(thrusterColor, 4.4, 9.5, 1.8);
      this.thrusterLight.position.set(0, -0.18, 1.15);
      this.backpack.add(this.thrusterLight);
    }

    // 7. Dual Hinged VLS 6-Cell Shoulder Missile Pods
    for (const side of [-1, 1]) {
      const podGroup = new THREE.Group();
      podGroup.position.set(side * (0.84 * chestScaleX + 0.34), 1.48, 0.06);
      podGroup.rotation.z = side * -0.10;
      this.torsoPitch.add(podGroup);

      addPart(podGroup, s.bevelBox, this.trimMat, 0.64, 0.44, 0.84, 0, 0, 0);
      addPart(podGroup, s.crispPlate, s.cavityBlackMat, 0.54, 0.32, 0.06, 0, 0.0, -0.40);

      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 3; c++) {
          addPart(
            podGroup,
            s.cylGeo,
            this.ventGlowMat,
            0.10,
            0.08,
            0.10,
            (c - 1) * 0.16,
            (r - 0.5) * 0.13,
            -0.41,
            Math.PI * 0.5,
            0,
            0,
            false
          );
        }
      }

      const door = new THREE.Group();
      door.position.set(0, 0.22, -0.39);
      podGroup.add(door);
      addPart(door, s.crispPlate, this.armorMat, 0.62, 0.08, 0.48, 0, 0, 0.22);
      this.missilePodDoors.push(door);
    }

    // 8. Articulated Right Arm + GAU-9 6-Barrel Rotary Autocannon
    this.rightShoulder = new THREE.Group();
    this.rightShoulder.position.set(0.86 * chestScaleX + 0.34, 1.12, 0);
    this.rightShoulder.rotation.z = 0.08;
    this.torsoPitch.add(this.rightShoulder);
    this._buildArmWithRotary(s, this.rightShoulder);

    // 9. Articulated Left Arm + Faceted Ballistic Shield & HV-88 Rail-Cannon
    this.leftShoulder = new THREE.Group();
    this.leftShoulder.position.set(-(0.86 * chestScaleX + 0.34), 1.12, 0);
    this.leftShoulder.rotation.z = -0.08;
    this.torsoPitch.add(this.leftShoulder);
    this._buildArmWithRailAndShield(s, this.leftShoulder);
  }

  _buildLeg(s, hipX) {
    const side = Math.sign(hipX);
    const hip = new THREE.Group();
    hip.position.set(hipX, -0.14, 0);
    // Natural heroic outward A-stance splay!
    hip.rotation.z = side * 0.092;
    this.pelvis.add(hip);

    // Athletic tapered armored femur + dark internal frame spine + dual rear hydraulic pistons
    addPart(hip, s.bevelBox, s.frameMat, 0.36, 1.18, 0.42, 0, -0.60, 0.04);
    addPart(hip, s.thighArmorGeo, this.armorMat, 0.86, 1.16, 0.98, 0, -0.54, -0.04);
    addPart(hip, s.bevelBox, this.trimMat, 0.20, 0.84, 0.48, side * 0.26, -0.50, -0.04, 0, 0, side * -0.08);
    addPart(hip, s.cylGeo, s.pistonSteelMat, 0.11, 0.96, 0.11, -0.10, -0.58, 0.26);
    addPart(hip, s.cylGeo, s.pistonSteelMat, 0.11, 0.96, 0.11, 0.10, -0.58, 0.26);

    // Exposed mechanical double-drum knee actuator + aggressive forward knee-breaker prow
    const knee = new THREE.Group();
    knee.position.set(0, -1.24, -0.04);
    hip.add(knee);

    addPart(knee, s.cylGeo, s.frameMat, 0.40, 0.52, 0.40, 0, 0.0, 0.02, 0, 0, Math.PI * 0.5);
    addPart(knee, s.cylGeo, s.pistonSteelMat, 0.24, 0.60, 0.24, 0, 0.0, 0.02, 0, 0, Math.PI * 0.5);
    addPart(knee, s.kneeProwGeo, this.trimMat, 0.96, 1.02, 1.04, 0, 0.08, -0.26);

    // Tall swept Armored-Core flared shin greave + sculpted rear calf armor louvers + Vernier hydro-jet
    addPart(knee, s.bevelBox, s.frameMat, 0.36, 1.16, 0.44, 0, -0.66, 0.16);
    addPart(knee, s.shinGreaveGeo, this.armorMat, 1.02, 1.24, 1.04, 0, -0.66, 0.02);
    addPart(knee, s.crispPlate, this.trimMat, 0.18, 0.86, 0.54, side * 0.28, -0.68, 0.02, 0, 0, side * -0.08);
    // Angled rear calf armor plates so back-of-leg silhouette looks sculpted & mechanical (zero flat box!)
    addPart(knee, s.crispPlate, this.armorMat, 0.44, 0.46, 0.20, 0, -0.44, 0.38, 0.28, 0, 0);
    addPart(knee, s.crispPlate, this.trimMat, 0.40, 0.38, 0.18, 0, -0.84, 0.42, 0.22, 0, 0);
    addPart(knee, s.cylGeo, s.darkGunMat, 0.26, 0.40, 0.26, 0, -0.72, 0.48, -0.52, 0, 0);

    const heelPlume = new THREE.Mesh(s.plumeGeo, this.thrusterPlumeMat);
    heelPlume.position.set(0, -0.88, 0.58);
    heelPlume.rotation.x = Math.PI * 0.44;
    heelPlume.userData.excludeAO = true;
    knee.add(heelPlume);
    this.thrusterCones.push(heelPlume);

    // Articulated Multi-Toe Stabilizer Foot (counter-angled so soles plant flat on floor in A-stance!)
    const ankle = new THREE.Group();
    ankle.position.set(0, -1.34, 0.04);
    ankle.rotation.z = -side * 0.092;
    knee.add(ankle);

    addPart(ankle, s.cylGeo, s.pistonSteelMat, 0.12, 0.28, 0.12, -0.18, 0.10, -0.12, 0.2, 0, 0);
    addPart(ankle, s.cylGeo, s.pistonSteelMat, 0.12, 0.28, 0.12, 0.18, 0.10, -0.12, 0.2, 0, 0);
    addPart(ankle, s.bevelBox, this.trimMat, 0.70, 0.22, 1.00, 0, -0.06, -0.08);
    // Splayed twin armored front claws + side outrigger stabilizer toe + heel spur
    addPart(ankle, s.bevelBox, this.armorMat, 0.26, 0.19, 0.52, -0.20, -0.08, -0.58, 0.14, 0.12, 0);
    addPart(ankle, s.bevelBox, this.armorMat, 0.26, 0.19, 0.52, 0.20, -0.08, -0.58, 0.14, -0.12, 0);
    addPart(ankle, s.crispPlate, this.trimMat, 0.20, 0.15, 0.56, side * 0.40, -0.09, -0.08, 0, 0, side * -0.18);
    addPart(ankle, s.crispPlate, this.armorMat, 0.46, 0.16, 0.44, 0, -0.09, 0.46, -0.12, 0, 0);

    const footWorldAnchor = new THREE.Object3D();
    footWorldAnchor.position.set(0, -0.16, -0.1);
    ankle.add(footWorldAnchor);

    return { hip, knee, ankle, footWorldAnchor, baseHipZ: side * 0.092 };
  }

  _buildArmWithRotary(s, shoulder) {
    addPart(shoulder, s.pauldronGeo, this.armorMat, 1.12, 1.12, 1.06, 0.16, 0.14, 0);
    addPart(shoulder, s.crispPlate, this.trimMat, 0.56, 0.18, 1.0, 0.28, -0.12, 0, 0, 0, -0.26);
    addPart(shoulder, s.cylGeo, s.pistonSteelMat, 0.44, 0.14, 0.44, 0.08, -0.24, 0);
    addPart(shoulder, s.bevelBox, s.frameMat, 0.40, 0.62, 0.42, 0.08, -0.52, 0);

    this.rightElbow = new THREE.Group();
    this.rightElbow.position.set(0.10, -0.86, 0);
    shoulder.add(this.rightElbow);
    this.rightElbow.rotation.x = 0.28;

    addPart(this.rightElbow, s.cylGeo, s.frameMat, 0.34, 0.46, 0.34, 0, 0, 0, 0, 0, Math.PI * 0.5);
    addPart(this.rightElbow, s.bevelBox, this.armorMat, 0.48, 0.70, 0.54, 0.02, -0.32, -0.12);
    addPart(this.rightElbow, s.bevelBox, s.darkGunMat, 0.32, 0.28, 0.34, 0.02, -0.68, -0.24);

    // Underslung GAU-9 6-Barrel Rotary Autocannon
    const gunRoot = new THREE.Group();
    gunRoot.position.set(0.06, -0.52, -0.58);
    this.rightElbow.add(gunRoot);

    addPart(gunRoot, s.bevelBox, s.darkGunMat, 0.42, 0.44, 0.98, 0, 0, 0);
    addPart(gunRoot, s.crispPlate, this.trimMat, 0.15, 0.20, 0.80, 0, 0.29, -0.06);
    addPart(gunRoot, s.cylGeo, this.trimMat, 0.60, 0.44, 0.60, 0.30, -0.10, 0.08, 0, 0, Math.PI * 0.5);
    addPart(gunRoot, s.cylGeo, s.darkGunMat, 0.36, 0.48, 0.36, 0.30, -0.10, 0.08, 0, 0, Math.PI * 0.5);

    this.rotaryBarrelGroup = new THREE.Group();
    this.rotaryBarrelGroup.position.set(0, -0.03, -0.50);
    gunRoot.add(this.rotaryBarrelGroup);

    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const bx = Math.cos(a) * 0.115;
      const by = Math.sin(a) * 0.115;
      addPart(
        this.rotaryBarrelGroup,
        s.cylGeo,
        s.pistonSteelMat,
        0.052,
        1.58,
        0.052,
        bx,
        by,
        -0.76,
        Math.PI * 0.5,
        0,
        0
      );
    }
    addPart(this.rotaryBarrelGroup, s.cylGeo, s.darkGunMat, 0.34, 0.18, 0.34, 0, 0, -0.32, Math.PI * 0.5, 0, 0);
    addPart(this.rotaryBarrelGroup, s.cylGeo, s.darkGunMat, 0.32, 0.09, 0.32, 0, 0, -0.98, Math.PI * 0.5, 0, 0);
    addPart(this.rotaryBarrelGroup, s.cylGeo, s.darkGunMat, 0.33, 0.11, 0.33, 0, 0, -1.46, Math.PI * 0.5, 0, 0);

    this.rightMuzzle = new THREE.Object3D();
    this.rightMuzzle.position.set(0, -0.03, -2.10);
    gunRoot.add(this.rightMuzzle);
  }

  _buildArmWithRailAndShield(s, shoulder) {
    addPart(shoulder, s.pauldronGeo, this.armorMat, -1.12, 1.12, 1.06, -0.16, 0.14, 0);
    addPart(shoulder, s.crispPlate, this.trimMat, 0.56, 0.18, 1.0, -0.28, -0.12, 0, 0, 0, 0.26);
    addPart(shoulder, s.cylGeo, s.pistonSteelMat, 0.44, 0.14, 0.44, -0.08, -0.24, 0);
    addPart(shoulder, s.bevelBox, s.frameMat, 0.40, 0.62, 0.42, -0.08, -0.52, 0);

    this.leftElbow = new THREE.Group();
    this.leftElbow.position.set(-0.10, -0.86, 0);
    shoulder.add(this.leftElbow);
    this.leftElbow.rotation.x = 0.28;

    addPart(this.leftElbow, s.cylGeo, s.frameMat, 0.34, 0.46, 0.34, 0, 0, 0, 0, 0, Math.PI * 0.5);
    addPart(this.leftElbow, s.bevelBox, this.armorMat, 0.48, 0.70, 0.54, -0.02, -0.32, -0.12);
    addPart(this.leftElbow, s.bevelBox, s.darkGunMat, 0.32, 0.28, 0.34, -0.02, -0.68, -0.24);

    const shield = new THREE.Group();
    shield.position.set(-0.38, -0.26, -0.20);
    shield.rotation.set(0.08, 0.24, 0.12);
    this.leftElbow.add(shield);
    addPart(shield, s.shieldGeo, this.armorMat, 1.02, 1.04, 1.02, 0, 0, 0);
    addPart(shield, s.crispPlate, this.trimMat, 0.12, 1.28, 0.36, -0.06, -0.04, 0);

    this.railGunRoot = new THREE.Group();
    this.railGunRoot.position.set(-0.04, -0.48, -0.58);
    this.leftElbow.add(this.railGunRoot);

    addPart(this.railGunRoot, s.bevelBox, s.darkGunMat, 0.36, 0.40, 0.92, 0, 0, 0);
    addPart(this.railGunRoot, s.crispPlate, this.trimMat, 0.20, 0.11, 1.68, 0, 0.12, -1.14);
    addPart(this.railGunRoot, s.crispPlate, this.trimMat, 0.20, 0.11, 1.68, 0, -0.12, -1.14);
    addPart(this.railGunRoot, s.crispPlate, this.ventGlowMat, 0.065, 0.075, 1.52, 0, 0, -1.10, 0, 0, 0, false);

    this.leftMuzzle = new THREE.Object3D();
    this.leftMuzzle.position.set(0, 0, -2.02);
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

    if (this._hitFlashTimer > 0) {
      this._hitFlashTimer -= dt;
      this.armorMat.emissive.setHex(0x52260e);
      this.armorMat.emissiveIntensity = 0.42;
    } else {
      this.armorMat.emissive.setHex(0x000000);
      this.armorMat.emissiveIntensity = 0;
    }

    this.torsoYaw.rotation.y = THREE.MathUtils.lerp(this.torsoYaw.rotation.y, aimYawOffset, Math.min(1, dt * 14));
    this.torsoPitch.rotation.x = THREE.MathUtils.lerp(
      this.torsoPitch.rotation.x,
      THREE.MathUtils.clamp(aimPitch, -0.55, 0.55),
      Math.min(1, dt * 14)
    );

    if (rotaryFiring) {
      this.rotaryBarrelGroup.rotation.z += dt * 34.0;
      this.rightElbow.position.z = Math.sin(elapsed * 55.0) * 0.045;
    } else {
      this.rightElbow.position.z = THREE.MathUtils.lerp(this.rightElbow.position.z, 0, Math.min(1, dt * 12));
    }

    this.railGunRoot.position.z = -0.58 + railRecoil * 0.36;

    const ventOpen = THREE.MathUtils.smoothstep(heatRatio, 0.38, 0.96);
    this.ventGlowMat.emissiveIntensity = 0.55 + ventOpen * 3.8;
    for (const v of this.ventFins) {
      v.pivot.rotation.y = v.side * (0.16 + ventOpen * 0.65);
    }

    // Sustain hot military turbofan idle flame & roar into full Mach-diamond afterburner on boost/skate!
    const plumePower = isSkating || isAirborne
      ? (1.28 + boostRatio * 0.95)
      : Math.max(speed > 1.5 ? 0.92 : 0.76, boostRatio * 1.55);
    const flicker = 0.93 + Math.sin(elapsed * 64.0) * 0.09;
    this.thrusterPlumeMat.uniforms.uTime.value = elapsed;
    this.thrusterPlumeMat.uniforms.uPower.value = Math.min(1.65, plumePower);

    const dorsalCount = this.role === 'BOSS' ? 4 : 2;
    this.thrusterCones.forEach((cone, idx) => {
      const isDorsal = idx < dorsalCount;
      const baseW = isDorsal ? 1.06 : 0.64;
      const baseL = isDorsal ? 1.05 : 0.62;
      cone.scale.set(
        baseW * (0.86 + plumePower * 0.20),
        baseL * plumePower * flicker,
        baseW * (0.86 + plumePower * 0.20)
      );
      cone.visible = isDorsal ? plumePower > 0.15 : (isSkating || isAirborne || speed > 3.0);
    });

    if (this.thrusterLight) {
      this.thrusterLight.intensity = (2.4 + plumePower * 4.2) * flicker;
    }

    if (isAirborne) {
      this.pelvis.position.y = THREE.MathUtils.lerp(this.pelvis.position.y, 2.68, dt * 8);
      this.pelvis.rotation.z = THREE.MathUtils.lerp(this.pelvis.rotation.z, -lateralSpeed * 0.012, dt * 8);
      this.pelvis.rotation.x = THREE.MathUtils.lerp(this.pelvis.rotation.x, forwardSpeed * 0.01, dt * 8);

      this.leftLeg.hip.rotation.x = THREE.MathUtils.lerp(this.leftLeg.hip.rotation.x, -0.35, dt * 8);
      this.leftLeg.knee.rotation.x = THREE.MathUtils.lerp(this.leftLeg.knee.rotation.x, 0.68, dt * 8);
      this.rightLeg.hip.rotation.x = THREE.MathUtils.lerp(this.rightLeg.hip.rotation.x, 0.15, dt * 8);
      this.rightLeg.knee.rotation.x = THREE.MathUtils.lerp(this.rightLeg.knee.rotation.x, 0.48, dt * 8);
    } else if (isSkating) {
      this.pelvis.position.y = THREE.MathUtils.lerp(this.pelvis.position.y, 2.36, dt * 10);
      this.pelvis.rotation.z = THREE.MathUtils.lerp(this.pelvis.rotation.z, -lateralSpeed * 0.016, dt * 10);
      this.pelvis.rotation.x = THREE.MathUtils.lerp(this.pelvis.rotation.x, forwardSpeed * 0.012 + 0.1, dt * 10);

      this.leftLeg.hip.rotation.x = THREE.MathUtils.lerp(this.leftLeg.hip.rotation.x, -0.52, dt * 10);
      this.leftLeg.knee.rotation.x = THREE.MathUtils.lerp(this.leftLeg.knee.rotation.x, 0.82, dt * 10);
      this.leftLeg.ankle.rotation.x = THREE.MathUtils.lerp(this.leftLeg.ankle.rotation.x, -0.28, dt * 10);

      this.rightLeg.hip.rotation.x = THREE.MathUtils.lerp(this.rightLeg.hip.rotation.x, 0.22, dt * 10);
      this.rightLeg.knee.rotation.x = THREE.MathUtils.lerp(this.rightLeg.knee.rotation.x, 0.56, dt * 10);
      this.rightLeg.ankle.rotation.x = THREE.MathUtils.lerp(this.rightLeg.ankle.rotation.x, -0.45, dt * 10);
    } else if (speed > 0.6) {
      const strideRate = Math.min(8.2, 2.8 + speed * 0.36);
      this._stridePhase += dt * strideRate;

      const sL = Math.sin(this._stridePhase);
      const sR = Math.sin(this._stridePhase + Math.PI);
      const liftL = Math.max(0, Math.cos(this._stridePhase));
      const liftR = Math.max(0, Math.cos(this._stridePhase + Math.PI));

      const bob = Math.abs(Math.cos(this._stridePhase)) * 0.14;
      this.pelvis.position.y = 2.72 - bob;
      this.pelvis.rotation.z = sL * 0.045;
      this.pelvis.rotation.x = THREE.MathUtils.lerp(this.pelvis.rotation.x, 0.04, dt * 8);

      this.leftLeg.hip.rotation.x = -sL * 0.52 - liftL * 0.22;
      this.leftLeg.knee.rotation.x = 0.18 + liftL * 0.68;
      this.leftLeg.ankle.rotation.x = sL * 0.24 - liftL * 0.3;

      this.rightLeg.hip.rotation.x = -sR * 0.52 - liftR * 0.22;
      this.rightLeg.knee.rotation.x = 0.18 + liftR * 0.68;
      this.rightLeg.ankle.rotation.x = sR * 0.24 - liftR * 0.3;

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
      // Heroic athletic A-stance with subtle combat-ready knee flex & forward stride offset!
      const breathe = Math.sin(elapsed * 1.8) * 0.028;
      this.pelvis.position.y = THREE.MathUtils.lerp(this.pelvis.position.y, 2.70 + breathe, dt * 6);
      this.pelvis.rotation.z = THREE.MathUtils.lerp(this.pelvis.rotation.z, 0, dt * 6);
      this.pelvis.rotation.x = THREE.MathUtils.lerp(this.pelvis.rotation.x, 0.03, dt * 6);

      this.leftLeg.hip.rotation.x = THREE.MathUtils.lerp(this.leftLeg.hip.rotation.x, -0.18, dt * 6);
      this.leftLeg.knee.rotation.x = THREE.MathUtils.lerp(this.leftLeg.knee.rotation.x, 0.32, dt * 6);
      this.leftLeg.ankle.rotation.x = THREE.MathUtils.lerp(this.leftLeg.ankle.rotation.x, -0.14, dt * 6);

      this.rightLeg.hip.rotation.x = THREE.MathUtils.lerp(this.rightLeg.hip.rotation.x, 0.10, dt * 6);
      this.rightLeg.knee.rotation.x = THREE.MathUtils.lerp(this.rightLeg.knee.rotation.x, 0.24, dt * 6);
      this.rightLeg.ankle.rotation.x = THREE.MathUtils.lerp(this.rightLeg.ankle.rotation.x, -0.34, dt * 6);
    }
  }
}
