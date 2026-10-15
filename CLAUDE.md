# Lunar City FPS (working title: "Low-G")

A single-player, browser-based first person shooter set on the Moon, inside and around a futuristic lunar city. Version 1 is a target-shooting game: no enemies, no multiplayer, no server. The twist is that the Moon actually plays like the Moon: low gravity, no air, and oxygen as a resource.

## How to work on this project (instructions for Claude Code)

- Build **one phase at a time**, in order. At the end of each phase, run the dev server, confirm it works with no console errors, summarize what changed, and **stop so I can playtest** before starting the next phase.
- Each phase has acceptance criteria. A phase is not done until every box can be checked.
- Put every tunable number (gravity, jump strength, mouse sensitivity, fire rate, oxygen drain, etc.) in `src/config.ts` so I can tweak the feel without digging through code.
- No paid assets. Build visuals from code (primitive geometry, procedural textures) or use CC0 assets only (Kenney.nl, Poly Haven, ambientCG). Note the source of any downloaded asset in `ASSETS.md`.
- Keep the code readable for a beginner: small files, clear names, short comments explaining the why.
- Commit to git at the end of every phase with a message like `Phase 2: shooting`.
- Visual direction: avoid the default bright blue that shows up in a lot of AI-made UIs. Use black, white, and warm accents (amber, orange, soft white) for the HUD and city lighting.

## Tech stack

- **Three.js** for 3D rendering
- **Vite** + **TypeScript** for the dev server and build
- **Rapier** (`@dimforge/rapier3d-compat`) for physics and the character controller
- **Web Audio API** (or Howler.js) for sound
- `localStorage` for saving high scores and settings
- Deploy target: **GitHub Pages** (static site, free)

## Folder structure

```
lunar-fps/
  CLAUDE.md
  ASSETS.md
  index.html
  src/
    main.ts            # boots the game
    config.ts          # all tunable numbers
    core/              # game loop, input, scene setup
    player/            # movement, camera, jetpack, oxygen
    weapons/           # rifle, hitscan, recoil, effects
    targets/           # target types and spawner
    world/             # terrain, sky, city, dome
    ui/                # HUD, menus
    audio/             # sound manager
  public/
    assets/            # models, textures, sounds
```

## Controls

| Action | Key |
|---|---|
| Move | W A S D |
| Look | Mouse |
| Shoot | Left click |
| Aim down sights | Right click |
| Jump | Space |
| Jetpack boost | Hold Space while in the air |
| Sprint | Shift |
| Crouch | C |
| Reload | R |
| Pause | Esc |

## Moon physics (the core of the feel)

- Gravity: **1.62 m/s²** (about 1/6 of Earth). Jumps should feel floaty and high, with long hang time.
- Air control: slightly reduced, so you commit to your jumps.
- Jetpack: short bursts of upward and forward thrust, limited fuel that recharges on the ground.
- Dust kicked up by footsteps and bullet impacts should hang in the air and fall slowly, with no drifting like smoke (there is no air on the Moon).
- No atmosphere means a pitch-black sky even in daylight, hard-edged shadows, and very harsh sunlight.

## The twist (v1)

**Oxygen is the clock.**
- Inside the pressurized dome, oxygen is full and refills.
- Outside on the lunar surface, oxygen drains steadily.
- Hitting targets outside rewards a small oxygen top-up; headshot/bullseye hits give more.
- When oxygen hits zero, the run ends.

**Vacuum audio.**
- Inside the dome: normal sound.
- Outside: sounds are heavily muffled (low-pass filtered), and you mostly hear your own breathing, suit beeps, and gunfire through your suit.

---

## Phase 0: Project setup

- [ ] Vite + TypeScript project created and running with `npm run dev`
- [ ] Three.js and Rapier installed
- [ ] Folder structure above created
- [ ] `src/config.ts` exists
- [ ] Git repo initialized with a `.gitignore`
- [ ] A blank scene renders with a gray floor and a light

## Phase 1: Movement sandbox

Goal: movement feels great before anything else is added. Test level is a flat gray floor with some boxes and ramps to jump on.

- [ ] Click to lock the mouse (pointer lock), Esc to release
- [ ] Mouse look with adjustable sensitivity
- [ ] WASD movement, sprint, crouch
- [ ] Jumping with moon gravity, clearly higher and floatier than Earth
- [ ] Jetpack boost with a fuel bar that recharges on the ground
- [ ] Collision with the floor and boxes, can't walk through walls
- [ ] Subtle camera bob while walking, landing impact dip

## Phase 2: Shooting

- [ ] A rifle viewmodel in the bottom right of the screen (built from simple shapes is fine)
- [ ] Hitscan shooting (instant raycast from the center of the screen)
- [ ] Crosshair in the center of the screen
- [ ] Muzzle flash, recoil kick, and a short screen shake
- [ ] Impact effects: dust puff that hangs and falls slowly, plus a small spark
- [ ] Magazine ammo count and reload with R
- [ ] Aim down sights with right click (zoom in FOV, steadier aim)

