// The announcer: a low, flat voice that calls out power-ups and big moments ("Double
// points", "Power restored"), using the browser's own speech synthesis. If the browser
// has no voices, nothing is said (every callout also shows on the visor and has its jingle).

let voice: SpeechSynthesisVoice | null = null;
let volume = 0.8;

function pickVoice() {
  if (typeof speechSynthesis === 'undefined') return;
  const voices = speechSynthesis.getVoices();
  // A plain English voice; deeper ones are preferred where the browser says which.
  voice =
    voices.find((v) => /en[-_]GB/i.test(v.lang) && /daniel|arthur|male/i.test(v.name)) ??
    voices.find((v) => /en[-_]US/i.test(v.lang) && /alex|fred|male|david/i.test(v.name)) ??
    voices.find((v) => /^en/i.test(v.lang)) ??
    null;
}

if (typeof speechSynthesis !== 'undefined') {
  pickVoice();
  speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
}

export function setAnnouncerVolume(level: number) {
  volume = level;
}

/** Say something now (cutting off anything still being said). */
export function announce(text: string) {
  if (typeof speechSynthesis === 'undefined' || volume <= 0) return;
  try {
    speechSynthesis.cancel();
    const line = new SpeechSynthesisUtterance(text);
    if (voice) line.voice = voice;
    line.pitch = 0.55;
    line.rate = 0.92;
    line.volume = Math.min(1, volume);
    speechSynthesis.speak(line);
  } catch {
    // Speech isn't available here; the visor callout is enough.
  }
}
