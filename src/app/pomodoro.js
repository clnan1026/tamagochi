// PomodoroTimer — the Pomodoro / Break countdown model.
//
// Wall-clock based (an `endTimestamp`, not a decrementing counter): the driver may be
// throttled or skip ticks while the window is unfocused/hidden, so `remaining()` is
// always computed from `Date.now()` rather than accumulated drift.
//
// Durations are per-instance and user-configurable (setDuration), not fixed constants —
// DEFAULT_DURATIONS only supplies the starting point for a fresh timer.
//
// Host-agnostic: no DOM, no chrome.*, no Electron. Runnable in Node for tests and
// loaded as a plain <script> in the app (exposed on window.__tamagotchi).
(() => {
  const DEFAULT_DURATIONS = { pomodoro: 25 * 60, break: 5 * 60 };
  const MIN_MINUTES = 1;
  const MAX_MINUTES = 180;

  class PomodoroTimer {
    // `saved` is a persisted snapshot
    // { mode, running, endTimestamp, pausedRemaining, durations } or null.
    constructor(saved = null, now = Date.now()) {
      this.durations = { ...DEFAULT_DURATIONS, ...sanitizeDurations(saved?.durations) };
      this.mode = saved?.mode in this.durations ? saved.mode : "pomodoro";
      this.running = false;
      this.endTimestamp = null;
      this.pausedRemaining = this.durations[this.mode];

      if (saved?.running && typeof saved.endTimestamp === "number") {
        const left = Math.round((saved.endTimestamp - now) / 1000);
        if (left > 0) {
          this.running = true;
          this.endTimestamp = saved.endTimestamp;
        } else {
          // Finished while the app was closed. Land stopped at full duration rather
          // than re-firing the alarm the instant the app reopens.
          this.pausedRemaining = this.durations[this.mode];
        }
      } else if (typeof saved?.pausedRemaining === "number") {
        this.pausedRemaining = Math.max(0, Math.min(this.durations[this.mode], saved.pausedRemaining));
      }
    }

    remaining(now = Date.now()) {
      if (!this.running) return this.pausedRemaining;
      return Math.max(0, Math.round((this.endTimestamp - now) / 1000));
    }

    start(now = Date.now()) {
      if (this.running) return;
      const left = this.pausedRemaining > 0 ? this.pausedRemaining : this.durations[this.mode];
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
      if (!(mode in this.durations)) return;
      this.mode = mode;
      this.running = false;
      this.endTimestamp = null;
      this.pausedRemaining = this.durations[mode];
    }

    reset() {
      this.running = false;
      this.endTimestamp = null;
      this.pausedRemaining = this.durations[this.mode];
    }

    // User-configurable duration, in minutes. Only affects an *idle* timer's
    // displayed remaining time immediately (if `mode` is the current one) — a
    // session already running keeps counting down on its original duration, so
    // editing durations mid-focus can't silently add or steal time.
    setDuration(mode, minutes) {
      if (!(mode in this.durations)) return;
      const seconds = clampMinutes(minutes) * 60;
      this.durations[mode] = seconds;
      if (mode === this.mode && !this.running) {
        this.pausedRemaining = seconds;
      }
    }

    // Call roughly once a second. Fires `onFinish` exactly once when a running
    // session reaches 0, then stops and resets to the mode's full duration.
    tick(onFinish, now = Date.now()) {
      if (!this.running) return;
      if (this.remaining(now) > 0) return;
      this.running = false;
      this.endTimestamp = null;
      this.pausedRemaining = this.durations[this.mode];
      if (onFinish) onFinish(this.mode);
    }

    snapshot() {
      return {
        mode: this.mode,
        running: this.running,
        endTimestamp: this.endTimestamp,
        pausedRemaining: this.pausedRemaining,
        durations: { ...this.durations },
      };
    }
  }

  function clampMinutes(minutes) {
    return Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, Math.round(minutes)));
  }

  // Only keep known modes, and clamp each to sane bounds, when restoring a
  // snapshot — never trust stored data blindly.
  function sanitizeDurations(durations) {
    if (!durations || typeof durations !== "object") return {};
    const clean = {};
    for (const mode of Object.keys(DEFAULT_DURATIONS)) {
      if (typeof durations[mode] === "number" && durations[mode] > 0) {
        clean[mode] = clampMinutes(durations[mode] / 60) * 60;
      }
    }
    return clean;
  }

  PomodoroTimer.DEFAULT_DURATIONS = DEFAULT_DURATIONS;
  PomodoroTimer.MIN_MINUTES = MIN_MINUTES;
  PomodoroTimer.MAX_MINUTES = MAX_MINUTES;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { PomodoroTimer };
  } else {
    (window.__tamagotchi ??= {}).PomodoroTimer = PomodoroTimer;
  }
})();
