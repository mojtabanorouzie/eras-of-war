# ⚔️ جنگ دوران‌ها — Eras of War

A small, mobile-first browser strategy game in Persian. Pick the right weapon for the
battlefield, win coins, unlock better gear, and beat the Future Commander.

No backend, no accounts, no network calls. Open a URL and play.

> **بازی به فارسی است.** سلاحت را انتخاب کن، میدان نبردت را انتخاب کن، تاریخ را عوض کن.

---

## Features

- ⚔️ **Tactical battles** — power is `army + weapon + terrain + veterancy + luck`, and every
  number is shown to the player before they commit
- 🧰 **Weapon armory** — 11 weapons across 5 eras; bought once, kept forever
- 🌲 **Five terrains** — forest, desert, ruined city, snow mountains, coast, each with real
  effects on weapon type, weight and range
- 🪙 **Economy** — start with 5,000 coins, earn more with every win
- 🏆 **Progression** — six battles ending in a boss fight, ~10–20 minutes
- 📱 **Mobile-first** — designed at 360×640, one-handed, 48px touch targets
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
3. **Press Battle.** Both sides roll ±10 luck, higher total wins.
4. **Winning pays coins.** Losing pays a small salvage, so a bad purchase never leaves you
   stuck with no way forward.
5. **Spend the coins in the Armory.** Weapons are permanent — using one never consumes it.

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
  data/          numbers only — weapons, terrains, enemies, levels
  game/          rules only — battle engine, economy, progression, storage
  components/    small reusable pieces
  screens/       one file per screen
  styles/        design tokens, then base / components / screens
```

The split is the point: **no React component decides a game rule, and no game rule knows
about React.** `simulateBattle()` in `src/game/battleEngine.ts` is a pure function you can
call from anywhere. Every tunable number lives in `src/game/balance.ts` or `src/data/`.

Adding a weapon is one object in `src/data/weapons.ts` — nothing else needs to change.

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
- **No runtime dependencies beyond React** and a self-hosted font. No CDN, no analytics,
  no external API. The game works offline once loaded.
- **Corrupted saves cannot crash the game.** `sanitizeState()` repairs every field
  independently and falls back to a fresh campaign; an error boundary catches anything else.
- **Sound is synthesised** with a few oscillators — no audio files, no autoplay. The
  AudioContext is only created after the player's first tap, and there is a mute switch.
- **Accessibility:** all text passes WCAG AA contrast on the dark background, touch targets
  are ≥48px, battle state is announced through `aria-live` rather than animation alone, and
  `prefers-reduced-motion` shortens the battle sequence instead of removing information.

---

## Future ideas

Not implemented, and deliberately so — the MVP is meant to stay small:

- More weapons and more eras
- Additional terrains and weather effects
- A campaign map with branching routes
- Character and army customisation
- Multiplayer or asynchronous duels
- An online leaderboard

---

The original game idea came from a child. The eras, the weapons, the money for winning, and
the final boss are all theirs — this version just makes them small enough to fit in a phone.
