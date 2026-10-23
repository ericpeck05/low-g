import { CONFIG } from '../config';
import { bestSiegeKills, clearHighScores, formatTime, loadHighScores } from '../core/highScores';
import { MODE_NAMES, type EndReason, type Mode } from '../core/session';
import { PERKS, loadRecord, nextPerk, quartermasterLevel } from '../salvage/quartermaster';
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
  siege: 'Rounds of hostile drones that shoot back. Earn points to buy guns, open the city section by section, get the power back on out on the surface, install suit mods and Overclock your weapons. Survive as many rounds as you can.',
  salvage: 'A solar storm hits in ten minutes. Crack open the wreckage out on the plain and carry it back through an airlock before it does. The farther out, the richer, and the more drones come. Die out there and you lose what you carry.',
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
  ['E', 'Use, buy (Drone Siege)'],
  ['Hold E', 'Open a cache (Salvage Run)'],
  ['1  2  3  or wheel', 'Switch weapon (Drone Siege, Salvage Run)'],
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
  siege?: { round: number; kills: number; coreKills: number; weakPoints: number; points: number; mostKills: boolean }; // Drone Siege only
  salvage?: SalvageSummary; // Salvage Run only
}

/** A Salvage Run's tallies, and what it did for the Quartermaster. */
export interface SalvageSummary {
  banked: number;
  caches: number;
  cachesTotal: number;
  trips: number;
  kills: number;
  lost: number;
  timeOutside: number;
  counted: number; // added to the lifetime total (banked plus insurance on what was lost)
  lifetimeBefore: number;
  lifetimeAfter: number;
}

const END_TITLES: Record<EndReason, string> = {
  timeUp: "TIME'S UP",
  oxygen: 'OXYGEN DEPLETED',
  destroyed: 'SUIT BREACHED',
  sheltered: 'SHELTERED FROM THE STORM',
};

