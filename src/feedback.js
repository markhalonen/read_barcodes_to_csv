// Audible/haptic scan feedback.
//
// You are looking at a box, not at the phone, so the beep is the primary signal
// that a scan landed. iOS Safari has no navigator.vibrate, so audio has to
// carry it there; we still fire vibrate where it exists.

let audioCtx = null;

/**
 * Unlock audio.
 *
 * Mobile browsers only allow an AudioContext to start inside a user gesture, so
 * this must be called from the tap that starts scanning — otherwise the first
 * several beeps are silently dropped.
 */
export function initFeedback() {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {
    audioCtx = null; // No audio available; visual flash still fires.
  }
}

function tone(frequency, durationMs, gainValue = 0.15) {
  if (!audioCtx || audioCtx.state !== 'running') return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.value = frequency;

  // Ramp the envelope rather than starting/stopping abruptly, which clicks.
  const now = audioCtx.currentTime;
  const duration = durationMs / 1000;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(gainValue, now + 0.008);
  gain.gain.setValueAtTime(gainValue, now + duration - 0.02);
  gain.gain.linearRampToValueAtTime(0, now + duration);

  osc.connect(gain).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + duration);
}

/** Bright confirmation for a newly captured serial. */
export function beepSuccess() {
  tone(1180, 0.11);
  navigator.vibrate?.(35);
}

/** Lower, softer note for a barcode we already have — distinct from success. */
export function beepDuplicate() {
  tone(560, 0.16, 0.1);
  navigator.vibrate?.([18, 40, 18]);
}
