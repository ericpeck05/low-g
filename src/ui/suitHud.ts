import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Suit } from '../siege/suit';
import type { Hud } from './hud';
import './suit.css';

// Drone Siege's additions to the visor: the suit integrity readout, a red flash at the
// edges when you're hit, arcs around the crosshair pointing to where each shot came
// from, and cracks across the visor when integrity is low.

const SEGMENTS = 20;
const ARCS = 4;

interface Arc {
  element: SVGSVGElement;
  from: THREE.Vector3; // where the shot came from, in the world
  time: number; // seconds left on screen
}

export class SuitHud {
  private panel: HTMLElement;
  private value: HTMLElement;
  private sub: HTMLElement;
  private segments: HTMLElement[];
  private flash: HTMLElement;
  private cracks: SVGSVGElement;
  private arcs: Arc[] = [];
  private flashTime = 0;
  private cracked = false;
  private shownIntegrity = -1;

  constructor(hud: Hud) {
    this.panel = document.createElement('div');
    this.panel.className = 'panel cut suit';
    this.panel.innerHTML = `
      <div class="row"><span class="label">SUIT INTEGRITY</span><span class="value integrity">100</span></div>
      <div class="bar suitbar">${'<i></i>'.repeat(SEGMENTS)}</div>
      <div class="sub suitsub"></div>`;
    this.value = this.panel.querySelector('.integrity')!;
    this.sub = this.panel.querySelector('.suitsub')!;
    this.segments = [...this.panel.querySelectorAll<HTMLElement>('.suitbar i')];
    hud.addPanel(this.panel);

    // Layers across the visor: cracks under the flash, arcs around the crosshair.
    this.cracks = svg('svg', { class: 'visor-cracks', viewBox: '0 0 1600 900', preserveAspectRatio: 'xMidYMid slice' }) as SVGSVGElement;
    hud.addOverlay(this.cracks);
    this.flash = document.createElement('div');
    this.flash.className = 'damage-flash';
    hud.addOverlay(this.flash);
    const arcLayer = document.createElement('div');
    arcLayer.className = 'hit-arcs';
    for (let i = 0; i < ARCS; i++) {
      const element = svg('svg', { viewBox: '-120 -120 240 240', class: 'hit-arc' }) as SVGSVGElement;
      // A short curved stroke at the top of a ring; turning the ring points it.
      element.appendChild(svg('path', { d: 'M -42 -102 A 110 110 0 0 1 42 -102' }));
      arcLayer.appendChild(element);
      this.arcs.push({ element, from: new THREE.Vector3(), time: 0 });
    }
    hud.addOverlay(arcLayer);
    this.setActive(false);
  }

  /** Only Drone Siege has suit integrity. */
  setActive(active: boolean) {
    this.panel.style.display = active ? 'block' : 'none';
    if (!active) this.reset();
  }

  reset() {
    this.flashTime = 0;
    this.flash.style.opacity = '0';
    for (const arc of this.arcs) {
      arc.time = 0;
      arc.element.style.opacity = '0';
    }
    this.setCracked(false);
    this.shownIntegrity = -1;
  }

  /** A hit landed: flash the edges and point to where it came from. */
  hit(from: THREE.Vector3) {
    this.flashTime = CONFIG.siege.feedback.flashTime;
    const arc = this.arcs.reduce((oldest, a) => (a.time < oldest.time ? a : oldest));
    arc.from.copy(from);
    arc.time = CONFIG.siege.feedback.indicatorTime;
  }

