# ⚔️ جنگ دوران‌ها — Eras of War

A mobile-first browser **third-person arena shooter** in Persian, wrapped in a small
strategy campaign. Pick the right weapon for the battlefield, then go and fight for it in 3D:
move, aim, take cover, roll, reload, and clear the field wave by wave.

No backend, no accounts, no network calls. Open a URL and play.

> **بازی به فارسی است.** سلاحت را انتخاب کن، وارد میدان شو، و تاریخ را عوض کن.

---

## Features

- 🔫 **A real 3D firefight** — third-person, over-the-shoulder, Three.js. Free movement,
  stick or mouse aim, hip-fire and aimed fire, magazines and reloads, a dodge roll with
  i-frames, cover you can hide behind and splash that comes over the top of it
- 📱 **Twin-stick touch controls** — floating sticks that appear under your thumbs,
  tap-to-fire on the aim stick, and per-`pointerId` tracking so two thumbs never steal each
  other's gesture
- 🧠 **Four enemy roles** — rushers walk you down, gunners punish open ground, heavies lob
  splash at whoever stopped moving, and the Future Commander stops being patient below half
  health
- ⚔️ **The strategy layer is still underneath** — power is `army + weapon + terrain +
  veterancy`, every number is shown before you commit, and it is what sets your gun's damage
  and the size of the force that walks in at you
- 🧰 **Weapon armory** — 11 weapons across 5 eras; bought once, kept forever
- 🌲 **Five terrains** — forest, desert, ruined city, snow mountains, coast, each with real
  effects on weapon type, weight and range
- 🪙 **Economy** — start with 5,000 coins, earn more with every win
- 🏆 **Progression** — six battles ending in a boss fight, ~10–20 minutes
- 📱 **Mobile-first** — designed at 360×640, 48px touch targets. The campaign screens are
  one-handed; the arena wants two thumbs, as a twin-stick shooter must
- 💾 **Local save** — `localStorage`, with graceful recovery from corrupted data
- 🔤 **Persian RTL** — self-hosted Vazirmatn, Persian numerals throughout
- 🌐 **GitHub Pages** — deploys itself on every push to `main`

---

## How to play

You command an army. The army is always the same; what changes is the weapon in its hands
and the ground under its feet.

1. **You start with two free weapons** — a Stone Axe and a Basic Pistol. Neither is a
   throwaway: the axe wins battle 1 outright, and the pistol wins battle 3.
2. **Every battle has a terrain.** The preparation screen shows exactly what your weapon
   gains or loses there, broken into labelled parts, plus an honest read on your odds.
3. **Press Battle and fight it yourself.** The arena is 52 units across, furnished with cover
   that matches the ground. Enemies arrive in two or three waves. Every one of them flashes a
   wind-up before it strikes — that is the cue to roll, and a roll carries a few frames of
   invulnerability.
4. **Winning pays coins.** Losing pays a small salvage, so a bad purchase never leaves you
   stuck with no way forward.
5. **Spend the coins in the Armory.** Weapons are permanent — using one never consumes it.

### Controls

| | Touch | Keyboard & mouse | Gamepad |
| --- | --- | --- | --- |
| Move | left stick (push to the edge to sprint) | `W` `A` `S` `D`, `Shift` to sprint | left stick |
| Aim | right stick | mouse, via pointer lock | right stick |
| Fire | tap the aim stick, or hold `⦿` | left click | right trigger, or `RB` |
| Aim down sights | `◎`, a toggle | right click | left trigger, or `LB` |
| Reload | `⟳` | `R` | `X` / Square |
| Dodge roll | `⤢` | `Space` | `A` / Cross |
| Sprint | push the left stick to the edge | `Shift` | click the left stick, or push it to the edge |

Touch is the platform the layout is designed around. All three surfaces are live at once and
fold into a single `ArenaInput` — whichever one is being pushed hardest drives the commander,
so a machine with a touchscreen, a keyboard and a pad attached never has to be told which to
listen to. A pad is detected on its own; plug one in and the on-screen buttons get out of the
way, and unplug it and they come back. Taking a hit rumbles it, which is worth more in a
third-person shooter than it sounds — the thing that killed you is usually off screen.

The whole game is one lesson: **the right weapon for the ground beats the expensive weapon.**
That is not a slogan, it is in the numbers:

| Battle | Terrain | Enemy power | Cheapest weapon that wins |
| -----: | ------- | ----------: | ------------------------- |
| 1 | 🌲 Deep Forest | 176 | Stone Axe — **free** |
| 2 | 🏜️ Open Desert | 189 | Catapult — 5,000 |
| 3 | 🏚️ Ruined City | 206 | Basic Pistol — **free** (the 40,000-coin Sniper Rifle *loses* here) |
| 4 | ❄️ Snow Mountains | 203 | Assault Rifle — 30,000 |
| 5 | 🌊 Windy Coast | 236 | Catapult — the 5,000-coin one you already own |
| 6 | 🏚️ The Last Capital | 264 | Assault Rifle — beats the 100,000-coin Laser Rifle |

