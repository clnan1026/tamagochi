// PetStats — the HP / Satiety / Stamina model.
//
//   Satiety  decays with time; Feed refills it, Play nibbles it.
//   HP       full to start; drains ONLY while Satiety is 0; slowly regenerates
//            while the pet is fed (Satiety above a comfort threshold).
//   Stamina  mirrors the real battery %; it is set from outside, never decayed here.
//
// Host-agnostic: no DOM, no chrome.*, no Electron. Runnable in Node for tests and
// loaded as a plain <script> in the app (exposed on window.__tamagotchi).
(() => {
  const MAX = 100;
  const clamp = (v) => Math.min(MAX, Math.max(0, v));

  const RATES = {
    satietyDecayPerSec: MAX / (20 * 60), // empty in ~20 min of app-open time
    hpDrainPerSec: MAX / (10 * 60), // ~10 min to empty once starving
    hpRegenPerSec: MAX / (10 * 60), // ~10 min to refill while well-fed
    hpRegenSatietyThreshold: 30, // regen only above this Satiety
    feedAmount: 25,
    playSatietyCost: 10,
    offlineCapSeconds: 8 * 3600, // never decay more than 8h of absence at once
  };

  class PetStats {
    // `saved` is the persisted snapshot { hp, satiety, lastSeen } or null.
    constructor(saved = null, now = Date.now()) {
      if (saved && typeof saved.hp === "number") {
        this.hp = clamp(saved.hp);
        this.satiety = clamp(saved.satiety);
        this.#applyOffline(saved.lastSeen, now);
      } else {
        this.hp = MAX;
        this.satiety = MAX;
      }
      this.stamina = MAX; // until the first battery read
      this.staminaKnown = false;
    }

    // Advance the time-driven stats. `dt` is seconds.
    tick(dt) {
      if (dt <= 0) return;
      this.satiety = clamp(this.satiety - RATES.satietyDecayPerSec * dt);

      if (this.satiety <= 0) {
        this.hp = clamp(this.hp - RATES.hpDrainPerSec * dt);
      } else if (this.satiety > RATES.hpRegenSatietyThreshold) {
        this.hp = clamp(this.hp + RATES.hpRegenPerSec * dt);
      }
    }

    // Revive after a faint: HP full, a modest Satiety head-start; Stamina is the
    // live battery and is left untouched.
    reset() {
      this.hp = MAX;
      this.satiety = 60;
    }

    feed() {
      this.satiety = clamp(this.satiety + RATES.feedAmount);
    }

    play() {
      this.satiety = clamp(this.satiety - RATES.playSatietyCost);
    }

    // Stamina is the battery level (0–100); charging is informational.
    setBattery(level, charging = false) {
      this.stamina = clamp(level);
      this.charging = charging;
      this.staminaKnown = true;
    }

    // Below these, the room slows the pet / shows it tired.
    get sluggish() {
      return this.staminaKnown && this.stamina < 30;
    }
    get exhausted() {
      return this.staminaKnown && this.stamina < 10;
    }
    get starving() {
      return this.satiety <= 0;
    }
    get unwell() {
      return this.hp < 30;
    }

    snapshot(now = Date.now()) {
      return { hp: this.hp, satiety: this.satiety, lastSeen: now };
    }

    // Fast-forward the model for time the app was closed.
    #applyOffline(lastSeen, now) {
      if (!lastSeen) return;
      const elapsed = Math.min((now - lastSeen) / 1000, RATES.offlineCapSeconds);
      if (elapsed > 0) this.tick(elapsed);
    }
  }

  PetStats.MAX = MAX;
  PetStats.RATES = RATES;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { PetStats };
  } else {
    (window.__tamagotchi ??= {}).PetStats = PetStats;
  }
})();