  /** yaw: which way the player faces (the same yaw the camera uses). */
  update(dt: number, suit: Suit, feet: THREE.Vector3, yaw: number) {
    const integrity = Math.ceil(suit.integrity);
    if (integrity !== this.shownIntegrity) {
      this.shownIntegrity = integrity;
      this.value.textContent = String(integrity);
      const on = Math.ceil(suit.fraction * SEGMENTS - 0.001);
      this.segments.forEach((segment, i) => segment.classList.toggle('on', i < on));
    }
    this.panel.classList.toggle('low', suit.low);
    this.sub.textContent = suit.low
      ? 'CRITICAL · GET TO COVER'
      : suit.repairing
        ? 'SELF-SEALING · REPAIRING'
        : suit.fraction < 1
          ? 'DAMAGED'
          : 'NOMINAL';

    // Red at the edges, strongest right after a hit, plus a steady glow when critical.
    this.flashTime = Math.max(0, this.flashTime - dt);
    const pulse = this.flashTime / CONFIG.siege.feedback.flashTime;
    const critical = suit.low ? 0.25 + 0.1 * Math.sin(performance.now() / 160) : 0;
    this.flash.style.opacity = Math.max(pulse * 0.85, critical).toFixed(3);

    // The visor cracks when integrity drops low, and the cracks go once it's repaired.
    if (suit.low && !this.cracked) this.setCracked(true);
    if (this.cracked && suit.integrity > CONFIG.siege.suit.lowWarning + 15) this.setCracked(false);
    if (this.cracked) {
      const severity = 1 - suit.integrity / CONFIG.siege.suit.lowWarning;
      this.cracks.style.opacity = THREE.MathUtils.clamp(0.5 + severity * 0.5, 0.35, 1).toFixed(2);
    }

    // Each arc turns to keep pointing at where its shot came from as you turn.
    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    for (const arc of this.arcs) {
      if (arc.time <= 0) continue;
      arc.time -= dt;
      const toward = arc.from.clone().sub(feet).setY(0);
      const angle = Math.atan2(toward.dot(right), toward.dot(forward));
      arc.element.style.transform = `translate(-50%, -50%) rotate(${angle.toFixed(3)}rad)`;
      arc.element.style.opacity = Math.min(1, arc.time / 0.5).toFixed(2);
    }
  }

  private setCracked(cracked: boolean) {
    this.cracked = cracked;
    if (cracked) drawCracks(this.cracks);
    this.cracks.style.opacity = cracked ? '0.5' : '0';
  }
}

// Fresh cracks each time: two or three impact points near the visor's edges, each with
// jagged fractures running out from it and a small ring of shattering at the center.
function drawCracks(layer: SVGSVGElement) {
  layer.innerHTML = '';
  const corners = [
    [140, 140], [1460, 140], [140, 760], [1460, 760], [800, 70], [800, 830],
  ].sort(() => Math.random() - 0.5);
  const count = 2 + Math.floor(Math.random() * 2);
  for (let c = 0; c < count; c++) {
    const [cx, cy] = corners[c];
    const x = cx + (Math.random() - 0.5) * 200;
    const y = cy + (Math.random() - 0.5) * 140;
    const lines: string[] = [];
    const branches = 6 + Math.floor(Math.random() * 4);
    for (let b = 0; b < branches; b++) {
      let angle = (b / branches) * Math.PI * 2 + Math.random() * 0.5;
      let px = x;
      let py = y;
      const points = [`${px.toFixed(0)},${py.toFixed(0)}`];
      const pieces = 4 + Math.floor(Math.random() * 4);
      for (let k = 0; k < pieces; k++) {
        angle += (Math.random() - 0.5) * 0.7;
        const length = 25 + Math.random() * 70;
        px += Math.cos(angle) * length;
        py += Math.sin(angle) * length;
        points.push(`${px.toFixed(0)},${py.toFixed(0)}`);
      }
      lines.push(points.join(' '));
    }
    // The ring of tiny fractures around the impact point.
    const ring: string[] = [];
    for (let k = 0; k <= 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const r = 16 + Math.random() * 10;
      ring.push(`${(x + Math.cos(a) * r).toFixed(0)},${(y + Math.sin(a) * r).toFixed(0)}`);
    }
    lines.push(ring.join(' '));
    for (const line of lines) {
      layer.appendChild(svg('polyline', { points: line, class: 'shadow' }));
      layer.appendChild(svg('polyline', { points: line }));
    }
  }
}

function svg(tag: string, attributes: Record<string, string>) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}
