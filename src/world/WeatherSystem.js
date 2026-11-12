import * as THREE from 'three';

const MAX_RAIN = 12000;
const MAX_BOLT_SEGMENTS = 72; // Main trunk + 6 forked branches

const WEATHER_PROFILES = {
  MONSOON: {
    label: 'MONSOON SQUALL',
    fogColor: new THREE.Color(0x23313f),
    fogDensity: 0.0058,
    skyTop: new THREE.Color(0x0b141e),
    skyHorizon: new THREE.Color(0x34495e),
    cloudLit: new THREE.Color(0x6b859e),
    cloudDark: new THREE.Color(0x131e29),
    sunColor: new THREE.Color(0xc8e0f8),
    sunIntensity: 3.35,
    fillColor: new THREE.Color(0x6e90b2),
    fillIntensity: 1.55,
    hemiSky: new THREE.Color(0x62809e),
    hemiGround: new THREE.Color(0x1d2731),
    hemiIntensity: 1.75,
    rainIntensity: 0.9,
    godRayOpacity: 0.08,
    lightningInterval: [5.2, 10.5],
    envKey: 'monsoon',
  },
  SUNBREAK: {
    label: 'AMBER STORM BREACH',
    fogColor: new THREE.Color(0x3a322c),
    fogDensity: 0.0048,
    skyTop: new THREE.Color(0x121e2c),
    skyHorizon: new THREE.Color(0x78563c),
    cloudLit: new THREE.Color(0xe6a263),
    cloudDark: new THREE.Color(0x21242b),
    sunColor: new THREE.Color(0xffbe76),
    sunIntensity: 5.1,
    fillColor: new THREE.Color(0x7c92ab),
    fillIntensity: 1.45,
    hemiSky: new THREE.Color(0x8c7f74),
    hemiGround: new THREE.Color(0x28211c),
    hemiIntensity: 1.85,
    rainIntensity: 0.32,
    godRayOpacity: 0.28,
    lightningInterval: [14.0, 24.0],
    envKey: 'sunbreak',
  },
  SUPERCELL: {
    label: 'SUPERCELL TEMPEST',
    fogColor: new THREE.Color(0x1b2735),
    fogDensity: 0.0066,
    skyTop: new THREE.Color(0x070d15),
    skyHorizon: new THREE.Color(0x283c52),
    cloudLit: new THREE.Color(0x5c7b99),
    cloudDark: new THREE.Color(0x0d151f),
    sunColor: new THREE.Color(0xa6ccf0),
    sunIntensity: 2.75,
    fillColor: new THREE.Color(0x5b7fa3),
    fillIntensity: 1.4,
    hemiSky: new THREE.Color(0x4e6c8a),
    hemiGround: new THREE.Color(0x16202a),
    hemiIntensity: 1.6,
    rainIntensity: 1.0,
    godRayOpacity: 0.05,
    lightningInterval: [2.4, 5.0],
    envKey: 'supercell',
  },
};

export class WeatherSystem {
  constructor(renderer, scene, qualityManager, texturesOrMist, onThunderCallback) {
    this.renderer = renderer;
    this.scene = scene;
    this.quality = qualityManager;
    if (texturesOrMist && texturesOrMist.softParticle) {
      this.softMistTex = texturesOrMist.softParticle;
      this.pyroNoiseTex = texturesOrMist.pyroNoise;
    } else {
      this.softMistTex = texturesOrMist;
      this.pyroNoiseTex = null;
    }
    this.onThunder = onThunderCallback;

    this.currentMode = 'MONSOON';
    this.targetProfile = WEATHER_PROFILES.MONSOON;

    this.rainIntensity = 0.9;
    this.lightningFlash = 0.0;
    this._nextLightningTimer = 3.2;
    this._modeCycleTimer = 28.0;
    this.lockedToWave = false;

    this.sunDirection = new THREE.Vector3(0.46, 0.48, -0.75).normalize();
    this.sunColor = WEATHER_PROFILES.MONSOON.sunColor.clone();
    this.skyHorizonColor = WEATHER_PROFILES.MONSOON.skyHorizon.clone();
    this.skyTopColor = WEATHER_PROFILES.MONSOON.skyTop.clone();
    this.cloudLitColor = WEATHER_PROFILES.MONSOON.cloudLit.clone();
    this.cloudDarkColor = WEATHER_PROFILES.MONSOON.cloudDark.clone();
    this.lightningDir = new THREE.Vector3(0.18, 0.65, -0.74).normalize();

    this.scene.fog = new THREE.FogExp2(0x23313f, 0.0058);

    this._setupLights();
    this._setupSkyDome();
    this._bakePMREMEnvironments();
    this._setupRainGPU();
    this._setupMistAndGodRays();
    this._setupLightningBolt();
  }

