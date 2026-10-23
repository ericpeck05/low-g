import * as THREE from 'three';
import { CONFIG } from '../config';
import { formatTime } from '../core/highScores';
import { MODE_NAMES, type Mode } from '../core/session';
import type { Oxygen } from '../player/oxygen';
import type { Player } from '../player/player';
import type { Scoring } from '../targets/scoring';
import type { Gun } from '../weapons/gun';
import { fireModeLabel } from '../weapons/weaponSpec';
import './theme.css';
import './hud.css';

// Everything the HUD shows, gathered each frame by main.ts.
export interface HudState {
  dt: number;
  player: Player;
  gun: Gun; // the gun in hand
  scope: { blend: number; style: 'cross' | 'ring' } | null; // looking through a magnified scope
  scoring: Scoring;
  oxygen: Oxygen;
  inside: boolean; // breathing dome air
  mode: Mode;
  timeLeft: number | null; // time trial countdown
  survived: number | null; // oxygen run clock
  drainPerSecond: number; // how fast oxygen is going outside right now
  spread: number; // degrees
  fov: number;
  heading: number; // compass degrees, 0 = north (toward -z), 90 = east
  mouse: { x: number; y: number };
  showStats: boolean;
  frameTime: number; // seconds the last frame really took (dt is capped, this isn't)
  siege: SiegeReadout | null; // Drone Siege's points, weapon slots and buy prompt (Salvage Run uses its slots and prompt)
  salvage: SalvageReadout | null; // Salvage Run's haul and storm clock
  render: { calls: number; triangles: number; width: number; height: number; quality: string };
}

/** Drone Siege's extra readouts. */
export interface SiegeReadout {
  points: number;
  kills: number;
  slots: (Gun | null)[];
  slot: number; // which one is in hand
  /** At something you can use (a station, a terminal...): what it offers, its price, and why not if you can't. hold: E is held, not pressed. */
  prompt: { text: string; price: number | null; affordable: boolean; note?: string; hold?: boolean } | null;
}

/** Salvage Run's readouts in the HUD's own panels. */
export interface SalvageReadout {
  banked: number;
  carried: number;
  load: string; // LIGHT, MEDIUM, HEAVY or OVERLOADED
  burden: number; // 0 to 1: how far toward the most a load can slow you
  caches: number; // opened
  cachesTotal: number;
  kills: number;
  timeLeft: number; // seconds to the storm
  stormHit: boolean;
}

const COMPASS_PX_PER_DEGREE = 3;
const OXYGEN_SEGMENTS = 20;
const FUEL_SEGMENTS = 12;

