import { formatTime, loadHighScores } from '../core/highScores';
import { MODE_NAMES, type EndReason, type Mode } from '../core/session';
import type { Scoring } from '../targets/scoring';

// The full-screen overlay for choosing a mode, pausing, and showing results.
// A simple version for now; phase 7 builds the proper menus and settings.

const MODE_BLURBS: Record<Mode, string> = {
  range: 'Free practice. No timer.',
  timeTrial: '60 seconds. Highest score wins.',
  oxygenRun: 'Locked outside. Hit targets for air.',
};

export interface RunSummary {
  mode: Mode;
  reason: EndReason;
  scoring: Scoring;
  survived: number; // seconds
  newBest: boolean;
}

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
  .menu .modes { display: flex; gap: 12px; }
  .menu .mode { display: flex; flex-direction: column; gap: 6px; align-items: stretch; width: 210px; }
  .menu .mode small { color: #bdb6aa; text-align: center; }
  .menu .mode .best { color: #ffa31a; }
  .menu .new-best { color: #ffa31a; font-size: 16px; letter-spacing: 0.2em; }
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
    const best = loadHighScores();
    const bestText: Record<Mode, string> = {
      range: best.range ? `BEST ${best.range.toLocaleString('en-US')}` : 'NO RECORD',
      timeTrial: best.timeTrial ? `BEST ${best.timeTrial.toLocaleString('en-US')}` : 'NO RECORD',
      oxygenRun: best.oxygenRun ? `BEST ${formatTime(best.oxygenRun)}` : 'NO RECORD',
    };
    const modes = (Object.keys(MODE_NAMES) as Mode[])
      .map(
        (mode) => `
        <div class="mode">
          <button data-action="${mode}">${MODE_NAMES[mode]}</button>
          <small>${MODE_BLURBS[mode]}</small>
          <small class="best">${bestText[mode]}</small>
        </div>`,
      )
      .join('');
    this.render(`<h1>LOW-G</h1><div class="modes">${modes}</div>${table(CONTROLS)}`);
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

  showResults(run: RunSummary) {
    const { scoring } = run;
    const accuracy = scoring.accuracy;
    const title = run.reason === 'oxygen' ? 'OXYGEN DEPLETED' : "TIME'S UP";
    const rows: [string, string][] = [];
    if (run.mode === 'oxygenRun') rows.push(['SURVIVED', formatTime(run.survived)]);
    rows.push(
      ['SCORE', scoring.score.toLocaleString('en-US')],
      ['ACCURACY', accuracy === null ? '-' : `${accuracy.toFixed(1)}%`],
      ['HITS', `${scoring.shotsHit} / ${scoring.shotsFired}`],
      ['BEST COMBO', String(scoring.bestCombo)],
      ['BULLSEYES', String(scoring.bullseyes)],
    );
    this.render(`
      <h2>${title}</h2>
      ${run.newBest ? '<div class="new-best">NEW BEST</div>' : ''}
      <div class="results">${table(rows)}</div>
      <div class="buttons">
        <button data-action="${run.mode}">PLAY AGAIN</button>
        <button data-action="menu">MENU</button>
      </div>`);
  }

  private render(html: string) {
    this.root.innerHTML = html;
    this.root.style.display = 'flex';
    this.root.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset.action;
        if (action === 'range' || action === 'timeTrial' || action === 'oxygenRun') this.actions.start(action);
        else if (action === 'resume') this.actions.resume();
        else if (action === 'menu') this.actions.quitToMenu();
      });
    });
  }
}

function table(rows: [string, string][]) {
  return `<table>${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>`;
}
