import { clearHighScores, formatTime, loadHighScores } from '../core/highScores';
import { MODE_NAMES, type EndReason, type Mode } from '../core/session';
import { LIMITS, QUALITY_PRESETS, type Quality, settings } from '../core/settings';
import type { Scoring } from '../targets/scoring';
import './theme.css';
import './menu.css';

// All the full-screen menus: main, mode select, settings, high scores, controls,
// pause, and results. Settings changes save and apply straight away.

const MODE_BLURBS: Record<Mode, string> = {
  range: 'Free practice around the city. No timer. Run out of air outside and you wake up back in the plaza.',
  timeTrial: '60 seconds. Highest score wins. Going outside costs oxygen.',
  oxygenRun: 'Locked out on the surface. Every hit buys air, and the air goes faster the longer you last.',
};

const CONTROLS: [string, string][] = [
  ['W A S D', 'Move'],
  ['Mouse', 'Look'],
  ['Left click', 'Shoot'],
  ['Right click', 'Aim down sights'],
  ['R', 'Reload'],
  ['Space', 'Jump'],
  ['Hold space', 'Jetpack (in the air)'],
  ['Shift', 'Sprint'],
  ['C', 'Crouch'],
  ['[  ]', 'Mouse sensitivity'],
  ['F3', 'Frame rate and stats'],
  ['Esc', 'Pause'],
];

export interface RunSummary {
  mode: Mode;
  reason: EndReason;
  scoring: Scoring;
  survived: number; // seconds
  newBest: boolean;
}

export interface MenuActions {
  start(mode: Mode): void;
  resume(): void;
  quitToMenu(): void;
}

type Screen = 'main' | 'modes' | 'settings' | 'scores' | 'controls' | 'paused' | 'results' | 'hidden';

export class Menu {
  private root: HTMLElement;
  private screen: Screen = 'hidden';
  private backTo: Screen = 'main'; // where Esc / Back returns to from settings and controls

