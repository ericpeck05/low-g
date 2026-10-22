import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { announce } from '../audio/announcer';
import type { GameAudio } from '../audio/gameAudio';
import { CONFIG } from '../config';
import type { Oxygen } from '../player/oxygen';
import type { Player } from '../player/player';
import type { Hud } from '../ui/hud';
import type { RoundHud } from '../ui/roundHud';
import type { GunModel } from '../weapons/gunModel';
import type { Loadout } from '../weapons/loadout';
import { type SiegeWeaponId, overclock, siegeWeapon } from '../weapons/weaponSpec';
import { ModStations, SuitMods, type ModId } from './mods';
import { OverclockStation } from './overclock';
import { CityPower, PowerStation } from './power';
import { POWER_UP_NAMES, type PowerUpKind, PowerUps } from './powerUps';
import { type AreaId, type SectionId, Sections } from './sections';
import type { SiegeMode } from './siege';
import type { WeaponStations } from './stations';
import { SupplyDrop } from './supplyDrop';

// Everything in Drone Siege that you spend points on or work toward, beyond the drones
// themselves: opening the city's sections, getting the power back on, suit mods, the
// Supply Drop, Overclock, and the power-ups drones drop. It also owns every "press E"
// spot, so main.ts asks it what's on offer where you're standing.

/** What a spot offers you, for the prompt on the visor. */
export interface Offer {
  text: string;
  price: number | null; // null: free (throwing the breaker, taking a weapon)
  affordable: boolean;
  note?: string; // why you can't right now ("NEEDS POWER", "4 MODS MAX")
}

interface Spot {
  area: () => AreaId;
  position: () => THREE.Vector3;
  facing: THREE.Vector3 | null; // null: usable from any side
  offer: () => Offer | null;
  use: () => void;
}

export interface ProgressionDeps {
  scene: THREE.Scene;
  world: RAPIER.World;
  siege: SiegeMode;
  stations: WeaponStations;
  loadout: Loadout;
  player: Player;
  oxygen: Oxygen;
  audio: GameAudio;
  hud: Hud;
  roundHud: RoundHud;
  buildGun: (id: SiegeWeaponId) => GunModel;
  /** Lights in the scene that aren't the city's (they stay as they are when the power goes). */
  keepLights: THREE.Light[];
}

export class Progression {
  readonly sections: Sections;
  readonly mods = new SuitMods();
  readonly power: CityPower;
  readonly powerUps: PowerUps;
  private station: PowerStation;
  private modStations: ModStations;
  private supply: SupplyDrop;
  private overclockStation: OverclockStation;
  private spots: Spot[] = [];
  private active = false;
  private overclockSlot = -1; // the slot whose gun is being overclocked
  private hintsShown = new Set<string>();
  private hintTimer = 0;
  private overclockSpec: ReturnType<typeof siegeWeapon> | null = null;

  constructor(private d: ProgressionDeps) {
    this.sections = new Sections(d.scene, d.world);
    this.power = new CityPower(d.scene, d.keepLights);
    this.station = new PowerStation(d.scene, d.world);
    this.modStations = new ModStations(d.scene, d.world);
    this.supply = new SupplyDrop(d.scene, d.world, d.buildGun);
    this.overclockStation = new OverclockStation(d.scene, d.world);
    this.powerUps = new PowerUps(d.scene);
    d.siege.routeBlocked = this.sections.blocked;
    this.addSpots();
    this.reset(false);
  }

  /** Glowing and see-through things, for leaving out of ambient occlusion. */
  get glowObjects(): THREE.Object3D[] {
    return [...this.sections.glowObjects, ...this.supply.glowObjects, ...this.overclockStation.glowObjects, ...this.powerUps.glowObjects];
  }

  /** A new game (active) or leaving the mode: everything closed, power off in a game and on otherwise. */
  reset(active: boolean) {
    this.active = active;
    this.sections.reset(active);
    this.mods.reset();
    this.applyMods();
    this.power.set(!active, true);
    this.station.setOn(!active);
    this.modStations.setActive(active);
    this.modStations.setPowered(!active);
    this.overclockStation.setActive(active);
    this.overclockStation.setPowered(!active);
    this.supply.reset(active);
    this.powerUps.reset();
    this.powerUps.group.visible = active;
    this.overclockSlot = -1;
    this.hintsShown.clear();
    this.hintTimer = 0;
    const unlocked = this.d.siege.spawnPoints.unlocked;
    unlocked.clear();
    for (const area of this.sections.unlockedAreas) unlocked.add(area);
  }

