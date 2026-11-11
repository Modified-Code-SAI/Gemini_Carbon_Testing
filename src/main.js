import * as THREE from 'three';
import { QualityManager } from './core/QualityManager.js';
import { TextureFactory } from './core/TextureFactory.js';
import { PostPipeline } from './core/PostPipeline.js';
import { WaterSystem } from './world/WaterSystem.js';
import { WeatherSystem } from './world/WeatherSystem.js';
import { ArenaWorld } from './world/ArenaWorld.js';
import { VFXSystem } from './combat/VFXSystem.js';
import { PlayerController } from './entities/PlayerController.js';
import { WeaponSystem } from './combat/WeaponSystem.js';
import { EnemyDirector } from './combat/EnemyDirector.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { HUDController } from './ui/HUDController.js';

class IronDelugeGame {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.bootScreen = document.getElementById('boot-screen');
    this.bootFill = document.getElementById('boot-progress-fill');
    this.bootStatus = document.getElementById('boot-status-text');

    this.titleScreen = document.getElementById('title-screen');
    this.pauseScreen = document.getElementById('pause-screen');
    this.endScreen = document.getElementById('end-screen');

    this.state = 'BOOT'; // 'BOOT' | 'TITLE' | 'PLAYING' | 'PAUSED' | 'ENDED'
    this.elapsed = 0;
    this.sortieTime = 0;
    this._lastNow = performance.now();

