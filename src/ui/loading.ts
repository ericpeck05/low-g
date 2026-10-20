// The loading screen. Its HTML and style are in index.html so it shows the moment the
// page opens; this file moves its progress bar while the world is built, then fades it out.

const TIPS = [
  'Hold Space in the air to fire the jetpack. It refills on the ground.',
  'Out on the surface, every hit buys a little oxygen. Bullseyes buy more.',
  'There is no air outside the dome, so sound barely carries. Watch for targets, don’t listen.',
  'Jumps are six times higher on the Moon. Some rooftops need a jump and the jetpack.',
  'Aim down sights with right click for a steadier shot.',
  'Press F3 any time to see the frame rate.',
];

const root = document.getElementById('loading')!;
const fill = root.querySelector<HTMLElement>('.fill')!;
const step = root.querySelector<HTMLElement>('.step')!;
const percent = root.querySelector<HTMLElement>('.percent')!;
root.querySelector<HTMLElement>('.tip')!.textContent = 'TIP: ' + TIPS[Math.floor(Math.random() * TIPS.length)];

export const loading = {
  /**
   * Show what's being built and how far along we are (0 to 1), then wait for the
   * browser to draw it. Building blocks the page, so without the wait it would never update.
   */
  async step(fraction: number, text: string) {
    fill.style.transform = `scaleX(${Math.max(0.02, fraction)})`;
    step.textContent = text;
    percent.textContent = `${Math.round(fraction * 100)}%`;
    performance.mark(`loading: ${text}`); // shows up in the browser's performance tools
    await nextPaint();
  },

  /** Fade the loading screen out, revealing the main menu. */
  done() {
    root.classList.add('done');
    setTimeout(() => root.remove(), 1000);
  },

  /** Something went wrong: say so instead of leaving a black page. */
  fail(error: unknown) {
    root.classList.add('failed');
    const reason = error instanceof Error ? error.message : String(error);
    step.textContent = /webgl/i.test(reason)
      ? 'This browser can’t run 3D graphics (WebGL 2). Try an up-to-date Chrome, Edge, Firefox or Safari.'
      : `Could not start: ${reason}`;
    step.style.textTransform = 'none';
    percent.textContent = '';
  },
};

function nextPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
    setTimeout(resolve, 250); // a hidden tab draws no frames; don't wait for one forever
  });
}