---

## Development

Requires Node 20+.

```bash
npm install
```

```bash
npm run dev
```

```bash
npm run build
```

```bash
npm run preview
```

`npm run build` type-checks with `tsc -b` before building, so a type error fails the build.
`npm run lint` runs oxlint.

To regenerate the app icons after editing the mark (no image dependencies — it writes PNGs
straight from a pixel buffer):

```bash
node scripts/generate-icons.mjs
```

### Project layout

```
src/
  data/          numbers only — weapons, terrains, enemies, levels, heroes
  game/          rules only — battle engine, economy, progression, storage
    arena/       the shooter: types, world constants, loadout, squad, sim, report
  render/        pixels only — no game rules, no React
    arena/       the 3D scene: camera, terrain, actors, effects
  components/    small reusable pieces, plus the arena loop, HUD and controls
  screens/       one file per screen
  styles/        design tokens, then base / components / screens / arena
```

The split is the point, and the shooter keeps it:

- **No React component decides a game rule, and no game rule knows about React.**
  `advanceArena(state, dt, input)` in `src/game/arena/sim.ts` is a pure, deterministic step
  function — no `Math.random()`, no DOM, no Three.js — so the same fight replays frame for
  frame from the same inputs.
- **The renderer cannot change the fight.** `src/render/arena/view.ts` declares the shapes the
  scene is allowed to read. TypeScript is structural, so the real `ArenaState` satisfies them
  without anything under `src/render/` ever importing the rules.
- Every tunable number lives in `src/game/balance.ts`, `src/game/arena/world.ts` or `src/data/`.

Adding a weapon is still one object in `src/data/weapons.ts` — `loadout.ts` derives a working
gun from its type, power, range and weight without another line of code.

---

## Deployment

The repository ships with `.github/workflows/deploy.yml`, which builds and publishes to
GitHub Pages on every push to `main`.

**One-time setup:** in the repository, go to **Settings → Pages → Build and deployment**, and
set **Source** to **GitHub Actions**. Push to `main`, and the site appears at:

```
https://<username>.github.io/<repository-name>/
```

You do **not** need to configure a base path. `vite.config.ts` builds with `base: './'`, so
every asset is referenced relatively and the same build works at a domain root, in a
subdirectory, or from a `file://` path. If you ever need an absolute base, set the
`VITE_BASE_PATH` environment variable at build time and it takes over.

---

## Technical notes

- **React 19 + TypeScript (strict) + Vite.** `strict`, `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes` are all on.
- **Three runtime dependencies:** React, Three.js and a self-hosted font. No CDN, no
  analytics, no external API. The game works offline once loaded.
- **Three.js is code-split.** It is fetched the first time a battle starts, so the home screen
  never downloads a renderer it will not use — about 143 kB gzipped, in its own chunk.
- **The campaign's balance survived the change of genre.** `loadout.ts` spends the same tuned
  power the strategy engine already computed as *sustained* damage per second, accounting for
  magazine and reload, and `squad.ts` sizes the enemy force from the same numbers. The lessons
  still hold: in the ruined city the free pistol still clears the field faster than the
  40,000-coin sniper rifle, and at the boss the assault rifle still edges out the
  100,000-coin laser.
- **No WebGL, no dead end.** A device that cannot give us a GL context settles the battle with
  the campaign's original dice roll and says so plainly, rather than faking a firefight.
- **Corrupted saves cannot crash the game.** `sanitizeState()` repairs every field
  independently and falls back to a fresh campaign; an error boundary catches anything else.
- **Sound is synthesised** with a few oscillators — no audio files, no autoplay. The
  AudioContext is only created after the player's first tap, and there is a mute switch.
- **Accessibility:** all text passes WCAG AA contrast on the dark background, touch targets
  are ≥48px, and `prefers-reduced-motion` removes screen shake and HUD animation without
  removing information. The arena is a real-time shooter and is not playable without sight or
  without a pointer; the campaign screens around it are ordinary accessible HTML.

---

## Future ideas

Not implemented, and deliberately so — the MVP is meant to stay small:

- More weapons and more eras
- Additional terrains and weather effects
- Verticality: ramps and rooftops, which the ruined city is asking for
- Remappable controls and a look-sensitivity slider
- Character and army customisation
- Multiplayer or asynchronous duels
- An online leaderboard

---

The original game idea came from a child. The eras, the weapons, the money for winning, and
the final boss are all theirs — this version just makes them small enough to fit in a phone.
