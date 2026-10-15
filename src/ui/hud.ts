import * as THREE from 'three';
import { formatTime } from '../core/highScores';
import type { Oxygen } from '../player/oxygen';
import type { Player } from '../player/player';
import type { Scoring } from '../targets/scoring';
import type { Rifle } from '../weapons/rifle';

// The in-game overlay: crosshair, hit marker, ammo, jetpack fuel, score,
// timer, floating score popups, and a small debug panel for tuning movement.
const STYLE = `
  .hud { position: fixed; inset: 0; pointer-events: none; color: #f5f0e8;
         font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px;
         letter-spacing: 0.05em;
         /* A dark halo keeps text readable over the bright, sunlit ground. */
         text-shadow: 0 0 3px rgba(0,0,0,0.9), 0 0 1px #000; }
  .hud-fuel { position: absolute; left: 50%; bottom: 40px; transform: translateX(-50%);
              width: 260px; text-align: center; }
  .hud-fuel .bar { height: 8px; margin-top: 6px; border: 1px solid #f5f0e8; background: rgba(0,0,0,0.5); }
  .hud-fuel .fill { height: 100%; background: #ffa31a; }
  .hud-fuel.empty .fill { background: #ff5a1f; }
  .hud-toast { position: absolute; left: 50%; top: 40%; transform: translateX(-50%);
               transition: opacity 0.3s; opacity: 0; }
  .hud-debug { position: absolute; left: 16px; top: 16px; white-space: pre; color: #bdb6aa; font-size: 11px; }
  .hud-crosshair { position: absolute; left: 50%; top: 50%; transition: opacity 0.1s; }
  .hud-crosshair div { position: absolute; background: #f5f0e8; box-shadow: 0 0 2px #000; }
  .hud-crosshair .h { width: 10px; height: 2px; margin-top: -1px; }
  .hud-crosshair .v { width: 2px; height: 10px; margin-left: -1px; }
  .hud-crosshair .dot { width: 2px; height: 2px; margin: -1px 0 0 -1px; }
  .hud-hitmarker { position: absolute; left: 50%; top: 50%; opacity: 0; }
  .hud-hitmarker div { position: absolute; width: 12px; height: 2px; margin: -1px 0 0 -6px;
                       background: #f5f0e8; box-shadow: 0 0 2px #000; }
  .hud-hitmarker.bullseye div { background: #ffa31a; }
  .hud-popups { position: absolute; left: 50%; top: 50%; }
  .hud-popup { position: absolute; left: 0; top: -60px; transform: translateX(-50%);
               white-space: nowrap; text-align: center; font-size: 15px;
               text-shadow: 0 0 4px #000; animation: hud-rise 0.9s ease-out forwards; }
  .hud-popup.bullseye { color: #ffa31a; font-size: 18px; }
  @keyframes hud-rise { from { transform: translate(-50%, 0); opacity: 1; }
                        to { transform: translate(-50%, -40px); opacity: 0; } }
  .hud-ammo { position: absolute; right: 40px; bottom: 36px; text-align: right; }
  .hud-ammo .count { font-size: 40px; line-height: 1; }
  .hud-ammo .count.low { color: #ffa31a; }
  .hud-ammo .count.empty { color: #ff5a1f; }
  .hud-ammo .max { color: #bdb6aa; font-size: 16px; }
  .hud-ammo .status { height: 16px; margin-top: 6px; color: #ffa31a; }
  .hud-ammo .bar { height: 3px; width: 120px; margin-left: auto; margin-top: 4px; background: #333; }
  .hud-ammo .bar div { height: 100%; width: 0; background: #ffa31a; }
  .hud-score { position: absolute; right: 40px; top: 28px; text-align: right; }
  .hud-score .points { font-size: 34px; line-height: 1; }
  .hud-score .label { color: #bdb6aa; font-size: 11px; }
  .hud-score .combo { margin-top: 8px; font-size: 16px; color: #ffa31a; min-height: 20px; }
  .hud-score .accuracy { margin-top: 4px; color: #bdb6aa; }
  .hud-timer { position: absolute; left: 50%; top: 24px; transform: translateX(-50%);
               font-size: 32px; display: none; }
  .hud-timer.urgent { color: #ffa31a; }
  .hud-oxygen { position: absolute; left: 40px; bottom: 36px; width: 220px; }
  .hud-oxygen .row { display: flex; justify-content: space-between; align-items: baseline; }
  .hud-oxygen .value { font-size: 28px; }
  .hud-oxygen .bar { height: 10px; margin-top: 6px; border: 1px solid #f5f0e8; background: rgba(0,0,0,0.5); }
  .hud-oxygen .fill { height: 100%; background: #f5f0e8; }
  .hud-oxygen .env { margin-top: 6px; color: #bdb6aa; font-size: 11px; }
  .hud-oxygen.outside .env { color: #ffa31a; }
  .hud-oxygen.low .fill { background: #ff5a1f; }
  .hud-oxygen.low .value { color: #ff5a1f; animation: hud-blink 0.6s steps(2) infinite; }
  @keyframes hud-blink { 50% { opacity: 0.3; } }
  /* Edges of the view darken and warm up as the air runs out. */
  .hud-hypoxia { position: absolute; inset: 0; opacity: 0;
                 background: radial-gradient(ellipse at center, transparent 40%, rgba(120,30,0,0.85) 100%); }
`;

