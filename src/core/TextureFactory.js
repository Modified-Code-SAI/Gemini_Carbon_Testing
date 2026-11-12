import * as THREE from 'three';

function loadHtmlImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = src;
  });
}

/**
 * Synthesizes 1024x1024 tangent-space multi-scale normal, roughness, and curvature-enhanced
 * albedo/AO maps from an input texture using wrapped Scharr + Sobel height & Laplacian operators.
 */
function derivePBRMaps(img, {
  size = 1024,
  normalStrength = 2.8,
  baseRough = 0.62,
  roughContrast = 0.38,
  invertRough = true,
  edgeWearBoost = 0.14,
  cavityDarken = 0.22,
  albedoLift = 1.18,
} = {}) {
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = size;
  srcCanvas.height = size;
  const sctx = srcCanvas.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(img, 0, 0, size, size);
  const srcImg = sctx.getImageData(0, 0, size, size);
  const srcData = srcImg.data;

  const gray = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const idx = i * 4;
    gray[i] = (srcData[idx] * 0.299 + srcData[idx + 1] * 0.587 + srcData[idx + 2] * 0.114) / 255;
  }

  const normCanvas = document.createElement('canvas');
  normCanvas.width = size;
  normCanvas.height = size;
  const nctx = normCanvas.getContext('2d');
  const normImg = nctx.createImageData(size, size);

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rctx = roughCanvas.getContext('2d');
  const roughImg = rctx.createImageData(size, size);

  const mask = size - 1;
  const isPow2 = (size & mask) === 0;
  const sample = isPow2
    ? (x, y) => gray[((y & mask) * size) + (x & mask)]
    : (x, y) => gray[(((y % size) + size) % size) * size + (((x % size) + size) % size)];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tl = sample(x - 1, y - 1);
      const t = sample(x, y - 1);
      const tr = sample(x + 1, y - 1);
      const l = sample(x - 1, y);
      const c = sample(x, y);
      const r = sample(x + 1, y);
      const bl = sample(x - 1, y + 1);
      const b = sample(x, y + 1);
      const br = sample(x + 1, y + 1);

      // Broad meso-scale bevel gradient (radius 3) for crisp architectural & armor panel relief
      const l3 = sample(x - 3, y);
      const r3 = sample(x + 3, y);
      const t3 = sample(x, y - 3);
      const b3 = sample(x, y + 3);

      const dXFine = (3 * tr + 10 * r + 3 * br) - (3 * tl + 10 * l + 3 * bl);
      const dYFine = (3 * bl + 10 * b + 3 * br) - (3 * tl + 10 * t + 3 * tr);
      const dXMeso = (r3 - l3) * 6.0;
      const dYMeso = (b3 - t3) * 6.0;

      const dX = (dXFine * 0.0625) * 0.72 + (dXMeso * 0.08) * 0.28;
      const dY = (dYFine * 0.0625) * 0.72 + (dYMeso * 0.08) * 0.28;

      let nx = -dX * normalStrength;
      let ny = -dY * normalStrength;
      let nz = 1.0;
      const invLen = 1.0 / Math.hypot(nx, ny, nz);
      nx *= invLen;
      ny *= invLen;
      nz *= invLen;

      // Discrete Laplacian curvature: positive on convex edges, negative inside panel seams/pores
      const avgNeighbors = (t + b + l + r + tl * 0.5 + tr * 0.5 + bl * 0.5 + br * 0.5) / 6.0;
      const curvature = c - avgNeighbors; // [-0.5 .. +0.5]
      const convexEdge = Math.max(0, curvature * 4.5);
      const cavity = Math.max(0, -curvature * 4.5);

      const idx = (y * size + x) * 4;
      normImg.data[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      normImg.data[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normImg.data[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normImg.data[idx + 3] = 255;

      // Enhance albedo with realistic micro-cavity occlusion + worn edge highlight + calibrated reflectance
      const shadeMod = Math.max(0.45, 1.0 - cavity * cavityDarken) * albedoLift;
      const wearAdd = convexEdge * edgeWearBoost * 255;
      srcData[idx] = Math.min(255, Math.round(srcData[idx] * shadeMod + wearAdd));
      srcData[idx + 1] = Math.min(255, Math.round(srcData[idx + 1] * shadeMod + wearAdd));
      srcData[idx + 2] = Math.min(255, Math.round(srcData[idx + 2] * shadeMod + wearAdd * 1.04));

      // Roughness: smoother on worn convex edges, rougher inside dusty/pitted cavities
      const delta = invertRough ? (0.5 - c) : (c - 0.5);
      let rv = baseRough + delta * roughContrast + cavity * 0.22 - convexEdge * 0.18;
      rv = Math.max(0.08, Math.min(0.98, rv));
      const rb = Math.round(rv * 255);
      roughImg.data[idx] = rb;
      roughImg.data[idx + 1] = rb;
      roughImg.data[idx + 2] = rb;
      roughImg.data[idx + 3] = 255;
    }
  }

  sctx.putImageData(srcImg, 0, 0);
  nctx.putImageData(normImg, 0, 0);
  rctx.putImageData(roughImg, 0, 0);

  const albedoTex = new THREE.CanvasTexture(srcCanvas);
  albedoTex.colorSpace = THREE.SRGBColorSpace;
  albedoTex.wrapS = THREE.RepeatWrapping;
  albedoTex.wrapT = THREE.RepeatWrapping;
  albedoTex.anisotropy = 8;

  const normalTex = new THREE.CanvasTexture(normCanvas);
  normalTex.wrapS = THREE.RepeatWrapping;
  normalTex.wrapT = THREE.RepeatWrapping;
  normalTex.anisotropy = 8;

  const roughTex = new THREE.CanvasTexture(roughCanvas);
  roughTex.wrapS = THREE.RepeatWrapping;
  roughTex.wrapT = THREE.RepeatWrapping;
  roughTex.anisotropy = 4;

  return { albedoTex, normalTex, roughTex };
}

