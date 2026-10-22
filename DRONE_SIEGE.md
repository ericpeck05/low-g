# Low-G: Drone Siege Mode

## Context (read this first)

The game in this repo is already built to the original spec in `CLAUDE.md`: movement with moon gravity, jetpack, hitscan shooting, drone targets, the single big dome city, the lunar surface, oxygen, HUD, audio, and deploy. Do not rebuild any of it. This document adds a brand new game mode.

`CLAUDE.md` listed "AI enemies that shoot back" as out of scope. That changes now. This mode is built around them.

If any features from `GAMEPLAY_OVERHAUL.md` already exist in the code (slide, jetpack dash, combo system, new target types), reuse them. If they don't, this mode does not depend on them.

## The concept

Drone Siege is a wave survival mode inspired by Call of Duty Zombies. Hostile drones attack the lunar city in rounds. Every round brings more drones, tougher drones, and new types. You earn points for every hit and kill, and spend them on weapons, suit upgrades, and opening up more of the city. There is no winning, only surviving longer. The score that matters is the highest round you reach.

What makes it different from Zombies: the enemies fly, and so do you. Low gravity jumps and the jetpack are how you dodge, and oxygen still drains outside the dome, so some of the most valuable upgrades are out on the surface where it's dangerous.

## How to work on this (instructions for Claude Code)

- Read through the existing code and `CLAUDE.md` first so this mode fits the current structure.
- Build one phase at a time, in order. At the end of each phase, run the dev server, confirm no console errors, summarize the changes, and stop so I can playtest.
- Put every tunable number in `src/config.ts`: drone health, damage, speed, fire rate, spawn counts per round, point values, prices, perk effects. Balancing this mode will take a lot of tweaking.
- Use object pooling for drones, projectiles, and effects so late rounds stay smooth.
- Keep the existing visual direction: black, white, amber/orange accents, no default blue. Hostile drones should glow red so they read instantly as enemies.
- Commit to git at the end of each phase, for example `Siege 1: hostile drones`.
- When finished, update `CLAUDE.md` to describe Drone Siege as part of the game.

## Phase 1: Hostile drones and player health

Get one enemy that fights back and feels fair.

- Scout drone (the basic enemy): hovers and strafes around the player at medium range, keeps a little distance, and fires slow glowing plasma bolts
- Enemy shots are visible projectiles, not hitscan, so they can be dodged with jumps, strafing, and the jetpack
- Telegraphing: drones glow brighter for about half a second before firing, so a skilled player can react
- Drones avoid flying through buildings and the dome wall (simple steering and obstacle avoidance is fine)
- Drones have a weak point core: hitting it does double damage
- Player health = suit integrity. Shown on the HUD. Regenerates after a few seconds without taking damage, like Call of Duty.
- Damage feedback: red flash at the screen edges, a direction indicator showing where the shot came from, cracked visor overlay at low health, suit alarm sound
- Death: when suit integrity hits zero, the run ends and shows a game over screen
- Drone death: sparks, explosion, debris that floats down slowly in low gravity

## Phase 2: The round system

- Big round number on the HUD (stylized, in a corner, like Zombies)
- Each round spawns a set number of drones. Not all at once: drones trickle in, with a cap on how many are alive at the same time (start around 24, tune for performance).
- Scaling per round (all in `config.ts`):
  - Total drones per round increases each round
  - Drone health increases each round
  - Drone fire rate and accuracy increase slowly
  - New drone types unlock at certain rounds (see Phase 4)
- Spawn points: drones fly in through hangar bays, vents, and openings in the dome roof. Only spawn points in areas the player has unlocked are active (see Phase 5).
- Short intermission between rounds (about 10 seconds) with a round-end sound and the next round number appearing
- Drones that lose track of the player for too long fly toward them so rounds never stall

## Phase 3: Points and weapons

- Points economy:
  - Each hit on a drone: +10
  - Kill: +60
  - Weak point (core) kill: +100
- Points shown on the HUD with small "+10" popups when earned
- Player starts with a basic sidearm and one weapon slot open; max two weapons carried
- Swap weapons with the scroll wheel or 1/2
- Weapon stations mounted on walls around the city. Walk up and press E to buy. Buying again later refills ammo at a lower price. Starting lineup:
  - Plasma SMG: fast fire, low damage, cheap
  - Scatter Cannon: shotgun, great up close
  - Burst Carbine: three-round burst, mid range
  - Rail Rifle: slow, powerful, pierces through multiple drones in a line