    this.quality = new QualityManager('ULTRA');
    this.audio = new AudioEngine();
    this.hud = new HUDController();
  }

  _setBootProgress(pct, label) {
    if (this.bootFill) this.bootFill.style.width = `${Math.round(pct * 100)}%`;
    if (this.bootStatus) this.bootStatus.textContent = label;
  }

  async init() {
    this._setBootProgress(0.08, 'INITIALIZING WEBGL2 HDR RENDERER...');

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.35, 420);

    const textures = await TextureFactory.loadAll((p, msg) => this._setBootProgress(p, msg));

    this._setBootProgress(0.62, 'CONSTRUCTING FLOODED BRUTALIST COLOSSEUM...');
    this.water = new WaterSystem(this.renderer, this.scene, this.quality, textures.waterNormal);
    this.weather = new WeatherSystem(
      this.renderer,
      this.scene,
      this.quality,
      textures.softParticle,
      (intensity) => this.audio.playThunder(intensity)
    );
    this.water.excludedDuringReflect.push(this.weather.rainMesh);

    this.vfx = new VFXSystem(this.scene, textures, this.quality);
    this.water.excludedDuringReflect.push(this.vfx.sparkInst);

    this.arena = new ArenaWorld(this.scene, textures, this.quality, this.water, () => {
      // Subtle tactical feedback on structural collapse
    });

    this._setBootProgress(0.8, 'ASSEMBLING AC-04 VANGUARD & WEAPON BAYS...');
    this.post = new PostPipeline(this.renderer, this.scene, this.camera, this.quality);
    this.player = new PlayerController(
      this.scene,
      this.camera,
      textures,
      this.arena,
      this.water,
      this.vfx,
      this.audio,
      this.post
    );

    this.weapons = new WeaponSystem(
      this.scene,
      this.arena,
      this.water,
      this.vfx,
      this.audio,
      (heavy) => this.hud.triggerHitmarker(heavy)
    );

    this.director = new EnemyDirector(
      this.scene,
      textures,
      this.arena,
      this.water,
      this.weather,
      this.vfx,
      this.audio,
      {
        onWaveBanner: (sub, main) => this.hud.showBanner(sub, main, 3.4),
        onVictory: () => this._finishSortie(true),
      }
    );

    this._setBootProgress(0.94, 'PRE-COMPILING PBR & WATER SHADER PROGRAMS...');
    this._setupTitleShowroomPose();
    this.renderer.compile(this.scene, this.camera);

    this._bindUI();
    this._bindQualitySync();

    this._setBootProgress(1.0, 'SYSTEMS ONLINE.');
    this.state = 'TITLE';
    setTimeout(() => {
      this.bootScreen.classList.add('is-complete');
    }, 180);

    this._lastNow = performance.now();
    requestAnimationFrame((now) => this._loop(now));
  }

  _setupTitleShowroomPose() {
    if (!this.heroKeyLight) {
      this.heroKeyLight = new THREE.PointLight(0x9ec4e8, 16, 26, 1.5);
      this.scene.add(this.heroKeyLight);
      this.heroWarmRim = new THREE.PointLight(0xff8c32, 12, 22, 1.6);
      this.scene.add(this.heroWarmRim);
    }
    this.weather.lockedToWave = false;
    this.weather.setMode('MONSOON');
    this.player.pos.set(1.8, this.arena.floorY, 14);
    this.player.mech.root.position.copy(this.player.pos);
    // Face heroic 3/4 front toward showroom camera (+Z) so glowing T-visor & minigun shine!
    this.player.mech.root.rotation.y = Math.PI - 0.38;
    this.heroKeyLight.position.set(5.5, 5.2, 21.0);
    this.heroWarmRim.position.set(-3.2, 4.2, 11.5);
    this.player.mech.updateAnimation(0.016, 0, {
      speed: 0,
      isSkating: false,
      isAirborne: false,
      aimYawOffset: 0.14,
      aimPitch: -0.05,
      heatRatio: 0.62,
      boostRatio: 0.42,
    });
  }

  _bindQualitySync() {
    this.quality.onChange((cfg, isAuto) => {
      this.post.applyQuality();
      this.water.applyQuality();
      this.weather.applyQuality();
      this._syncQualityButtons();
      if (this.state === 'PLAYING') {
        this.hud.showBanner(
          isAuto ? 'ADAPTIVE FPS SCALER' : 'GRAPHICS PRESET UPDATED',
          `RENDER TIER: ${cfg.name}`,
          2.0
        );
      }
    });
  }

  _syncQualityButtons() {
    const tier = this.quality.currentTierName;
    document.querySelectorAll('[data-tier]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.tier === tier);
    });

    const autoText = `AUTO-SCALE: ${this.quality.autoScale ? 'ON' : 'OFF'}`;
    const btnTitleAuto = document.getElementById('btn-toggle-autoscale');
    const btnPauseAuto = document.getElementById('pause-autoscale');
    btnTitleAuto.textContent = autoText;
    btnPauseAuto.textContent = autoText;
    btnTitleAuto.classList.toggle('is-active', this.quality.autoScale);
    btnPauseAuto.classList.toggle('is-active', this.quality.autoScale);
  }

  _syncAudioButtons() {
    const label = `AUDIO: ${this.audio.muted ? 'MUTED' : 'ACTIVE'}`;
    const btnTitleMute = document.getElementById('btn-toggle-mute');
    const btnPauseMute = document.getElementById('pause-audio');
    btnTitleMute.textContent = label;
    btnPauseMute.textContent = label;
    btnTitleMute.classList.toggle('is-active', !this.audio.muted);
    btnPauseMute.classList.toggle('is-active', !this.audio.muted);
  }

  _bindUI() {
    this._syncQualityButtons();
    this._syncAudioButtons();

    document.querySelectorAll('[data-tier]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.quality.setTier(btn.dataset.tier, false);
      });
    });

    const toggleAuto = () => {
      this.quality.setAutoScale(!this.quality.autoScale);
      this._syncQualityButtons();
    };
    document.getElementById('btn-toggle-autoscale').addEventListener('click', toggleAuto);
    document.getElementById('pause-autoscale').addEventListener('click', toggleAuto);

    const toggleAudio = () => {
      this.audio.init();
      this.audio.setMuted(!this.audio.muted);
      this._syncAudioButtons();
    };
    document.getElementById('btn-toggle-mute').addEventListener('click', toggleAudio);
    document.getElementById('pause-audio').addEventListener('click', toggleAudio);

    document.getElementById('btn-deploy').addEventListener('click', () => this.startSortie());
    document.getElementById('btn-play-again').addEventListener('click', () => this.startSortie());
    document.getElementById('btn-restart-pause').addEventListener('click', () => this.startSortie());
    document.getElementById('btn-resume').addEventListener('click', () => this.resumeSortie());

    window.addEventListener('resize', () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.camera.aspect = w / Math.max(h, 1);
      this.camera.updateProjectionMatrix();
      this.post.resize(w, h);
      this.water.resize();
    });

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'Digit1') this.quality.setTier('ULTRA', false);
      if (e.code === 'Digit2') this.quality.setTier('HIGH', false);
      if (e.code === 'Digit3') this.quality.setTier('BALANCED', false);

      if (e.code === 'KeyP') {
        if (this.state === 'PLAYING') this.pauseSortie();
        else if (this.state === 'PAUSED') this.resumeSortie();
      }
    });

    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== document.body && this.state === 'PLAYING') {
        this.pauseSortie();
      }
    });

    // Click canvas during PLAYING if pointer lock wasn't active (e.g. automated / windowed mode)
    this.canvas.addEventListener('click', () => {
      if (this.state === 'PLAYING' && document.pointerLockElement !== document.body) {
        try {
          document.body.requestPointerLock?.();
        } catch (_) {
          // Ignore pointer lock rejection in restricted/headless contexts
        }
      }
    });
  }

  _tryLockPointer() {
    try {
      const res = document.body.requestPointerLock?.();
      if (res && typeof res.catch === 'function') res.catch(() => {});
    } catch (_) {
      // Ignore in non-interactive environments
    }
  }

  startSortie() {
    this.audio.init();
    this._tryLockPointer();

    if (this.heroKeyLight) this.heroKeyLight.intensity = 6.5;
    if (this.heroWarmRim) this.heroWarmRim.intensity = 0;

    this.arena.resetArena();
    this.player.reset();
    this.weapons.reset();
    this.director.startNewSortie();
    this.quality.resetCooldown(4.5);

    this.sortieTime = 0;
    this.state = 'PLAYING';

    this.titleScreen.classList.add('is-hidden');
    this.pauseScreen.classList.add('is-hidden');
    this.endScreen.classList.add('is-hidden');
    this.hud.setVisible(true);
  }

  pauseSortie() {
    if (this.state !== 'PLAYING') return;
    this.state = 'PAUSED';
    this.player.clearTransientInputs();
    this.audio.setThrusterLevel(0);
    if (document.pointerLockElement === document.body) {
      document.exitPointerLock?.();
    }
    this.pauseScreen.classList.remove('is-hidden');
  }

  resumeSortie() {
    if (this.state !== 'PAUSED') return;
    this.state = 'PLAYING';
    this.pauseScreen.classList.add('is-hidden');
    this._tryLockPointer();
  }

  _finishSortie(victory) {
    this.state = 'ENDED';
    this.player.clearTransientInputs();
    this.audio.setThrusterLevel(0);
    if (document.pointerLockElement === document.body) {
      document.exitPointerLock?.();
    }

    this.hud.setVisible(false);
    this.endScreen.classList.remove('is-hidden');

    const kicker = document.getElementById('end-kicker');
    const heading = document.getElementById('end-heading');
    kicker.textContent = victory
      ? 'SORTIE DEBRIEF // BASIN SECURED'
      : 'CRITICAL FAILURE // CHASSIS OFFLINE';
    heading.textContent = victory ? 'LEVIATHAN NEUTRALIZED' : 'ARMOR INTEGRITY LOST';

    const mins = Math.floor(this.sortieTime / 60);
    const secs = Math.floor(this.sortieTime % 60);
    document.getElementById('end-stats-time').textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    document.getElementById('end-stats-kills').textContent = String(this.director.totalKills);
    document.getElementById('end-stats-cover').textContent = String(this.arena.shatteredCount);

    const apBonus = victory ? Math.round(this.player.ap * 1.5) : 0;
    const score = this.director.totalKills * 1200 + this.arena.shatteredCount * 350 + apBonus;
    document.getElementById('end-stats-score').textContent = score.toLocaleString();
  }

  _updateTitleShowroom(dt) {
    // Low-angle cinematic orbit around AC-04 Vanguard standing knee-deep in rippling storm floodwater
    const orbitAngle = Math.sin(this.elapsed * 0.22) * 0.62 + 0.42;
    const dist = 10.6;
    const targetX = this.player.pos.x - 1.8; // Offset mech slightly right so left UI panel stays clear
    const targetZ = this.player.pos.z;

    this.camera.fov = 52;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(
      this.player.pos.x + Math.sin(orbitAngle) * dist - 1.2,
      2.25 + Math.sin(this.elapsed * 0.45) * 0.22,
      this.player.pos.z + Math.cos(orbitAngle) * dist
    );
    this.camera.lookAt(targetX, 2.55, targetZ);

    this.player.mech.updateAnimation(dt, this.elapsed, {
      speed: 0,
      isSkating: false,
      isAirborne: false,
      aimYawOffset: Math.sin(this.elapsed * 0.5) * 0.24,
      aimPitch: -0.05,
      heatRatio: 0.62,
      boostRatio: 0.4,
    });

    this._titleRippleAccum = (this._titleRippleAccum || 0) + dt;
    if (this._titleRippleAccum > 1.35) {
      this._titleRippleAccum = 0;
      this.water.spawnRipple(this.player.pos.x - 0.7, this.player.pos.z, 0.48);
      this.water.spawnRipple(this.player.pos.x + 0.7, this.player.pos.z, 0.48);
    }

    this.post.boostIntensity = 0.0;
    this.post.rainLensWeight = this.weather.rainIntensity * 0.85;
  }

  _loop(now) {
    requestAnimationFrame((t) => this._loop(t));

    const rawDt = (now - this._lastNow) * 0.001;
    this._lastNow = now;
    const dt = Math.min(Math.max(rawDt, 0.001), 0.05);

    this.quality.update(rawDt, this.state === 'PLAYING');

    if (this.state === 'TITLE') {
      this.elapsed += dt;
      this._updateTitleShowroom(dt);
      this.weather.update(dt, this.elapsed, this.camera);
      this.water.update(dt, this.elapsed, this.weather);
      this.arena.update(dt, this.elapsed, this.vfx);
      this.vfx.update(dt, this.camera);
    } else if (this.state === 'PLAYING') {
      this.elapsed += dt;
      this.sortieTime += dt;

      this.player.update(dt, this.elapsed, {
        rotaryFiring: this.weapons.rotaryFiring,
        railRecoil: this.weapons.railRecoil,
      });
      if (this.heroKeyLight) {
        this.heroKeyLight.position.set(this.camera.position.x, this.camera.position.y + 2.4, this.camera.position.z);
      }

      this.weapons.update(dt, this.player, this.director.enemies, true);
      this.director.update(dt, this.elapsed, this.player, this.weapons);

      this.weather.update(dt, this.elapsed, this.camera);
      this.water.update(dt, this.elapsed, this.weather);
      this.arena.update(dt, this.elapsed, this.vfx);
      this.vfx.update(dt, this.camera);

      this.post.rainLensWeight = this.weather.rainIntensity * 0.75;
      this.hud.update(dt, {
        player: this.player,
        weapons: this.weapons,
        director: this.director,
        weather: this.weather,
        quality: this.quality,
        camera: this.camera,
      });

      if (this.player.ap <= 0) {
        this._finishSortie(false);
      }
    } else if (this.state === 'ENDED') {
      this.elapsed += dt * 0.4;
      this.weather.update(dt * 0.4, this.elapsed, this.camera);
      this.water.update(dt * 0.4, this.elapsed, this.weather);
      this.arena.update(dt * 0.4, this.elapsed, this.vfx);
      this.vfx.update(dt * 0.4, this.camera);
    }

    // Render planar floodwater reflection then main HDR scene + post-processing
    this.water.updateReflection(this.camera);
    this.post.render(dt, this.elapsed);
  }
}

const game = new IronDelugeGame();
window.__IRON_DELUGE__ = game;
game.init().catch((err) => {
  console.error('Failed to initialize IRON DELUGE:', err);
});