// The in-game overlay, styled as readouts on the inside of a helmet visor.
export class Hud {
  private root: HTMLElement;
  private sway: HTMLElement;
  private el: Record<string, HTMLElement> = {};
  private oxygenBar: HTMLElement[];
  private fuelBar: HTMLElement[];
  private pips: HTMLElement[] = [];
  private toastTimer = 0;
  private hitmarkerTime = 0;
  private swayOffset = new THREE.Vector2();
  private shown = { ammo: -1, reserve: -1, oxygen: -1, fuel: -1, weapon: '', slots: '', prompt: '' };
  private frameTimes: number[] = [];

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="visor"></div>
      <div class="hypoxia"></div>
      <div class="scope"><div class="dot"></div></div>
      <div class="hud-sway">
        <div class="hud-top">
          <div class="compass"><div class="strip"></div><div class="needle"></div></div>
          <div class="timer-label"></div>
          <div class="timer"></div>
        </div>
        <div class="hud-left">
          <div class="panel cut status">
            <div class="label">ENVIRONMENT</div>
            <div class="place"><span class="dot"></span><span class="where"></span></div>
            <div class="sub pressure"></div>
          </div>
          <div class="stack">
            <div class="panel cut oxygen">
              <div class="row"><span class="label">OXYGEN</span><span class="value o2">100</span></div>
              <div class="bar o2bar"></div>
              <div class="sub o2sub"></div>
            </div>
            <div class="panel cut fuel">
              <div class="row"><span class="label">JETPACK</span><span class="label fuelpct">100%</span></div>
              <div class="bar amber fuelbar"></div>
            </div>
          </div>
        </div>
        <div class="hud-right">
          <div class="panel cut score">
            <div class="label score-label">SCORE</div>
            <div class="value points">0</div>
            <div class="combo"></div>
            <div class="meter"><div></div></div>
            <div class="sub accuracy"></div>
          </div>
          <div class="panel cut ammo">
            <div class="row"><span class="label weapon">RIFLE &middot; AUTO</span></div>
            <div class="value rounds">30 <small>/ 30</small></div>
            <div class="pips"></div>
            <div class="state"></div>
            <div class="reload"><div></div></div>
            <div class="slots"></div>
          </div>
        </div>
      </div>
      <div class="crosshair">
        <div class="dot"></div><div class="h l"></div><div class="h r"></div>
        <div class="v t"></div><div class="v b"></div>
      </div>
      <div class="hitmarker"><div></div><div></div><div></div><div></div></div>
      <div class="popups"></div>
      <div class="warning">LOW OXYGEN</div>
      <div class="prompt"></div>
      <div class="toast"></div>
      <div class="stats"></div>`;
    document.body.appendChild(this.root);

    const names = [
      'sway:.hud-sway', 'strip:.compass .strip', 'timer:.timer', 'timerLabel:.timer-label',
      'status:.status', 'where:.where', 'pressure:.pressure',
      'oxygen:.oxygen', 'o2:.o2', 'o2sub:.o2sub', 'fuel:.fuel', 'fuelpct:.fuelpct',
      'score:.hud-right .score', 'scoreLabel:.score-label', 'points:.points', 'combo:.combo', 'meter:.meter div', 'accuracy:.accuracy',
      'ammo:.ammo', 'weapon:.ammo .weapon', 'rounds:.rounds', 'pips:.pips', 'state:.state', 'reload:.reload div', 'slots:.slots', 'prompt:.prompt',
      'crosshair:.crosshair', 'l:.crosshair .l', 'r:.crosshair .r', 't:.crosshair .t', 'b:.crosshair .b',
      'hitmarker:.hitmarker', 'popups:.popups', 'warning:.warning', 'toast:.toast', 'hypoxia:.hypoxia', 'scope:.scope', 'stats:.stats',
    ];
    for (const entry of names) {
      const [name, selector] = entry.split(':');
      this.el[name] = this.root.querySelector<HTMLElement>(selector)!;
    }
    this.sway = this.el.sway;
    this.oxygenBar = this.segments(this.root.querySelector('.o2bar')!, OXYGEN_SEGMENTS);
    this.fuelBar = this.segments(this.root.querySelector('.fuelbar')!, FUEL_SEGMENTS);
    this.buildPips(CONFIG.rifle.magazineSize);
    this.buildCompass();

    // The hit marker is an X: four short lines angled out from the center.
    this.el.hitmarker.querySelectorAll('div').forEach((line, i) => {
      line.style.transform = `rotate(${45 + i * 90}deg) translateX(14px)`;
    });
  }

  setVisible(visible: boolean) {
    this.root.style.display = visible ? 'block' : 'none';
  }

  /** Add a readout panel above oxygen (for a mode's own readouts, like suit integrity). */
  addPanel(panel: HTMLElement) {
    this.root.querySelector('.hud-left .stack')!.prepend(panel);
  }

  /** Add a strip just under the compass (it moves with the visor). */
  addUnderCompass(element: HTMLElement) {
    this.root.querySelector('.hud-top .compass')!.after(element);
  }

  /** A quick pulse on the score panel (Salvage Run: a haul banked). */
  flashScore() {
    const panel = this.root.querySelector('.hud-right .score')!;
    panel.classList.remove('flash');
    void (panel as HTMLElement).offsetWidth; // restart the animation
    panel.classList.add('flash');
  }

  /** Add a full-screen layer across the visor, under the readouts. */
  addOverlay(layer: Element) {
    this.root.insertBefore(layer, this.sway);
  }

  /** Flash the hit marker without a points popup. strong: amber, for a weak-point hit. */
  flashHitmarker(strong: boolean) {
    this.hitmarkerTime = 0.18;
    this.el.hitmarker.classList.toggle('bullseye', strong);
  }

  /** Points earned, floating up from the crosshair. strong: a kill. */
  showPoints(points: number, label: string, strong: boolean) {
    if (points <= 0) return;
    this.showCallout(`+${points}${label ? ` ${label}` : ''}`, strong);
  }

  /** Float a short message above the crosshair, like the points popups. */
  showCallout(text: string, strong: boolean) {
    const popup = document.createElement('div');
    popup.className = strong ? 'popup bullseye' : 'popup';
    popup.textContent = text;
    this.el.popups.appendChild(popup);
    window.setTimeout(() => popup.remove(), 900);
  }

  showToast(text: string) {
    this.el.toast.textContent = text;
    this.el.toast.style.opacity = '1';
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.el.toast.style.opacity = '0'), 1600);
  }

  /** Flash the X around the crosshair and float the points (and any oxygen bonus) above it. */
  showHit(earned: number, label: string, bullseye: boolean, multiplier: number, oxygenBonus = 0) {
    this.hitmarkerTime = 0.18;
    this.el.hitmarker.classList.toggle('bullseye', bullseye);
    const popup = document.createElement('div');
    popup.className = bullseye ? 'popup bullseye' : 'popup';
    popup.textContent =
      `+${earned} ${label}${multiplier > 1 ? ` x${multiplier}` : ''}` + (oxygenBonus > 0 ? `   +${oxygenBonus} O2` : '');
    // Nudge sideways a little so rapid hits don't stack exactly on top of each other.
    popup.style.left = `${(Math.random() - 0.5) * 40}px`;
    this.el.popups.appendChild(popup);
    window.setTimeout(() => popup.remove(), 900);
  }

  update(s: HudState) {
    this.updateSway(s);
    this.updateCrosshair(s);
    this.updateCompass(s.heading);
    this.updateClock(s);
    this.updateEnvironment(s);
    this.updateOxygen(s);
    // In Drone Siege the air only matters outside: the oxygen readout shows when you're out or not full.
    this.el.oxygen.style.display = (s.mode === 'siege' || s.mode === 'salvage') && s.inside && s.oxygen.fraction > 0.999 ? 'none' : '';
    this.updateFuel(s);
    this.updateScore(s);
    this.updateAmmo(s);
    this.updateStats(s);
  }

  // The visor sits on your head, so its readouts lag a touch behind quick turns and jumps.
  private updateSway(s: HudState) {
    const target = new THREE.Vector2(-s.mouse.x * 0.35, -s.mouse.y * 0.35 + s.player.velocity.y * 1.2);
    target.clampLength(0, 14);
    this.swayOffset.lerp(target, Math.min(1, 6 * s.dt));
    this.sway.style.transform = `translate(${this.swayOffset.x.toFixed(1)}px, ${this.swayOffset.y.toFixed(1)}px)`;
  }

  private updateCrosshair(s: HudState) {
    // The gap matches where shots can actually land.
    const halfScreen = window.innerHeight / 2;
    const gap = 3 + (Math.tan(THREE.MathUtils.degToRad(s.spread)) / Math.tan(THREE.MathUtils.degToRad(s.fov / 2))) * halfScreen;
    this.el.l.style.left = `${-gap - 10}px`;
    this.el.r.style.left = `${gap}px`;
    this.el.t.style.top = `${-gap - 10}px`;
    this.el.b.style.top = `${gap}px`;
    // Aiming down sights uses the gun's own reticle instead; sprinting hides it too.
    const hidden = Math.max(s.gun.aimBlend * 1.5, s.player.sprinting ? 1 : 0);
    this.el.crosshair.style.opacity = String(Math.max(0, 1 - hidden));
    // Through a scope: the overlay fades in as the sights come all the way up.
    this.el.scope.style.opacity = s.scope ? s.scope.blend.toFixed(3) : '0';
    this.el.scope.classList.toggle('ring', s.scope?.style === 'ring');
    this.hitmarkerTime = Math.max(0, this.hitmarkerTime - s.dt);
    this.el.hitmarker.style.opacity = String(Math.min(1, this.hitmarkerTime / 0.08));
  }

  private updateCompass(heading: number) {
    const width = 380;
    const x = -(heading + 360) * COMPASS_PX_PER_DEGREE + width / 2;
    this.el.strip.style.transform = `translateX(${x.toFixed(1)}px)`;
  }

  private updateClock(s: HudState) {
    const { timer, timerLabel } = this.el;
    const show = s.timeLeft !== null || s.survived !== null || s.salvage !== null;
    timer.style.display = timerLabel.style.display = show ? 'block' : 'none';
    timer.classList.toggle('storm', s.salvage !== null && (s.salvage.stormHit || s.salvage.timeLeft <= 120));
    timer.classList.toggle('storm-close', s.salvage !== null && (s.salvage.stormHit || s.salvage.timeLeft <= 30));
    if (s.salvage) {
      // Salvage Run: the solar storm's countdown, warm-colored in its last two minutes.
      timerLabel.textContent = s.salvage.stormHit ? 'SOLAR STORM · RADIATION' : 'SOLAR STORM IN';
      timer.textContent = s.salvage.stormHit ? 'GET INSIDE' : formatTime(Math.ceil(s.salvage.timeLeft));
      timer.classList.remove('urgent');
    } else if (s.timeLeft !== null) {
      timerLabel.textContent = MODE_NAMES[s.mode];
      timer.textContent = formatTime(Math.ceil(s.timeLeft));
      timer.classList.toggle('urgent', s.timeLeft <= 10);
    } else if (s.survived !== null) {
      timerLabel.textContent = `${MODE_NAMES[s.mode]} · SURVIVED`;
      timer.textContent = formatTime(s.survived);
      timer.classList.remove('urgent');
    }
  }

  private updateEnvironment(s: HudState) {
    this.el.status.classList.toggle('vacuum', !s.inside);
    this.el.where.textContent = s.inside ? 'DOME: PRESSURIZED' : 'SURFACE: VACUUM';
    this.el.pressure.textContent = s.inside ? 'EXT PRESSURE 101.3 KPA' : 'EXT PRESSURE 0.0 KPA';
  }

  private updateOxygen(s: HudState) {
    const { oxygen } = s;
    const level = Math.ceil(oxygen.level);
    if (level !== this.shown.oxygen) {
      this.shown.oxygen = level;
      this.el.o2.textContent = String(level);
      this.fill(this.oxygenBar, oxygen.fraction);
    }
    this.el.oxygen.classList.toggle('low', oxygen.low);
    this.el.oxygen.querySelector('.o2bar')!.classList.toggle('warn', oxygen.low);
    if (s.inside) this.el.o2sub.textContent = oxygen.fraction >= 1 ? 'TANK FULL' : 'REFILLING FROM DOME';
    else {
      const left = s.drainPerSecond > 0 ? oxygen.level / s.drainPerSecond : 0;
      this.el.o2sub.textContent = `SUIT SUPPLY · ${formatTime(left)} LEFT`;
    }
    this.el.warning.style.display = oxygen.low && !s.inside ? 'block' : 'none';
    this.el.hypoxia.style.opacity = oxygen.low ? String((1 - oxygen.level / CONFIG.oxygen.lowWarning) * 0.9) : '0';
  }

  private updateFuel(s: HudState) {
    const jetpack = s.player.jetpack;
    const percent = Math.round(jetpack.fraction * 100);
    if (percent !== this.shown.fuel) {
      this.shown.fuel = percent;
      this.el.fuelpct.textContent = `${percent}%`;
      this.fill(this.fuelBar, jetpack.fraction);
      this.root.querySelector('.fuelbar')!.classList.toggle('warn', jetpack.fraction < 0.2);
    }
    this.el.fuel.classList.toggle('thrust', jetpack.thrusting);
  }

  private updateScore(s: HudState) {
    if (s.salvage) return this.updateHaul(s.salvage);
    this.el.score.classList.remove('haul');
    const { scoring } = s;
    const siege = s.siege !== null;
    this.el.scoreLabel.textContent = siege ? 'POINTS' : 'SCORE';
    this.el.points.textContent = (siege ? s.siege!.points : scoring.score).toLocaleString('en-US');
    this.el.combo.textContent = !siege && scoring.combo > 1 ? `COMBO ${scoring.combo} · x${scoring.multiplier}` : '';
    this.el.meter.parentElement!.style.visibility = siege ? 'hidden' : 'visible';
    // Progress toward the next multiplier step.
    const { comboStep, maxMultiplier } = CONFIG.scoring;
    const progress = scoring.multiplier >= maxMultiplier ? 1 : (scoring.combo % comboStep) / comboStep;
    this.el.meter.style.width = `${(progress * 100).toFixed(0)}%`;
    const accuracy = scoring.accuracy;
    const accuracyText = `ACCURACY ${accuracy === null ? '-' : `${accuracy.toFixed(0)}%`}`;
    this.el.accuracy.textContent = siege ? `DRONES ${s.siege!.kills} · ${accuracyText}` : `${accuracyText} · HITS ${scoring.shotsHit}`;
  }

  // Salvage Run: banked salvage is the score; under it, what you're carrying and how heavy it is.
  private updateHaul(h: SalvageReadout) {
    this.el.score.classList.add('haul');
    this.el.score.classList.toggle('overloaded', h.load === 'OVERLOADED');
    this.el.scoreLabel.textContent = 'BANKED SALVAGE';
    this.el.points.textContent = h.banked.toLocaleString('en-US');
    this.el.combo.textContent = h.carried > 0 ? `CARRYING ${h.carried.toLocaleString('en-US')} · ${h.load}` : 'CARRYING NOTHING';
    this.el.combo.classList.toggle('empty', h.carried <= 0);
    this.el.meter.parentElement!.style.visibility = 'visible';
    this.el.meter.style.width = `${(h.burden * 100).toFixed(0)}%`;
    this.el.accuracy.textContent = `CACHES ${h.caches}/${h.cachesTotal} · DRONES ${h.kills}`;
  }

  private updateAmmo(s: HudState) {
    const gun = s.gun;
    const spec = gun.spec;
    // A different gun in hand: new name, and pips for its magazine size.
    if (spec.id !== this.shown.weapon) {
      this.shown.weapon = spec.id;
      this.el.weapon.textContent = `${spec.name} · ${fireModeLabel(spec)}`;
      this.buildPips(spec.magazine);
      this.shown.ammo = -1;
    }
    if (gun.ammo !== this.shown.ammo || gun.reserve !== this.shown.reserve) {
      this.shown.ammo = gun.ammo;
      this.shown.reserve = gun.reserve;
      // Spare ammo after the slash; the range rifle never runs out, so it shows the magazine.
      const after = Number.isFinite(gun.reserve) ? gun.reserve : spec.magazine;
      this.el.rounds.innerHTML = `${gun.ammo} <small>/ ${after}</small>`;
      this.pips.forEach((pip, i) => pip.classList.toggle('spent', i >= gun.ammo));
    }
    const empty = gun.ammo === 0;
    this.el.ammo.classList.toggle('empty', empty);
    this.el.ammo.classList.toggle('low', gun.ammo > 0 && gun.ammo <= spec.magazine / 4);
    this.el.state.textContent = gun.reloading ? 'RELOADING' : empty ? (gun.reserve > 0 ? 'EMPTY · PRESS R' : 'OUT OF AMMO') : '';
    this.el.reload.style.width = gun.reloading ? `${(gun.reloadProgress * 100).toFixed(0)}%` : '0';
    this.updateSiege(s);
  }

  // Drone Siege: the two weapon slots, and what's for sale at the station you're facing.
  private updateSiege(s: HudState) {
    const siege = s.siege;
    const slots = siege
      ? siege.slots.map((gun, i) => `<span class="${i === siege.slot ? 'on' : ''}">${i + 1} ${gun ? gun.spec.name : '—'}</span>`).join('')
      : '';
    if (slots !== this.shown.slots) {
      this.shown.slots = slots;
      this.el.slots.innerHTML = slots;
      this.el.slots.classList.toggle('many', (siege?.slots.length ?? 0) > 2);
    }
    const prompt = siege?.prompt;
    const price = prompt && prompt.price !== null ? ` · <span class="${prompt.affordable ? 'price' : 'price short'}">${prompt.price}</span>` : '';
    const note = prompt?.note ? ` · <span class="note">${prompt.note}</span>` : '';
    const html = prompt ? `${prompt.hold ? 'HOLD' : 'PRESS'} E · ${prompt.text}${price}${note}` : '';
    if (html !== this.shown.prompt) {
      this.shown.prompt = html;
      this.el.prompt.innerHTML = html;
      this.el.prompt.style.display = html ? 'block' : 'none';
    }
  }

  private updateStats(s: HudState) {
    this.el.stats.style.display = s.showStats ? 'block' : 'none';
    this.frameTimes.push(s.frameTime);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    if (!s.showStats) return;
    const average = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    const worst = Math.max(...this.frameTimes); // the slowest of the last 60: shows stutters
    const p = s.player;
    const r = s.render;
    this.el.stats.textContent =
      `FPS ${Math.round(1 / average)}  (${(average * 1000).toFixed(1)} ms, worst ${(worst * 1000).toFixed(0)})\n` +
      `${r.quality} ${r.width}x${r.height}  ${r.calls} draws  ${Math.round(r.triangles / 1000)}k tris\n` +
      `speed  ${p.horizontalSpeed.toFixed(1)} m/s\n` +
      `height ${p.feet.y.toFixed(2)} m\n` +
      `vert   ${p.velocity.y >= 0 ? '+' : ''}${p.velocity.y.toFixed(2)} m/s\n` +
      `state  ${p.grounded ? 'ground' : 'air'}${p.crouched ? ' crouch' : ''}${p.sprinting ? ' sprint' : ''}${p.jetpack.thrusting ? ' thrust' : ''}`;
  }

  private segments(parent: HTMLElement, count: number) {
    parent.innerHTML = '<i></i>'.repeat(count);
    return [...parent.querySelectorAll<HTMLElement>('i')];
  }

  private fill(segments: HTMLElement[], fraction: number) {
    const on = Math.ceil(fraction * segments.length - 0.001);
    segments.forEach((segment, i) => segment.classList.toggle('on', i < on));
  }

  private buildPips(count: number) {
    this.el.pips.innerHTML = '<i></i>'.repeat(count);
    this.el.pips.classList.toggle('wide', count <= 12); // a few big rounds read better as wide pips
    this.pips = [...this.el.pips.querySelectorAll<HTMLElement>('i')];
  }

  // A strip of tick marks and headings, wider than a full turn so it can slide either way.
  private buildCompass() {
    const names: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    let html = '';
    for (let d = -360; d <= 720; d += 5) {
      const x = (d + 360) * COMPASS_PX_PER_DEGREE;
      const deg = ((d % 360) + 360) % 360;
      const major = deg % 15 === 0;
      html += `<div class="tick${major ? ' major' : ''}" style="left:${x}px"></div>`;
      if (names[deg] !== undefined) html += `<div class="mark cardinal" style="left:${x}px">${names[deg]}</div>`;
      else if (deg % 15 === 0) html += `<div class="mark" style="left:${x}px">${deg}</div>`;
    }
    this.el.strip.innerHTML = html;
  }
}
