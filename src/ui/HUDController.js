import * as THREE from 'three';

const MAX_BRACKETS = 10;

export class HUDController {
  constructor() {
    this.root = document.getElementById('hud-root');
    this.waveLabel = document.getElementById('hud-wave-label');
    this.enemiesRem = document.getElementById('hud-enemies-remaining');
    this.weatherTag = document.getElementById('hud-weather-state');
    this.fpsReadout = document.getElementById('hud-fps-readout');
    this.qualityBadge = document.getElementById('hud-quality-badge');

    this.bossPanel = document.getElementById('hud-boss-panel');
    this.bossBarFill = document.getElementById('hud-boss-bar-fill');
    this.bossSub = document.getElementById('hud-boss-substatus');

    this.lockLayer = document.getElementById('hud-lock-layer');
    this.missileAlert = document.getElementById('hud-missile-alert');
    this.damageFlash = document.getElementById('hud-damage-flash');

    this.spreadRing = document.getElementById('reticle-spread-ring');
    this.railArc = document.getElementById('reticle-rail-arc');
    this.hitmarker = document.getElementById('reticle-hitmarker');
    this.lockCounter = document.getElementById('reticle-lock-counter');

    this.banner = document.getElementById('hud-banner');
    this.bannerSub = document.getElementById('hud-banner-sub');
    this.bannerMain = document.getElementById('hud-banner-main');

    this.barAp = document.getElementById('bar-ap-fill');
    this.valAp = document.getElementById('val-ap');
    this.barEn = document.getElementById('bar-en-fill');
    this.valEn = document.getElementById('val-en');
    this.barHeat = document.getElementById('bar-heat-fill');
    this.valHeat = document.getElementById('val-heat');

    this.wpnRotaryBar = document.getElementById('wpn-rotary-bar');
    this.wpnRotaryState = document.getElementById('wpn-rotary-state');
    this.wpnRailBar = document.getElementById('wpn-rail-bar');
    this.wpnRailState = document.getElementById('wpn-rail-state');
    this.wpnMissileBar = document.getElementById('wpn-missile-bar');
    this.wpnMissileLocks = document.getElementById('wpn-missile-locks');
    this.wpnPulseBar = document.getElementById('wpn-pulse-bar');
    this.wpnPulseState = document.getElementById('status-pulse-armor');

    this._hitmarkerTimer = 0;
    this._bannerTimer = 0;
    this._damageFlashAlpha = 0;
    this._lastAp = 10000;
    this._projVec = new THREE.Vector3();

    this.brackets = [];
    for (let i = 0; i < MAX_BRACKETS; i++) {
      const el = document.createElement('div');
      el.className = 'lock-bracket';
      el.style.opacity = '0';

      const tag = document.createElement('div');
      tag.className = 'lock-tag';
      el.appendChild(tag);

      const hpWrap = document.createElement('div');
      hpWrap.className = 'lock-hp-mini';
      const hpFill = document.createElement('div');
      hpFill.className = 'lock-hp-mini-fill';
      hpWrap.appendChild(hpFill);
      el.appendChild(hpWrap);

      this.lockLayer.appendChild(el);
      this.brackets.push({ el, tag, hpFill });
    }
  }

  setVisible(visible) {
    this.root.classList.toggle('hud-hidden', !visible);
  }

  triggerHitmarker(heavy = false) {
    this._hitmarkerTimer = heavy ? 0.2 : 0.09;
    this.hitmarker.classList.add('is-hit');
  }

  showBanner(subText, mainText, duration = 3.2) {
    this.bannerSub.textContent = subText;
    this.bannerMain.textContent = mainText;
    this.banner.classList.remove('is-hidden');
    this._bannerTimer = duration;
  }

