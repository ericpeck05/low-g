import type { Scoring } from '../targets/scoring';

// The full-screen overlay for choosing a mode, pausing, and showing results.
// A simple version for now; phase 7 builds the proper menus and settings.

export type Mode = 'practice' | 'timeTrial';

const STYLE = `
  .menu { position: fixed; inset: 0; display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 18px;
          background: rgba(0,0,0,0.72); color: #f5f0e8;
          font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px;
          letter-spacing: 0.05em; }
  .menu h1 { margin: 0; font-size: 56px; letter-spacing: 0.3em; color: #ffa31a; }
  .menu h2 { margin: 0; font-size: 22px; letter-spacing: 0.2em; }
  .menu .buttons { display: flex; gap: 12px; }
  .menu button { font: inherit; font-size: 15px; letter-spacing: 0.1em; color: #f5f0e8;
                 background: #000; border: 1px solid #f5f0e8; padding: 10px 22px; cursor: pointer; }
  .menu button:hover, .menu button:focus-visible { border-color: #ffa31a; color: #ffa31a; outline: none; }
  .menu table { border-collapse: collapse; color: #bdb6aa; }
  .menu td { padding: 2px 12px; }
  .menu td:first-child { text-align: right; color: #ffa31a; }
  .menu .results td:last-child { color: #f5f0e8; font-size: 18px; }
`;

const CONTROLS: [string, string][] = [
  ['W A S D', 'move'],
  ['MOUSE', 'look'],
  ['LEFT CLICK', 'shoot'],
  ['RIGHT CLICK', 'aim down sights'],
  ['R', 'reload'],
  ['SPACE', 'jump'],
  ['HOLD SPACE', 'jetpack (in the air)'],
  ['SHIFT', 'sprint'],
  ['C', 'crouch'],
  ['[  ]', 'mouse sensitivity'],
  ['ESC', 'pause'],
];

export interface MenuActions {
  start(mode: Mode): void;
  resume(): void;
  quitToMenu(): void;
}

export class Menu {
  private root: HTMLElement;

  constructor(private actions: MenuActions) {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.className = 'menu';
    document.body.appendChild(this.root);
    this.showMain();
  }

  hide() {
    this.root.style.display = 'none';
  }

  showMain() {
    this.render(`
      <h1>LOW-G</h1>
      <div class="buttons">
        <button data-action="practice">FREE PRACTICE</button>
        <button data-action="timeTrial">TIME TRIAL  60s</button>
      </div>
      ${table(CONTROLS)}`);
  }

  showPaused() {
    this.render(`
      <h2>PAUSED</h2>
      <div class="buttons">
        <button data-action="resume">RESUME</button>
        <button data-action="menu">QUIT TO MENU</button>
      </div>
      ${table(CONTROLS)}`);
  }

  showResults(scoring: Scoring) {
    const accuracy = scoring.accuracy;
    this.render(`
      <h2>TIME'S UP</h2>
      <div class="results">${table([
        ['SCORE', scoring.score.toLocaleString('en-US')],
        ['ACCURACY', accuracy === null ? '-' : `${accuracy.toFixed(1)}%`],
        ['HITS', `${scoring.shotsHit} / ${scoring.shotsFired}`],
        ['BEST COMBO', String(scoring.bestCombo)],
        ['BULLSEYES', String(scoring.bullseyes)],
      ])}</div>
      <div class="buttons">
        <button data-action="timeTrial">PLAY AGAIN</button>
        <button data-action="menu">MENU</button>
      </div>`);
  }

  private render(html: string) {
    this.root.innerHTML = html;
    this.root.style.display = 'flex';
    this.root.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset.action;
        if (action === 'practice' || action === 'timeTrial') this.actions.start(action);
        else if (action === 'resume') this.actions.resume();
        else if (action === 'menu') this.actions.quitToMenu();
      });
    });
  }
}

function table(rows: [string, string][]) {
  return `<table>${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>`;
}
