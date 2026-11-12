import * as THREE from 'three';

const MAX_RIPPLES = 32;
const EMPTY_PLANES = [];

export class WaterSystem {
  constructor(renderer, scene, qualityManager, pyroNoiseTex) {
    this.renderer = renderer;
    this.scene = scene;
    this.quality = qualityManager;
    this.waterLevel = 0.0;
    this.time = 0;

    this.reflectionRT = null;
    this.reflectCamera = new THREE.PerspectiveCamera();
    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.08);
    this.excludedDuringReflect = [];

    this.ripples = [];
    for (let i = 0; i < MAX_RIPPLES; i++) {
      this.ripples.push(new THREE.Vector4(0, 0, -99, 0));
    }
    this._rippleCursor = 0;

    this._allocateReflectionTarget();

    // High-density storm basin water mesh for real geometric wave & shockwave displacement
    const geo = new THREE.PlaneGeometry(360, 360, 180, 180);
    geo.rotateX(-Math.PI / 2);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPyroNoise: { value: pyroNoiseTex },
        uReflectionMap: { value: this.reflectionRT ? this.reflectionRT.texture : null },
        uReflTexel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
        uHasPlanar: { value: this.reflectionRT ? 1.0 : 0.0 },
        uRainIntensity: { value: 0.85 },
        uSunDir: { value: new THREE.Vector3(0.46, 0.48, -0.75).normalize() },
        uSunColor: { value: new THREE.Color(0xc8e0f8) },
        uSkyColor: { value: new THREE.Color(0x34495e) },
        uSkyTopColor: { value: new THREE.Color(0x0b141e) },
        uDeepColor: { value: new THREE.Color(0x050a0f) },
        uShallowColor: { value: new THREE.Color(0x0d1822) },
        uFogColor: { value: new THREE.Color(0x23313f) },
        uFogDensity: { value: 0.0058 },
        uLightningFlash: { value: 0.0 },
        uReflProjView: { value: new THREE.Matrix4() },
        uRipples: { value: this.ripples },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform mat4 uReflProjView;
        uniform vec4 uRipples[${MAX_RIPPLES}];
        varying vec3 vWorldPos;
        varying vec4 vReflClip;
        varying float vWaveCrest;

        // Irrational-angle storm swell sum (zero axis alignment)
        float stormHeight(vec2 p, float t) {
          float h = 0.0;
          h += sin(dot(p, vec2(0.243, 0.167)) + t * 2.05) * 0.056;
          h += sin(dot(p, vec2(-0.198, 0.284)) - t * 1.72 + 1.1) * 0.048;
          h += sin(dot(p, vec2(0.381, -0.212)) + t * 2.65 + 2.4) * 0.034;
          h += sin(dot(p, vec2(-0.319, -0.347)) + t * 3.10 + 0.7) * 0.026;
          return h;
        }

        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vec4 flatWaterPos = vec4(worldPos.x, 0.0, worldPos.z, 1.0);
          vReflClip = uReflProjView * flatWaterPos;

          float swell = stormHeight(worldPos.xz, uTime);

          float ripDisp = 0.0;
          for (int i = 0; i < ${MAX_RIPPLES}; i++) {
            vec4 r = uRipples[i];
            if (r.w <= 0.001) continue;
            float age = uTime - r.z;
            if (age < 0.0 || age > 2.8) continue;
            float dist = length(worldPos.xz - r.xy);
            float radius = age * 11.5;
            float band = exp(-abs(dist - radius) * 1.45);
            float fade = (1.0 - age / 2.8);
            float wave = sin((dist - radius) * 5.5);
            ripDisp += wave * band * r.w * fade * 0.11;
          }

          worldPos.y += swell + ripDisp;
          vWorldPos = worldPos.xyz;
          vWaveCrest = clamp(swell * 7.2 + 0.32, 0.0, 1.0);

          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform sampler2D uPyroNoise;
        uniform sampler2D uReflectionMap;
        uniform vec2 uReflTexel;
        uniform float uHasPlanar;
        uniform float uRainIntensity;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform vec3 uSkyColor;
        uniform vec3 uSkyTopColor;
        uniform vec3 uDeepColor;
        uniform vec3 uShallowColor;
        uniform vec3 uFogColor;
        uniform float uFogDensity;
        uniform float uLightningFlash;
        uniform vec4 uRipples[${MAX_RIPPLES}];

        varying vec3 vWorldPos;
        varying vec4 vReflClip;
        varying float vWaveCrest;