  /** Show everything for one frame at load, so its shaders compile then. */
  showForWarmUp(shown: boolean) {
    this.sections.reset(shown);
    this.modStations.setActive(shown);
    this.overclockStation.setActive(shown);
    this.supply.reset(shown);
    this.powerUps.group.visible = shown;
    this.powerUps.showForWarmUp(shown);
    if (!shown) this.reset(false);
  }

  /** How much faster (or slower) oxygen drains right now: the O2 Recycler slows it. */
  get oxygenDrain() {
    return this.mods.has('recycler') ? CONFIG.siege.mods.recycler.drain : 1;
  }

  /** The thing you're standing at and facing, if it offers anything, and what. */
  nearest(feet: THREE.Vector3, look: THREE.Vector3): { offer: Offer; use: () => void } | null {
    if (!this.active) return null;
    const areas = this.sections.unlockedAreas;
    const flat = look.clone().setY(0).normalize();
    let best: Spot | null = null;
    let bestDistance: number = CONFIG.siege.stationReach;
    for (const spot of this.spots) {
      if (!areas.has(spot.area())) continue;
      const p = spot.position();
      if (Math.abs(feet.y - p.y) > 2.2) continue;
      const away = feet.clone().sub(p).setY(0);
      const distance = away.length();
      if (distance > bestDistance) continue;
      if (spot.facing) {
        if (away.dot(spot.facing) < 0) continue; // behind it
        if (flat.dot(spot.facing) > -0.35) continue; // not looking at it
      } else if (distance > 0.3 && flat.dot(away.clone().normalize()) > -0.4) {
        continue;
      }
      best = spot;
      bestDistance = distance;
    }
    if (!best) return null;
    const offer = best.offer();
    return offer ? { offer, use: best.use } : null;
  }

  /**
   * One frame of the game. Handles the Supply Drop, Overclock and power-ups;
   * `round` is the current round (for how often power-ups drop).
   */
  update(dt: number, feet: THREE.Vector3) {
    this.sections.update(dt);
    this.power.update(dt);
    this.station.update(dt, this.power.on);
    if (!this.active) return;
    this.applyMods();
    const siege = this.d.siege;

    // The Supply Drop.
    const result = this.supply.update(dt, () => this.rollWeapon(), this.sections.unlockedAreas);
    if (result === 'revealed') this.d.audio.supplyReveal(this.supply.position);
    else if (result === 'leaving') {
      siege.addPoints(CONFIG.siege.supplyDrop.price); // your points back
      this.d.audio.supplyMove(this.supply.position);
      this.d.roundHud.callout('SUPPLY DROP MOVING', 'POINTS REFUNDED');
    } else if (result === 'landed') {
      this.d.audio.supplyMove(this.supply.position);
    }

    // Overclock: when the job's done, the gun in that slot comes back upgraded.
    if (this.overclockStation.update(dt) && this.overclockSpec) {
      const gun = this.d.loadout.slots[this.overclockSlot];
      if (gun && gun.spec.id === this.overclockSpec.id && !gun.spec.overclocked) {
        this.d.loadout.replace(this.overclockSlot, overclock(gun.spec));
        this.d.audio.overclockDone();
        this.d.roundHud.callout(overclock(gun.spec).name, 'OVERCLOCKED');
      }
      this.overclockSpec = null;
    }

    // Power-ups: walking into them, and their timers.
    const { picked, faded } = this.powerUps.update(dt, feet);
    for (const kind of picked) this.takePowerUp(kind);
    for (const at of faded) this.d.audio.powerUpGone(at);
    siege.pointsScale = this.powerUps.timers.doublePoints > 0 ? 2 : 1;
    siege.oneShot = this.powerUps.timers.oneShot > 0;
    this.hints(dt);
  }

