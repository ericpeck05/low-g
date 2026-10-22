// Every tunable number in the game lives here, so the feel can be tweaked
// without digging through the rest of the code. Later phases add to this.

export const CONFIG = {
  // Moon gravity in m/s² (Earth is 9.81). Used for the player and the physics world.
  gravity: 1.62,

  // Longest frame the simulation will accept (seconds). If the tab stalls,
  // we simulate this much instead of one huge jump that could skip through walls.
  maxFrameTime: 1 / 30,

  camera: {
    fov: 75, // degrees, vertical field of view
    near: 0.1, // closest distance the camera draws (meters)
    far: 2000, // farthest distance the camera draws (meters)
  },

  look: {
    sensitivity: 0.002, // radians of turn per pixel of mouse movement
    sensitivityStep: 0.0002, // how much [ and ] change it
    sensitivityMin: 0.0002,
    sensitivityMax: 0.01,
    maxPitch: 89, // degrees: how far you can look up or down
  },

  player: {
    startPosition: { x: 0, y: 0.5, z: 26 }, // in the plaza, facing the beacon
    radius: 0.35, // capsule radius (meters)
    standHeight: 1.8, // total body height standing
    crouchHeight: 1.1, // total body height crouched
    eyeFromTop: 0.12, // eyes sit this far below the top of the head
    crouchSpeed: 8, // how fast the camera slides between stand and crouch heights

    walkSpeed: 4.5, // m/s
    sprintSpeed: 7.5,
    crouchWalkSpeed: 2.2,
    groundAccel: 30, // how quickly you reach your target speed on the ground
    airControl: 0.25, // fraction of groundAccel you get in the air (commit to your jumps)

    // Jump: with moon gravity this gives about 3.2 m of height and ~4 s of hang time.
    // Earth-style height would be jumpSpeed²/(2*9.81) ≈ 0.5 m with the same number.
    jumpSpeed: 3.2,
    maxFallSpeed: 30,

    // Character controller details
    skinWidth: 0.02, // small gap Rapier keeps between the player and walls
    maxSlopeDegrees: 45, // steeper than this and you slide off
    stepHeight: 0.35, // small ledges you walk up without jumping
    snapToGround: 0.3, // keeps you glued to the ground going down ramps
  },

  jetpack: {
    maxFuel: 100,
    burnRate: 50, // fuel per second while thrusting (2 s from full)
    rechargeRate: 40, // fuel per second while on the ground
    rechargeDelay: 0.4, // seconds on the ground before recharging starts
    upThrust: 3.0, // m/s² upward (beats moon gravity by ~1.4 m/s²)
    forwardThrust: 1.5, // m/s² extra push in the direction you steer with WASD
    maxUpSpeed: 3, // thrust stops adding lift above this climb speed
    // With these numbers a jump plus a full tank tops out a little under 10 m.
    // Seconds after leaving the ground before holding Space fires the jetpack,
    // so a normal held jump doesn't instantly turn into a jetpack burn.
    holdDelay: 0.35,
  },

  cameraFx: {
    bobFrequency: 1.6, // bobs per meter walked (scaled into steps)
    bobAmountY: 0.04, // meters of up/down bob
    bobAmountX: 0.025, // meters of side-to-side sway
    landingDipPerSpeed: 0.04, // meters of dip per m/s of landing speed
    landingDipMax: 0.35,
    landingRecover: 7, // how quickly the dip springs back
  },

  rifle: {
    magazineSize: 30,
    fireRate: 9, // shots per second while holding the trigger (full auto)
    reloadTime: 1.6, // seconds
    range: 400, // meters: how far a shot can hit something

    // Spread: how far shots wander from the crosshair, in degrees.
    hipSpread: 1.2,
    adsSpread: 0.1,
    moveSpread: 1.5, // added at full sprint speed, less when walking
    airSpread: 2.0, // added while airborne
    spreadPerShot: 0.35, // grows while you hold the trigger
    spreadRecovery: 4, // degrees per second it shrinks back

    // Aim down sights (right click)
    adsFov: 45, // degrees: zoomed field of view
    adsSpeed: 10, // how fast you raise and lower the sights
    adsMoveScale: 0.6, // walk slower while aiming
  },

  recoil: {
    kickPitch: 0.55, // degrees the view jumps up per shot
    kickYaw: 0.2, // max degrees of random sideways kick per shot
    adsScale: 0.55, // recoil multiplier while aiming down sights
    recovery: 7, // how quickly the view settles back after shooting
    shakeAmount: 0.006, // radians of random screen shake per shot
    shakeDecay: 18, // how quickly the shake dies out
  },

  viewmodel: {
    fov: 58, // the gun is drawn with its own fixed camera so it never stretches
    hipPosition: { x: 0.175, y: -0.205, z: -0.43 }, // where the trigger sits, relative to the eye
    eyeRelief: 0.17, // meters from the eye to the sight when aiming down sights
    kickBack: 0.03, // meters the gun slides back per shot
    kickUp: 3, // degrees the gun tilts up per shot
    swayAmount: 0.0006, // how much the gun lags behind mouse movement
    muzzleFlashTime: 0.035, // seconds: short, there's no air for a fireball
    casingSpeed: 2.6, // m/s spent brass leaves the ejection port
  },

  impacts: {
    dustCount: 26, // particles per hit
    dustSpeed: 1.6, // m/s: how hard the dust is thrown off the surface
    dustLift: 1.2, // m/s of extra upward toss, which sets how long the puff hangs
    dustLife: 5, // seconds before a dust particle fades away
    dustSize: 0.09, // meters
    sparkCount: 8,
    sparkSpeed: 6,
    sparkLife: 0.25,
  },

  targets: {
    discRadius: 0.6, // meters
    discThickness: 0.06,
    // Ring edges as a fraction of the disc radius, and what each ring is worth.
    bullseyeRadius: 0.2,
    innerRadius: 0.58,
    bullseyePoints: 50,
    innerPoints: 25,
    outerPoints: 10,
    respawnTime: 2.5, // seconds before a broken static target comes back

    popupMultiplier: 2, // pop-ups are worth double: they don't stay up long
    popupUpTime: 3, // seconds a pop-up stays standing
    popupFlipTime: 0.25, // seconds to rise or drop
    popupInterval: [1.0, 2.2], // random gap between pop-ups rising (min, max seconds)
    popupRange: 70, // only pop-ups within this many meters of the player rise

    dronePoints: 75,
    droneRadius: 0.45,
    droneRespawnTime: 4,
  },

  debris: {
    life: 6, // seconds before broken pieces disappear
    burstSpeed: 1.4, // m/s outward from the center of the target
    shotPush: 1.2, // m/s knocked off the target (off the face for discs, along the shot for drones)
    spin: 4, // max radians per second of tumble
  },

  oxygen: {
    max: 100,
    drainRate: 1.8, // per second on the surface (about 55 s from full)
    refillRate: 30, // per second inside the dome or an airlock chamber
    lowWarning: 25, // below this the HUD warns you
    // Top-ups for hitting targets while you're outside.
    hitReward: 5,
    bullseyeReward: 12,
    droneReward: 9,
    // Oxygen Run gets harder: the drain grows by this fraction every minute survived.
    runDrainGrowthPerMinute: 0.6,
  },

  audio: {
    // Outside the dome there's no air to carry sound. World sounds are cut down to a faint
    // low rumble; your own gun, steps and jetpack still reach you through the suit, dulled.
    worldMuffleHz: 260, // world sounds' brightness outside (inside: full range)
    worldMuffleGain: 0.45,
    bodyMuffleHz: 1000, // sounds carried through your suit outside
    domeReverb: 0.22, // how much the dome echoes (none outside: vacuum)
    muffleTime: 0.6, // seconds to go from inside sound to outside sound
    breathPeriodCalm: 4.2, // seconds per breath, relaxed
    breathPeriodPanic: 1.4, // seconds per breath with almost no oxygen left
  },

  scoring: {
    comboStep: 5, // the multiplier goes up by one every this many hits in a row
    maxMultiplier: 4,
    timeTrialSeconds: 60,
    // Where each mode starts (feet position) and which way you face (degrees, 180 = toward -z).
    rangeStart: { x: 0, y: 0.5, z: 26, bearing: 180 },
    oxygenRunStart: { x: 0, y: 0.8, z: 140, bearing: 180 }, // on the landing pad, facing the dome
  },

  terrain: {
    seed: 7, // change for a different (but repeatable) landscape
    size: 1000, // meters across
    resolution: 500, // grid cells per side (2 m each)
    flatRadius: 150, // the flat area in the middle: the dome and the buildings around it
    blendRadius: 210, // terrain fades from flat to full height out to here
    hillHeight: 7, // meters of rolling hills
    hillScale: 140, // meters between hill tops, roughly
    // Craters at three sizes. Real lunar ground is covered in them at every scale.
    largeCraters: 16, // 25-70 m radius: big, old basins
    mediumCraters: 260, // 6-25 m radius
    smallCraters: 1400, // 2.5-6 m radius
    freshFraction: 0.2, // share of craters young enough to be sharp and have bright rays
    edgeHillHeight: 45, // a ring of tall hills at the map edge that hides the end of the world
    edgeHillWidth: 140,
    textureMeters: 8, // the ground texture repeats every this many meters
    shadowBakeDistance: 220, // meters: how far shadows are traced toward the sun when baking
  },

  city: {
    domeRadius: 90, // meters, at ground level
    domeHeight: 50, // meters at the very top
    walkwayHeight: 8, // the ring of bridges between towers
    airlockBearings: [180, 0], // degrees: north (toward the Earth) and south (toward the landing pad)
    airlockDoorSpeed: 2.5, // m/s the doors slide
    airlockCycleTime: 1.2, // seconds to "pressurize" between closing one door and opening the other
    litWindows: 0.62, // share of the city's rooms with their lights on
    roomBrightness: 1.0, // how bright lit rooms look through the windows
  },

  render: {
    exposure: 0.85, // overall brightness after tone mapping
    msaaSamples: 4, // anti-aliasing samples for the main image
    ambientOcclusion: true, // soft contact shadows in corners; the most expensive effect (turn off on slow machines)
    aoRadius: 1.6, // meters: how far ambient occlusion looks for nearby surfaces
    aoIntensity: 0.9, // 0 = off, 1 = full darkening in corners and crevices
  },

  bloom: {
    strength: 0.35, // how much glowing things bleed light
    radius: 0.3,
    threshold: 1.0, // only things brighter than this glow (lit windows, light strips), not sunlit ground
  },

  // The last touches on every frame, like a camera lens and film.
  film: {
    grain: 0.05, // strength of the film grain in mid-tones (0 = none); black stays black
    vignette: 0.28, // how much the corners darken (0 = none, 1 = black)
    vignetteStart: 0.45, // where the darkening begins: 0 = screen center, 1 = the corners
  },

  sky: {
    starCount: 4500,
    earthDistance: 1500,
    earthAngularSize: 7, // degrees across (the real Earth is about 2 from the Moon, made bigger for drama)
    earthElevation: 22, // degrees above the horizon
    earthBearing: 200, // degrees: 180 is straight ahead from the spawn point
  },

  sun: {
    elevation: 24, // degrees above the horizon: low, so shadows are long
    bearing: 50, // degrees around from the spawn view
    shadowRange: 70, // meters around the player that get sharp shadows
    shadowHeight: 30, // walls and rooftops up to this many meters tall get them too
    shadowMapSize: 4096,
  },

  rocks: {
    pebbles: 9000, // fist-sized and smaller, no collision
    stones: 1800, // knee-high, no collision (you can step over or through them)
    boulders: 220, // big rocks you collide with
    nearCraterShare: 0.65, // most rocks lie around crater rims, where impacts threw them
  },

  footsteps: {
    strideLength: 1.1, // meters walked between footprints
    footprintLife: 400, // how many prints stay on the ground before the oldest disappear
    dustPerStep: 7, // dust particles kicked up per step
    landingDust: 30,
  },


  lighting: {
    sunColor: 0xfff6ea, // very slightly warm white
    sunIntensity: 4.5, // harsh: nothing in the way
    ambientIntensity: 0.012, // nearly none: no air to scatter light into shadows
    earthshineIntensity: 0.05, // faint fill light reflected off the Earth
    // How bright the sunlit ground looks to everything above it. On the Moon this
    // bounce light off the regolith is what fills shadows, from below, not the sky.
    groundBounce: 0.16,
    opposition: 0.45, // extra brightness of ground seen with the sun behind you (the "opposition surge")
  },

  // Drone Siege: hostile drones that shoot back (see DRONE_SIEGE.md).
  siege: {
    maxDrones: 24, // most hostile drones alive at once (the size of the drone pool)
    maxBolts: 96, // most plasma bolts in flight at once
    coreMultiplier: 2, // a hit on the glowing core does this much more damage

    points: {
      start: 500, // what you start a game with
      hit: 10, // each drone a shot hits (a shotgun blast on one drone counts once)
      kill: 60,
      coreKill: 100, // a kill with a hit on the core
    },

    // Weapons. You start with the sidearm and one empty slot (two weapons at most).
    // The rest are bought at stations on the city's walls; buying one you already
    // have refills its spare ammo for ammoPrice. damage is per pellet; pierce is how
    // many drones one shot can pass through. falloff: [full damage up to this many
    // meters, down to minDamage of it at this many meters]. Spreads are in degrees.
    weapons: {
      sidearm: {
        name: 'P-9 SIDEARM', fireMode: 'semi', fireRate: 6, burstCount: 1, burstRate: 0, magazine: 12, reserve: 84,
        reloadTime: 1.3, damage: 34, pellets: 1, pierce: 1, range: 250, falloff: [60, 250], minDamage: 0.6,
        hipSpread: 0.9, adsSpread: 0.15, spreadPerShot: 0.55, spreadRecovery: 6,
        adsFov: 60, eyeRelief: 0.55, recoil: { pitch: 1.1, yaw: 0.35, shake: 0.006, kickBack: 0.045, kickUp: 6 },
        price: 0, ammoPrice: 0,
      },
      smg: {
        name: 'PLASMA SMG', fireMode: 'auto', fireRate: 13, burstCount: 1, burstRate: 0, magazine: 45, reserve: 270,
        reloadTime: 1.6, damage: 18, pellets: 1, pierce: 1, range: 150, falloff: [25, 120], minDamage: 0.5,
        hipSpread: 2, adsSpread: 0.45, spreadPerShot: 0.22, spreadRecovery: 6,
        adsFov: 55, eyeRelief: 0.17, recoil: { pitch: 0.32, yaw: 0.22, shake: 0.003, kickBack: 0.018, kickUp: 1.5 },
        price: 500, ammoPrice: 250,
      },
      scatter: {
        name: 'SCATTER CANNON', fireMode: 'semi', fireRate: 1.3, burstCount: 1, burstRate: 0, magazine: 6, reserve: 36,
        reloadTime: 2.4, damage: 16, pellets: 9, pierce: 1, range: 60, falloff: [12, 38], minDamage: 0.3,
        hipSpread: 4.5, adsSpread: 3.2, spreadPerShot: 0, spreadRecovery: 6,
        adsFov: 62, eyeRelief: 0.2, recoil: { pitch: 3.4, yaw: 0.8, shake: 0.02, kickBack: 0.07, kickUp: 9 },
        price: 900, ammoPrice: 450,
      },
      carbine: {
        name: 'BURST CARBINE', fireMode: 'burst', fireRate: 2.6, burstCount: 3, burstRate: 15, magazine: 30, reserve: 180,
        reloadTime: 1.8, damage: 40, pellets: 1, pierce: 1, range: 300, falloff: [80, 300], minDamage: 0.7,
        hipSpread: 1.3, adsSpread: 0.1, spreadPerShot: 0.3, spreadRecovery: 5,
        adsFov: 38, eyeRelief: 0.2, recoil: { pitch: 0.55, yaw: 0.2, shake: 0.005, kickBack: 0.028, kickUp: 2.6 },
        price: 1100, ammoPrice: 550,
      },
      rail: {
        name: 'RAIL RIFLE', fireMode: 'semi', fireRate: 0.8, burstCount: 1, burstRate: 0, magazine: 5, reserve: 25,
        reloadTime: 2.6, damage: 260, pellets: 1, pierce: 6, range: 500, falloff: [500, 500], minDamage: 1,
        hipSpread: 0.6, adsSpread: 0, spreadPerShot: 0, spreadRecovery: 4,
        adsFov: 28, eyeRelief: 0.22, recoil: { pitch: 4.5, yaw: 0.6, shake: 0.03, kickBack: 0.09, kickUp: 7 },
        price: 1250, ammoPrice: 625,
      },
      // The two rare ones only come out of the Supply Drop (no price: there's no wall station).
      singularity: {
        name: 'SINGULARITY LAUNCHER', fireMode: 'semi', fireRate: 0.9, burstCount: 1, burstRate: 0, magazine: 3, reserve: 9,
        reloadTime: 2.8, damage: 0, pellets: 1, pierce: 1, range: 60, falloff: [60, 60], minDamage: 1,
        hipSpread: 0.5, adsSpread: 0.2, spreadPerShot: 0, spreadRecovery: 4,
        adsFov: 62, eyeRelief: 0.24, recoil: { pitch: 3.2, yaw: 0.5, shake: 0.025, kickBack: 0.08, kickUp: 6 },
        price: 0, ammoPrice: 0,
      },
      arc: {
        name: 'ARC CASTER', fireMode: 'auto', fireRate: 3.2, burstCount: 1, burstRate: 0, magazine: 24, reserve: 144,
        reloadTime: 2.0, damage: 75, pellets: 1, pierce: 1, range: 38, falloff: [38, 38], minDamage: 1,
        hipSpread: 1.2, adsSpread: 0.5, spreadPerShot: 0.1, spreadRecovery: 6,
        adsFov: 60, eyeRelief: 0.2, recoil: { pitch: 0.7, yaw: 0.3, shake: 0.008, kickBack: 0.03, kickUp: 2 },
        price: 0, ammoPrice: 0,
      },
    },
    stationReach: 2.4, // meters from a weapon station (or anything else you can use) you can buy from it

    // The Singularity Launcher's shot: a slow glowing round that collapses into a small
    // black hole, pulling drones in and crushing the ones that get close.
    singularity: {
      speed: 24, // m/s the round flies
      life: 1.1, // seconds before it collapses where it is, if it hasn't hit anything
      duration: 3, // seconds the black hole lasts
      pullRadius: 11, // meters: drones this close are dragged in
      pull: 16, // m/s² of pull at the middle (less toward the edge)
      crushRadius: 3.2, // meters: drones this close take damage
      damagePerSecond: 320,
      finalBlast: 260, // damage when it collapses, to everything within crushRadius × 1.6
    },
    // The Arc Caster's lightning jumps from the drone it hits to the nearest others.
    arc: {
      chains: 4, // extra drones one bolt can jump to
      chainRange: 10, // meters between jumps
      chainFalloff: 0.8, // each jump does this share of the last one's damage
    },

    // ---- Opening up the city (Zombies' doors) ----
    // You start in the plaza. Energy barriers seal off the rest: the tower ring around it,
    // and the south and north halves of the outer district beyond the ring road. Buy your
    // way through at the barrier terminals. Each section has its own spawn points and stations.
    sections: {
      towers: { name: 'TOWER RING', price: 1000 },
      south: { name: 'SOUTH DISTRICT', price: 1500 },
      north: { name: 'NORTH DISTRICT', price: 2000 },
    },
    // The city's power is off when a game starts. The substation is out on the surface past
    // airlock S. Switching it on lights the city and wakes the suit mod and Overclock stations.
    power: {
      darkLights: 0.12, // how bright the city's lights are with the power off (1 = normal)
      darkRooms: 0.12, // and the rooms behind the windows
      restoreTime: 2.5, // seconds for the lights to come up when it's switched on
    },
    // Suit mods (Zombies' perks): bought at mod stations once the power is on, 4 at most.
    mods: {
      max: 4,
      plating: { name: 'REINFORCED PLATING', price: 2500, bonus: 60 }, // extra suit integrity
      cycler: { name: 'RAPID CYCLER', price: 2000, reloadTime: 0.55 }, // reloads take this share of the time
      thruster: { name: 'THRUSTER MK II', price: 2000, fuel: 1.6, recharge: 1.8 }, // jetpack tank and refill
      overcharge: { name: 'OVERCHARGE', price: 2000, fireRate: 1.33 }, // all guns fire this much faster
      recycler: { name: 'O2 RECYCLER', price: 1500, drain: 0.35 }, // oxygen drains at this share outside
      medic: { name: 'AUTO-MEDIC', price: 500, maxPerGame: 3, shield: 3 }, // a second chance; seconds untouchable after
    },
    // Supply Drop (the Mystery Box): pay, watch it cycle, take what it gives you.
    supplyDrop: {
      price: 950,
      spinTime: 4, // seconds it cycles through weapons
      takeTime: 8, // seconds you have to take the weapon
      movesAfter: [4, 7], // it relocates after this many uses (picked at random each time)
      // How often each weapon comes up (relative).
      weights: { sidearm: 2, smg: 4, scatter: 4, carbine: 4, rail: 2.5, singularity: 1, arc: 1.2 },
    },
    // Overclock (Pack-a-Punch): makes the gun in your hand much stronger.
    overclock: {
      price: 5000,
      time: 3, // seconds it takes
      damage: 2.2, // damage multiplier
      magazine: 1.5,
      reserve: 1.8,
      fireRate: 1.12,
      ammoPrice: 3, // buying ammo for an overclocked gun at a wall costs this many times more
    },
    // Power-ups dropped by destroyed drones.
    powerUps: {
      chance: 0.06, // per drone destroyed
      perRound: [2, 0.15], // most drops in round n: base + per round × n
      life: 20, // seconds before one fades away (it blinks for the last 6)
      pickupRadius: 1.8, // meters
      duration: 30, // seconds Double Points and One Shot last
      empPoints: 400, // points for setting off an EMP Blast
    },
    lostSightTime: 6, // seconds a drone can go without seeing you before it comes hunting for you
    huntSpeed: 1.35, // how much faster than normal a hunting drone flies
    huntTimeout: 10, // seconds of hunting without finding you before it's sent back to a spawn point

    // The rounds. Round n has more drones, tougher and sharper ones, arriving faster.
    rounds: {
      firstDelay: 5, // seconds before round 1 starts
      intermission: 10, // seconds of quiet between rounds
      // Drones in round n: base + perRound × (n - 1) + growth × (n - 1)²
      baseDrones: 6,
      dronesPerRound: 2.5,
      dronesGrowth: 0.15,
      // Most drones flying at once in round n (never more than maxDrones).
      baseAlive: 4,
      alivePerRound: 1,
      spawnInterval: 2.2, // seconds between arrivals in round 1...
      spawnIntervalShrink: 0.93, // ...multiplied by this each round...
      minSpawnInterval: 0.5, // ...down to this
      spawnWarning: 1.1, // seconds a spawn point glows red before a drone comes out
      spawnRange: [12, 90], // meters from the player a spawn point can be used
      // Health: +healthPerRound each round up to round 10, then ×healthGrowth per round.
      healthPerRound: 0.12,
      healthGrowth: 1.08,
      fireRatePerRound: 0.03, // drones fire this much faster each round...
      maxFireRate: 1.8, // ...up to this many times their round-1 rate
      spreadPerRound: 0.03, // aim error shrinks by this fraction each round...
      minSpread: 0.45, // ...down to this fraction of round 1's
      leadPerRound: 0.02, // and they lead their shots a little more each round...
      maxLead: 0.85, // ...up to this
    },

    // The tougher drones in ordinary rounds (scouts make up the rest). Each type unlocks
    // in round fromRound with `first` of them, then gains perRound more each round after
    // (rounded down), spaced out through the round. So gunners: 1 in rounds 4 and 5,
    // 2 in rounds 6 and 7, 3 in rounds 8 and 9, and so on. Kamikazes only come in swarm
    // rounds, carriers in carrier rounds.
    roster: {
      gunner: { fromRound: 4, first: 1, perRound: 0.5 },
      shielded: { fromRound: 8, first: 1, perRound: 0.4 },
      sniper: { fromRound: 10, first: 1, perRound: 0.34 },
      repair: { fromRound: 12, first: 1, perRound: 0.25 },
    },

    // Special rounds, like Zombies' dog rounds and boss waves.
    special: {
      swarmGap: [5, 7], // a swarm round comes every 5 to 7 rounds (the first in round 5 to 7)
      swarmDrones: [4, 0.9], // kamikazes in a swarm round: base + per round × round number (9 in round 5)
      swarmAlive: [2, 0.2], // most flying at once: base + per round × round number (3 in round 5, 4 by round 10)
      swarmInterval: 1.6, // seconds between them arriving
      swarmSpawnMin: 25, // meters: kamikazes come out of spawn points at least this far away, so you see them coming
      carrierEvery: 10, // a carrier (the boss) leads every 10th round...
      carrierEscort: 0.5, // ...with this share of the round's usual drones
    },

    glowColor: [1, 0.05, 0.03], // hostile red (red, green, blue)
    glowIdle: 1.4, // brightness of the core normally (kept low so it stays a deep red)
    glowCharged: 9, // brightness at the moment it fires: white-hot, with a bloom flare
    haloSize: 1.1, // meters across the soft red glow around each drone's core

    suit: {
      max: 100, // suit integrity: your health
      regenDelay: 4, // seconds without being hit before the suit starts repairing itself
      regenRate: 22, // integrity per second while repairing
      lowWarning: 35, // below this the visor cracks and the suit alarm sounds
    },

    scout: {
      health: 100,
      speed: 6.5, // m/s top speed
      acceleration: 7, // m/s² of steering
      range: [13, 21], // meters it likes to keep from you
      height: [2.5, 7], // meters above your feet it likes to hover
      strafeSpeed: 4, // m/s it circles around you
      fireInterval: [1.9, 3.2], // seconds between shots
      telegraph: 0.5, // seconds its core glows brighter before a shot
      aimSpread: 2.2, // degrees of random aim error
      aimLead: 0.5, // 0 aims where you are, 1 aims where you'll be when the bolt arrives
      sightRange: 50, // meters: no shooting from farther than this
    },

    // Bulkier, tougher, closer in, and fires its bolts in bursts.
    gunner: {
      health: 230, speed: 5, acceleration: 6, range: [10, 16], height: [2, 6], strafeSpeed: 3,
      fireInterval: [2.8, 3.8], telegraph: 0.7, aimSpread: 3.4, aimLead: 0.35, sightRange: 45,
      burst: 4, // bolts per burst...
      burstGap: 0.13, // ...this many seconds apart
    },

    // Carries an energy shield on its front that stops shots. It flies shield-first and
    // only turns to face you to shoot, so hit it from the side or behind.
    shielded: {
      health: 170, speed: 5.5, acceleration: 6, range: [12, 19], height: [2.5, 7], strafeSpeed: 3.6,
      fireInterval: [2.4, 3.6], telegraph: 0.6, aimSpread: 2.4, aimLead: 0.45, sightRange: 50,
      shieldArc: 70, // degrees either side of straight ahead that the shield covers
      turnRate: 1.4, // radians per second it can turn (slow, so you can get round it)
    },

    // Hangs far back and charges a red aiming beam, then fires one hard shot down it.
    // The beam stops following you just before it fires: move then. Breaking line of sight cancels it.
    sniper: {
      health: 120, speed: 4, acceleration: 5, range: [34, 52], height: [8, 15], strafeSpeed: 1.6,
      fireInterval: [4, 6], telegraph: 1.5, aimSpread: 0, aimLead: 0, sightRange: 90,
      lockTime: 0.4, // seconds before the shot that the beam stops tracking you
      damage: 45,
    },

    // Doesn't attack: it keeps near the most damaged drone and repairs everything close by.
    repair: {
      health: 140, speed: 6, acceleration: 7, range: [18, 26], height: [4, 9], strafeSpeed: 2.5,
      fireInterval: [99, 99], telegraph: 0, aimSpread: 0, aimLead: 0, sightRange: 60,
      healRate: 22, // health per second given to each drone in reach
      healRange: 9, // meters
      keepAway: 12, // meters it tries to stay from you
    },

    // Swarm rounds only: small, fast, and they fly straight at you and blow up.
    kamikaze: {
      health: 22, speed: 7, acceleration: 10, range: [0, 0], height: [0, 1], strafeSpeed: 0, // a little slower than you sprint
      healthGrowth: 0.5, // gets tougher round by round at half the rate of other drones (one sidearm shot until round 10)
      fireInterval: [99, 99], telegraph: 0, aimSpread: 0, aimLead: 0, sightRange: 80,
      triggerDistance: 1.6, // meters from you it detonates
      blastRadius: 3, // meters
      damage: 20, // when it reaches you; less if it goes off farther away
    },

    // The boss: a big armored drone that launches scouts from its bay. Shots barely
    // scratch its armor; destroy its glowing weak points instead.
    carrier: {
      health: 1, speed: 3, acceleration: 3, range: [24, 34], height: [13, 20], strafeSpeed: 2,
      fireInterval: [3.5, 5], telegraph: 0.9, aimSpread: 4, aimLead: 0.3, sightRange: 80,
      weakPoints: 3,
      weakPointHealth: 650, // each (grows with the round like other drones' health)
      armor: 0.06, // share of damage that gets through the armor
      launchInterval: 7, // seconds between scouts launched from its bay
      maxLaunched: 4, // most of its scouts alive at once
      fan: 5, // bolts in each spread of shots
      points: 1500, // for destroying it (plus kill points for each weak point)
    },

    bolt: {
      speed: 15, // m/s: slow enough to see coming and dodge
      damage: 12,
      radius: 0.14, // meters, for hitting you
      life: 5, // seconds before a bolt that hit nothing fizzles out
    },

    explosion: {
      debris: 14, // pieces per destroyed drone
      maxDebris: 240, // pieces in the pool
      debrisLife: 8, // seconds pieces last before shrinking away
      sparks: 45,
      flashTime: 0.35, // seconds the flash lasts
      lightIntensity: 60,
      lightRange: 16, // meters the flash lights up
    },

    feedback: {
      flashTime: 0.5, // seconds the red edge flash lasts after a hit
      indicatorTime: 1.6, // seconds the hit-direction marker stays up
    },
  },
};