        // Golden-angle rotated 8-wave analytic Gerstner/Capillary slope (100% grid-free!)
        vec2 computeStormWaveSlope(vec2 xz, float t, vec2 warp) {
          vec2 p = xz + warp * 1.55;
          vec2 grad = vec2(0.0);

          // 8 non-commensurate rotated wave vectors
          const vec2 d0 = vec2(0.832, 0.555);
          const vec2 d1 = vec2(-0.612, 0.791);
          const vec2 d2 = vec2(0.271, -0.963);
          const vec2 d3 = vec2(-0.944, -0.330);
          const vec2 d4 = vec2(0.978, -0.208);
          const vec2 d5 = vec2(-0.142, -0.990);
          const vec2 d6 = vec2(0.514, 0.858);
          const vec2 d7 = vec2(-0.779, 0.627);

          grad += d0 * cos(dot(p, d0) * 0.42 + t * 1.95) * 0.068;
          grad += d1 * cos(dot(p, d1) * 0.67 - t * 2.25 + 1.3) * 0.056;
          grad += d2 * cos(dot(p, d2) * 1.09 + t * 2.85 + 2.7) * 0.048;
          grad += d3 * cos(dot(p, d3) * 1.63 - t * 3.35 + 0.8) * 0.041;
          grad += d4 * cos(dot(p, d4) * 2.48 + t * 4.10 + 3.9) * 0.034;
          grad += d5 * cos(dot(p, d5) * 3.72 - t * 4.95 + 1.9) * 0.028;
          grad += d6 * cos(dot(p, d6) * 5.65 + t * 5.80 + 4.5) * 0.022;
          grad += d7 * cos(dot(p, d7) * 8.40 - t * 6.90 + 0.4) * 0.017;

          return grad * 1.48;
        }

