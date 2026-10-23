import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { announce } from '../audio/announcer';
import type { GameAudio } from '../audio/gameAudio';
import { CONFIG } from '../config';
import { formatTime } from '../core/highScores';
import type { Oxygen } from '../player/oxygen';
import type { Player } from '../player/player';
import type { SiegeMode } from '../siege/siege';
import type { Hud, SiegeReadout } from '../ui/hud';
import type { SalvageHud } from '../ui/salvageHud';
import type { Loadout } from '../weapons/loadout';
import { siegeWeapon } from '../weapons/weaponSpec';
import { SalvageDirector } from './director';
import { PERKS, type PerkId, hasPerk, loadRecord } from './quartermaster';
import { ShelterConsoles } from './shelter';
import { type Site, Sites } from './sites';

// Salvage Run (see SALVAGE_RUN.md): go out through the airlocks, crack open the wreckage
// strewn across the plain, and carry what you find back inside before the solar storm
// hits. What you carry only counts once you're through an airlock. This keeps the run's
// clock and tallies, opens caches, banks your haul, and hands out the Quartermaster's
// perks. The drones themselves are Drone Siege's, brought in by the director.

/** How a run ended, as far as Salvage Run is concerned. */
export type SalvageEnd = 'sheltered' | 'destroyed' | null;

interface Deps {
  scene: THREE.Scene;
  world: RAPIER.World;
  siege: SiegeMode;
  player: Player;
  oxygen: Oxygen;
  loadout: Loadout;
  audio: GameAudio;
  hud: Hud;
  salvageHud: SalvageHud;
}

/** What you're doing this frame, as the run needs to know it. */
export interface SalvageInput {
  feet: THREE.Vector3;
  look: THREE.Vector3; // the way you're facing
  inside: boolean; // breathing dome air (the dome or an airlock chamber)
  holdingUse: boolean; // E held down
}

const SPOKEN: Record<number, string> = { 120: 'two minutes', 60: 'one minute', 30: 'thirty seconds' };
const SHELTER_HOLD = 1.2; // seconds to hold E at a shelter console

export class SalvageRun {
  readonly sites: Sites;
  readonly director: SalvageDirector;
  readonly shelters: ShelterConsoles;
  active = false;
  timeLeft: number = CONFIG.salvage.stormTime; // seconds to the storm
  stormHit = false;
  banked = 0; // salvage safely inside: the score
  carried = 0; // salvage on you, lost if you go down
  lost = 0; // salvage that went down with you
  trips = 0; // times you came back in with something
  cachesOpened = 0;
  kills = 0;
  timeOutside = 0;
  level = 1; // threat level, 1 to 5
  perks = new Set<PerkId>();
  medicReady = false;
  private wasInside = true;
  private insideTime = 0;
  private target: Site | null = null; // the cache you're at
  private holding: Site | null = null; // the cache you're opening
  private atShelter = false;
  private shelterHold = 0;
  private needsRelease = false; // knocked off a cache (or just opened one): let go of E first
  private tickTimer = 0;
  private warned = 0; // how many storm warnings have sounded
  private shownLoad = 'LIGHT';

  constructor(private d: Deps) {
    this.sites = new Sites(d.scene, d.world);
    this.sites.setShown(false);
    this.director = new SalvageDirector(d.siege);
    this.shelters = new ShelterConsoles(d.scene, d.world);
  }

  /** The glowing parts, for leaving out of ambient occlusion. */
  get glowObjects() {
    return [...this.sites.glowObjects, ...this.shelters.glowObjects];
  }

