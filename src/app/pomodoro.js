// PomodoroTimer — the Pomodoro / Short Break / Long Break countdown model.
//
// Wall-clock based (an `endTimestamp`, not a decrementing counter): the driver may be
// throttled or skip ticks while the window is unfocused/hidden, so `remaining()` is
// always computed from `Date.now()` rather than accumulated drift.
//
// Host-agnostic: no DOM, no chrome.*, no Electron. Runnable in Node for tests and
// loaded as a plain <script> in the app (exposed on window.__tamagotchi).
(() => {
  const MODES = { pomodoro: 25 * 60, short: 5 * 60, long: 15 * 60 };

  class PomodoroTimer {
    // `saved` is a persisted snapshot { mode, running, endTimestamp, pausedRemaining } or null.
    constructor(saved = null, now = Date.now()) {
      this.mode = saved?.mode in MODES ? saved.mode : "pomodoro";
      this.running = false;
      this.endTimestamp = null;
      this.pausedRemaining = MODES[this.mode];

      if (saved?.running && typeof saved.endTimestamp === "number") {
        const left = Math.round((saved.endTimestamp - now) / 1000);
        if (left > 0) {
          this.running = true;
          this.endTimestamp = saved.endTimestamp;
        } else {
          // Finished while the app was closed. Land stopped at full duration rather
          // than re-firing the alarm the instant the app reopens.
          this.pausedRemaining = MODES[this.mode];
        }
      } else if (typeof saved?.pausedRemaining === "number") {
        this.pausedRemaining = Math.max(0, Math.min(MODES[this.mode], saved.pausedRemaining));
      }
    }

    remaining(now = Date.now()) {
      if (!this.running) return this.pausedRemaining;
      return Math.max(0, Math.round((this.endTimestamp - now) / 1000));
    }

    start(now = Date.now()) {
      if (this.running) return;
      const left = this.pausedRemaining > 0 ? this.pausedRemaining : MODES[this.mode];
      this.running = true;
      this.endTimestamp = now + left * 1000;
    }

    pause(now = Date.now()) {
      if (!this.running) return;
      this.pausedRemaining = this.remaining(now);
      this.running = false;
      this.endTimestamp = null;
    }

    // Switching modes always stops and resets to that mode's full duration — no
    // silent progress loss, no auto-chaining between modes.
    switchMode(mode) {
      if (!(mode in MODES)) return;
      this.mode = mode;
      this.running = false;
      this.endTimestamp = null;
      this.pausedRemaining = MODES[mode];
    }

    reset() {
      this.running = false;
      this.endTimestamp = null;
      this.pausedRemaining = MODES[this.mode];
    }

    // Call roughly once a second. Fires `onFinish` exactly once when a running
    // session reaches 0, then stops and resets to the mode's full duration.
    tick(onFinish, now = Date.now()) {
      if (!this.running) return;
      if (this.remaining(now) > 0) return;
      this.running = false;
      this.endTimestamp = null;
      this.pausedRemaining = MODES[this.mode];
      if (onFinish) onFinish(this.mode);
    }

    snapshot() {
      return {
        mode: this.mode,
        running: this.running,
        endTimestamp: this.endTimestamp,
        pausedRemaining: this.pausedRemaining,
      };
    }
  }

  PomodoroTimer.MODES = MODES;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { PomodoroTimer };
  } else {
    (window.__tamagotchi ??= {}).PomodoroTimer = PomodoroTimer;
  }
})();
