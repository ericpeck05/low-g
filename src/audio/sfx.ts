// Tiny synthesized sound effects using the Web Audio API, so there are no sound files yet.
// Phase 8 replaces this with the full sound manager (vacuum muffling and so on).

let context: AudioContext | null = null;

/** Browsers only allow audio after a click, so call this from a click handler. */
export function unlockAudio() {
  context ??= new AudioContext();
  if (context.state === 'suspended') void context.resume();
}

/** A short "tick" confirming a hit. Bullseyes get a brighter two-note chirp. */
export function playHitSound(bullseye: boolean) {
  if (!context) return;
  beep(1400, 0.06, 0.12);
  if (bullseye) beep(2100, 0.08, 0.1, 0.05);
}

function beep(frequency: number, duration: number, volume: number, delay = 0) {
  if (!context) return;
  const start = context.currentTime + delay;
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = 'triangle';
  osc.frequency.value = frequency;
  // Quick attack, fast fade, so it's a click rather than a tone.
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(context.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}
