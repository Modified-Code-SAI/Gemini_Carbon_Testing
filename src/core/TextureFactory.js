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
 * Synthesizes tangent-space normal, roughness, and metalness maps from an input image
 * using Sobel height gradients on an offscreen canvas.
 */
function derivePBRMaps(img, size = 512, normalStrength = 2.6, baseRough = 0.72, roughContrast = 0.35, invertRough = true) {
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = size;
  srcCanvas.height = size;
  const sctx = srcCanvas.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(img, 0, 0, size, size);
  const srcData = sctx.getImageData(0, 0, size, size).data;

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

  const sample = (x, y) => {
    const wx = (x + size) % size;
    const wy = (y + size) % size;
    return gray[wy * size + wx];
  };

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

      const dX = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dY = (bl + 2 * b + br) - (tl + 2 * t + tr);

      let nx = -dX * normalStrength;
      let ny = -dY * normalStrength;
      let nz = 1.0;
      const invLen = 1.0 / Math.hypot(nx, ny, nz);
      nx *= invLen;
      ny *= invLen;
      nz *= invLen;

      const idx = (y * size + x) * 4;
      normImg.data[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      normImg.data[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normImg.data[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normImg.data[idx + 3] = 255;

      const delta = invertRough ? (0.5 - c) : (c - 0.5);
      const rv = Math.max(0.08, Math.min(0.98, baseRough + delta * roughContrast));
      const rb = Math.round(rv * 255);
      roughImg.data[idx] = rb;
      roughImg.data[idx + 1] = rb;
      roughImg.data[idx + 2] = rb;
      roughImg.data[idx + 3] = 255;
    }
  }

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

function createProceduralWaterNormal(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);

  const hField = new Float32Array(size * size);
  const TAU = Math.PI * 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let h = 0;
      h += Math.sin(u * TAU * 3 + v * TAU * 2) * 0.35;
      h += Math.cos(u * TAU * 7 - v * TAU * 5 + 1.3) * 0.22;
      h += Math.sin(u * TAU * 13 + v * TAU * 11 + 2.4) * 0.14;
      h += Math.cos(u * TAU * 23 - v * TAU * 19 + 0.7) * 0.08;
      hField[y * size + x] = h;
    }
  }

  const sample = (x, y) => hField[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = sample(x + 1, y) - sample(x - 1, y);
      const dy = sample(x, y + 1) - sample(x, y - 1);
      let nx = -dx * 2.4;
      let ny = -dy * 2.4;
      let nz = 1.0;
      const len = Math.hypot(nx, ny, nz);
      const idx = (y * size + x) * 4;
      img.data[idx] = Math.round(((nx / len) * 0.5 + 0.5) * 255);
      img.data[idx + 1] = Math.round(((ny / len) * 0.5 + 0.5) * 255);
      img.data[idx + 2] = Math.round(((nz / len) * 0.5 + 0.5) * 255);
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function createSoftMistTexture(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size * 0.5;
  const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  grad.addColorStop(0.0, 'rgba(255, 255, 255, 0.95)');
  grad.addColorStop(0.32, 'rgba(235, 242, 248, 0.52)');
  grad.addColorStop(0.7, 'rgba(205, 218, 230, 0.14)');
  grad.addColorStop(1.0, 'rgba(180, 195, 210, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
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
    onProgress?.(0.18, 'LOADING ARCHITECTURAL & ARMOR PBR TEXTURES...');
    const [concreteImg, armorImg] = await Promise.all([
      loadHtmlImage('./assets/textures/brutalist_concrete.jpg'),
      loadHtmlImage('./assets/textures/mech_armor_titanium.jpg'),
    ]);

    onProgress?.(0.42, 'SYNTHESIZING SOBEL NORMAL & ROUGHNESS MAPS...');
    const concrete = derivePBRMaps(concreteImg, 512, 3.1, 0.74, 0.42, true);
    const armor = derivePBRMaps(armorImg, 512, 2.5, 0.36, 0.34, true);
    const waterNormal = createProceduralWaterNormal(256);
    const softParticle = createSoftMistTexture(128);
    const scorchDecal = createScorchDecalTexture(128);

    return {
      concrete,
      armor,
      waterNormal,
      softParticle,
      scorchDecal,
    };
  }
}
