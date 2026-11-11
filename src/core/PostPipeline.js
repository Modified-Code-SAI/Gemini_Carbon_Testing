import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const UberPostShader = {
  name: 'UberPostShader',
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
    uTime: { value: 0 },
    uBoostIntensity: { value: 0 },
    uImpactShock: { value: 0 },
    uRainLensWeight: { value: 0 },
    uSharpen: { value: 0.28 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform float uBoostIntensity;
    uniform float uImpactShock;
    uniform float uRainLensWeight;
    uniform float uSharpen;
    varying vec2 vUv;

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    vec2 lensRainOffset(vec2 uv, float t) {
      vec2 aspect = vec2(uResolution.x / max(uResolution.y, 1.0), 1.0);
      vec2 st = uv * aspect * 9.5;
      st.y += t * 0.55;
      vec2 id = floor(st);
      vec2 gv = fract(st) - 0.5;
      float n = hash21(id);
      if (n < 0.72) return vec2(0.0);
      float slide = sin(t * (1.2 + n) + n * 6.2831) * 0.18;
      vec2 dropPos = vec2((n - 0.85) * 1.4, slide);
      vec2 diff = gv - dropPos;
      diff.y *= 0.65;
      float d = length(diff);
      float mask = smoothstep(0.22, 0.03, d);
      return diff * mask * 0.45;
    }

    void main() {
      vec2 uv = vUv;
      vec2 toCenter = uv - 0.5;
      float radialDist = length(toCenter);

      // Subtle rain-on-optic droplets near periphery
      if (uRainLensWeight > 0.005 && radialDist > 0.24) {
        float edgeMask = smoothstep(0.24, 0.68, radialDist);
        uv += lensRainOffset(uv, uTime) * uRainLensWeight * edgeMask * 0.012;
      }

      // Boost radial streak + ballistic impact dispersion in linear HDR
      float boostMask = smoothstep(0.12, 0.72, radialDist);
      float chroma = (uBoostIntensity * 0.0065 * boostMask) + (uImpactShock * 0.011 * radialDist);

      vec3 color = vec3(0.0);
      if (uBoostIntensity > 0.02) {
        vec2 streakStep = -toCenter * uBoostIntensity * boostMask * 0.014;
        vec3 acc = vec3(0.0);
        for (int i = 0; i < 4; i++) {
          float fi = float(i);
          vec2 sUv = clamp(uv + streakStep * fi, 0.001, 0.999);
          acc.r += texture2D(tDiffuse, sUv + toCenter * chroma).r;
          acc.g += texture2D(tDiffuse, sUv).g;
          acc.b += texture2D(tDiffuse, sUv - toCenter * chroma).b;
        }
        color = acc * 0.25;
      } else if (chroma > 0.0002) {
        color.r = texture2D(tDiffuse, clamp(uv + toCenter * chroma, 0.001, 0.999)).r;
        color.g = texture2D(tDiffuse, clamp(uv, 0.001, 0.999)).g;
        color.b = texture2D(tDiffuse, clamp(uv - toCenter * chroma, 0.001, 0.999)).b;
      } else {
        color = texture2D(tDiffuse, clamp(uv, 0.001, 0.999)).rgb;
      }

      // Contrast-Adaptive Sharpening (CAS-lite) for crisp PBR detail
      if (uSharpen > 0.01) {
        vec2 texel = 1.0 / uResolution;
        vec3 n = texture2D(tDiffuse, clamp(uv + vec2(0.0, texel.y), 0.001, 0.999)).rgb;
        vec3 s = texture2D(tDiffuse, clamp(uv - vec2(0.0, texel.y), 0.001, 0.999)).rgb;
        vec3 e = texture2D(tDiffuse, clamp(uv + vec2(texel.x, 0.0), 0.001, 0.999)).rgb;
        vec3 w = texture2D(tDiffuse, clamp(uv - vec2(texel.x, 0.0), 0.001, 0.999)).rgb;
        vec3 avg = (n + s + e + w) * 0.25;
        vec3 detail = color - avg;
        // Attenuate sharpening on super-bright HDR bloom peaks
        float hdrAtten = 1.0 / (1.0 + max(max(color.r, color.g), color.b));
        color = max(vec3(0.0), color + detail * uSharpen * hdrAtten * 1.6);
      }

      // Subtle cinema edge vignette & fine organic grain
      float vig = mix(1.0, smoothstep(0.96, 0.34, radialDist), 0.32);
      float grain = (hash21(uv * uResolution + fract(uTime * 17.3)) - 0.5) * 0.008;
      color = max(vec3(0.0), color * vig + grain);

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

export class PostPipeline {
  constructor(renderer, scene, camera, qualityManager) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = qualityManager;

    this.composer = null;
    this.renderPass = null;
    this.bloomPass = null;
    this.uberPass = null;
    this.outputPass = null;
    this.renderTarget = null;

    this.boostIntensity = 0;
    this.impactShock = 0;
    this.rainLensWeight = 0.5;

    this._buildComposer();
  }

  _buildComposer() {
    const cfg = this.quality.config;
    const dpr = Math.min(window.devicePixelRatio || 1, cfg.pixelRatioCap);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    const drawSize = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(drawSize);

    if (this.composer) {
      this.renderTarget?.dispose();
    }

    const maxSamples = this.renderer.capabilities.maxSamples || 0;
    const samples = Math.min(cfg.msaaSamples, maxSamples);

    this.renderTarget = new THREE.WebGLRenderTarget(drawSize.x, drawSize.y, {
      type: THREE.HalfFloatType,
      samples,
    });

    this.composer = new EffectComposer(this.renderer, this.renderTarget);
    this.composer.setPixelRatio(1); // drawSize already incorporates DPR
    this.composer.setSize(drawSize.x, drawSize.y);

    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(drawSize.x, drawSize.y),
      cfg.bloomStrength,
      cfg.bloomRadius,
      cfg.bloomThreshold
    );
    this.composer.addPass(this.bloomPass);

    this.uberPass = new ShaderPass(UberPostShader);
    this.uberPass.uniforms.uResolution.value.set(drawSize.x, drawSize.y);
    this.uberPass.uniforms.uSharpen.value = cfg.sharpen;
    this.composer.addPass(this.uberPass);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
  }

  applyQuality() {
    this._buildComposer();
  }

  resize(width, height) {
    const cfg = this.quality.config;
    const dpr = Math.min(window.devicePixelRatio || 1, cfg.pixelRatioCap);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height);

    const drawSize = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(drawSize);
    this.composer.setSize(drawSize.x, drawSize.y);
    this.bloomPass.setSize(drawSize.x, drawSize.y);
    this.uberPass.uniforms.uResolution.value.set(drawSize.x, drawSize.y);
  }

  addImpactShock(amount = 0.45) {
    this.impactShock = Math.min(1.0, this.impactShock + amount);
  }

  render(dt, elapsed) {
    const cfg = this.quality.config;
    this.impactShock = Math.max(0, this.impactShock - dt * 2.8);

    this.uberPass.uniforms.uTime.value = elapsed;
    this.uberPass.uniforms.uBoostIntensity.value = this.boostIntensity;
    this.uberPass.uniforms.uImpactShock.value = this.impactShock;
    this.uberPass.uniforms.uRainLensWeight.value = cfg.lensFX ? this.rainLensWeight : 0.0;
    this.uberPass.uniforms.uSharpen.value = cfg.sharpen;

    this.composer.render(dt);
  }
}