/**
 * Deterministic periodic 2D gradient & cellular Worley generators for seamless AAA
 * volumetric cloud, blackbody explosion, smoke erosion, and water foam shaders.
 */
function hashPeriodic(ix, iy, period, seed) {
  const x = ((ix % period) + period) % period;
  const y = ((iy % period) + period) % period;
  let n = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  n = n ^ (n >>> 16);
  return (n >>> 0) / 4294967295;
}

function periodicValueNoise(u, v, freq, seed) {
  const x = u * freq;
  const y = v * freq;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);

  const n00 = hashPeriodic(ix, iy, freq, seed);
  const n10 = hashPeriodic(ix + 1, iy, freq, seed);
  const n01 = hashPeriodic(ix, iy + 1, freq, seed);
  const n11 = hashPeriodic(ix + 1, iy + 1, freq, seed);

  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

function periodicWorley(u, v, cells, seed) {
  const x = u * cells;
  const y = v * cells;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let minDistSq = 99.0;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx;
      const cy = iy + dy;
      const px = cx + hashPeriodic(cx, cy, cells, seed);
      const py = cy + hashPeriodic(cx, cy, cells, seed + 97);
      const ddx = px - x;
      const ddy = py - y;
      const dSq = ddx * ddx + ddy * ddy;
      if (dSq < minDistSq) minDistSq = dSq;
    }
  }
  // Inverted Worley billow: 1.0 at lobe centers, 0.0 along sharp cauliflower creases
  return Math.max(0, 1.0 - Math.sqrt(minDistSq) * 0.92);
}

/**
 * Generates a 512x512 RGBA seamless multi-channel Perlin-Worley Pyro/Cloud/Water texture:
 * - R: 5-octave seamless FBM turbulence
 * - G: 3-octave inverted Worley cauliflower billow lobes
 * - B: Nubis-style Perlin-Worley remapped volumetric cloud/smoke density
 * - A: High-frequency detail noise for crisp foam & spark erosion
 */
