# Low-G: Salvage Run

A single-player extraction mode. A cargo convoy broke up in orbit, and its pods are strewn
across the plain around the city. A solar storm is coming. Go out through the airlocks,
crack open the wreckage, and carry what you find back inside before the storm hits. Your
haul only counts once it's through an airlock. Die out there and what you were carrying
is lost.

## Why this mode

Extraction games are the most talked-about shooter format right now. ARC Raiders, a PvE-heavy
extraction shooter where players scavenge while robotic machines hunt them, launched in late
2025 to hundreds of thousands of players. The genre's hook is a stake that grows the longer
you push, set against the choice to bank it or gamble for more, under time pressure and a
rising threat. Good single-player versions soften losses (insurance, partial rewards) and
carry progress between runs.

Low-G already has the pieces: oxygen as a clock, a safe dome with airlocks, an open lunar
surface, and hostile drones. Salvage Run turns them into that loop.

## The run

- A solar storm hits 10 minutes after the start. Warnings sound (siren, announcer, banner) at
  2:00, 1:00 and 0:30. Over the last minute radiation creeps into the visor: a warm haze,
  grain and a Geiger counter that clicks faster as it builds.
- When the storm hits, the surface is deadly: radiation takes 12 suit integrity a second.
  If you're inside when it hits (or get inside after), the run ends: sheltered, and your
  banked salvage is your score.
- You can end a run early at a storm shelter console inside each airlock (hold E). It
  shows the countdown and your banked salvage.
- You start inside the dome, by airlock S, with a sidearm and a burst carbine.
- The dome is safe. No drones come inside, and the ones outside lose your signal and pull
  back a couple of seconds after you get in. Inside, your suit mends and your oxygen refills.
  Coming in through an airlock banks everything you carry and refills your ammo.
- Outside, oxygen drains at 70% of the usual rate (about 80 seconds from full), so the
  far wrecks are within reach on one tank.

## Caches

16 wreck sites are picked at random each run from a fixed set of candidate spots across
the plain. The farther out, the richer:

| Kind | Count | Where | Salvage | Opening |
|---|---|---|---|---|
| Scrap crate | 6 | 100-140 m out | 60-120 | 1.6 s |
| Cargo pod | 6 | 140-190 m | 160-300 | 2.4 s |
| Armored vault | 3 | 190-235 m | 420-700 | 3.4 s, its alarm calls 2 drones |
| Black box | 1 | one of the farthest sites | 1,200 | 4.5 s, calls a 4-drone strike team |

- Each site has a scorched impact ring, a small distress beacon on a whip antenna, and a
  soft shaft of light in its kind's color (white, amber, gold, white-gold). The shaft faces
  you, is drawn wider far off so it can be found across the plain, and fades up close.
- The black box is a crashed satellite: its foil-wrapped body, a snapped solar wing, the
  other wing in pieces, a dish thrown clear, and the orange flight recorder.
- Hold E to open one. Taking a hit knocks you off it (some progress is lost) and you have
  to press E again. A vault's alarm goes off the moment you start on it.
- Glowing salvage pops out, hangs in the low gravity, then streaks into you.
- Crates and pods sometimes hold something useful too (vaults and the black box always do):
  an oxygen canister (+40), a suit patch (+50) or an ammo pack. What you need most is likelier.
- Destroyed drones are worth 15 salvage each.

## Weight

What you carry slows you down: every 1,000 salvage costs 7% of your speed and jetpack lift,
up to 35%. The HUD shows your load: LIGHT, MEDIUM (800), HEAVY (2,000), OVERLOADED (3,500).

## Heat and threat

Heat (0 to 100) rises 0.6 a second outside, with every cache you open (6, 10, 18, 35 by
kind) and with every shot. It cools 3 a second inside. Heat sets the threat level, 1 to 5
(from heat 20, 40, 60, 80), and the storm holds it up: at least 3 with three minutes left,
at least 4 with one minute left.

| Level | Most drones out | Seconds between drops | Kinds |
|---|---|---|---|
| 1 | 2 | 9 | scouts |
| 2 | 3 | 7.5 | scouts, gunners |
| 3 | 5 | 6 | scouts, gunners, kamikazes |
| 4 | 6 | 5 | adds snipers and shielded drones |
| 5 | 8 | 4 | everything |

Drones drop in from high above, 40-60 m from you, with a red warning flare, and only while
you're outside (the first comes 12 s after you step out). They're as tough as Drone Siege's
round 3 at level 1, and a round tougher each level up. An alarm's drones are a level up again.

## Quartermaster

Banked salvage also adds up across runs, plus a fifth of anything lost on the surface, as
insurance. Lifetime totals unlock perks for every future run:

| Level | Lifetime salvage | Perk |
|---|---|---|
| 1 | 2,500 | Big Tank: oxygen +30% |
| 2 | 7,000 | Thruster Mk II jetpack |
| 3 | 14,000 | Start with the Plasma SMG as well (a third slot, key 3) |
| 4 | 24,000 | Scanner: cache values show on the compass |
| 5 | 40,000 | Auto-Medic: get back up once per run |

## HUD

- The storm countdown under the compass, amber in the last two minutes and blinking in the
  last thirty seconds.
- The score panel shows banked salvage, what you carry and its load (with a meter for how
  much it slows you), and caches opened and drones destroyed.
- A threat panel: five level pips and the heat bar, with a note (rising, cooling, storm is close).
- Markers under the compass: a diamond per unopened cache in its kind's color, and the two
  airlocks while you're outside. The one nearest the middle is labeled with its name,
  distance and (with the scanner) value.
- A ring round the crosshair while you hold E.
- Banners for the big moments: the start, threat levels, alarms, storm warnings, banking.

## Results and records

Results show banked salvage, caches opened, trips home, drones destroyed, salvage lost on the
surface, time outside and accuracy, then the Quartermaster: level, what this run added (and
how much was insurance), a bar filling toward the next perk, and any perk just unlocked. The
best haul is saved and shown on the mode select screen with the Quartermaster level.

## Code

`src/salvage/`: `salvage.ts` runs it (storm clock, banking, opening, perks), `director.ts`
the heat, threat and drone drops (Drone Siege's drones, dropped through movable sky-drop
points), `sites.ts` the wreck sites and their models, `shelter.ts` the consoles, and
`quartermaster.ts` the saved progress. The HUD is `src/ui/salvageHud.ts`, the sounds
`src/audio/salvageSounds.ts`. Every number is in `CONFIG.salvage`.