        void main() {
          float camDist = length(cameraPosition - vWorldPos);
          float detailAtten = 1.0 - smoothstep(8.0, 145.0, camDist);

          // Sample multi-scale seamless Perlin-Worley texture at rotated coordinates to domain-warp waves & foam
          mat2 rotA = mat2(0.80, -0.60, 0.60, 0.80);
          mat2 rotB = mat2(-0.55, 0.835, -0.835, -0.55);

          vec2 nUv1 = (rotA * vWorldPos.xz) * 0.034 + vec2(uTime * 0.015, -uTime * 0.012);
          vec2 nUv2 = (rotB * vWorldPos.xz) * 0.115 - vec2(uTime * 0.026, uTime * 0.021);
          vec2 nUv3 = vWorldPos.xz * 0.36 + vec2(-uTime * 0.044, uTime * 0.036);

          vec4 nw1 = texture2D(uPyroNoise, nUv1);
          vec4 nw2 = texture2D(uPyroNoise, nUv2);
          vec4 nw3 = texture2D(uPyroNoise, nUv3);

          vec2 domainWarp = (nw1.rg - 0.5) * 2.4 + (nw2.rg - 0.5) * 0.85;
          vec2 slope = computeStormWaveSlope(vWorldPos.xz, uTime, domainWarp);

          // Fine organic capillary & rain-impact micro-ripples near camera (zero tiling!)
          vec2 microGrad = ((nw2.ba - 0.5) * 0.44 + (nw3.rg - 0.5) * 0.48 * (0.45 + uRainIntensity * 0.90)) * detailAtten;
          slope += microGrad;

          // Analytic concentric wave rings from footsteps, boosters, rail-slugs & collapsing columns
          float analyticFoam = 0.0;
          for (int i = 0; i < ${MAX_RIPPLES}; i++) {
            vec4 r = uRipples[i];
            if (r.w <= 0.001) continue;
            float age = uTime - r.z;
            if (age < 0.0 || age > 2.8) continue;
            vec2 delta = vWorldPos.xz - r.xy;
            float dist = length(delta) + 1e-4;
            float radius = age * 11.5;
            float band = exp(-abs(dist - radius) * 2.65);
            if (band > 0.008) {
              float fade = pow(1.0 - age / 2.8, 1.35) * r.w;
              float ringOsc = cos((dist - radius) * 11.0);
              slope += (delta / dist) * ringOsc * band * fade * 0.95;
              analyticFoam += max(0.0, ringOsc) * exp(-abs(dist - radius) * 3.2) * fade * 0.82;
            }
          }

          vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
          vec3 V = normalize(cameraPosition - vWorldPos);
          vec3 sunD = normalize(uSunDir);

          // Physically-grounded Schlick Fresnel for water (F0 = 0.022, roughness attenuated at grazing angles)
          float ndotv = max(dot(N, V), 0.001);
          float fresnel = 0.022 + 0.86 * pow(1.0 - ndotv, 4.4);

          // Planar reflection lookup with anisotropic wave-chop distortion
          vec2 baseReflUv = (vReflClip.xy / max(vReflClip.w, 0.001)) * 0.5 + 0.5;
          vec2 distort = vec2(N.x * 0.046, N.z * 0.072);
          vec2 reflUv = clamp(baseReflUv + distort, 0.003, 0.997);

          vec3 skyEnv = mix(uSkyTopColor * 1.15, uSkyColor * 1.25 + uSunColor * 0.16, pow(1.0 - ndotv, 1.9));
          skyEnv += vec3(0.50, 0.68, 0.92) * uLightningFlash * 0.65;

          vec3 reflColor = skyEnv;
          if (uHasPlanar > 0.5) {
            vec2 spread = uReflTexel * (1.2 + uRainIntensity * 0.95);
            vec3 c0 = texture2D(uReflectionMap, reflUv).rgb;
            vec3 c1 = texture2D(uReflectionMap, clamp(reflUv + vec2(spread.x, 0.0), 0.002, 0.998)).rgb;
            vec3 c2 = texture2D(uReflectionMap, clamp(reflUv - vec2(spread.x, 0.0), 0.002, 0.998)).rgb;
            vec3 c3 = texture2D(uReflectionMap, clamp(reflUv + vec2(0.0, spread.y * 1.6), 0.002, 0.998)).rgb;
            vec3 c4 = texture2D(uReflectionMap, clamp(reflUv - vec2(0.0, spread.y * 1.6), 0.002, 0.998)).rgb;
            vec3 blurredRefl = c0 * 0.40 + (c1 + c2 + c3 + c4) * 0.15;
            blurredRefl = blurredRefl / (1.0 + max(max(blurredRefl.r, blurredRefl.g), blurredRefl.b) * 0.08);
            reflColor = mix(skyEnv * 0.24, blurredRefl, 0.90);
          }

          // Flooded brutalist stone basin scattering & shallow dais / step depth modulation
          float rBasin = length(vWorldPos.xz);
          float daisProximity = 1.0 - smoothstep(9.5, 13.2, rBasin);
          float amphitheaterEdge = smoothstep(67.2, 69.2, rBasin);
          float shallowMask = clamp(daisProximity * 0.6 + amphitheaterEdge * 0.55 + nw1.r * 0.2, 0.0, 1.0);
          vec3 waterBody = mix(uDeepColor, uShallowColor, shallowMask);

          // Dual-lobe micro-facet sun & storm-break specular glitter
          vec3 H = normalize(sunD + V);
          float ndoth = max(dot(N, H), 0.0);
          float specCrisp = pow(ndoth, 220.0) * 2.6;
          float specBroad = pow(ndoth, 22.0) * 0.22;
          vec3 specLight = uSunColor * (specCrisp + specBroad) * (0.9 + uLightningFlash * 1.5);

          // High-threshold lacy Worley whitewater foam on wakes, splash crests & storm whitecaps
          float lacePattern = pow(nw2.g, 1.45) * 0.58 + nw3.a * 0.42;
          float curbFoam = smoothstep(0.62, 0.92, daisProximity * lacePattern) * 0.52
                         + smoothstep(0.62, 0.92, amphitheaterEdge * lacePattern) * 0.58;
          float whitecap = smoothstep(0.66, 0.93, vWaveCrest * lacePattern + length(slope) * 0.92) * 0.44 * uRainIntensity;
          float wakeLace = smoothstep(0.22, 0.78, analyticFoam * (0.38 + lacePattern * 1.25)) * 0.82;
          float foamMask = clamp(wakeLace + curbFoam + whitecap, 0.0, 0.85) * detailAtten;

          vec3 foamAlbedo = (uSkyColor * 1.25 + uSunColor * 0.38 + vec3(0.22)) * (0.75 + uLightningFlash * 0.5);

          vec3 col = mix(waterBody, reflColor, fresnel) + specLight;
          col = mix(col, foamAlbedo, foamMask);

          // Directional Rayleigh + Mie atmospheric aerial perspective matching scene FogExp2
          float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * camDist * camDist);
          float sunFogAlign = pow(max(dot(-V, sunD), 0.0), 6.0);
          vec3 aerialColor = uFogColor + uSunColor * sunFogAlign * 0.16 + vec3(0.35, 0.48, 0.65) * uLightningFlash * 0.25;
          col = mix(col, aerialColor, clamp(fogFactor, 0.0, 1.0));

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.y = this.waterLevel;
    this.mesh.renderOrder = -1;
    this.scene.add(this.mesh);
  }

  _allocateReflectionTarget() {
    if (this.reflectionRT) {
      this.reflectionRT.dispose();
      this.reflectionRT = null;
    }
    const scale = this.quality.config.planarReflectionScale;
    if (scale <= 0.01) {
      if (this.material) {
        this.material.uniforms.uReflectionMap.value = null;
        this.material.uniforms.uHasPlanar.value = 0.0;
      }
      return;
    }

    const w = Math.max(256, Math.floor(window.innerWidth * scale));
    const h = Math.max(256, Math.floor(window.innerHeight * scale));
    this.reflectionRT = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });

    if (this.material) {
      this.material.uniforms.uReflectionMap.value = this.reflectionRT.texture;
      this.material.uniforms.uReflTexel.value.set(1 / w, 1 / h);
      this.material.uniforms.uHasPlanar.value = 1.0;
    }
  }

  applyQuality() {
    this._allocateReflectionTarget();
  }

  resize() {
    this._allocateReflectionTarget();
  }

  spawnRipple(x, z, amplitude = 0.9) {
    const slot = this.ripples[this._rippleCursor];
    slot.set(x, z, this.time, Math.min(amplitude, 2.2));
    this._rippleCursor = (this._rippleCursor + 1) % MAX_RIPPLES;
  }

  updateReflection(mainCamera) {
    if (!this.reflectionRT) return;

    this.reflectCamera.projectionMatrix.copy(mainCamera.projectionMatrix);
    this.reflectCamera.projectionMatrixInverse.copy(mainCamera.projectionMatrixInverse);
    this.reflectCamera.fov = mainCamera.fov;
    this.reflectCamera.aspect = mainCamera.aspect;
    this.reflectCamera.near = mainCamera.near;
    this.reflectCamera.far = mainCamera.far;

    mainCamera.updateMatrixWorld();
    const camPos = mainCamera.position;
    this.reflectCamera.position.set(camPos.x, 2 * this.waterLevel - camPos.y, camPos.z);

    const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(mainCamera.quaternion);
    lookDir.y = -lookDir.y;

    this.reflectCamera.up.set(0, 1, 0);
    this.reflectCamera.lookAt(
      this.reflectCamera.position.x + lookDir.x * 20,
      this.reflectCamera.position.y + lookDir.y * 20,
      this.reflectCamera.position.z + lookDir.z * 20
    );
    this.reflectCamera.updateMatrixWorld();
    this.reflectCamera.matrixWorldInverse.copy(this.reflectCamera.matrixWorld).invert();
    this.material.uniforms.uReflProjView.value.multiplyMatrices(
      this.reflectCamera.projectionMatrix,
      this.reflectCamera.matrixWorldInverse
    );

    this.mesh.visible = false;
    const prevStates = this.excludedDuringReflect.map((obj) => {
      const v = obj.visible;
      obj.visible = false;
      return v;
    });

    const prevTarget = this.renderer.getRenderTarget();
    const prevToneMapping = this.renderer.toneMapping;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.clippingPlanes = [this.clipPlane];

    this.renderer.setRenderTarget(this.reflectionRT);
    this.renderer.clear(true, true, false);
    this.renderer.render(this.scene, this.reflectCamera);

    this.renderer.clippingPlanes = EMPTY_PLANES;
    this.renderer.toneMapping = prevToneMapping;
    this.renderer.setRenderTarget(prevTarget);

    this.mesh.visible = true;
    this.excludedDuringReflect.forEach((obj, idx) => {
      obj.visible = prevStates[idx];
    });
  }

  update(dt, elapsed, weather) {
    this.time = elapsed;
    const u = this.material.uniforms;
    u.uTime.value = elapsed;
    if (weather) {
      u.uRainIntensity.value = weather.rainIntensity;
      u.uSunDir.value.copy(weather.sunDirection);
      u.uSunColor.value.copy(weather.sunColor);
      u.uSkyColor.value.copy(weather.skyHorizonColor);
      u.uSkyTopColor.value.copy(weather.skyTopColor);
      u.uFogColor.value.copy(this.scene.fog.color);
      u.uFogDensity.value = this.scene.fog.density;
      u.uLightningFlash.value = weather.lightningFlash;
    }
  }
}