## Phase 3: Targets and scoring

- [ ] Static bullseye targets (outer ring, inner ring, bullseye, worth different points)
- [ ] Pop-up targets that appear for a few seconds and then drop
- [ ] Moving targets: hovering drones that drift on slow paths
- [ ] In low gravity, hit targets should break apart and the pieces float away slowly
- [ ] Hit marker on the crosshair and a hit sound
- [ ] Score counter, accuracy %, and combo multiplier for consecutive hits
- [ ] A 60-second time trial mode with a results screen at the end

## Phase 4: The lunar surface

- [ ] Procedural terrain with craters and gentle hills
- [ ] Gray regolith (moon dust) ground texture
- [ ] Black sky with a starfield
- [ ] Earth visible in the sky, large and bright
- [ ] One harsh directional "sun" light with sharp shadows, very little ambient light
- [ ] Rocks and boulders scattered around
- [ ] Footprints or dust trails where the player walks (nice to have)

## Phase 5: The futuristic city

- [ ] One single large transparent pressurized dome at the center of the map (no multiple domes or connecting tunnels for v1)
- [ ] The dome should be big enough to hold the whole city: it is the main hub, and everything outside it is open lunar surface
- [ ] Inside: towers, walkways, a plaza, and an indoor shooting range
- [ ] Outside: landing pad, antennas, solar panel arrays, and modules connected by tubes
- [ ] Airlock doors between inside and outside
- [ ] Warm accent lighting (amber, orange, white) with a bloom glow
- [ ] Target courses placed around the city: rooftops, walkways, and out on the surface
- [ ] The level uses the low gravity: high ledges you can only reach with a jump plus jetpack

## Phase 6: Oxygen and game modes

- [ ] Oxygen meter that drains outside the dome and refills inside
- [ ] Oxygen rewards for hitting targets outside
- [ ] Game over when oxygen runs out
- [ ] Game modes:
  - **Range:** free practice inside the dome, no timer
  - **Time Trial:** 60 seconds, highest score wins
  - **Oxygen Run:** survive as long as possible outside by hitting targets to stay alive
- [ ] High scores saved locally for each mode

## Phase 7: HUD and menus

- [ ] Helmet visor style HUD: slight curve or vignette at the edges, readouts for oxygen, jetpack fuel, ammo, score, timer
- [ ] Main menu: Play (choose mode), Settings, High Scores
- [ ] Pause menu with Esc
- [ ] Settings: mouse sensitivity, field of view, volume, graphics quality (low/medium/high)
- [ ] Color scheme: black panels, white text, amber/orange highlights, no default blue

## Phase 8: Audio

- [ ] Gunfire, reload, hit, target break, footsteps, jetpack thrust, airlock door
- [ ] Breathing sound outside the dome that speeds up as oxygen gets low
- [ ] Low-oxygen warning beeps
- [ ] Vacuum muffling: low-pass filter on all world sounds while outside the dome
- [ ] Ambient hum inside the city

## Phase 9: Polish and performance

- [ ] Holds 60 FPS on a normal laptop on medium settings
- [ ] Use instanced meshes for repeated objects (rocks, lights, panels)
- [ ] Post-processing: bloom and a light film grain/vignette
- [ ] Loading screen while assets load
- [ ] FPS counter toggle (F3) for testing

## Phase 10: Deploy

- [ ] Production build with `npm run build`
- [ ] Deploy to GitHub Pages so it can be played from a link
- [ ] README with a short description, controls, and a screenshot

---

## Out of scope for v1 (ideas for later)

- Multiplayer (needs a server)
- AI enemies that shoot back
- Multiple weapons (pistol, rail gun with charge-up shot)
- Moon buggy you can drive around the city
- A story mode or missions
- Online leaderboard
- Extra domes connected by tunnels

## Open decisions

- Final game name
- Whether the rifle should be hitscan only or also have a slower "plasma" projectile option

## Decisions made

- Map layout: one big dome for v1. Several domes connected by tunnels can come later.
- Crouch is C only. Ctrl was dropped because browsers don't let a page block Ctrl+W, so crouch-walking forward could close the tab.
- Phase 5 replaced the Phase 1 movement sandbox with the city. Its moves (ramps, steps, crouching, jetpack-only ledges) now live in the city: ramps up to the walkways, rooftops you reach by jetpack.
- Oxygen rules (phase 6): the airlock chamber counts as inside. In Range, running out sends you back to the plaza instead of ending anything. Time Trial starts in the plaza, and running out of oxygen ends it early. Oxygen Run starts on the landing pad with both airlocks locked, and the drain grows 60% per minute survived. Its high score is time survived; the other modes keep the best score (Range saves when you quit to the menu).