function createPerlinWorleyNoiseTexture(size = 512) {
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;

      const fbm =
        periodicValueNoise(u, v, 4, 11) * 0.5 +
        periodicValueNoise(u, v, 8, 23) * 0.25 +
        periodicValueNoise(u, v, 16, 37) * 0.125 +
        periodicValueNoise(u, v, 32, 53) * 0.075 +
        periodicValueNoise(u, v, 64, 71) * 0.05;

      const worley =
        periodicWorley(u, v, 5, 101) * 0.58 +
        periodicWorley(u, v, 10, 211) * 0.28 +
        periodicWorley(u, v, 20, 307) * 0.14;

      // Remap Perlin by Worley for authentic cumulus/pyroclastic cauliflower lobes
      const cloudBase = Math.max(0, Math.min(1, fbm * 0.62 + worley * 0.52 - 0.12));

      const fine =
        periodicValueNoise(u, v, 24, 401) * 0.55 +
        periodicWorley(u, v, 32, 509) * 0.45;

      const idx = (y * size + x) * 4;
      data[idx] = Math.round(Math.max(0, Math.min(1, fbm)) * 255);
      data[idx + 1] = Math.round(Math.max(0, Math.min(1, worley)) * 255);
      data[idx + 2] = Math.round(cloudBase * 255);
      data[idx + 3] = Math.round(Math.max(0, Math.min(1, fine)) * 255);
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates an organic Worley-eroded volumetric mist/smoke sprite texture (zero geometric circle edges)
 */
function createSoftMistTexture(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    const ny = (y / size) * 2 - 1;
    for (let x = 0; x < size; x++) {
      const nx = (x / size) * 2 - 1;
      const r = Math.hypot(nx, ny);

      const u = x / size;
      const v = y / size;
      const billow =
        periodicWorley(u, v, 4, 17) * 0.55 +
        periodicValueNoise(u, v, 7, 43) * 0.45;

      const radialFalloff = Math.max(0, 1.0 - r);
      const shaped = Math.pow(radialFalloff, 1.65) * (0.42 + billow * 0.85);
      const alpha = Math.max(0, Math.min(1, shaped * 1.18 - (1.0 - radialFalloff) * 0.22));

      // Subtle pseudo-spherical shading in RGB so puffs have 3D volume even before lighting
      const shade = Math.max(0.55, Math.min(1.0, 0.82 - ny * 0.14 + billow * 0.2));
      const c = Math.round(shade * 255);
      const idx = (y * size + x) * 4;
      img.data[idx] = c;
      img.data[idx + 1] = c;
      img.data[idx + 2] = c;
      img.data[idx + 3] = Math.round(alpha * 255);
    }
  }

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Generates an anamorphic starburst flare texture for rocket motors, muzzle flashes, and optics.
 */
function createStarFlareTexture(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    const ny = (y / size) * 2 - 1;
    for (let x = 0; x < size; x++) {
      const nx = (x / size) * 2 - 1;
      const r = Math.hypot(nx, ny);
      const core = Math.exp(-r * r * 14.0);
      const hStreak = Math.exp(-Math.abs(ny) * 18.0) * Math.exp(-Math.abs(nx) * 2.2) * 0.75;
      const vStreak = Math.exp(-Math.abs(nx) * 22.0) * Math.exp(-Math.abs(ny) * 3.4) * 0.42;
      const diag = Math.exp(-Math.abs(nx - ny) * 24.0) * Math.exp(-r * 3.5) * 0.22;
      const val = Math.min(1.0, (core + hStreak + vStreak + diag) * Math.max(0, 1.0 - r));

      const idx = (y * size + x) * 4;
      img.data[idx] = 255;
      img.data[idx + 1] = Math.round(235 + core * 20);
      img.data[idx + 2] = Math.round(205 + core * 50);
      img.data[idx + 3] = Math.round(val * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createScorchDecalTexture(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size * 0.5;
  const grad = ctx.createRadialGradient(cx, cx, 2, cx, cx, cx * 0.92);
  grad.addColorStop(0.0, 'rgba(255, 145, 38, 0.95)');
  grad.addColorStop(0.18, 'rgba(24, 18, 15, 0.92)');
  grad.addColorStop(0.55, 'rgba(12, 12, 14, 0.68)');
  grad.addColorStop(1.0, 'rgba(10, 10, 12, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class TextureFactory {
  static async loadAll(onProgress) {
    onProgress?.(0.16, 'LOADING 1K ARCHITECTURAL & TITANIUM ARMOR TEXTURES...');
    const [concreteImg, armorImg] = await Promise.all([
      loadHtmlImage('./assets/textures/brutalist_concrete.jpg'),
      loadHtmlImage('./assets/textures/mech_armor_titanium.jpg'),
    ]);

    onProgress?.(0.38, 'SYNTHESIZING 1024PX MULTI-SCALE NORMAL & CURVATURE MAPS...');
    const concrete = derivePBRMaps(concreteImg, {
      size: 1024,
      normalStrength: 3.2,
      baseRough: 0.68,
      roughContrast: 0.42,
      invertRough: true,
      edgeWearBoost: 0.09,
      cavityDarken: 0.25,
      albedoLift: 1.15,
    });

    const armor = derivePBRMaps(armorImg, {
      size: 1024,
      normalStrength: 2.7,
      baseRough: 0.34,
      roughContrast: 0.36,
      invertRough: true,
      edgeWearBoost: 0.22,
      cavityDarken: 0.3,
      albedoLift: 1.38,
    });

    onProgress?.(0.52, 'GENERATING VOLUMETRIC PERLIN-WORLEY PYRO & CLOUD NOISE...');
    const pyroNoise = createPerlinWorleyNoiseTexture(512);
    const softParticle = createSoftMistTexture(256);
    const starFlare = createStarFlareTexture(128);
    const scorchDecal = createScorchDecalTexture(128);

    return {
      concrete,
      armor,
      pyroNoise,
      softParticle,
      starFlare,
      scorchDecal,
    };
  }
}