- Each weapon has its own sound, viewmodel (built from shapes is fine), recoil, and ammo count

## Phase 4: The drone roster

New drone types unlock as rounds go up (round numbers are starting values to tune):

- Scout (round 1+): the basic drone from Phase 1
- Gunner (round 4+): bulkier, more health, fires bursts of bolts
- Shielded (round 8+): a front-facing energy shield blocks shots; you must hit it from the side or behind, or wait for it to turn
- Sniper (round 10+): stays far away, charges a visible red beam for about 1.5 seconds, then fires a hard-hitting shot. Breaking line of sight cancels it.
- Repair drone (round 12+): doesn't attack, heals nearby drones. Priority target.
- Swarm rounds (special, roughly every 5 to 7 rounds, like the dog rounds in Zombies): a different alarm plays, the lighting shifts, and only small fast kamikaze drones come, which explode on contact. Finishing a swarm round drops a guaranteed Max Ammo.
- Carrier boss (every 10th round): a large drone that launches Scouts from its bay, has armored plating and two or three glowing weak points to destroy. Big point reward.

## Phase 5: Map unlocking, power, and upgrades

This is what gives each game a sense of progress, like opening doors in Zombies.

- Player starts in one small section of the dome. Other sections are closed off by blast doors that cost points to open (prices increase deeper into the city). Opening a door unlocks new weapon stations and spawn points.
- Power is off at the start. The power generator is outside the dome on the lunar surface, so the player has to go through the airlock, survive on oxygen while drones attack, and flip it on. Turning power on:
  - Lights up the city
  - Activates suit mod stations and the Overclock station
- Suit mods (like perks), bought at stations once power is on. Max 4 at a time:
  - Reinforced Plating: more suit integrity
  - Rapid Cycler: faster reload
  - Thruster Mk II: more jetpack fuel and faster recharge
  - Overcharge: faster fire rate
  - O2 Recycler: oxygen drains much slower outside
  - Auto-Medic: if you die, you're revived on the spot once (solo version of Quick Revive, can be rebought, max 3 times per game)
- Supply Drop (like the Mystery Box): costs points, gives a random weapon, including rare ones only found here:
  - Singularity Launcher: fires a small black hole that pulls drones in and crushes them
  - Arc Caster: lightning that chains between nearby drones
  - Supply Drop moves to a new location after several uses
- Overclock station (like Pack-a-Punch): expensive upgrade that makes a weapon much stronger, gives it more ammo, a new color, and a new name

## Phase 6: Power-up drops

Destroyed drones occasionally drop glowing power-ups that float in low gravity and disappear after about 20 seconds:

- Max Ammo: refills all weapons
- Double Points: 2x points for 30 seconds
- One Shot: every hit destroys a drone for 30 seconds
- EMP Blast: destroys every drone alive right now
- O2 Surge: fully refills oxygen
- Each has a distinct icon, an announcer callout, and a timer on the HUD while active
- Drop rate is limited per round so they stay special

## Phase 7: HUD, menus, and game over

- Drone Siege added to the main menu as its own mode
- HUD shows: round number, points, suit integrity, oxygen (when outside), ammo, active power-ups, owned suit mods as icons
- Prompts when near something buyable: "Press E: Rail Rifle [1250]"
- Game over screen: round reached, drones destroyed, weak point kills, accuracy, points earned, time survived
- Records: highest round, most kills in one game, saved locally; best round shown on the mode select screen
- Music or ambient tension that builds in later rounds

## Phase 8: Balance and performance

- Rounds 1 to 5 should feel easy and teach the basics
- Rounds 10 to 15 should feel tense; a new player should usually die somewhere in here
- Rounds 20+ should require full upgrades and good movement
- Holds 60 FPS with the max number of drones alive and effects going
- Add a debug menu (toggle with F4) to jump to any round, give points, and spawn any drone type, so balance testing is fast

## Out of scope for now

- Co-op or multiplayer
- Story or easter egg quests (fun idea for later)
- Online leaderboard for highest round (possible later with a free database, no game server needed)

## Open decisions

- Final name for the mode (working title: Drone Siege)
- ~~Names for the dome sections behind the blast doors~~ Decided: Plaza (start), Tower Ring, South District, North District. The "blast doors" are see-through energy barriers, so the open dome stays in view.
- Whether drones can damage or breach the dome itself as an extra twist
