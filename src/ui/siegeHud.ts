import { CONFIG } from '../config';
import { iconUrl } from '../siege/icons';
import { MOD_IDS, type ModId } from '../siege/mods';
import { POWER_UP_NAMES } from '../siege/powerUps';
import type { Hud } from './hud';
import './siegeHud.css';

// Drone Siege's progression readouts: a panel under suit integrity with the city's power
// and your suit mods (four slots), and the timed power-ups running, with their countdowns,
// across the top of the visor.

export class SiegeHud {
  private panel: HTMLElement;
  private power: HTMLElement;
  private slots: HTMLElement[] = [];
  private timers: HTMLElement;
  private shownMods = '';
  private shownTimers = '';
  private shownPower: boolean | null = null;

  constructor(hud: Hud) {
    this.panel = document.createElement('div');
    this.panel.className = 'panel cut siege-mods';
    this.panel.innerHTML = `
      <div class="row"><span class="label">SUIT MODS</span><span class="label power"></span></div>
      <div class="mod-slots">${'<span></span>'.repeat(CONFIG.siege.mods.max)}</div>`;
    this.power = this.panel.querySelector('.power')!;
    this.slots = [...this.panel.querySelectorAll<HTMLElement>('.mod-slots span')];
    hud.addPanel(this.panel);
    // Below the suit readout (panels are added at the top of the stack).
    const suit = this.panel.parentElement!.querySelector('.suit');
    suit?.after(this.panel);
    this.timers = document.createElement('div');
    this.timers.className = 'powerup-timers';
    hud.addOverlay(this.timers);
    this.setActive(false);
  }

  setActive(active: boolean) {
    this.panel.style.display = active ? 'block' : 'none';
    this.timers.style.display = active ? 'flex' : 'none';
    this.shownMods = '';
    this.shownTimers = '';
    this.shownPower = null;
  }

  update(state: { powered: boolean; mods: Set<ModId>; timers: { doublePoints: number; oneShot: number } }) {
    if (state.powered !== this.shownPower) {
      this.shownPower = state.powered;
      this.power.textContent = state.powered ? 'POWER ON' : 'POWER OFF';
      this.power.classList.toggle('off', !state.powered);
    }
    const owned = MOD_IDS.filter((id) => state.mods.has(id));
    const key = owned.join(',');
    if (key !== this.shownMods) {
      this.shownMods = key;
      this.slots.forEach((slot, i) => {
        const id = owned[i];
        slot.innerHTML = id ? `<img src="${iconUrl(id)}" alt="" />` : '';
        slot.title = id ? CONFIG.siege.mods[id].name : '';
        slot.classList.toggle('filled', Boolean(id));
      });
    }
    const running = (['doublePoints', 'oneShot'] as const).filter((k) => state.timers[k] > 0);
    const html = running
      .map((k) => {
        const left = state.timers[k];
        const ending = left < 5 ? ' ending' : '';
        return `<div class="powerup${ending}"><img src="${iconUrl(k, '#fff1dc')}" alt="" /><span>${POWER_UP_NAMES[k]}</span><b>${Math.ceil(left)}</b></div>`;
      })
      .join('');
    if (html !== this.shownTimers) {
      this.shownTimers = html;
      this.timers.innerHTML = html;
    }
  }
}