  _setupLights() {
    const cfg = this.quality.config;

    this.hemiLight = new THREE.HemisphereLight(0x62809e, 0x1d2731, 1.75);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xc8e0f8, 3.35);
    this.sunLight.position.copy(this.sunDirection).multiplyScalar(120);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(cfg.shadowMapSize, cfg.shadowMapSize);
    this.sunLight.shadow.camera.near = 12;
    this.sunLight.shadow.camera.far = 260;
    const d = 92;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.00035;
    this.sunLight.shadow.normalBias = 0.028;
    this.scene.add(this.sunLight);

    // Cool atmospheric storm fill from camera-hemisphere sky so foreground armor & arches never crush to black
    this.fillLight = new THREE.DirectionalLight(0x6e90b2, 1.55);
    this.fillLight.position.set(-54, 52, 96);
    this.scene.add(this.fillLight);

    // Subtle warm bounce rim from basin deck / reactor glow
    this.rimLight = new THREE.DirectionalLight(0x8aa8c4, 0.85);
    this.rimLight.position.set(65, 28, 45);
    this.scene.add(this.rimLight);

    // High-contrast fork lightning directional flash light
    this.lightningLight = new THREE.DirectionalLight(0xdceeff, 0.0);
    this.lightningLight.position.set(18, 95, -110);
    this.scene.add(this.lightningLight);
  }

  _setupSkyDome() {
    const skyGeo = new THREE.SphereGeometry(380, 48, 32);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthTest: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uPyroNoise: { value: this.pyroNoiseTex },
        uTopColor: { value: this.skyTopColor },
        uHorizonColor: { value: this.skyHorizonColor },
        uCloudLit: { value: this.cloudLitColor },
        uCloudDark: { value: this.cloudDarkColor },
        uSunDir: { value: this.sunDirection },
        uSunColor: { value: this.sunColor },
        uLightning: { value: 0 },
        uLightningDir: { value: this.lightningDir },
        uCloudSteps: { value: this.quality.config.cloudSteps || 10 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldDir;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldDir = wp.xyz - cameraPosition;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform sampler2D uPyroNoise;
        uniform vec3 uTopColor;
        uniform vec3 uHorizonColor;
        uniform vec3 uCloudLit;
        uniform vec3 uCloudDark;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uLightning;
        uniform vec3 uLightningDir;
        uniform int uCloudSteps;
        varying vec3 vWorldDir;

        float hgPhase(float cosTheta, float g) {
          float g2 = g * g;
          return (1.0 - g2) / (4.0 * 3.14159265 * pow(max(0.02, 1.0 + g2 - 2.0 * g * cosTheta), 1.5));
        }

        float sampleCloudDensity(vec3 p, float hFrac) {
          vec2 uvBase = p.xz * 0.0036 + vec2(uTime * 0.0055, -uTime * 0.0038);
          vec2 uvDetail = p.xz * 0.0115 - vec2(uTime * 0.0095, uTime * 0.0062) + hFrac * 0.22;

          vec4 nBase = texture2D(uPyroNoise, uvBase);
          vec4 nDet = texture2D(uPyroNoise, uvDetail);

          // Cumulonimbus anvil vertical profile: brooding storm base, billowing cauliflower tops
          float heightShape = smoothstep(0.0, 0.16, hFrac) * (1.0 - smoothstep(0.38, 1.0, hFrac));
          float baseCloud = nBase.b * 0.72 + nBase.r * 0.34;
          // Erode edges strongly with inverted Worley lobes so billowing storm clouds are unmistakable!
          float eroded = baseCloud - (1.0 - nDet.g) * 0.36 * (0.35 + hFrac * 0.65);
          return clamp((eroded - 0.28) * 2.95, 0.0, 1.0) * heightShape;
        }

        void main() {
          vec3 dir = normalize(vWorldDir);
          vec3 sunD = normalize(uSunDir);
          float cosSun = dot(dir, sunD);

          // Physically inspired Rayleigh + Mie atmospheric base gradient
          float zenith = clamp(dir.y, 0.0, 1.0);
          vec3 sky = mix(uHorizonColor * 0.78, uTopColor, pow(zenith, 0.48));

          // Mie forward-scattering atmospheric sun glow
          float mieHalo = pow(max(cosSun, 0.0), 8.0) * 0.26 + pow(max(cosSun, 0.0), 64.0) * 0.82;
          sky += uSunColor * mieHalo * smoothstep(-0.08, 0.35, dir.y);

          // Raymarch 3D volumetric storm cloud deck overhead & down into arch openings!
          if (dir.y > 0.005) {
            float effY = max(dir.y, 0.11);
            float tEnter = 56.0 / effY;
            float tExit = 148.0 / effY;
            int steps = clamp(uCloudSteps, 4, 14);
            float dtStep = (tExit - tEnter) / float(steps);

            // Interleaved Gradient Noise (Jimenez) eliminates raymarch step-banding near horizon!
            float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));

            float transmittance = 1.0;
            vec3 accumLight = vec3(0.0);

            // Dual-lobe Henyey-Greenstein phase for silver-lining clouds
            float phase = mix(hgPhase(cosSun, 0.58), hgPhase(cosSun, -0.25), 0.32) * 2.1 + 0.32;
            float boltAlign = pow(max(dot(dir, normalize(uLightningDir)), 0.0), 6.0);

            for (int i = 0; i < 14; i++) {
              if (i >= steps) break;
              float fi = (float(i) + ign) / float(steps);
              float t = mix(tEnter, tExit, fi);
              vec3 pos = dir * t;
              float d = sampleCloudDensity(pos, fi);

              if (d > 0.01) {
                float dSun = sampleCloudDensity(pos + sunD * 19.0, clamp(fi + 0.24, 0.0, 1.0));
                float sunVis = exp(-dSun * 3.1);
                float powder = 1.0 - exp(-d * 3.8) * 0.52;

                vec3 directCol = uSunColor * phase * sunVis * powder * 1.55;
                // High-contrast brooding storm base vs luminous silver-lined cloud tops
                vec3 ambientCol = mix(uCloudDark * 0.58, uCloudLit * 1.12, pow(clamp(fi * 0.92 + 0.08, 0.0, 1.0), 1.35));
                vec3 stormFlash = vec3(0.75, 0.92, 1.25) * uLightning * (0.14 + boltAlign * 2.8) * (1.0 - fi * 0.35);

                vec3 sampleCol = ambientCol + directCol + stormFlash;
                float stepAlpha = 1.0 - exp(-d * dtStep * 0.042);
                accumLight += transmittance * sampleCol * stepAlpha;
                transmittance *= (1.0 - stepAlpha);
                if (transmittance < 0.025) break;
              }
            }

            float horizonBlend = smoothstep(0.005, 0.14, dir.y);
            vec3 cloudResult = accumLight + sky * transmittance;
            sky = mix(sky, cloudResult, horizonBlend);
          } else {
            sky = mix(uHorizonColor * 0.78, uHorizonColor * 0.36, clamp(-dir.y * 4.0, 0.0, 1.0));
          }

          gl_FragColor = vec4(sky, 1.0);
        }
      `,
    });

    this.skyMesh = new THREE.Mesh(skyGeo, this.skyMat);
    this.skyMesh.frustumCulled = false;
    this.skyMesh.renderOrder = 1;
    this.skyMesh.userData.excludeAO = true;
    this.scene.add(this.skyMesh);
  }

  _bakePMREMEnvironments() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();

    this.envMaps = {};
    const bakeForProfile = (key, prof) => {
      const miniScene = new THREE.Scene();

      // Multi-bounce storm sky + soft architectural bounce dome + specular cloud-break panels
      // Ensures brushed titanium chamfers & wet stone edges catch crisp metallic speculars on all 360 deg
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(32, 32, 20),
        new THREE.ShaderMaterial({
          side: THREE.BackSide,
          uniforms: {
            uTop: { value: prof.skyTop },
            uHor: { value: prof.skyHorizon },
            uLit: { value: prof.cloudLit },
            uSun: { value: prof.sunColor },
            uSunDir: { value: this.sunDirection },
          },
          vertexShader: `
            varying vec3 vDir;
            void main() {
              vDir = normalize(position);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform vec3 uTop;
            uniform vec3 uHor;
            uniform vec3 uLit;
            uniform vec3 uSun;
            uniform vec3 uSunDir;
            varying vec3 vDir;
            void main() {
              vec3 d = normalize(vDir);
              vec3 upper = mix(uHor * 1.65 + uLit * 0.35, uTop * 1.6 + uLit * 0.22, pow(max(d.y, 0.0), 0.52));
              // Floodwater & stone multi-bounce below horizon (never pitch black!)
              vec3 lower = mix(uHor * 0.95, uHor * 0.42 + vec3(0.06, 0.08, 0.1), clamp(-d.y * 1.8, 0.0, 1.0));
              vec3 col = d.y >= 0.0 ? upper : lower;

              // Primary sun-break specular lobe
              float s = max(dot(d, normalize(uSunDir)), 0.0);
              col += uSun * (pow(s, 10.0) * 1.15 + pow(s, 72.0) * 3.4);

              // Opposing cool storm-cloud rim panel so front-facing armor bevels gleam crisply
              vec3 rimDir = normalize(vec3(-0.45, 0.55, 0.7));
              float r = max(dot(d, rimDir), 0.0);
              col += (uLit * 1.25 + vec3(0.18, 0.24, 0.32)) * pow(r, 8.0) * 0.95;

              gl_FragColor = vec4(col, 1.0);
            }
          `,
        })
      );
      miniScene.add(dome);
      const rt = pmrem.fromScene(miniScene, 0.025);
      dome.geometry.dispose();
      dome.material.dispose();
      this.envMaps[key] = rt.texture;
    };

    bakeForProfile('monsoon', WEATHER_PROFILES.MONSOON);
    bakeForProfile('sunbreak', WEATHER_PROFILES.SUNBREAK);
    bakeForProfile('supercell', WEATHER_PROFILES.SUPERCELL);
    pmrem.dispose();

    this.scene.environment = this.envMaps.monsoon;
    this.scene.environmentIntensity = 1.38;
  }

  _setupRainGPU() {
    // Razor-thin cinema shutter rain streak (0.014m x 1.75m)
    const baseGeo = new THREE.PlaneGeometry(0.014, 1.75);
    const instGeo = new THREE.InstancedBufferGeometry();
    instGeo.index = baseGeo.index;
    instGeo.attributes.position = baseGeo.attributes.position;
    instGeo.attributes.uv = baseGeo.attributes.uv;

    const offsets = new Float32Array(MAX_RAIN * 4);
    for (let i = 0; i < MAX_RAIN; i++) {
      offsets[i * 4] = (Math.random() - 0.5) * 116;
      offsets[i * 4 + 1] = Math.random() * 50;
      offsets[i * 4 + 2] = (Math.random() - 0.5) * 116;
      offsets[i * 4 + 3] = 0.72 + Math.random() * 0.62;
    }
    instGeo.setAttribute('aRainSeed', new THREE.InstancedBufferAttribute(offsets, 4));
    instGeo.instanceCount = this.quality.config.rainCount;

    this.rainMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uCamPos: { value: new THREE.Vector3() },
        uOpacity: { value: 0.24 },
        uTint: { value: new THREE.Color(0xb4d0ea) },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aRainSeed;
        uniform float uTime;
        uniform vec3 uCamPos;
        varying vec2 vUv;
        varying float vDistFade;

        void main() {
          vUv = uv;
          float speed = 38.0 * aRainSeed.w;
          vec3 boxSize = vec3(116.0, 48.0, 116.0);

          vec3 worldCenter = aRainSeed.xyz;
          worldCenter.y -= uTime * speed;
          worldCenter.x += uTime * 5.2;

          vec3 rel = mod(worldCenter - uCamPos + boxSize * 0.5, boxSize) - boxSize * 0.5;
          vec3 dropPos = uCamPos + rel;

          vec3 fallAxis = normalize(vec3(0.13, -1.0, 0.03));
          vec3 toCam = normalize(uCamPos - dropPos);
          vec3 sideAxis = normalize(cross(fallAxis, toCam));

          vec3 finalPos = dropPos + sideAxis * position.x + fallAxis * (position.y * aRainSeed.w);
          float d = length(rel.xz);
          vDistFade = (1.0 - smoothstep(9.0, 56.0, d)) * smoothstep(1.8, 5.5, d);

          gl_Position = projectionMatrix * viewMatrix * vec4(finalPos, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        uniform vec3 uTint;
        varying vec2 vUv;
        varying float vDistFade;

        void main() {
          float tip = pow(sin(vUv.y * 3.14159), 1.4);
          float core = 1.0 - smoothstep(0.05, 0.5, abs(vUv.x - 0.5));
          float alpha = tip * core * uOpacity * vDistFade;
          if (alpha < 0.004) discard;
          gl_FragColor = vec4(uTint, alpha);
        }
      `,
    });

    this.rainMesh = new THREE.Mesh(instGeo, this.rainMat);
    this.rainMesh.frustumCulled = false;
    this.rainMesh.renderOrder = 6;
    this.rainMesh.userData.excludeAO = true;
    this.scene.add(this.rainMesh);
  }

  _setupMistAndGodRays() {
    // Organic Perlin-Worley eroded storm mist banks drifting through colosseum arches & amphitheater tiers
    this.mistGroup = new THREE.Group();
    this.mistGroup.userData.excludeAO = true;
    this.mistPlanes = [];

    const mistGeo = new THREE.PlaneGeometry(42, 18);
    this.mistMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uPyroNoise: { value: this.pyroNoiseTex },
        uColor: { value: new THREE.Color(0x4b637a) },
        uSunColor: { value: new THREE.Color(0xc8e0f8) },
        uLightning: { value: 0.0 },
        uOpacity: { value: 0.18 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying float vSeed;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vSeed = fract((modelMatrix[3][0] + modelMatrix[3][2]) * 0.037);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform sampler2D uPyroNoise;
        uniform vec3 uColor;
        uniform vec3 uSunColor;
        uniform float uLightning;
        uniform float uOpacity;
        varying vec2 vUv;
        varying float vSeed;

        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          float radial = max(0.0, 1.0 - dot(p * vec2(0.88, 1.15), p * vec2(0.88, 1.15)));

          vec2 nUv1 = vUv * 1.35 + vec2(vSeed + uTime * 0.018, -uTime * 0.008);
          vec2 nUv2 = vUv * 2.7 - vec2(uTime * 0.025, vSeed * 2.1);
          vec4 n1 = texture2D(uPyroNoise, nUv1);
          vec4 n2 = texture2D(uPyroNoise, nUv2);

          float wisp = n1.b * 0.65 + n2.g * 0.35;
          float alpha = pow(radial, 1.6) * smoothstep(0.22, 0.85, wisp) * uOpacity;
          if (alpha < 0.004) discard;

          vec3 col = uColor + uSunColor * (n1.g * 0.14) + vec3(0.55, 0.7, 0.9) * uLightning * 0.35;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    for (let i = 0; i < 36; i++) {
      const m = new THREE.Mesh(mistGeo, this.mistMat);
      m.userData.excludeAO = true;
      const angle = (i / 36) * Math.PI * 2 + (i % 3) * 0.14;
      // Layer mist across amphitheater stairs (52..72m) and arch colonnade (76..98m)
      const radius = i % 2 === 0 ? 54 + (i % 5) * 4.2 : 78 + (i % 4) * 5.5;
      m.position.set(Math.cos(angle) * radius, 4.5 + (i % 5) * 2.8, Math.sin(angle) * radius);
      m.scale.set(0.85 + (i % 4) * 0.22, 0.75 + (i % 3) * 0.25, 1.0);
      m.userData.baseAngle = angle;
      m.userData.radius = radius;
      m.userData.driftSpeed = (0.012 + (i % 4) * 0.006) * (i % 2 === 0 ? 1 : -1);
      m.userData.baseY = m.position.y;
      this.mistGroup.add(m);
      this.mistPlanes.push(m);
    }
    this.scene.add(this.mistGroup);

    // Volumetric noise-streaked crepuscular light shafts (God-Rays) piercing the storm arches
    this.godRayGroup = new THREE.Group();
    this.godRayGroup.userData.excludeAO = true;
    const rayGeo = new THREE.PlaneGeometry(24, 115);
    this.godRayMat = new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uPyroNoise: { value: this.pyroNoiseTex },
        uColor: { value: new THREE.Color(0xffbe76) },
        uOpacity: { value: 0.08 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform sampler2D uPyroNoise;
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec2 vUv;
        void main() {
          float beamX = pow(max(0.0, 1.0 - abs(vUv.x - 0.5) * 2.0), 2.2);
          float beamY = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.15, 1.0, vUv.y));
          float streak = texture2D(uPyroNoise, vec2(vUv.x * 2.8 + uTime * 0.01, vUv.y * 0.35 - uTime * 0.02)).r;
          float alpha = beamX * beamY * (0.45 + streak * 0.75) * uOpacity;
          if (alpha < 0.002) discard;
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
    });

    for (let i = 0; i < 7; i++) {
      const ray = new THREE.Mesh(rayGeo, this.godRayMat);
      ray.userData.excludeAO = true;
      ray.position.set((i - 3) * 20 + 10, 42, -52 - (i % 3) * 15);
      ray.rotation.z = -0.44;
      ray.rotation.x = 0.22;
      this.godRayGroup.add(ray);
    }
    this.scene.add(this.godRayGroup);
    this._syncMistQuality();
  }

  _setupLightningBolt() {
    // Procedural multi-branched camera-billboarded HDR plasma lightning ribbon mesh!
    // Each segment is 2 triangles (4 vertices: startL, startR, endL, endR)
    const vertCount = MAX_BOLT_SEGMENTS * 4;
    const indexCount = MAX_BOLT_SEGMENTS * 6;
    const centersA = new Float32Array(vertCount * 3);
    const centersB = new Float32Array(vertCount * 3);
    const sideWidth = new Float32Array(vertCount * 2); // x: -1 or +1, y: halfWidth
    const uvs = new Float32Array(vertCount * 2);
    const indices = new Uint16Array(indexCount);

    for (let s = 0; s < MAX_BOLT_SEGMENTS; s++) {
      const v = s * 4;
      const idx = s * 6;
      indices[idx] = v;
      indices[idx + 1] = v + 1;
      indices[idx + 2] = v + 2;
      indices[idx + 3] = v + 2;
      indices[idx + 4] = v + 1;
      indices[idx + 5] = v + 3;

      uvs[v * 2] = 0; uvs[v * 2 + 1] = 0;
      uvs[(v + 1) * 2] = 1; uvs[(v + 1) * 2 + 1] = 0;
      uvs[(v + 2) * 2] = 0; uvs[(v + 2) * 2 + 1] = 1;
      uvs[(v + 3) * 2] = 1; uvs[(v + 3) * 2 + 1] = 1;
    }

    const boltGeo = new THREE.BufferGeometry();
    // Dummy position attribute required by Three.js frustum/program binding
    boltGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertCount * 3), 3));
    boltGeo.setAttribute('aPosA', new THREE.BufferAttribute(centersA, 3));
    boltGeo.setAttribute('aPosB', new THREE.BufferAttribute(centersB, 3));
    boltGeo.setAttribute('aSideWidth', new THREE.BufferAttribute(sideWidth, 2));
    boltGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    boltGeo.setIndex(new THREE.BufferAttribute(indices, 1));

    this.boltMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uOpacity: { value: 0.0 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aPosA;
        attribute vec3 aPosB;
        attribute vec2 aSideWidth;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec3 p = mix(aPosA, aPosB, uv.y);
          vec3 segDir = normalize(aPosB - aPosA + vec3(0.0, 1e-4, 0.0));
          vec3 toCam = normalize(cameraPosition - p);
          vec3 perp = normalize(cross(segDir, toCam));
          vec3 worldPos = p + perp * (aSideWidth.x * aSideWidth.y);
          gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying vec2 vUv;
        void main() {
          float distFromAxis = abs(vUv.x - 0.5) * 2.0;
          float hotCore = exp(-distFromAxis * distFromAxis * 22.0);
          float corona = exp(-distFromAxis * 3.8) * 0.65;
          vec3 col = vec3(0.55, 0.80, 1.25) * corona + vec3(6.8, 7.8, 9.6) * hotCore;
          float alpha = clamp((hotCore + corona) * uOpacity, 0.0, 1.0);
          if (alpha < 0.005) discard;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    this.boltLine = new THREE.Mesh(boltGeo, this.boltMat);
    this.boltLine.frustumCulled = false;
    this.boltLine.visible = false;
    this.boltLine.userData.excludeAO = true;
    this.scene.add(this.boltLine);
  }

  _writeBoltSegment(segIdx, ax, ay, az, bx, by, bz, widthStart, widthEnd) {
    if (segIdx >= MAX_BOLT_SEGMENTS) return;
    const posAttr = this.boltLine.geometry.attributes.position;
    const aAttr = this.boltLine.geometry.attributes.aPosA;
    const bAttr = this.boltLine.geometry.attributes.aPosB;
    const swAttr = this.boltLine.geometry.attributes.aSideWidth;
    const v = segIdx * 4;

    for (let k = 0; k < 4; k++) {
      posAttr.setXYZ(v + k, ax, ay, az);
      aAttr.setXYZ(v + k, ax, ay, az);
      bAttr.setXYZ(v + k, bx, by, bz);
    }
    swAttr.setXY(v, -1, widthStart);
    swAttr.setXY(v + 1, 1, widthStart);
    swAttr.setXY(v + 2, -1, widthEnd);
    swAttr.setXY(v + 3, 1, widthEnd);
  }

  _triggerLightning(customAngle = null, customDist = null) {
    this.lightningFlash = 1.0;

    // Frame lightning dramatically behind or inside the colosseum arches
    const angle = customAngle !== null
      ? customAngle
      : -Math.PI * 0.5 + (Math.random() - 0.5) * 1.45;
    const dist = customDist !== null ? customDist : (96 + Math.random() * 28);
    let x = Math.cos(angle) * dist;
    let z = Math.sin(angle) * dist;
    let y = customDist !== null ? 68 : 104;

    this.lightningLight.position.set(x, 96, z);
    this.lightningDir.set(x, 76, z).normalize();

    // Tangent lateral vector perpendicular to radial sightline for unmistakable jagged zig-zags!
    const tanX = -Math.sin(angle);
    const tanZ = Math.cos(angle);

    let cursor = 0;
    const trunkNodes = [];
    const trunkSteps = 30;
    const stepY = customDist !== null ? 1.95 : 3.0;

    for (let i = 0; i < trunkSteps; i++) {
      const zigSign = i % 2 === 0 ? 1 : -1;
      const latStep = zigSign * (0.9 + Math.random() * 2.1) + (Math.random() - 0.5) * 1.4;
      const radStep = (Math.random() - 0.5) * 1.8;
      const nx = x + tanX * latStep + Math.cos(angle) * radStep;
      const nz = z + tanZ * latStep + Math.sin(angle) * radStep;
      const ny = y - (stepY + Math.random() * 0.85);
      // Razor-crisp plasma bolt width (0.28m -> 0.08m, NOT 2.7m wide ribbon!)
      const w0 = THREE.MathUtils.lerp(0.28, 0.08, i / trunkSteps);
      const w1 = THREE.MathUtils.lerp(0.28, 0.08, (i + 1) / trunkSteps);
      this._writeBoltSegment(cursor++, x, y, z, nx, ny, nz, w0, w1);
      trunkNodes.push({ x: nx, y: ny, z: nz });
      x = nx;
      y = ny;
      z = nz;
    }

    // Spawn 6 razor-sharp jagged secondary fork filaments off the main trunk (30 + 42 = 72 segments)
    const branchIndices = [3, 7, 11, 15, 19, 23];
    for (let b = 0; b < branchIndices.length; b++) {
      const startNode = trunkNodes[branchIndices[b]];
      if (!startNode) continue;
      let bx = startNode.x;
      let by = startNode.y;
      let bz = startNode.z;
      const sideSign = b % 2 === 0 ? 1 : -1;
      const branchLen = 7;

      for (let s = 0; s < branchLen && cursor < MAX_BOLT_SEGMENTS; s++) {
        const kink = (s % 2 === 0 ? 1 : -0.45) * sideSign * (1.3 + Math.random() * 2.2);
        const nbx = bx + tanX * kink + (Math.random() - 0.5) * 1.2;
        const nbz = bz + tanZ * kink + (Math.random() - 0.5) * 1.2;
        const nby = by - (1.6 + Math.random() * 1.3);
        const bw0 = THREE.MathUtils.lerp(0.13, 0.022, s / branchLen);
        const bw1 = THREE.MathUtils.lerp(0.13, 0.022, (s + 1) / branchLen);
        this._writeBoltSegment(cursor++, bx, by, bz, nbx, nby, nbz, bw0, bw1);
        bx = nbx;
        by = nby;
        bz = nbz;
      }
    }

    // Zero any remaining unused segments
    while (cursor < MAX_BOLT_SEGMENTS) {
      this._writeBoltSegment(cursor++, 0, -999, 0, 0, -999, 0, 0, 0);
    }

    const geo = this.boltLine.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aPosA.needsUpdate = true;
    geo.attributes.aPosB.needsUpdate = true;
    geo.attributes.aSideWidth.needsUpdate = true;

    const range = this.targetProfile.lightningInterval;
    this._nextLightningTimer = range[0] + Math.random() * (range[1] - range[0]);
    this.onThunder?.(0.75 + Math.random() * 0.35);
  }

  setMode(modeName) {
    if (!WEATHER_PROFILES[modeName] || modeName === this.currentMode) return;
    this.currentMode = modeName;
    this.targetProfile = WEATHER_PROFILES[modeName];
    this.scene.environment = this.envMaps[this.targetProfile.envKey];
  }

  get label() {
    return this.targetProfile.label;
  }

  _syncMistQuality() {
    const limit = this.quality.config.mistCount;
    this.mistPlanes.forEach((m, idx) => {
      m.visible = idx < limit;
    });
  }

  applyQuality() {
    const cfg = this.quality.config;
    this.rainMesh.geometry.instanceCount = cfg.rainCount;
    this.skyMat.uniforms.uCloudSteps.value = cfg.cloudSteps || 8;
    this.sunLight.shadow.mapSize.set(cfg.shadowMapSize, cfg.shadowMapSize);
    if (this.sunLight.shadow.map) {
      this.sunLight.shadow.map.dispose();
      this.sunLight.shadow.map = null;
    }
    this._syncMistQuality();
  }

  update(dt, elapsed, camera) {
    if (!this.lockedToWave) {
      this._modeCycleTimer -= dt;
      if (this._modeCycleTimer <= 0) {
        const order = ['MONSOON', 'SUNBREAK', 'SUPERCELL'];
        const next = order[(order.indexOf(this.currentMode) + 1) % order.length];
        this.setMode(next);
        this._modeCycleTimer = 26.0;
      }
    }

    const p = this.targetProfile;
    const lerpRate = Math.min(1.0, dt * 0.9);

    this.scene.fog.color.lerp(p.fogColor, lerpRate);
    this.scene.fog.density = THREE.MathUtils.lerp(this.scene.fog.density, p.fogDensity, lerpRate);

    this.skyTopColor.lerp(p.skyTop, lerpRate);
    this.skyHorizonColor.lerp(p.skyHorizon, lerpRate);
    this.cloudLitColor.lerp(p.cloudLit, lerpRate);
    this.cloudDarkColor.lerp(p.cloudDark, lerpRate);
    this.sunColor.lerp(p.sunColor, lerpRate);

    this.sunLight.color.copy(this.sunColor);
    this.sunLight.intensity = THREE.MathUtils.lerp(this.sunLight.intensity, p.sunIntensity, lerpRate);
    this.fillLight.color.lerp(p.fillColor, lerpRate);
    this.fillLight.intensity = THREE.MathUtils.lerp(this.fillLight.intensity, p.fillIntensity, lerpRate);

    this.hemiLight.color.lerp(p.hemiSky, lerpRate);
    this.hemiLight.groundColor.lerp(p.hemiGround, lerpRate);
    this.hemiLight.intensity = THREE.MathUtils.lerp(this.hemiLight.intensity, p.hemiIntensity, lerpRate);

    this.rainIntensity = THREE.MathUtils.lerp(this.rainIntensity, p.rainIntensity, lerpRate);
    this.rainMat.uniforms.uTime.value = elapsed;
    this.rainMat.uniforms.uCamPos.value.copy(camera.position);
    this.rainMat.uniforms.uOpacity.value = 0.24 * this.rainIntensity;
    this.rainMat.uniforms.uTint.value.copy(this.sunColor).lerp(new THREE.Color(0xc4dcf4), 0.7);

    const targetGodRay = p.godRayOpacity;
    this.godRayMat.uniforms.uOpacity.value = THREE.MathUtils.lerp(
      this.godRayMat.uniforms.uOpacity.value,
      targetGodRay,
      lerpRate
    );
    this.godRayMat.uniforms.uTime.value = elapsed;
    this.godRayMat.uniforms.uColor.value.copy(this.sunColor);
    this.godRayGroup.visible = this.godRayMat.uniforms.uOpacity.value > 0.004;

    // Lightning updates
    this._nextLightningTimer -= dt;
    if (this._nextLightningTimer <= 0) {
      this._triggerLightning();
    }

    if (this.lightningFlash > 0.001) {
      this.lightningFlash = Math.max(0, this.lightningFlash - dt * 3.4);
      const flicker = this.lightningFlash > 0.42 ? (Math.sin(elapsed * 92.0) * 0.3 + 0.85) : this.lightningFlash;
      this.lightningLight.intensity = flicker * 6.5;
      this.boltMat.uniforms.uOpacity.value = Math.min(1.0, flicker * 1.25);
      this.boltLine.visible = true;
    } else {
      this.lightningLight.intensity = 0;
      this.boltLine.visible = false;
    }

    this.skyMesh.position.copy(camera.position);
    this.skyMat.uniforms.uTime.value = elapsed;
    this.skyMat.uniforms.uLightning.value = this.lightningFlash;

    // Update organic volumetric storm mist banks
    this.mistMat.uniforms.uTime.value = elapsed;
    this.mistMat.uniforms.uColor.value.copy(this.skyHorizonColor).multiplyScalar(1.22);
    this.mistMat.uniforms.uSunColor.value.copy(this.sunColor);
    this.mistMat.uniforms.uLightning.value = this.lightningFlash;

    for (let i = 0; i < this.mistPlanes.length; i++) {
      const m = this.mistPlanes[i];
      if (!m.visible) continue;
      m.userData.baseAngle += m.userData.driftSpeed * dt;
      m.position.x = Math.cos(m.userData.baseAngle) * m.userData.radius;
      m.position.z = Math.sin(m.userData.baseAngle) * m.userData.radius;
      m.position.y = m.userData.baseY + Math.sin(elapsed * 0.38 + i) * 0.65;
      m.quaternion.copy(camera.quaternion);
    }
  }
}