  // Tips for a first game, each shown once, only in the quiet between rounds.
  private hints(dt: number) {
    const siege = this.d.siege;
    this.hintTimer -= dt;
    // After the "round cleared" banner, before the countdown to the next round.
    const countdown = siege.rounds.countdown;
    if (siege.rounds.state !== 'intermission' || siege.rounds.round === 0 || this.hintTimer > 0) return;
    if (countdown > CONFIG.siege.rounds.intermission - 3.2 || countdown < 5.5) return;
    const tips: [string, boolean, string, string][] = [
      ['open', !this.sections.bought.has('towers') && siege.points >= CONFIG.siege.sections.towers.price, 'TIP', 'BUY YOUR WAY OUT OF THE PLAZA AT A BARRIER TERMINAL (E)'],
      ['supply', siege.rounds.round >= 2 && siege.points >= CONFIG.siege.supplyDrop.price, 'TIP', 'THE SUPPLY DROP, UNDER THE BEAM OF LIGHT, GIVES A RANDOM WEAPON'],
      ['power', this.sections.bought.has('towers') && !this.power.on && siege.rounds.round >= 3, 'THE POWER IS OUT', 'THE POWER STATION IS OUTSIDE: SOUTH DISTRICT, THEN AIRLOCK S'],
      ['mods', this.power.on && this.mods.owned.size === 0, 'TIP', 'SUIT MOD STATIONS ARE ONLINE: FOUR MODS AT A TIME'],
    ];
    for (const [id, ready, title, text] of tips) {
      if (!ready || this.hintsShown.has(id)) continue;
      this.hintsShown.add(id);
      this.hintTimer = 6;
      this.d.roundHud.callout(title, text, 4.5);
      return;
    }
  }

  /** A drone went down: maybe it dropped a power-up. */
  onKill(position: THREE.Vector3) {
    const kind = this.powerUps.maybeDrop(position, this.d.siege.rounds.round);
    if (kind) this.d.audio.powerUpSpawn(position);
  }

  /** The swarm round's reward, dropped where its last kamikaze fell (or right by you). */
  dropMaxAmmo(position: THREE.Vector3, feet: THREE.Vector3) {
    const at = position.lengthSq() > 0 && position.distanceTo(feet) < 60 ? position : feet.clone().add(new THREE.Vector3(1.5, 1.5, 0));
    this.powerUps.spawn('maxAmmo', at);
    this.d.audio.powerUpSpawn(at);
  }

  onRoundStart() {
    this.powerUps.newRound();
  }

  /**
   * Your suit just broke (or your air ran out). If Auto-Medic is installed it's used up
   * and you get back up. Returns true if you were saved.
   */
  revive(cause: 'suit' | 'oxygen') {
    if (!this.mods.has('medic')) return false;
    this.mods.owned.delete('medic');
    const suit = this.d.siege.suit;
    suit.integrity = suit.max;
    suit.shielded = CONFIG.siege.mods.medic.shield;
    if (cause === 'oxygen') this.d.oxygen.level = CONFIG.oxygen.max * 0.5;
    this.d.audio.revive();
    this.d.roundHud.callout('AUTO-MEDIC', 'BACK ON YOUR FEET');
    announce('Auto medic');
    return true;
  }

  // ---- What each spot offers ----

