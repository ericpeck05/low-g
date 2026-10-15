import * as THREE from 'three';
import type { Player } from '../player/player';
import type { Rifle } from '../weapons/rifle';

// The on-screen overlay: start/pause screen, jetpack fuel bar,
// a sensitivity readout, and a small debug panel for tuning movement.
const STYLE = `
  .hud { position: fixed; inset: 0; pointer-events: none; color: #f5f0e8;
         font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px;
         letter-spacing: 0.05em; }
  .hud-start { position: absolute; inset: 0; display: flex; flex-direction: column;
               align-items: center; justify-content: center; gap: 18px;
               background: rgba(0,0,0,0.6); pointer-events: auto; cursor: pointer; }
  .hud-start h1 { margin: 0; font-size: 56px; letter-spacing: 0.3em; color: #ffa31a; }
  .hud-start .prompt { font-size: 16px; }
  .hud-start table { border-collapse: collapse; color: #bdb6aa; }
  .hud-start td { padding: 2px 12px; }
  .hud-start td:first-child { text-align: right; color: #ffa31a; }
  .hud-fuel { position: absolute; left: 50%; bottom: 40px; transform: translateX(-50%);
              width: 260px; text-align: center; }
  .hud-fuel .bar { height: 8px; margin-top: 6px; border: 1px solid #f5f0e8; }
  .hud-fuel .fill { height: 100%; background: #ffa31a; }
  .hud-fuel.empty .fill { background: #ff5a1f; }
  .hud-toast { position: absolute; left: 50%; top: 40%; transform: translateX(-50%);
               transition: opacity 0.3s; opacity: 0; }
  .hud-debug { position: absolute; left: 16px; top: 16px; white-space: pre; color: #bdb6aa; }
  .hud-crosshair { position: absolute; left: 50%; top: 50%; transition: opacity 0.1s; }
  .hud-crosshair div { position: absolute; background: #f5f0e8; box-shadow: 0 0 2px #000; }
  .hud-crosshair .h { width: 10px; height: 2px; margin-top: -1px; }
  .hud-crosshair .v { width: 2px; height: 10px; margin-left: -1px; }
  .hud-crosshair .dot { width: 2px; height: 2px; margin: -1px 0 0 -1px; }
  .hud-ammo { position: absolute; right: 40px; bottom: 36px; text-align: right; }
  .hud-ammo .count { font-size: 40px; line-height: 1; }
  .hud-ammo .count.low { color: #ffa31a; }
  .hud-ammo .count.empty { color: #ff5a1f; }
  .hud-ammo .max { color: #8a8379; font-size: 16px; }
  .hud-ammo .status { height: 16px; margin-top: 6px; color: #ffa31a; }
  .hud-ammo .bar { height: 3px; width: 120px; margin-left: auto; margin-top: 4px; background: #333; }
  .hud-ammo .bar div { height: 100%; width: 0; background: #ffa31a; }
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
  ['ESC', 'release mouse'],
];

export class Hud {
  private start: HTMLElement;
  private fuel: HTMLElement;
  private fuelFill: HTMLElement;
  private toast: HTMLElement;
  private debug: HTMLElement;
  private crosshair: HTMLElement;
  private crosshairArms: { l: HTMLElement; r: HTMLElement; t: HTMLElement; b: HTMLElement };
  private ammoCount: HTMLElement;
  private ammoMax: HTMLElement;
  private ammoStatus: HTMLElement;
  private reloadBar: HTMLElement;
  private toastTimer = 0;

  constructor(onStartClick: () => void) {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.className = 'hud';
    root.innerHTML = `
      <div class="hud-crosshair">
        <div class="dot"></div><div class="h l"></div><div class="h r"></div>
        <div class="v t"></div><div class="v b"></div>
      </div>
      <div class="hud-ammo">
        <span class="count">30</span><span class="max"> / 30</span>
        <div class="status"></div><div class="bar"><div></div></div>
      </div>
      <div class="hud-debug"></div>
      <div class="hud-toast"></div>
      <div class="hud-fuel">JETPACK<div class="bar"><div class="fill"></div></div></div>
      <div class="hud-start">
        <h1>LOW-G</h1>
        <div class="prompt">CLICK TO PLAY</div>
        <table>${CONTROLS.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
      </div>`;
    document.body.appendChild(root);

    this.start = root.querySelector('.hud-start')!;
    this.fuel = root.querySelector('.hud-fuel')!;
    this.fuelFill = root.querySelector('.fill')!;
    this.toast = root.querySelector('.hud-toast')!;
    this.debug = root.querySelector('.hud-debug')!;
    this.crosshair = root.querySelector('.hud-crosshair')!;
    this.crosshairArms = {
      l: this.crosshair.querySelector('.l')!,
      r: this.crosshair.querySelector('.r')!,
      t: this.crosshair.querySelector('.t')!,
      b: this.crosshair.querySelector('.b')!,
    };
    this.ammoCount = root.querySelector('.hud-ammo .count')!;
    this.ammoMax = root.querySelector('.hud-ammo .max')!;
    this.ammoStatus = root.querySelector('.hud-ammo .status')!;
    this.reloadBar = root.querySelector('.hud-ammo .bar div')!;
    this.start.addEventListener('click', onStartClick);
  }

  setPaused(paused: boolean) {
    this.start.style.display = paused ? 'flex' : 'none';
  }

  showToast(text: string) {
    this.toast.textContent = text;
    this.toast.style.opacity = '1';
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toast.style.opacity = '0'), 1200);
  }

  // spreadDegrees and fov decide how far apart the crosshair arms sit, so the gap
  // on screen matches where shots can actually land.
  update(player: Player, rifle: Rifle, spreadDegrees: number, fov: number, magazineSize: number) {
    const halfScreen = window.innerHeight / 2;
    const gap =
      3 + (Math.tan(THREE.MathUtils.degToRad(spreadDegrees)) / Math.tan(THREE.MathUtils.degToRad(fov / 2))) * halfScreen;
    const { l, r, t, b } = this.crosshairArms;
    l.style.left = `${-gap - 10}px`;
    r.style.left = `${gap}px`;
    t.style.top = `${-gap - 10}px`;
    b.style.top = `${gap}px`;
    // Aiming down sights uses the gun's own sight dot instead.
    this.crosshair.style.opacity = String(1 - rifle.aimBlend * 1.5);

    this.ammoCount.textContent = String(rifle.ammo);
    this.ammoMax.textContent = ` / ${magazineSize}`;
    this.ammoCount.classList.toggle('empty', rifle.ammo === 0);
    this.ammoCount.classList.toggle('low', rifle.ammo > 0 && rifle.ammo <= magazineSize / 4);
    this.ammoStatus.textContent = rifle.reloading ? 'RELOADING' : rifle.ammo === 0 ? 'PRESS R' : '';
    this.reloadBar.style.width = rifle.reloading ? `${(rifle.reloadProgress * 100).toFixed(0)}%` : '0';

    const fraction = player.jetpack.fraction;
    this.fuelFill.style.width = `${(fraction * 100).toFixed(1)}%`;
    this.fuel.classList.toggle('empty', fraction < 0.2);

    const feet = player.feet;
    this.debug.textContent =
      `SPEED  ${player.horizontalSpeed.toFixed(1)} m/s\n` +
      `HEIGHT ${feet.y.toFixed(2)} m\n` +
      `VERT   ${player.velocity.y >= 0 ? '+' : ''}${player.velocity.y.toFixed(2)} m/s\n` +
      `STATE  ${player.grounded ? 'GROUND' : 'AIR'}${player.crouched ? ' CROUCH' : ''}` +
      `${player.jetpack.thrusting ? ' THRUST' : ''}`;
  }
}
