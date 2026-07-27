# LONGSHOT

A 3D sniper game that runs in the browser. No build step, no dependencies, no
asset files — a custom WebGL2 renderer, a procedurally generated desert town,
and synthesised audio, all in about 2,500 lines of plain JavaScript.

## Play

Open `index.html` in any browser with WebGL2 (or serve the folder over HTTP —
`npx http-server` works). Click **DEPLOY** and the game takes pointer lock.

## The job

You are in an overwatch tower 48 m above a valley town. Hostiles push up the
streets toward the gate you are defending. Every one that reaches it takes a
bite out of the gate's integrity; when the gate falls, so do you. Enemy
marksmen shoot back.

Clear a wave and you pick a perk. Then the next wave moves in, larger and
faster than the last. It does not stop.

## Controls

| | |
|---|---|
| Mouse | Aim |
| Right mouse / Space | Scope |
| Left mouse | Fire |
| Shift | Hold breath — steadies the reticle, costs air |
| Wheel | Change magnification |
| R | Reload |
| WASD | Shift your stance along the platform |
| C | Duck behind the parapet |
| F | FOCUS — bullet time and a kill cam |
| Esc | Pause · M mute |

## What makes the shot hard

Rounds are simulated, not hitscan. At 480 m/s a shot to the far end of the
town takes most of a second, and in that second gravity pulls it down several
metres while the crosswind walks it sideways. Read the range, hold over with
the ladder in the reticle, lead a moving target, and hold your breath — the
reticle wanders on its own otherwise.

Hits are zone-based. Headshots kill anything outright and pay double. Body
shots kill soft targets. Leg hits cripple. **HEAVY** troopers carry a front
plate that skips rounds straight off, so you take their head or you buy AP
rounds. A **MARKSMAN** telegraphs with a red scope glint before firing —
that's your cue to duck, which means giving up your own shot.

## Perks

Seventeen of them, stacking: steadier hands, faster bolt, bigger magazine,
match ammunition, armour-piercing rounds, overpenetration, a 16x optic, a
ballistic computer that predicts your point of impact, and more. Every run
builds a different rifle.

## Layout

```
index.html        markup, HUD, scope reticle
style.css         HUD, scope, menus
src/engine.js     math, shaders, mesh building, forward renderer
src/audio.js      procedural WebAudio voices
src/world.js      town generation, character meshes
src/entities.js   soldiers, ballistics, particles
src/game.js       rules, input, camera, waves, perks
```

The town is generated from a random seed each session, so the cover, the
sightlines and the skyline are different every run.