/** A saved best result in words: a time, a score, or a drone count. */
function recordText(mode: Mode, value: number) {
  if (mode === 'oxygenRun') return `${formatTime(value)} SURVIVED`;
  if (mode === 'siege') return `ROUND ${value}`;
  if (mode === 'salvage') return `${value.toLocaleString('en-US')} BANKED`;
  return `${value.toLocaleString('en-US')} PTS`;
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
        const kills = mode === 'siege' && bestSiegeKills() ? ` · ${bestSiegeKills()} KILLS` : '';
        const level = mode === 'salvage' ? ` · QUARTERMASTER LV ${quartermasterLevel(loadRecord().lifetime)}` : '';
        const record = (best[mode] ? `BEST ${recordText(mode, best[mode])}${kills}` : 'NO RECORD YET') + level;
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
        ${this.slider('music', 'MUSIC (DRONE SIEGE)', 0, 100, 1, s.music * 100, (v) => `${v.toFixed(0)}%`)}
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
        if (input.name === 'music') settings.set({ music: v / 100 });
        readout.textContent = input.dataset.unit === 'deg' ? `${v}°` : input.dataset.unit === 'pct' ? `${v}%` : v.toFixed(1);
      });
      input.dataset.unit = input.name === 'fov' ? 'deg' : input.name === 'volume' || input.name === 'music' ? 'pct' : 'num';
    });
  }

  showScores(confirming = false) {
    const best = loadHighScores();
    const rows = (Object.keys(MODE_NAMES) as Mode[])
      .map((mode) => {
        const value = best[mode] ? recordText(mode, best[mode]) : '-';
        return `<tr><td>${MODE_NAMES[mode]}</td><td class="big">${value}</td></tr>`;
      })
      .join('') + `<tr><td>DRONE SIEGE · MOST KILLS</td><td class="big">${bestSiegeKills() || '-'}</td></tr>`;
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
    const accuracyText = accuracy === null ? '-' : `${accuracy.toFixed(1)}%`;
    if (run.mode === 'oxygenRun' || run.siege) rows.push(['SURVIVED', formatTime(run.survived)]);
    const haul = run.salvage;
    if (haul) {
      rows.push(
        ['SALVAGE BANKED', haul.banked.toLocaleString('en-US')],
        ['CACHES OPENED', `${haul.caches} / ${haul.cachesTotal}`],
        ['TRIPS HOME', String(haul.trips)],
        ['DRONES DESTROYED', String(haul.kills)],
        ['LOST ON THE SURFACE', haul.lost > 0 ? haul.lost.toLocaleString('en-US') : '-'],
        ['TIME OUTSIDE', formatTime(haul.timeOutside)],
        ['ACCURACY', accuracyText],
      );
    } else if (run.siege) {
      rows.unshift(['ROUND REACHED', String(run.siege.round)]);
      rows.push(
        ['DRONES DESTROYED', String(run.siege.kills)],
        ['CORE KILLS', String(run.siege.coreKills)],
        ['WEAK POINT KILLS', String(run.siege.weakPoints)],
        ['POINTS EARNED', run.siege.points.toLocaleString('en-US')],
        ['ACCURACY', accuracyText],
      );
    } else {
      rows.push(
        ['SCORE', scoring.score.toLocaleString('en-US')],
        ['ACCURACY', accuracyText],
        ['HITS', `${scoring.shotsHit} / ${scoring.shotsFired}`],
        ['BEST COMBO', String(scoring.bestCombo)],
        ['BULLSEYES', String(scoring.bullseyes)],
      );
    }
    this.render('results', 'center', `
      <h2>${END_TITLES[run.reason]}</h2>
      <div class="hint">${MODE_NAMES[run.mode]}</div>
      ${run.newBest ? '<div class="new-best">NEW BEST</div>' : ''}
      ${run.siege?.mostKills ? '<div class="new-best">MOST KILLS YET</div>' : ''}
      <table>${rows.map(([a, b]) => `<tr><td>${a}</td><td class="big">${b}</td></tr>`).join('')}</table>
      ${haul ? quartermasterReport(haul) : ''}
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
    // The Quartermaster's bar fills from where it was to where this run took it.
    const fill = this.root.querySelector<HTMLElement>('.qm-bar b');
    if (fill) requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.width = fill.dataset.to!)));
  }
}

// The results' Quartermaster panel: the level, what this run added, the bar toward the
// next perk (filling up as it shows), and any perk this run unlocked.
function quartermasterReport(haul: SalvageSummary) {
  const before = quartermasterLevel(haul.lifetimeBefore);
  const level = quartermasterLevel(haul.lifetimeAfter);
  const next = nextPerk(haul.lifetimeAfter);
  const floor = level === 0 ? 0 : CONFIG.salvage.quartermaster[level - 1];
  const share = (total: number) => (next ? Math.max(0, Math.min(1, (total - floor) / (next.needed - floor))) : 1);
  const from = before === level ? share(haul.lifetimeBefore) : 0;
  const insured = haul.counted - haul.banked;
  const unlocked = PERKS.slice(before, level)
    .map((p) => `<div class="qm-unlock"><span>UNLOCKED</span> ${p.name} <small>${p.blurb}</small></div>`)
    .join('');
  return `<div class="quartermaster">
    <div class="qm-top"><span>QUARTERMASTER</span><span class="qm-level">LEVEL ${level}</span></div>
    <div class="qm-added">+${haul.counted.toLocaleString('en-US')} TO YOUR LIFETIME TOTAL${insured > 0 ? ` <small>(${insured.toLocaleString('en-US')} INSURANCE)</small>` : ''}</div>
    <div class="qm-bar"><b style="width:${(from * 100).toFixed(1)}%" data-to="${(share(haul.lifetimeAfter) * 100).toFixed(1)}%"></b></div>
    <div class="qm-next">${next ? `${haul.lifetimeAfter.toLocaleString('en-US')} / ${next.needed.toLocaleString('en-US')} · NEXT: ${next.perk.name}` : `${haul.lifetimeAfter.toLocaleString('en-US')} · EVERY PERK UNLOCKED`}</div>
    ${unlocked}
  </div>`;
}