  /** A new run (or, not active, clear it all away). Puts the Quartermaster's perks on you. */
  reset(active: boolean) {
    const s = CONFIG.salvage;
    this.active = active;
    this.sites.reset(active);
    this.sites.setShown(active);
    this.shelters.setActive(active);
    this.director.reset();
    this.timeLeft = s.stormTime;
    this.stormHit = false;
    this.banked = this.carried = this.lost = this.trips = this.cachesOpened = this.kills = 0;
    this.timeOutside = 0;
    this.level = 1;
    this.wasInside = true;
    this.insideTime = 0;
    this.target = this.holding = null;
    this.atShelter = false;
    this.shelterHold = 0;
    this.needsRelease = false;
    this.warned = 0;
    this.shownLoad = 'LIGHT';
    this.d.player.burden = 0;
    this.d.oxygen.capacity = CONFIG.oxygen.max;
    this.perks.clear();
    this.medicReady = false;
    if (!active) return;

    const lifetime = loadRecord().lifetime;
    for (const perk of PERKS) if (hasPerk(lifetime, perk.id)) this.perks.add(perk.id);
    if (this.perks.has('tank')) this.d.oxygen.capacity = CONFIG.oxygen.max * s.bigTank;
    this.d.oxygen.reset();
    const jetpack = this.d.player.jetpack;
    const thruster = CONFIG.siege.mods.thruster;
    jetpack.capacity = CONFIG.jetpack.maxFuel * (this.perks.has('thruster') ? thruster.fuel : 1);
    jetpack.rechargeScale = this.perks.has('thruster') ? thruster.recharge : 1;
    jetpack.fuel = jetpack.capacity;
    this.medicReady = this.perks.has('medic');
    this.d.salvageHud.banner('SALVAGE RUN', `SOLAR STORM IN ${formatTime(s.stormTime)} · BANK YOUR HAUL THROUGH AN AIRLOCK`, 5);
  }

  /** Show the caches for one frame at load, so their shaders compile then. */
  showForWarmUp(shown: boolean) {
    this.sites.reset(shown);
    this.sites.setShown(shown);
    this.shelters.setActive(shown);
  }

  /** The guns a run starts with: a sidearm and a burst carbine (and the SMG, once the Quartermaster has one for you). */
  startingGuns() {
    return [siegeWeapon('sidearm'), siegeWeapon('carbine'), ...(this.perks.has('smg') ? [siegeWeapon('smg')] : [])];
  }

  /** How much what you're carrying slows you (0 to CONFIG.salvage.maxSlow). */
  get burden() {
    const s = CONFIG.salvage;
    return Math.min(s.maxSlow, (this.carried / 1000) * s.weightPer1000);
  }

  get loadName() {
    const [medium, heavy, over] = CONFIG.salvage.loads;
    const c = this.carried;
    return c >= over ? 'OVERLOADED' : c >= heavy ? 'HEAVY' : c >= medium ? 'MEDIUM' : 'LIGHT';
  }

  /** While you hold E at a cache (or a shelter console): how far along it is, 0 to 1. Otherwise null. */
  get holdProgress() {
    if (this.holding) return this.holding.progress;
    if (this.atShelter && this.shelterHold > 0) return this.shelterHold / SHELTER_HOLD;
    return null;
  }

  /** What the visor offers at the cache or console you're facing. */
  get prompt(): SiegeReadout['prompt'] {
    if (this.atShelter) {
      return { text: 'SEAL THE SHELTER · END THE RUN', price: null, affordable: true, hold: true, note: `KEEP ${this.banked.toLocaleString('en-US')}` };
    }
    const site = this.target;
    if (!site) return null;
    const cfg = CONFIG.salvage.caches[site.kind];
    const value = this.perks.has('scanner') ? ` · ${site.value}` : '';
    const opened = site.progress > 0 ? `${Math.floor(site.progress * 100)}% OPEN` : undefined;
    const note = this.holding === site ? `${Math.floor(site.progress * 100)}%` : cfg.guards > 0 && !site.alarmed ? 'TRIPS AN ALARM' : opened;
    return { text: `${this.holding === site ? 'OPENING' : 'OPEN'} ${cfg.name}${value}`, price: null, affordable: true, hold: true, note };
  }

