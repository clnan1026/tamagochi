// A synthesized alarm tone — no sound asset in the project, so this is built from a
// Web Audio oscillator instead: a repeating on/off beep for ~5 seconds.
(() => {
  const NS = (window.__tamagotchi ??= {});

  const DURATION_S = 5;
  const BEEP_HZ = 880;
  const BEEP_ON_S = 0.28;
  const BEEP_OFF_S = 0.18;
  const PEAK_GAIN = 0.22; // quiet enough not to be jarring on unattenuated speakers

  let ctx = null;
  const getContext = () => (ctx ??= new (window.AudioContext || window.webkitAudioContext)());

  // Fired from a real user gesture (the Start button) or the tick driver; either
  // way `getContext()` lazily creates/reuses one AudioContext for the app's lifetime.
  function playAlarm() {
    const audioCtx = getContext();
    if (audioCtx.state === "suspended") audioCtx.resume();

    const start = audioCtx.currentTime;
    const period = BEEP_ON_S + BEEP_OFF_S;
    const beeps = Math.ceil(DURATION_S / period);

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "square";
    osc.frequency.value = BEEP_HZ;
    gain.gain.setValueAtTime(0, start);
    osc.connect(gain).connect(audioCtx.destination);

    for (let i = 0; i < beeps; i++) {
      const onAt = start + i * period;
      const offAt = onAt + BEEP_ON_S;
      // Tiny ramps avoid the audible click of a hard on/off gain step.
      gain.gain.setValueAtTime(0, onAt);
      gain.gain.linearRampToValueAtTime(PEAK_GAIN, onAt + 0.01);
      gain.gain.setValueAtTime(PEAK_GAIN, offAt - 0.01);
      gain.gain.linearRampToValueAtTime(0, offAt);
    }

    const stopAt = start + DURATION_S;
    osc.start(start);
    osc.stop(stopAt);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  // Warms up the AudioContext from a real user gesture (the Start button) so a
  // later unattended playAlarm() — possibly minutes on — isn't the first thing
  // asking the browser to create audio output.
  function primeAudio() {
    const audioCtx = getContext();
    if (audioCtx.state === "suspended") audioCtx.resume();
  }

  NS.playAlarm = playAlarm;
  NS.primeAudio = primeAudio;
})();