  update(dt, { player, weapons, director, weather, quality, camera }) {
    // Hitmarker decay
    if (this._hitmarkerTimer > 0) {
      this._hitmarkerTimer -= dt;
      if (this._hitmarkerTimer <= 0) {
        this.hitmarker.classList.remove('is-hit');
      }
    }

    // Banner decay
    if (this._bannerTimer > 0) {
      this._bannerTimer -= dt;
      if (this._bannerTimer <= 0) {
        this.banner.classList.add('is-hidden');
      }
    }

    // Damage vignette flash when AP drops
    if (player.ap < this._lastAp) {
      this._damageFlashAlpha = 0.85;
    }
    this._lastAp = player.ap;
    if (this._damageFlashAlpha > 0) {
      this._damageFlashAlpha = Math.max(0, this._damageFlashAlpha - dt * 2.8);
      this.damageFlash.style.opacity = this._damageFlashAlpha.toFixed(2);
    }

    // Top telemetry
    this.waveLabel.textContent = director.waveLabel;
    this.enemiesRem.textContent = String(director.aliveCount);
    this.weatherTag.textContent = weather.label;
    this.fpsReadout.textContent = `${Math.round(quality.fps)} FPS`;
    this.qualityBadge.textContent = quality.currentTierName;

    // Boss Dreadnought bar
    const boss = director.bossRef;
    if (boss && boss.alive) {
      this.bossPanel.classList.remove('is-hidden');
      const pct = Math.max(0, (boss.ap / boss.maxAp) * 100);
      this.bossBarFill.style.width = `${pct.toFixed(1)}%`;
      this.bossSub.textContent = boss.laserState !== 'IDLE' ? 'WARNING // THERMAL BEAM ACTIVE' : `${Math.ceil(boss.ap)} AP`;
    } else {
      this.bossPanel.classList.add('is-hidden');
    }

    // Chassis telemetry
    const apPct = (player.ap / player.maxAp) * 100;
    this.barAp.style.width = `${apPct.toFixed(1)}%`;
    this.valAp.textContent = player.ap.toLocaleString();

    this.barEn.style.width = `${player.en.toFixed(1)}%`;
    this.valEn.textContent = `${Math.round(player.en)}%`;

    this.barHeat.style.width = `${player.heat.toFixed(1)}%`;
    this.valHeat.textContent = `${Math.round(player.heat)}%`;

    // Center reticle spread + Railgun SVG arc
    const spreadScale = 1 + (weapons.rotarySpread - 0.01) * 28;
    this.spreadRing.style.transform = `scale(${spreadScale.toFixed(2)})`;

    const circ = 276.46;
    const offset = circ * (1 - weapons.railCharge);
    this.railArc.style.strokeDashoffset = offset.toFixed(1);

    if (weapons.isLocking) {
      this.lockCounter.textContent = `MISSILE LOCK [${weapons.lockTargets.length}/${weapons.missileAmmo}]`;
    } else if (weapons.railCharge > 0.05) {
      this.lockCounter.textContent = `RAIL CAPACITOR ${Math.round(weapons.railCharge * 100)}%`;
    } else {
      this.lockCounter.textContent = '';
    }

    // Weapon bay readouts
    const rotaryHeatFactor = Math.max(0, 1 - player.heat / 100);
    this.wpnRotaryBar.style.width = `${(rotaryHeatFactor * 100).toFixed(0)}%`;
    this.wpnRotaryState.textContent = weapons.rotaryFiring ? 'FIRING' : 'READY';

    if (weapons.railCooldown > 0) {
      const readyPct = (1 - weapons.railCooldown / 1.65) * 100;
      this.wpnRailBar.style.width = `${Math.max(0, readyPct).toFixed(0)}%`;
      this.wpnRailState.textContent = 'CYCLING';
    } else {
      this.wpnRailBar.style.width = '100%';
      this.wpnRailState.textContent = weapons.railCharge > 0.05 ? `${Math.round(weapons.railCharge * 100)}%` : 'CHARGED';
    }

    if (weapons.missileReloadTimer > 0) {
      const mPct = (1 - weapons.missileReloadTimer / 4.2) * 100;
      this.wpnMissileBar.style.width = `${Math.max(0, mPct).toFixed(0)}%`;
      this.wpnMissileLocks.textContent = 'RELOADING';
    } else {
      this.wpnMissileBar.style.width = `${((weapons.missileAmmo / weapons.maxMissileCells) * 100).toFixed(0)}%`;
      this.wpnMissileLocks.textContent = `${weapons.missileAmmo} CELLS`;
    }

    if (weapons.pulseCooldown > 0) {
      const pPct = (1 - weapons.pulseCooldown / weapons.pulseMaxCooldown) * 100;
      this.wpnPulseBar.style.width = `${Math.max(0, pPct).toFixed(0)}%`;
      this.wpnPulseState.textContent = `${weapons.pulseCooldown.toFixed(1)}S`;
    } else {
      this.wpnPulseBar.style.width = '100%';
      this.wpnPulseState.textContent = 'ONLINE';
    }

    // Incoming enemy missile alert
    const incoming = weapons.countIncomingEnemyMissiles();
    this.missileAlert.classList.toggle('is-hidden', incoming === 0);

    // 3D-Projected Multi-Lock Target Brackets
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const aliveEnemies = director.enemies.filter((e) => e.alive);

    for (let i = 0; i < MAX_BRACKETS; i++) {
      const b = this.brackets[i];
      const e = aliveEnemies[i];
      if (!e) {
        b.el.style.opacity = '0';
        continue;
      }

      this._projVec.copy(e.getTargetPoint()).project(camera);
      if (this._projVec.z > 1.0 || this._projVec.z < -1.0) {
        b.el.style.opacity = '0';
        continue;
      }

      const sx = (this._projVec.x * 0.5 + 0.5) * vw;
      const sy = (-this._projVec.y * 0.5 + 0.5) * vh;
      if (sx < -40 || sx > vw + 40 || sy < -40 || sy > vh + 40) {
        b.el.style.opacity = '0';
        continue;
      }

      const locksOnThis = weapons.lockTargets.filter((t) => t === e).length;
      b.el.classList.toggle('is-locked', locksOnThis > 0);
      b.el.style.opacity = '1';
      b.el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0)`;

      b.tag.textContent = locksOnThis > 0 ? `${e.callsign} [LOCK x${locksOnThis}]` : e.callsign;
      b.hpFill.style.width = `${Math.max(0, (e.ap / e.maxAp) * 100).toFixed(0)}%`;
    }
  }
}
