import { CONFIG } from '../config';

// Everything that makes one gun different from another: how it fires, how hard it
// hits, how it kicks, what it looks and sounds like. The range rifle's numbers come
// from CONFIG.rifle (as they always have); Drone Siege's weapons from CONFIG.siege.weapons.

export type FireMode = 'auto' | 'semi' | 'burst';
export type WeaponId = 'rifle' | SiegeWeaponId;
export type SiegeWeaponId = keyof typeof CONFIG.siege.weapons;

export interface WeaponSpec {
  id: WeaponId;
  name: string;
  fireMode: FireMode;
  fireRate: number; // shots per second (for burst: bursts per second)
  burstCount: number; // shots in one burst
  burstRate: number; // shots per second within a burst
  magazine: number;
  reserve: number; // spare rounds carried (Infinity: never runs out)
  reloadTime: number;
  damage: number; // per pellet, against hostile drones
  pellets: number; // rays per shot (a shotgun fires several)
  pierce: number; // drones one shot can pass through
  range: number;
  falloff: number[]; // [full damage up to this many meters, minimum damage from this many meters]
  minDamage: number; // fraction of damage left at long range
  hipSpread: number;
  adsSpread: number;
  moveSpread: number;
  airSpread: number;
  spreadPerShot: number;
  spreadRecovery: number;
  adsFov: number;
  adsSpeed: number;
  adsMoveScale: number;
  eyeRelief: number; // meters from the eye to the sight when aiming
  recoil: { pitch: number; yaw: number; shake: number; kickBack: number; kickUp: number };
  price: number;
  ammoPrice: number;
  /** Upgraded at Drone Siege's Overclock station. */
  overclocked: boolean;
}

/** The rifle used everywhere except Drone Siege: full auto, endless spare magazines. */
export function rangeRifle(): WeaponSpec {
  const r = CONFIG.rifle;
  const k = CONFIG.recoil;
  const v = CONFIG.viewmodel;
  return {
    id: 'rifle',
    name: 'RIFLE',
    fireMode: 'auto',
    fireRate: r.fireRate,
    burstCount: 1,
    burstRate: 0,
    magazine: r.magazineSize,
    reserve: Infinity,
    reloadTime: r.reloadTime,
    damage: 34,
    pellets: 1,
    pierce: 1,
    range: r.range,
    falloff: [r.range, r.range],
    minDamage: 1,
    hipSpread: r.hipSpread,
    adsSpread: r.adsSpread,
    moveSpread: r.moveSpread,
    airSpread: r.airSpread,
    spreadPerShot: r.spreadPerShot,
    spreadRecovery: r.spreadRecovery,
    adsFov: r.adsFov,
    adsSpeed: r.adsSpeed,
    adsMoveScale: r.adsMoveScale,
    eyeRelief: v.eyeRelief,
    recoil: { pitch: k.kickPitch, yaw: k.kickYaw, shake: k.shakeAmount, kickBack: v.kickBack, kickUp: v.kickUp },
    price: 0,
    ammoPrice: 0,
    overclocked: false,
  };
}

/** A Drone Siege weapon. How it moves with you (spread on the move, aim speed) matches the rifle. */
export function siegeWeapon(id: SiegeWeaponId): WeaponSpec {
  const w = CONFIG.siege.weapons[id];
  const r = CONFIG.rifle;
  return {
    ...w,
    id,
    fireMode: w.fireMode as FireMode,
    moveSpread: r.moveSpread,
    airSpread: r.airSpread,
    adsSpeed: r.adsSpeed,
    adsMoveScale: r.adsMoveScale,
    overclocked: false,
  };
}

/** Each gun's name once it's been overclocked. */
const OVERCLOCK_NAMES: Record<SiegeWeaponId, string> = {
  sidearm: 'P-9 SUNSPOT',
  smg: 'PLASMA TEMPEST',
  scatter: 'SCATTER NOVA',
  carbine: 'BURST LANCE',
  rail: 'RAIL ECLIPSE',
  singularity: 'EVENT HORIZON',
  arc: 'STORM CASTER',
};

/** The same gun overclocked: much harder hitting, more ammo, a little faster, and a new name. */
export function overclock(spec: WeaponSpec): WeaponSpec {
  const o = CONFIG.siege.overclock;
  const id = spec.id as SiegeWeaponId;
  return {
    ...spec,
    name: OVERCLOCK_NAMES[id] ?? spec.name,
    damage: spec.damage * o.damage,
    magazine: Math.round(spec.magazine * o.magazine),
    reserve: Math.round(spec.reserve * o.reserve),
    fireRate: spec.fireRate * o.fireRate,
    ammoPrice: spec.ammoPrice * o.ammoPrice,
    // A few guns get something extra.
    pellets: id === 'scatter' ? spec.pellets + 3 : spec.pellets,
    pierce: id === 'rail' ? spec.pierce + 4 : spec.pierce,
    burstCount: id === 'carbine' ? spec.burstCount + 1 : spec.burstCount,
    overclocked: true,
  };
}

/** How much of a shot's damage is left after flying `distance` meters. */
export function damageAt(spec: WeaponSpec, distance: number) {
  const [full, far] = spec.falloff;
  if (distance <= full) return spec.damage;
  const t = Math.min(1, (distance - full) / Math.max(1e-6, far - full));
  return spec.damage * (1 - t * (1 - spec.minDamage));
}

/** "AUTO", "SEMI" or "BURST", for the HUD. */
export function fireModeLabel(spec: WeaponSpec) {
  return spec.fireMode === 'burst' ? `${spec.burstCount}-BURST` : spec.fireMode.toUpperCase();
}