  private addSpots() {
    const d = this.d;
    const siege = d.siege;
    const pay = (price: number) => {
      if (siege.spend(price)) return true;
      d.audio.denied();
      d.hud.showToast('NOT ENOUGH POINTS');
      return false;
    };

    // Weapon stations on the walls: buy the gun, or ammo for the one you have.
    for (const station of d.stations.stations) {
      this.spots.push({
        area: () => station.area,
        position: () => station.position.clone().setY(0),
        facing: station.facing,
        offer: () => {
          const spec = siegeWeapon(station.weapon);
          const owned = d.loadout.owns(spec.id);
          const price = owned ? owned.spec.ammoPrice : spec.price;
          return { text: owned ? `${owned.spec.name} AMMO` : spec.name, price, affordable: siege.points >= price };
        },
        use: () => {
          const spec = siegeWeapon(station.weapon);
          const owned = d.loadout.owns(spec.id);
          if (owned?.full) return d.hud.showToast('AMMO ALREADY FULL');
          if (!pay(owned ? owned.spec.ammoPrice : spec.price)) return;
          d.audio.purchase();
          if (owned) owned.refill();
          else {
            d.loadout.give(spec);
            d.audio.weaponSwap();
          }
        },
      });
    }

    // Barrier terminals: open the next section.
    for (const terminal of this.sections.terminals) {
      const section = CONFIG.siege.sections[terminal.section];
      this.spots.push({
        area: () => (terminal.section === 'towers' ? 'plaza' : 'towers'),
        position: () => terminal.position,
        facing: terminal.facing,
        offer: () => (this.sections.bought.has(terminal.section) ? null : { text: `OPEN ${section.name}`, price: section.price, affordable: siege.points >= section.price }),
        use: () => {
          if (this.sections.bought.has(terminal.section) || !pay(section.price)) return;
          this.openSection(terminal.section, terminal.position);
        },
      });
    }

    // The breaker at the power station.
    this.spots.push({
      area: () => 'surface',
      position: () => this.station.panel.position,
      facing: this.station.panel.facing,
      offer: () => (this.power.on ? null : { text: 'RESTORE POWER', price: null, affordable: true }),
      use: () => {
        if (this.power.on) return;
        this.power.set(true);
        this.station.setOn(true);
        this.modStations.setPowered(true);
        this.overclockStation.setPowered(true);
        d.audio.powerOn();
        d.roundHud.callout('POWER RESTORED', 'SUIT MODS AND OVERCLOCK ONLINE');
        announce('Power restored');
      },
    });

    // Suit mod stations.
    for (const station of this.modStations.stations) {
      const mod = CONFIG.siege.mods[station.mod];
      this.spots.push({
        area: () => station.area,
        position: () => station.position,
        facing: station.facing,
        offer: () => {
          const blocker = !this.power.on ? 'NEEDS POWER' : this.mods.blocker(station.mod);
          return { text: mod.name, price: mod.price, affordable: !blocker && siege.points >= mod.price, note: blocker ?? undefined };
        },
        use: () => {
          if (!this.power.on) {
            d.audio.denied();
            return d.hud.showToast('NO POWER: RESTORE IT AT THE POWER STATION');
          }
          const blocker = this.mods.blocker(station.mod);
          if (blocker) {
            d.audio.denied();
            return d.hud.showToast(blocker);
          }
          if (!pay(mod.price)) return;
          this.install(station.mod);
        },
      });
    }

    // The Supply Drop: pay to open it, then take what it offers.
    this.spots.push({
      area: () => this.supply.area,
      position: () => this.supply.position,
      facing: null,
      offer: () => {
        if (this.supply.state === 'closed') return { text: 'SUPPLY DROP', price: CONFIG.siege.supplyDrop.price, affordable: siege.points >= CONFIG.siege.supplyDrop.price };
        if (this.supply.state === 'ready' && this.supply.pick) return { text: `TAKE ${siegeWeapon(this.supply.pick).name}`, price: null, affordable: true };
        return null;
      },
      use: () => {
        if (this.supply.state === 'closed') {
          if (!pay(CONFIG.siege.supplyDrop.price)) return;
          this.supply.open();
          d.audio.supplyOpen(this.supply.position);
        } else if (this.supply.state === 'ready' && this.supply.pick) {
          d.loadout.give(siegeWeapon(this.supply.pick));
          d.audio.weaponSwap();
          this.supply.take();
        }
      },
    });

    // Overclock: upgrade the gun in your hand.
    const oc = this.overclockStation;
    this.spots.push({
      area: () => oc.area,
      position: () => oc.position.clone().addScaledVector(oc.facing, 0.9),
      facing: oc.facing,
      offer: () => {
        if (oc.working > 0) return null;
        const gun = d.loadout.current;
        const price = CONFIG.siege.overclock.price;
        const note = !this.power.on ? 'NEEDS POWER' : gun.spec.overclocked ? 'ALREADY OVERCLOCKED' : undefined;
        return { text: `OVERCLOCK ${gun.spec.name}`, price, affordable: !note && siege.points >= price, note };
      },
      use: () => {
        const gun = d.loadout.current;
        if (oc.working > 0) return;
        if (!this.power.on || gun.spec.overclocked) {
          d.audio.denied();
          return d.hud.showToast(!this.power.on ? 'NO POWER: RESTORE IT AT THE POWER STATION' : 'ALREADY OVERCLOCKED');
        }
        if (!pay(CONFIG.siege.overclock.price)) return;
        this.overclockSlot = d.loadout.index;
        this.overclockSpec = gun.spec;
        oc.start();
        d.audio.overclockWork(oc.position);
      },
    });
  }