  /** One frame. Returns how the run ended this frame, if it did. */
  update(dt: number, f: SalvageInput): SalvageEnd {
    const s = CONFIG.salvage;
    const suit = this.d.siege.suit;

    // The storm's clock.
    if (!this.stormHit) {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      while (this.warned < s.warnings.length && this.timeLeft <= s.warnings[this.warned]) this.stormWarning(s.warnings[this.warned++]);
      if (this.timeLeft <= 0) this.stormArrives(f.inside);
    }

    // Coming in through an airlock banks what you carry and refills your guns.
    if (f.inside && !this.wasInside) this.comeInside();
    this.wasInside = f.inside;
    if (this.stormHit && f.inside) return 'sheltered';

    this.insideTime = f.inside ? this.insideTime + dt : 0;
    if (f.inside) {
      // The dome mends your suit, and the drones out there soon lose you.
      if (suit.integrity > 0) suit.integrity = Math.min(suit.max, suit.integrity + s.insideRepair * dt);
      if (this.insideTime > s.recallDelay && this.d.siege.incoming > 0) {
        this.d.siege.recallAll();
        this.d.hud.showToast('SIGNAL LOST · DRONES PULLING BACK');
      }
    } else {
      this.timeOutside += dt;
    }

    // After the storm hits, the surface is deadly.
    if (this.stormHit && !f.inside && suit.damage(s.stormDamage * dt)) return 'destroyed';

    this.director.update(dt, f.feet, !f.inside, this.timeLeft);
    const level = this.director.level(this.timeLeft);
    if (level > this.level && !f.inside) {
      this.d.salvageHud.banner(`THREAT LEVEL ${level}`, s.threat[level - 1].says, 2.4);
      this.d.audio.threatUp();
    }
    this.level = level;

    if (!f.holdingUse) this.needsRelease = false;
    if (this.updateShelter(dt, f)) return 'sheltered';
    this.updateOpening(dt, f);
    this.sites.update(dt, f.feet);
    this.shelters.update(this.timeLeft, this.banked, this.stormHit);
    this.d.player.burden = this.burden;
    return null;
  }

  /** You fired: a little more heat. */
  onShot() {
    this.director.addHeat(CONFIG.salvage.heatPerShot);
  }

  /** A drone went down: it's worth a little salvage. */
  onKill() {
    this.kills++;
    this.carried += CONFIG.salvage.killSalvage;
  }

  /** You were hit: it knocks you off a cache you were opening. */
  onPlayerHit() {
    if (!this.holding) return;
    this.holding.progress = Math.max(0, this.holding.progress - 0.15);
    this.holding = null;
    this.needsRelease = true;
    this.d.hud.showToast('KNOCKED OFF · HOLD E AGAIN');
  }

  /** Your suit broke or your air ran out. The Auto-Medic perk gets you up once. Returns true if it did. */
  revive(cause: 'suit' | 'oxygen') {
    if (!this.medicReady) return false;
    this.medicReady = false;
    const suit = this.d.siege.suit;
    suit.integrity = suit.max;
    suit.shielded = CONFIG.salvage.medicShield;
    if (cause === 'oxygen') this.d.oxygen.level = this.d.oxygen.capacity * 0.5;
    this.d.audio.revive();
    this.d.salvageHud.banner('AUTO-MEDIC', 'BACK ON YOUR FEET · USED UP FOR THIS RUN', 2.6);
    announce('Auto medic');
    return true;
  }

  /** You went down out there: what you were carrying is lost. */
  lose() {
    this.lost += this.carried;
    this.carried = 0;
  }

  // ---- What happens ----

  private comeInside() {
    const guns = this.d.loadout.slots;
    const refilled = guns.some((gun) => gun && !gun.full);
    for (const gun of guns) gun?.refill();
    if (this.carried <= 0) {
      if (refilled) this.d.hud.showToast('AMMO REFILLED');
      return;
    }
    const amount = this.carried;
    this.banked += amount;
    this.carried = 0;
    this.trips++;
    this.d.audio.banked();
    this.d.salvageHud.banked(amount);
    this.d.salvageHud.banner(`BANKED +${amount.toLocaleString('en-US')}`, `TOTAL ${this.banked.toLocaleString('en-US')} · AMMO REFILLED`, 2.6);
  }

  private stormWarning(seconds: number) {
    this.d.audio.stormSiren();
    this.d.salvageHud.banner(`SOLAR STORM IN ${formatTime(seconds)}`, seconds <= 30 ? 'GET INSIDE NOW' : seconds <= 60 ? 'HEAD FOR AN AIRLOCK' : 'START HEADING BACK', 3.2);
    announce(`Solar storm in ${SPOKEN[seconds] ?? `${seconds} seconds`}`);
  }

  private stormArrives(inside: boolean) {
    this.stormHit = true;
    this.d.audio.stormHit();
    if (!inside) {
      this.d.salvageHud.banner('SOLAR STORM', 'RADIATION · GET TO AN AIRLOCK', 4);
      announce('The storm is here. Get inside.');
    }
  }

