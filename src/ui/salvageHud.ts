import * as THREE from 'three';
import { CONFIG } from '../config';
import { KIND_CSS, type Site } from '../salvage/sites';
import type { Hud } from './hud';
import './salvageHud.css';

// Salvage Run's own readouts: the threat panel (level pips and the heat bar), markers
// under the compass for the caches and airlocks, a ring round the crosshair while you
// hold E, a banner across the visor for the big moments, and the radiation creeping into
// the visor as the storm closes in. The haul and the storm clock use the HUD's own panels.

const PX_PER_DEGREE = 3; // the compass's scale
const HALF_WIDTH = 190; // half the compass's width, in pixels
const HEAT_SEGMENTS = 20;
const RING = 2 * Math.PI * 21; // the hold ring's circumference (radius 21)
const FOCUS_DEGREES = 12; // a marker this close to the middle of the compass gets its label

export interface SalvageHudState {
  dt: number;
  heading: number; // compass degrees, 0 = north (toward -z)
  feet: THREE.Vector3;
  sites: Site[];
  scanner: boolean; // cache values on the compass
  inside: boolean;
  level: number; // threat, 1 to 5
  heat: number; // 0 to 100
  stormFloor: boolean; // the storm is holding the threat up
  holdProgress: number | null;
  radiation: number; // 0 to 1
  medicReady: boolean;
}

export class SalvageHud {
  private panel: HTMLElement;
  private pips: HTMLElement[];
  private heatBar: HTMLElement[];
  private levelText: HTMLElement;
  private heatNote: HTMLElement;
  private markers: HTMLElement;
  private siteMarks: HTMLElement[] = [];
  private airlockMarks: HTMLElement[] = [];
  private ring: HTMLElement;
  private ringArc: SVGCircleElement;
  private bannerBox: HTMLElement;
  private bannerTitle: HTMLElement;
  private bannerSubtitle: HTMLElement;
  private bannerTime = 0;
  private radiation: HTMLElement;
  private shown = { level: -1, heat: -1, note: '' };
  private airlocks = CONFIG.city.airlockBearings.map((bearing) => {
    const b = THREE.MathUtils.degToRad(bearing);
    const R = CONFIG.city.domeRadius + 9;
    return { name: bearing === 180 ? 'N' : 'S', position: new THREE.Vector3(Math.sin(b) * R, 0, Math.cos(b) * R) };
  });

  constructor(private hud: Hud) {
    this.panel = document.createElement('div');
    this.panel.className = 'panel cut salvage-threat';
    this.panel.innerHTML = `
      <div class="row"><span class="label">THREAT</span><span class="label level"></span></div>
      <div class="threat-pips">${'<i></i>'.repeat(5)}</div>
      <div class="row heat-row"><span class="label">HEAT</span><span class="label heat-note"></span></div>
      <div class="bar heat-bar">${'<i></i>'.repeat(HEAT_SEGMENTS)}</div>`;
    this.pips = [...this.panel.querySelectorAll<HTMLElement>('.threat-pips i')];
    this.heatBar = [...this.panel.querySelectorAll<HTMLElement>('.heat-bar i')];
    this.levelText = this.panel.querySelector('.level')!;
    this.heatNote = this.panel.querySelector('.heat-note')!;
    hud.addPanel(this.panel);
    // Below the suit readout (panels are added at the top of the stack).
    this.panel.parentElement!.querySelector('.suit')?.after(this.panel);

    this.markers = document.createElement('div');
    this.markers.className = 'salvage-markers';
    hud.addUnderCompass(this.markers);
    for (const airlock of this.airlocks) {
      const mark = document.createElement('div');
      mark.className = 'smark airlock';
      mark.innerHTML = `<b>${airlock.name}</b><span></span>`;
      this.markers.appendChild(mark);
      this.airlockMarks.push(mark);
    }

    this.ring = document.createElement('div');
    this.ring.className = 'hold-ring';
    this.ring.innerHTML = `<svg viewBox="-26 -26 52 52"><circle class="track" r="21" /><circle class="arc" r="21" /></svg>`;
    this.ringArc = this.ring.querySelector<SVGCircleElement>('.arc')!;
    this.ringArc.style.strokeDasharray = `${RING}`;
    hud.addOverlay(this.ring);

    this.bannerBox = document.createElement('div');
    this.bannerBox.className = 'salvage-banner';
    this.bannerBox.innerHTML = `<div class="title"></div><div class="subtitle"></div>`;
    this.bannerTitle = this.bannerBox.querySelector('.title')!;
    this.bannerSubtitle = this.bannerBox.querySelector('.subtitle')!;
    hud.addOverlay(this.bannerBox);

    this.radiation = document.createElement('div');
    this.radiation.className = 'radiation';
    this.radiation.style.backgroundImage = `radial-gradient(ellipse 70% 75% at 50% 50%, transparent 35%, rgba(255, 110, 20, 0.35) 80%, rgba(255, 70, 10, 0.75) 100%), url(${grain()})`;
    hud.addOverlay(this.radiation);
    this.setActive(false);
  }

  setActive(active: boolean) {
    this.panel.style.display = active ? 'block' : 'none';
    this.markers.style.display = active ? 'block' : 'none';
    this.ring.style.opacity = '0';
    this.radiation.style.opacity = '0';
    this.radiation.style.display = active ? 'block' : 'none';
    this.bannerBox.style.opacity = '0';
    this.bannerTime = 0;
    this.shown = { level: -1, heat: -1, note: '' };
  }

