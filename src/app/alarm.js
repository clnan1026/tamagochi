// A synthesized alarm tone — no sound asset in the project, so this is built from
// Web Audio oscillators instead: a short ascending marimba-style chime motif,
// repeated for ~5 seconds. Closer to a classic phone alarm's pleasant bell/chime
// feel than a harsh square-wave beep (can't use a real iPhone sound file — that's
// Apple's copyrighted audio — so this is an inspired-by synthesis instead).
(() => {
  const NS = (window.__tamagotchi ??= {});

  const DURATION_S = 5;
  const MOTIF_HZ = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6 — ascending
  const NOTE_SPACING_S = 0.11;
  const NOTE_DECAY_S = 0.35; // bell-like tail
  const MOTIF_GAP_S = 0.25; // brief silence between repeats of the motif
  const NOTE_PEAK_GAIN = 0.3;

  let ctx = null;
  const getContext = () => (ctx ??= new (window.AudioContext || window.webkitAudioContext)());

  // One mallet-struck note: quick attack, exponential decay — a bell/marimba
  // pluck rather than a flat on/off gate.
  function pluck(audioCtx, dest, time, freq) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(NOTE_PEAK_GAIN, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + NOTE_DECAY_S);
    osc.connect(gain).connect(dest);
    osc.start(time);
    osc.stop(time + NOTE_DECAY_S + 0.02);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  let alarmLoopTimer = null;

  // Fired from a real user gesture (the Start button) or the tick driver; either
  // way `getContext()` lazily creates/reuses one AudioContext for the app's lifetime.
  function playAlarm() {
    const audioCtx = getContext();
    if (audioCtx.state === "suspended") audioCtx.resume();

    const start = audioCtx.currentTime;
    const motifLength = MOTIF_HZ.length * NOTE_SPACING_S + MOTIF_GAP_S;
    const repeats = Math.ceil(DURATION_S / motifLength);

    for (let r = 0; r < repeats; r++) {
      const motifStart = start + r * motifLength;
      MOTIF_HZ.forEach((freq, i) => pluck(audioCtx, audioCtx.destination, motifStart + i * NOTE_SPACING_S, freq));
    }
  }

  function startAlarm(muted) {
    stopAlarm(); // guard
    const audioCtx = getContext();
    if (audioCtx.state === "suspended") audioCtx.resume();
    if (muted) return;

    playAlarm();
    alarmLoopTimer = setInterval(() => {
      playAlarm();
    }, 5000);
  }

  function stopAlarm() {
    if (alarmLoopTimer) {
      clearInterval(alarmLoopTimer);
      alarmLoopTimer = null;
    }
    if (ctx && ctx.state === "running") {
      ctx.suspend();
    }
  }

  // Warms up the AudioContext from a real user gesture (the Start button) so a
  // later unattended playAlarm() — possibly minutes on — isn't the first thing
  // asking the browser to create audio output.
  function primeAudio() {
    const audioCtx = getContext();
    if (audioCtx.state === "suspended") audioCtx.resume();
  }

  NS.playAlarm = playAlarm;
  NS.startAlarm = startAlarm;
  NS.stopAlarm = stopAlarm;
  NS.primeAudio = primeAudio;
  NS.getAudioContext = getContext; // shared with room.js's mic playback (pitch-shifted recording)
})();