  // A shelter console: hold E to seal up and end the run now.
  private updateShelter(dt: number, f: SalvageInput) {
    this.atShelter = f.inside && this.shelters.nearest(f.feet, f.look) !== null;
    if (!this.atShelter || !f.holdingUse || this.needsRelease) {
      this.shelterHold = 0;
      return false;
    }
    this.shelterHold += dt;
    return this.shelterHold >= SHELTER_HOLD;
  }

  // Holding E at a cache: it opens bit by bit. Vaults and the black box set off an alarm.
  private updateOpening(dt: number, f: SalvageInput) {
    const site = this.atShelter ? null : this.sites.nearest(f.feet, f.look);
    this.target = site;
    if (!site || !f.holdingUse || this.needsRelease) {
      this.holding = null;
      return;
    }
    const cfg = CONFIG.salvage.caches[site.kind];
    if (this.holding !== site) {
      this.holding = site;
      this.tickTimer = 0;
    }
    if (!site.alarmed && cfg.guards > 0) {
      site.alarmed = true;
      this.director.callGuards(cfg.guards, site.position, this.level);
      this.d.audio.cacheAlarm(site.position);
      const strike = site.kind === 'blackBox';
      this.d.salvageHud.banner(strike ? 'STRIKE TEAM INBOUND' : 'VAULT ALARM', strike ? 'THE BLACK BOX IS CALLING THEM IN' : 'DRONES DROPPING IN · KEEP AT IT OR RUN', 2.6);
    }
    site.progress = Math.min(1, site.progress + dt / cfg.openTime);
    this.tickTimer -= dt;
    if (this.tickTimer <= 0) {
      this.tickTimer = 0.2;
      this.d.audio.cacheWork(site.position, site.progress);
    }
    if (site.progress >= 1) this.open(site);
  }

  private open(site: Site) {
    const cfg = CONFIG.salvage.caches[site.kind];
    this.sites.open(site);
    this.holding = null;
    this.needsRelease = true;
    this.carried += site.value;
    this.cachesOpened++;
    this.director.addHeat(cfg.heat);
    this.d.audio.cacheOpen(site.position, site.kind === 'vault' || site.kind === 'blackBox');
    this.d.hud.showCallout(`+${site.value} SALVAGE`, true);
    this.d.salvageHud.carried();
    this.extra(site);
    const load = this.loadName;
    if (load !== this.shownLoad && load !== 'LIGHT') this.d.hud.showToast(`LOAD ${load} · SLOWER ON YOUR FEET`);
    this.shownLoad = load;
  }

  // Some caches hold something useful as well. What you need most is likelier.
  private extra(site: Site) {
    const s = CONFIG.salvage;
    const rich = site.kind === 'vault' || site.kind === 'blackBox';
    if (!rich && Math.random() > s.extraChance) return;
    const suit = this.d.siege.suit;
    const guns = this.d.loadout.slots.filter((g) => g !== null);
    const ammoShort = guns.some((g) => g.reserve < g.spec.magazine * 2);
    const choices: ['oxygen' | 'patch' | 'ammo', number][] = [
      ['oxygen', 1 + (1 - this.d.oxygen.fraction) * 2],
      ['patch', 0.5 + (1 - suit.fraction) * 2],
      ['ammo', ammoShort ? 1.5 : 0.6],
    ];
    let roll = Math.random() * choices.reduce((sum, [, w]) => sum + w, 0);
    const kind = choices.find(([, w]) => (roll -= w) <= 0)?.[0] ?? 'oxygen';
    if (kind === 'oxygen') {
      this.d.oxygen.reward(s.oxygenCanister);
      this.d.audio.powerUp('o2');
      this.d.hud.showToast(`OXYGEN CANISTER · +${s.oxygenCanister} O2`);
    } else if (kind === 'patch') {
      suit.integrity = Math.min(suit.max, suit.integrity + s.suitPatch);
      this.d.audio.revive();
      this.d.hud.showToast(`SUIT PATCH · +${s.suitPatch} INTEGRITY`);
    } else {
      for (const gun of guns) gun.refill();
      this.d.audio.powerUp('maxAmmo');
      this.d.hud.showToast('AMMO PACK · GUNS REFILLED');
    }
  }
}
