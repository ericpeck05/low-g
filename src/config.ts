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