export class Hud {
  private root: HTMLElement;
  private fuel: HTMLElement;
  private fuelFill: HTMLElement;
  private toast: HTMLElement;
  private debug: HTMLElement;
  private crosshair: HTMLElement;
  private crosshairArms: { l: HTMLElement; r: HTMLElement; t: HTMLElement; b: HTMLElement };
  private hitmarker: HTMLElement;
  private popups: HTMLElement;
  private ammoCount: HTMLElement;
  private ammoMax: HTMLElement;
  private ammoStatus: HTMLElement;
  private reloadBar: HTMLElement;
  private scorePoints: HTMLElement;
  private scoreCombo: HTMLElement;
  private scoreAccuracy: HTMLElement;
  private timer: HTMLElement;
  private oxygen: HTMLElement;
  private oxygenValue: HTMLElement;
  private oxygenFill: HTMLElement;
  private oxygenEnv: HTMLElement;
  private hypoxia: HTMLElement;
  private toastTimer = 0;
  private hitmarkerTime = 0;

  constructor() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-crosshair">
        <div class="dot"></div><div class="h l"></div><div class="h r"></div>
        <div class="v t"></div><div class="v b"></div>
      </div>
      <div class="hud-hitmarker"><div></div><div></div><div></div><div></div></div>
      <div class="hud-popups"></div>
      <div class="hud-debug"></div>
      <div class="hud-toast"></div>
      <div class="hud-timer"></div>
      <div class="hud-score">
        <div class="label">SCORE</div><div class="points">0</div>
        <div class="combo"></div><div class="accuracy"></div>
      </div>
      <div class="hud-hypoxia"></div>
      <div class="hud-oxygen">
        <div class="row"><span>OXYGEN</span><span class="value">100</span></div>
        <div class="bar"><div class="fill"></div></div>
        <div class="env"></div>
      </div>
      <div class="hud-fuel">JETPACK<div class="bar"><div class="fill"></div></div></div>
      <div class="hud-ammo">
        <span class="count">30</span><span class="max"> / 30</span>
        <div class="status"></div><div class="bar"><div></div></div>
      </div>`;
    document.body.appendChild(this.root);

    const q = (selector: string) => this.root.querySelector<HTMLElement>(selector)!;
    this.fuel = q('.hud-fuel');
    this.fuelFill = q('.hud-fuel .fill');
    this.toast = q('.hud-toast');
    this.debug = q('.hud-debug');
    this.crosshair = q('.hud-crosshair');
    this.crosshairArms = { l: q('.hud-crosshair .l'), r: q('.hud-crosshair .r'), t: q('.hud-crosshair .t'), b: q('.hud-crosshair .b') };
    this.hitmarker = q('.hud-hitmarker');
    this.popups = q('.hud-popups');
    this.ammoCount = q('.hud-ammo .count');
    this.ammoMax = q('.hud-ammo .max');
    this.ammoStatus = q('.hud-ammo .status');
    this.reloadBar = q('.hud-ammo .bar div');
    this.scorePoints = q('.hud-score .points');
    this.scoreCombo = q('.hud-score .combo');
    this.scoreAccuracy = q('.hud-score .accuracy');
    this.timer = q('.hud-timer');
    this.oxygen = q('.hud-oxygen');
    this.oxygenValue = q('.hud-oxygen .value');
    this.oxygenFill = q('.hud-oxygen .fill');
    this.oxygenEnv = q('.hud-oxygen .env');
    this.hypoxia = q('.hud-hypoxia');

    // The hit marker is an X: four short lines angled out from the center.
    this.hitmarker.querySelectorAll('div').forEach((line, i) => {
      const angle = 45 + i * 90;
      line.style.transform = `rotate(${angle}deg) translateX(14px)`;
    });
  }

  setVisible(visible: boolean) {
    this.root.style.display = visible ? 'block' : 'none';
  }

  showToast(text: string) {
    this.toast.textContent = text;
    this.toast.style.opacity = '1';
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toast.style.opacity = '0'), 1500);
  }

  /** Flash the X around the crosshair and float the points (and any oxygen bonus) above it. */
  showHit(earned: number, label: string, bullseye: boolean, multiplier: number, oxygenBonus = 0) {
    this.hitmarkerTime = 0.18;
    this.hitmarker.classList.toggle('bullseye', bullseye);

    const popup = document.createElement('div');
    popup.className = bullseye ? 'hud-popup bullseye' : 'hud-popup';
    popup.textContent =
      `+${earned} ${label}${multiplier > 1 ? ` x${multiplier}` : ''}` + (oxygenBonus > 0 ? `   +${oxygenBonus} O2` : '');
    // Nudge sideways a little so rapid hits don't stack exactly on top of each other.
    popup.style.left = `${(Math.random() - 0.5) * 40}px`;
    this.popups.appendChild(popup);
    window.setTimeout(() => popup.remove(), 900);
  }

  /**
   * timeLeft: a countdown (time trial), or null. survived: a count-up (oxygen run), or null.
   * inside: whether the player is breathing dome air.
   */
  update(
    dt: number,
    player: Player,
    rifle: Rifle,
    scoring: Scoring,
    oxygen: Oxygen,
    inside: boolean,
    timeLeft: number | null,
    survived: number | null,
    spreadDegrees: number,
    fov: number,
    magazineSize: number,
  ) {
    // Crosshair: the gap matches where shots can actually land.
    const halfScreen = window.innerHeight / 2;
    const gap =
      3 + (Math.tan(THREE.MathUtils.degToRad(spreadDegrees)) / Math.tan(THREE.MathUtils.degToRad(fov / 2))) * halfScreen;
    const { l, r, t, b } = this.crosshairArms;
    l.style.left = `${-gap - 10}px`;
    r.style.left = `${gap}px`;
    t.style.top = `${-gap - 10}px`;
    b.style.top = `${gap}px`;
    // Aiming down sights uses the gun's own sight dot instead.
    this.crosshair.style.opacity = String(Math.max(0, 1 - rifle.aimBlend * 1.5));

    this.hitmarkerTime = Math.max(0, this.hitmarkerTime - dt);
    this.hitmarker.style.opacity = String(Math.min(1, this.hitmarkerTime / 0.08));

    // Ammo
    this.ammoCount.textContent = String(rifle.ammo);
    this.ammoMax.textContent = ` / ${magazineSize}`;
    this.ammoCount.classList.toggle('empty', rifle.ammo === 0);
    this.ammoCount.classList.toggle('low', rifle.ammo > 0 && rifle.ammo <= magazineSize / 4);
    this.ammoStatus.textContent = rifle.reloading ? 'RELOADING' : rifle.ammo === 0 ? 'PRESS R' : '';
    this.reloadBar.style.width = rifle.reloading ? `${(rifle.reloadProgress * 100).toFixed(0)}%` : '0';

    // Jetpack
    const fraction = player.jetpack.fraction;
    this.fuelFill.style.width = `${(fraction * 100).toFixed(1)}%`;
    this.fuel.classList.toggle('empty', fraction < 0.2);

    // Score
    this.scorePoints.textContent = scoring.score.toLocaleString('en-US');
    this.scoreCombo.textContent = scoring.combo > 1 ? `COMBO ${scoring.combo}  x${scoring.multiplier}` : '';
    const accuracy = scoring.accuracy;
    this.scoreAccuracy.textContent = `ACCURACY ${accuracy === null ? '-' : `${accuracy.toFixed(0)}%`}`;

    // Timer: counts down in the time trial, up in the oxygen run.
    this.timer.style.display = timeLeft === null && survived === null ? 'none' : 'block';
    if (timeLeft !== null) {
      this.timer.textContent = formatTime(Math.ceil(timeLeft));
      this.timer.classList.toggle('urgent', timeLeft <= 10);
    } else if (survived !== null) {
      this.timer.textContent = formatTime(survived);
      this.timer.classList.remove('urgent');
    }

    // Oxygen
    this.oxygenValue.textContent = String(Math.ceil(oxygen.level));
    this.oxygenFill.style.width = `${(oxygen.fraction * 100).toFixed(1)}%`;
    this.oxygen.classList.toggle('low', oxygen.low);
    this.oxygen.classList.toggle('outside', !inside);
    this.oxygenEnv.textContent = inside ? 'DOME AIR: REFILLING' : 'VACUUM: SUIT SUPPLY';
    this.hypoxia.style.opacity = oxygen.low ? String((1 - oxygen.level / 25) * 0.9) : '0';

    const feet = player.feet;
    this.debug.textContent =
      `SPEED  ${player.horizontalSpeed.toFixed(1)} m/s\n` +
      `HEIGHT ${feet.y.toFixed(2)} m\n` +
      `VERT   ${player.velocity.y >= 0 ? '+' : ''}${player.velocity.y.toFixed(2)} m/s\n` +
      `STATE  ${player.grounded ? 'GROUND' : 'AIR'}${player.crouched ? ' CROUCH' : ''}` +
      `${player.jetpack.thrusting ? ' THRUST' : ''}`;
  }
}
