import type { Player } from '../player/player';

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
  .hud-crosshair { position: absolute; left: 50%; top: 50%; width: 4px; height: 4px;
                   margin: -2px 0 0 -2px; background: #f5f0e8; }
`;

const CONTROLS: [string, string][] = [
  ['W A S D', 'move'],
  ['MOUSE', 'look'],
  ['SPACE', 'jump'],
  ['HOLD SPACE', 'jetpack (in the air)'],
  ['SHIFT', 'sprint'],
  ['C / CTRL', 'crouch'],
  ['[  ]', 'mouse sensitivity'],
  ['ESC', 'release mouse'],
];

export class Hud {
  private start: HTMLElement;
  private fuel: HTMLElement;
  private fuelFill: HTMLElement;
  private toast: HTMLElement;
  private debug: HTMLElement;
  private toastTimer = 0;

  constructor(onStartClick: () => void) {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.className = 'hud';
    root.innerHTML = `
      <div class="hud-crosshair"></div>
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

  update(player: Player) {
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