  /** A big message across the visor for a few seconds. */
  banner(title: string, subtitle = '', seconds = 2.4) {
    this.bannerTitle.textContent = title;
    this.bannerSubtitle.textContent = subtitle;
    // Threats and the storm are hostile red-orange; good news is amber.
    const hostile = /THREAT|ALARM|STRIKE|STORM/.test(title);
    this.bannerBox.classList.toggle('hostile', hostile);
    this.bannerBox.style.opacity = '1';
    this.bannerTime = seconds;
  }

  /** A haul banked: the score panel pulses. */
  banked(_amount: number) {
    this.hud.flashScore();
  }

  /** Salvage picked up (a cache opened). */
  carried() {
    this.markers.classList.remove('ping');
    void this.markers.offsetWidth;
    this.markers.classList.add('ping');
  }

  update(s: SalvageHudState) {
    if (this.bannerTime > 0) {
      this.bannerTime -= s.dt;
      if (this.bannerTime <= 0) this.bannerBox.style.opacity = '0';
    }
    this.updateThreat(s);
    this.updateMarkers(s);
    // The hold ring fills as the cache opens.
    const holding = s.holdProgress !== null;
    this.ring.style.opacity = holding ? '1' : '0';
    if (holding) this.ringArc.style.strokeDashoffset = `${(RING * (1 - s.holdProgress!)).toFixed(1)}`;
    // Radiation: a warm haze and grain creeping in from the edges, flickering harder as it builds.
    this.radiation.style.opacity = s.radiation.toFixed(3);
    this.radiation.classList.toggle('strong', s.radiation > 0.6);
  }

  private updateThreat(s: SalvageHudState) {
    if (s.level !== this.shown.level) {
      this.shown.level = s.level;
      this.levelText.textContent = `LEVEL ${s.level}`;
      this.pips.forEach((pip, i) => pip.classList.toggle('on', i < s.level));
      this.panel.classList.remove('rise');
      void this.panel.offsetWidth;
      this.panel.classList.add('rise');
    }
    const heat = Math.round(s.heat);
    if (heat !== this.shown.heat) {
      this.shown.heat = heat;
      const on = Math.ceil((s.heat / 100) * HEAT_SEGMENTS - 0.001);
      this.heatBar.forEach((segment, i) => segment.classList.toggle('on', i < on));
    }
    const note = s.inside ? 'COOLING · SAFE' : s.stormFloor ? 'STORM IS CLOSE' : 'RISING';
    if (note !== this.shown.note) {
      this.shown.note = note;
      this.heatNote.textContent = note;
      this.panel.classList.toggle('cool', s.inside);
    }
  }

  // Each marker sits where its cache or airlock is on the compass, if it's in view. Only the
  // one nearest the middle is labeled (what it is, how far, and its value with the scanner),
  // so the labels never pile up.
  private updateMarkers(s: SalvageHudState) {
    while (this.siteMarks.length < s.sites.length) {
      const mark = document.createElement('div');
      mark.innerHTML = '<i></i><span></span>';
      this.markers.appendChild(mark);
      this.siteMarks.push(mark);
    }
    const focus = { mark: null as HTMLElement | null, delta: FOCUS_DEGREES, text: '' };
    const consider = (mark: HTMLElement, delta: number, text: string) => {
      if (Math.abs(delta) >= focus.delta) return;
      focus.mark = mark;
      focus.delta = Math.abs(delta);
      focus.text = text;
    };
    this.siteMarks.forEach((mark, k) => {
      const site = s.sites[k];
      const placed = site && !site.opened ? this.place(site.position, s) : null;
      if (!placed || Math.abs(placed.delta) > 64) {
        mark.style.display = 'none';
        return;
      }
      mark.style.display = 'block';
      mark.className = `smark cache ${site.kind}`;
      mark.style.transform = `translateX(${placed.x.toFixed(1)}px)`;
      (mark.firstElementChild as HTMLElement).style.background = KIND_CSS[site.kind];
      const value = s.scanner ? ` · ${site.value}` : '';
      consider(mark, placed.delta, `${CONFIG.salvage.caches[site.kind].name}${value} · ${Math.round(placed.distance)}M`);
    });
    this.airlocks.forEach((airlock, k) => {
      const mark = this.airlockMarks[k];
      const placed = this.place(airlock.position, s);
      const show = !s.inside && Math.abs(placed.delta) <= 64;
      mark.style.display = show ? 'block' : 'none';
      if (!show) return;
      mark.style.transform = `translateX(${placed.x.toFixed(1)}px)`;
      consider(mark, placed.delta, `AIRLOCK ${airlock.name} · ${Math.round(placed.distance)}M`);
    });
    for (const mark of [...this.siteMarks, ...this.airlockMarks]) {
      const label = mark.lastElementChild as HTMLElement;
      const text = focus.mark === mark ? focus.text : '';
      if (label.textContent !== text) label.textContent = text;
    }
  }

  private place(position: THREE.Vector3, s: SalvageHudState) {
    const dx = position.x - s.feet.x;
    const dz = position.z - s.feet.z;
    const bearing = THREE.MathUtils.radToDeg(Math.atan2(dx, -dz));
    const delta = ((((bearing - s.heading) % 360) + 540) % 360) - 180;
    return { x: HALF_WIDTH + delta * PX_PER_DEGREE, delta, distance: Math.hypot(dx, dz) };
  }
}

// A tile of fine grain for the radiation overlay (made once, as a data URL).
function grain() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const bright = Math.random() < 0.06 ? 255 : 0;
    image.data[i * 4] = 255;
    image.data[i * 4 + 1] = 190;
    image.data[i * 4 + 2] = 120;
    image.data[i * 4 + 3] = bright ? 90 + Math.random() * 120 : 0;
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL();
}
