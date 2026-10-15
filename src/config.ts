// Every tunable number in the game lives here, so the feel can be tweaked
// without digging through the rest of the code. Later phases add to this.

export const CONFIG = {
  // Moon gravity in m/s² (Earth is 9.81). Used by the physics world.
  gravity: 1.62,

  camera: {
    fov: 75, // degrees, vertical field of view
    near: 0.1, // closest distance the camera draws (meters)
    far: 2000, // farthest distance the camera draws (meters)
    startHeight: 1.7, // eye height above the floor (meters)
  },

  floor: {
    size: 100, // width and depth of the test floor (meters)
    color: 0x808080, // plain gray for now
  },

  lighting: {
    sunColor: 0xfff4e0, // slightly warm white
    sunIntensity: 3,
    ambientIntensity: 0.15, // kept low: the Moon has no air to scatter light
  },
};
