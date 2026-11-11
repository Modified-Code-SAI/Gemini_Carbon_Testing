import * as THREE from 'three';

const MAX_RIPPLES = 32;
const EMPTY_PLANES = [];

export class WaterSystem {
  constructor(renderer, scene, qualityManager, waterNormalTex) {
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

    const geo = new THREE.PlaneGeometry(340, 340, 140, 140);
    geo.rotateX(-Math.PI / 2);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uNormalMap: { value: waterNormalTex },
        uReflectionMap: { value: this.reflectionRT ? this.reflectionRT.texture : null },
        uHasPlanar: { value: this.reflectionRT ? 1.0 : 0.0 },
        uRainIntensity: { value: 0.85 },
        uSunDir: { value: new THREE.Vector3(0.45, 0.55, -0.7).normalize() },
        uSunColor: { value: new THREE.Color(0xc8dcf0) },
        uSkyColor: { value: new THREE.Color(0x1b2632) },
        uDeepColor: { value: new THREE.Color(0x060a0e) },
        uShallowColor: { value: new THREE.Color(0x0f1a22) },
        uFogColor: { value: new THREE.Color(0x121a22) },
        uFogDensity: { value: 0.0085 },
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
        varying float vRippleFoam;

        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vec4 flatWaterPos = vec4(worldPos.x, 0.0, worldPos.z, 1.0);
          vReflClip = uReflProjView * flatWaterPos;

          // Subtle multi-directional storm swell
          float swell = sin(worldPos.x * 0.14 + uTime * 1.6) * 0.042
                      + cos(worldPos.z * 0.17 - uTime * 1.35) * 0.036
                      + sin((worldPos.x - worldPos.z) * 0.31 + uTime * 2.4) * 0.018;

          float ripDisp = 0.0;
          float ripFoam = 0.0;
          for (int i = 0; i < ${MAX_RIPPLES}; i++) {
            vec4 r = uRipples[i];
            if (r.w <= 0.001) continue;
            float age = uTime - r.z;
            if (age < 0.0 || age > 3.2) continue;
            float dist = length(worldPos.xz - r.xy);
            float radius = age * 13.5;
            float band = exp(-abs(dist - radius) * 0.58);
            float fade = (1.0 - age / 3.2);
            float wave = sin((dist - radius) * 3.4);
            ripDisp += wave * band * r.w * fade * 0.14;
            ripFoam += band * r.w * fade;
          }

          worldPos.y += swell + ripDisp;
          vWorldPos = worldPos.xyz;
          vRippleFoam = clamp(ripFoam, 0.0, 1.5);

          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform sampler2D uNormalMap;
        uniform sampler2D uReflectionMap;
        uniform float uHasPlanar;
        uniform float uRainIntensity;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform vec3 uSkyColor;
        uniform vec3 uDeepColor;
        uniform vec3 uShallowColor;
        uniform vec3 uFogColor;
        uniform float uFogDensity;
        uniform float uLightningFlash;
        uniform vec4 uRipples[${MAX_RIPPLES}];

        varying vec3 vWorldPos;
        varying vec4 vReflClip;
        varying float vRippleFoam;

        float hash21(vec2 p) {
          p = fract(p * vec2(234.34, 435.345));
          p += dot(p, p + 34.23);
          return fract(p.x * p.y);
        }

        // Seamless organic multi-angle storm capillary ripples (zero grid boundaries)
        vec2 rainSurfaceGrad(vec2 xz, float t) {
          float a1 = dot(xz, vec2(1.73, 1.19)) * 2.4 + t * 5.2;
          float a2 = dot(xz, vec2(-1.31, 1.87)) * 2.9 - t * 4.6;
          float a3 = dot(xz, vec2(2.11, -0.93)) * 3.7 + t * 6.1;
          float gx = cos(a1) * 0.12 - cos(a2) * 0.1 + cos(a3) * 0.08;
          float gz = sin(a1) * 0.12 + cos(a2) * 0.11 - sin(a3) * 0.08;
          return vec2(gx, gz);
        }

        void main() {
          vec2 uv1 = vWorldPos.xz * 0.047 + vec2(uTime * 0.024, uTime * 0.017);
          vec2 uv2 = vWorldPos.xz * 0.113 - vec2(uTime * 0.031, -uTime * 0.023);
          vec2 uv3 = vWorldPos.xz * 0.27 + vec2(-uTime * 0.045, uTime * 0.038);

          vec3 n1 = texture2D(uNormalMap, uv1).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(uNormalMap, uv2).xyz * 2.0 - 1.0;
          vec3 n3 = texture2D(uNormalMap, uv3).xyz * 2.0 - 1.0;

          vec2 slope = (n1.xy * 0.48 + n2.xy * 0.36 + n3.xy * 0.22);

          // Add organic storm micro-ripples close to camera
          float camDist = length(cameraPosition - vWorldPos);
          if (uRainIntensity > 0.05 && camDist < 68.0) {
            float rainFade = (1.0 - camDist / 68.0) * uRainIntensity;
            slope += rainSurfaceGrad(vWorldPos.xz, uTime) * rainFade;
          }

          // Analytic shockwave normal perturbation for razor-sharp concentric water rings
          float analyticFoam = vRippleFoam * 0.35;
          for (int i = 0; i < ${MAX_RIPPLES}; i++) {
            vec4 r = uRipples[i];
            if (r.w <= 0.001) continue;
            float age = uTime - r.z;
            if (age < 0.0 || age > 3.2) continue;
            vec2 delta = vWorldPos.xz - r.xy;
            float dist = length(delta) + 1e-4;
            float radius = age * 13.5;
            float band = exp(-abs(dist - radius) * 0.72);
            if (band > 0.01) {
              float fade = (1.0 - age / 3.2) * r.w;
              float dWave = cos((dist - radius) * 4.2) * band * fade;
              slope += (delta / dist) * dWave * 0.85;
              analyticFoam += band * fade * 0.32;
            }
          }

          vec3 N = normalize(vec3(slope.x, 1.0, slope.y));
          vec3 V = normalize(cameraPosition - vWorldPos);

          // Schlick Fresnel
          float ndotv = max(dot(N, V), 0.0);
          float fresnel = 0.06 + 0.94 * pow(1.0 - ndotv, 4.0);

          // Exact planar reflection UV via reflectCamera view-projection matrix
          vec2 reflUv = (vReflClip.xy / max(vReflClip.w, 0.001)) * 0.5 + 0.5;
          reflUv = clamp(reflUv + N.xz * 0.052, 0.002, 0.998);

          vec3 skyFallback = mix(uSkyColor * 0.75, uSkyColor * 1.45 + uSunColor * 0.22, pow(1.0 - ndotv, 2.0));
          skyFallback += vec3(0.55, 0.68, 0.85) * uLightningFlash * 0.65;

          vec3 reflColor = skyFallback;
          if (uHasPlanar > 0.5) {
            vec3 sampleRefl = texture2D(uReflectionMap, reflUv).rgb;
            reflColor = mix(skyFallback * 0.35, sampleRefl, 0.88);
          }

          // Murky flooded stone basin base color + subtle colosseum step rings
          float radialBasin = length(vWorldPos.xz);
          float stepRing = smoothstep(0.88, 0.98, abs(sin(radialBasin * 0.22)));
          vec3 waterBody = mix(uDeepColor, uShallowColor, clamp(0.35 + stepRing * 0.25, 0.0, 1.0));

          // Direct sun / storm-break / lightning specular highlight
          vec3 H = normalize(uSunDir + V);
          float spec = pow(max(dot(N, H), 0.0), 180.0) * 2.1 + pow(max(dot(N, H), 0.0), 28.0) * 0.18;
          vec3 specLight = uSunColor * spec * (1.0 + uLightningFlash * 1.8);

          // Whitewater shockwave & step-edge foam
          float foamMask = clamp(analyticFoam + stepRing * 0.06 * uRainIntensity, 0.0, 0.85);
          vec3 foamColor = (uSkyColor * 1.6 + uSunColor * 0.45) * (0.75 + uLightningFlash * 0.6);

          vec3 col = mix(waterBody, reflColor, fresnel) + specLight;
          col = mix(col, foamColor, foamMask * 0.62);

          // Exponential squared distance fog matching Three.js FogExp2
          float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * camDist * camDist);
          col = mix(col, uFogColor, clamp(fogFactor, 0.0, 1.0));

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

    // Mirror mainCamera across plane y = waterLevel
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
      u.uFogColor.value.copy(this.scene.fog.color);
      u.uFogDensity.value = this.scene.fog.density;
      u.uLightningFlash.value = weather.lightningFlash;
    }
  }
}