  constructor(private actions: MenuActions) {
    this.root = document.createElement('div');
    this.root.className = 'menu';
    document.body.appendChild(this.root);
    // Esc goes back a screen (pausing itself is handled by the mouse lock).
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || this.screen === 'hidden') return;
      if (['modes', 'scores'].includes(this.screen)) this.showMain();
      else if (['settings', 'controls'].includes(this.screen)) this.back();
    });
    this.showMain();
  }

  /** True on the main menu screens (not paused mid-run, not results). */
  get atMainMenu() {
    return ['main', 'modes', 'settings', 'scores', 'controls'].includes(this.screen) && this.backTo === 'main';
  }

  hide() {
    this.screen = 'hidden';
    this.root.style.display = 'none';
  }

  showMain() {
    this.backTo = 'main';
    this.render('main', 'side', `
      <h1>LOW-G</h1>
      <div class="tagline">LUNAR TARGET RANGE</div>
      <div class="buttons">
        <button class="primary" data-go="modes">PLAY</button>
        <button data-go="settings">SETTINGS</button>
        <button data-go="scores">HIGH SCORES</button>
        <button data-go="controls">CONTROLS</button>
      </div>
      <div class="hint">Moon gravity: 1.62 m/s².<br />The dome holds air. The surface doesn't.</div>`);
  }

  showModes() {
    const best = loadHighScores();
    const cards = (Object.keys(MODE_NAMES) as Mode[])
      .map((mode) => {
        const record = best[mode] ? `BEST ${mode === 'oxygenRun' ? formatTime(best[mode]) : best[mode].toLocaleString('en-US')}` : 'NO RECORD YET';
        return `<button class="mode" data-start="${mode}">
          <span class="title">${MODE_NAMES[mode]}</span>
          <span class="blurb">${MODE_BLURBS[mode]}</span>
          <span class="best">${record}</span>
        </button>`;
      })
      .join('');
    this.render('modes', 'side', `
      <h2>CHOOSE A MODE</h2>
      <div class="buttons">${cards}</div>
      <div class="buttons"><button class="plain" data-go="main">BACK</button></div>`);
  }

  showSettings() {
    if (this.screen === 'paused') this.backTo = 'paused';
    const s = settings.get();
    const quality = (Object.keys(QUALITY_PRESETS) as Quality[])
      .map((q) => `<button class="${q === s.quality ? 'on' : ''}" data-quality="${q}">${QUALITY_PRESETS[q].label}</button>`)
      .join('');
    this.render('settings', this.backTo === 'paused' ? 'center' : 'side', `
      <h2>SETTINGS</h2>
      <div class="scroll">
        ${this.slider('sensitivity', 'MOUSE SENSITIVITY', LIMITS.sensitivity.min * 1000, LIMITS.sensitivity.max * 1000, 0.1, s.sensitivity * 1000, (v) => v.toFixed(1))}
        ${this.slider('fov', 'FIELD OF VIEW', LIMITS.fov.min, LIMITS.fov.max, 1, s.fov, (v) => `${v.toFixed(0)}°`)}
        ${this.slider('volume', 'VOLUME', 0, 100, 1, s.volume * 100, (v) => `${v.toFixed(0)}%`)}
        <div class="setting">
          <div class="top"><span>GRAPHICS QUALITY</span><span class="now">${QUALITY_PRESETS[s.quality].label}</span></div>
          <div class="choices">${quality}</div>
          <div class="note">${QUALITY_PRESETS[s.quality].note}. Medium is aimed at a typical laptop.</div>
        </div>
        <div class="setting">
          <div class="top"><span>SHOW FRAME RATE (F3)</span><span class="now">${s.showStats ? 'ON' : 'OFF'}</span></div>
          <div class="choices"><button class="${s.showStats ? '' : 'on'}" data-stats="off">OFF</button><button class="${s.showStats ? 'on' : ''}" data-stats="on">ON</button></div>
        </div>
      </div>
      <div class="buttons row">
        <button class="plain" data-reset-settings>RESET TO DEFAULTS</button>
        <button class="plain primary" data-back>BACK</button>
      </div>`);

    // Sliders apply as you drag.
    this.root.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((input) => {
      const readout = input.closest('.setting')!.querySelector('.now')!;
      input.addEventListener('input', () => {
        const v = Number(input.value);
        if (input.name === 'sensitivity') settings.set({ sensitivity: v / 1000 });
        if (input.name === 'fov') settings.set({ fov: v });
        if (input.name === 'volume') settings.set({ volume: v / 100 });
        readout.textContent = input.dataset.unit === 'deg' ? `${v}°` : input.dataset.unit === 'pct' ? `${v}%` : v.toFixed(1);
      });
      input.dataset.unit = input.name === 'fov' ? 'deg' : input.name === 'volume' ? 'pct' : 'num';
    });
  }

  showScores(confirming = false) {
    const best = loadHighScores();
    const rows = (Object.keys(MODE_NAMES) as Mode[])
      .map((mode) => {
        const value = best[mode] ? (mode === 'oxygenRun' ? `${formatTime(best[mode])} SURVIVED` : `${best[mode].toLocaleString('en-US')} PTS`) : '-';
        return `<tr><td>${MODE_NAMES[mode]}</td><td class="big">${value}</td></tr>`;
      })
      .join('');
    this.render('scores', 'side', `
      <h2>HIGH SCORES</h2>
      <table>${rows}</table>
      <div class="hint">Saved in this browser only.</div>
      <div class="buttons">
        <button class="plain danger" data-reset-scores>${confirming ? 'CLICK AGAIN TO ERASE ALL RECORDS' : 'RESET RECORDS'}</button>
        <button class="plain primary" data-go="main">BACK</button>
      </div>`);
    const reset = this.root.querySelector<HTMLButtonElement>('[data-reset-scores]')!;
    reset.onclick = () => {
      if (!confirming) return this.showScores(true);
      clearHighScores();
      this.showScores(false);
    };
  }

  showControls() {
    if (this.screen === 'paused') this.backTo = 'paused';
    this.render('controls', this.backTo === 'paused' ? 'center' : 'side', `
      <h2>CONTROLS</h2>
      <table>${CONTROLS.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
      <div class="buttons"><button class="plain primary" data-back>BACK</button></div>`);
  }

  showPaused() {
    this.backTo = 'paused';
    this.render('paused', 'center', `
      <h2>PAUSED</h2>
      <div class="buttons">
        <button class="primary" data-resume>RESUME</button>
        <button data-go="settings">SETTINGS</button>
        <button data-go="controls">CONTROLS</button>
        <button data-quit>QUIT TO MENU</button>
      </div>
      <div class="hint">Click resume to grab the mouse again.</div>`);
  }

  showResults(run: RunSummary) {
    this.backTo = 'main';
    const { scoring } = run;
    const accuracy = scoring.accuracy;
    const rows: [string, string][] = [];
    if (run.mode === 'oxygenRun') rows.push(['SURVIVED', formatTime(run.survived)]);
    rows.push(
      ['SCORE', scoring.score.toLocaleString('en-US')],
      ['ACCURACY', accuracy === null ? '-' : `${accuracy.toFixed(1)}%`],
      ['HITS', `${scoring.shotsHit} / ${scoring.shotsFired}`],
      ['BEST COMBO', String(scoring.bestCombo)],
      ['BULLSEYES', String(scoring.bullseyes)],
    );
    this.render('results', 'center', `
      <h2>${run.reason === 'oxygen' ? 'OXYGEN DEPLETED' : "TIME'S UP"}</h2>
      <div class="hint">${MODE_NAMES[run.mode]}</div>
      ${run.newBest ? '<div class="new-best">NEW BEST</div>' : ''}
      <table>${rows.map(([a, b]) => `<tr><td>${a}</td><td class="big">${b}</td></tr>`).join('')}</table>
      <div class="buttons">
        <button class="primary" data-start="${run.mode}">PLAY AGAIN</button>
        <button data-quit>MENU</button>
      </div>`);
  }

  private back() {
    if (this.backTo === 'paused') this.showPaused();
    else this.showMain();
  }

  private slider(name: string, label: string, min: number, max: number, step: number, value: number, show: (v: number) => string) {
    return `<div class="setting">
      <div class="top"><span>${label}</span><span class="now">${show(value)}</span></div>
      <input type="range" name="${name}" min="${min}" max="${max}" step="${step}" value="${value}" />
    </div>`;
  }

  private render(screen: Screen, layout: 'side' | 'center', html: string) {
    this.screen = screen;
    this.root.className = `menu ${layout}`;
    this.root.innerHTML = `<div class="column">${html}</div>`;
    this.root.style.display = 'flex';

    const on = (selector: string, handler: (el: HTMLElement) => void) =>
      this.root.querySelectorAll<HTMLElement>(selector).forEach((el) => el.addEventListener('click', () => handler(el)));
    on('[data-go]', (el) => {
      const to = el.dataset.go;
      if (to === 'main') this.showMain();
      if (to === 'modes') this.showModes();
      if (to === 'settings') this.showSettings();
      if (to === 'scores') this.showScores();
      if (to === 'controls') this.showControls();
    });
    on('[data-start]', (el) => this.actions.start(el.dataset.start as Mode));
    on('[data-resume]', () => this.actions.resume());
    on('[data-quit]', () => this.actions.quitToMenu());
    on('[data-back]', () => this.back());
    on('[data-quality]', (el) => {
      settings.set({ quality: el.dataset.quality as Quality });
      this.showSettings();
    });
    on('[data-stats]', (el) => {
      settings.set({ showStats: el.dataset.stats === 'on' });
      this.showSettings();
    });
    on('[data-reset-settings]', () => {
      settings.reset();
      this.showSettings();
    });
    // Put keyboard focus on the first button so Enter works straight away.
    this.root.querySelector<HTMLElement>('button.primary, button')?.focus({ preventScroll: true });
  }
}