  private openSection(id: SectionId, at: THREE.Vector3) {
    this.sections.buy(id);
    for (const area of this.sections.unlockedAreas) this.d.siege.spawnPoints.unlocked.add(area);
    this.d.audio.barrierDown(at);
    this.d.roundHud.callout(`${CONFIG.siege.sections[id].name} OPEN`, id === 'south' ? 'AIRLOCK S: THE POWER STATION IS OUTSIDE' : '');
  }

  private install(id: ModId) {
    this.mods.owned.add(id);
    if (id === 'medic') this.mods.medicsBought++;
    if (id === 'plating') this.d.siege.suit.integrity += CONFIG.siege.mods.plating.bonus;
    this.applyMods();
    this.d.audio.modInstall();
    this.d.roundHud.callout(CONFIG.siege.mods[id].name, 'INSTALLED');
  }

  // Put each mod's effect on the suit, jetpack and guns (guns change, so every frame).
  private applyMods() {
    const m = CONFIG.siege.mods;
    const has = (id: ModId) => this.mods.has(id);
    this.d.siege.suit.bonus = has('plating') ? m.plating.bonus : 0;
    this.d.siege.suit.integrity = Math.min(this.d.siege.suit.integrity, this.d.siege.suit.max);
    const jetpack = this.d.player.jetpack;
    jetpack.capacity = CONFIG.jetpack.maxFuel * (has('thruster') ? m.thruster.fuel : 1);
    jetpack.rechargeScale = has('thruster') ? m.thruster.recharge : 1;
    jetpack.fuel = Math.min(jetpack.fuel, jetpack.capacity);
    for (const gun of this.d.loadout.slots) {
      if (!gun) continue;
      gun.fireRateScale = has('overcharge') ? m.overcharge.fireRate : 1;
      gun.reloadScale = has('cycler') ? m.cycler.reloadTime : 1;
    }
  }

  // The Supply Drop's pick: by weight, never a gun you're already carrying.
  private rollWeapon(): SiegeWeaponId {
    const weights = CONFIG.siege.supplyDrop.weights;
    const choices = (Object.keys(weights) as SiegeWeaponId[]).filter((id) => !this.d.loadout.owns(id));
    if (choices.length === 0) return 'smg';
    let roll = Math.random() * choices.reduce((sum, id) => sum + weights[id], 0);
    for (const id of choices) {
      roll -= weights[id];
      if (roll <= 0) return id;
    }
    return choices[choices.length - 1];
  }

  private takePowerUp(kind: PowerUpKind) {
    const d = this.d;
    const name = POWER_UP_NAMES[kind];
    d.audio.powerUp(kind);
    announce(name.toLowerCase());
    if (kind === 'maxAmmo') {
      for (const gun of d.loadout.slots) gun?.refill();
      d.roundHud.callout(name, 'EVERY GUN FULL');
    } else if (kind === 'doublePoints') {
      this.powerUps.timers.doublePoints = CONFIG.siege.powerUps.duration;
      d.roundHud.callout(name, `${CONFIG.siege.powerUps.duration} SECONDS`);
    } else if (kind === 'oneShot') {
      this.powerUps.timers.oneShot = CONFIG.siege.powerUps.duration;
      d.roundHud.callout(name, 'EVERY HIT DESTROYS');
    } else if (kind === 'emp') {
      const count = d.siege.empBlast();
      const points = CONFIG.siege.powerUps.empPoints * d.siege.pointsScale;
      d.siege.addPoints(points);
      d.hud.showPoints(points, `EMP ×${count}`, true);
      d.roundHud.callout(name, `${count} DRONE${count === 1 ? '' : 'S'} DOWN`);
    } else if (kind === 'o2') {
      d.oxygen.reset();
      d.roundHud.callout(name, 'OXYGEN FULL');
    }
  }
}
