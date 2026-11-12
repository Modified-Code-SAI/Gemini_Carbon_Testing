export const QUALITY_TIERS = {
  ULTRA: {
    name: 'ULTRA',
    pixelRatioCap: 1.5,
    shadowMapSize: 4096,
    msaaSamples: 4,
    gtaoEnabled: true,
    gtaoScale: 0.75,
    planarReflectionScale: 0.55,
    cloudSteps: 12,
    rainCount: 11000,
    mistCount: 36,
    debrisMultiplier: 1.0,
    bloomStrength: 0.42,
    bloomRadius: 0.56,
    bloomThreshold: 0.96,
    lensFX: true,
    sharpen: 0.28,
  },
  HIGH: {
    name: 'HIGH',
    pixelRatioCap: 1.25,
    shadowMapSize: 2048,
    msaaSamples: 2,
    gtaoEnabled: true,
    gtaoScale: 0.55,
    planarReflectionScale: 0.38,
    cloudSteps: 8,
    rainCount: 6000,
    mistCount: 24,
    debrisMultiplier: 0.72,
    bloomStrength: 0.4,
    bloomRadius: 0.5,
    bloomThreshold: 0.96,
    lensFX: true,
    sharpen: 0.22,
  },
  BALANCED: {
    name: 'BALANCED',
    pixelRatioCap: 1.0,
    shadowMapSize: 1024,
    msaaSamples: 0,
    gtaoEnabled: false,
    gtaoScale: 0.0,
    planarReflectionScale: 0.25,
    cloudSteps: 5,
    rainCount: 2600,
    mistCount: 14,
    debrisMultiplier: 0.45,
    bloomStrength: 0.36,
    bloomRadius: 0.44,
    bloomThreshold: 0.98,
    lensFX: false,
    sharpen: 0.16,
  },
};

const TIER_ORDER = ['ULTRA', 'HIGH', 'BALANCED'];

export class QualityManager {
  constructor(initialTier = 'ULTRA') {
    this.currentTierName = QUALITY_TIERS[initialTier] ? initialTier : 'ULTRA';
    this.autoScale = true;
    this.listeners = new Set();

    this.fps = 60;
    this._frameAccum = 0;
    this._timeAccum = 0;
    this._lowFpsDuration = 0;
    this._cooldown = 4.5;
  }

  get config() {
    return QUALITY_TIERS[this.currentTierName];
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setTier(tierName, isAuto = false) {
    if (!QUALITY_TIERS[tierName] || tierName === this.currentTierName) return;
    this.currentTierName = tierName;
    this._lowFpsDuration = 0;
    this._cooldown = isAuto ? 5.0 : 6.0;
    const cfg = this.config;
    for (const fn of this.listeners) {
      fn(cfg, isAuto);
    }
  }

  setAutoScale(enabled) {
    this.autoScale = Boolean(enabled);
    this._lowFpsDuration = 0;
  }

  resetCooldown(seconds = 4.0) {
    this._cooldown = seconds;
    this._lowFpsDuration = 0;
  }

  update(rawDt, allowAutoScale = true) {
    const dt = Math.min(Math.max(rawDt, 0.001), 0.25);
    this._frameAccum += 1;
    this._timeAccum += dt;

    if (this._timeAccum >= 0.35) {
      const measured = this._frameAccum / this._timeAccum;
      this.fps = this.fps * 0.45 + measured * 0.55;
      this._frameAccum = 0;
      this._timeAccum = 0;
    }

    if (this._cooldown > 0) {
      this._cooldown -= dt;
      return;
    }

    if (this.autoScale && allowAutoScale) {
      if (this.fps < 43) {
        this._lowFpsDuration += dt;
        if (this._lowFpsDuration > 3.2) {
          const idx = TIER_ORDER.indexOf(this.currentTierName);
          if (idx >= 0 && idx < TIER_ORDER.length - 1) {
            this.setTier(TIER_ORDER[idx + 1], true);
          }
        }
      } else {
        this._lowFpsDuration = Math.max(0, this._lowFpsDuration - dt * 1.5);
      }
    }
  }
}
