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
    startPosition: { x: 0, y: 2, z: 12 },
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
    fov: 60, // the gun is drawn with its own fixed camera so it never stretches
    hipPosition: { x: 0.2, y: -0.2, z: -0.48 }, // bottom right of the screen
    kickBack: 0.05, // meters the gun slides back per shot
    kickUp: 4, // degrees the gun tilts up per shot
    kickRecovery: 14,
    swayAmount: 0.0006, // how much the gun lags behind mouse movement
    muzzleFlashTime: 0.05, // seconds the flash stays visible
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

  scoring: {
    comboStep: 5, // the multiplier goes up by one every this many hits in a row
    maxMultiplier: 4,
    timeTrialSeconds: 60,
  },

  floor: {
    size: 100, // width and depth of the test floor (meters)
    color: 0x7a7a7a,
  },

  lighting: {
    sunColor: 0xfff4e0, // slightly warm white
    sunIntensity: 3,
    ambientIntensity: 0.25, // kept low: the Moon has no air to scatter light
  },
};
