import { MAX_HEALTH } from '../balance'
import { projectPlayerPower } from '../battleEngine'
import type { Hero, Terrain, Weapon, WeaponType, WeaponWeight } from '../types'
import type { GunStats } from './types'
import { ARENA_HALF } from './world'

/**
 * Turns an armory weapon into a gun you have to aim.
 *
 * This is the module that decides whether the campaign survives the change of
 * genre. The old duel spent `projectPlayerPower` as damage-per-second, so a
 * matchup thirty points ahead on paper was thirty points ahead in the fight,
 * and the whole six-level ladder was tuned against that promise. Nothing in
 * `src/data` or `balance.ts` changes here, and the promise is kept:
 *
 *     sustained DPS = (power / REFERENCE_POWER) * (MAX_HEALTH / TIME_TO_KILL)
 *                     * dpsScale
 *
 * "Sustained" is the load-bearing word. A gun that spends a third of its
 * uptime reloading has to hit correspondingly harder per shot, or every
 * magazine-fed weapon would quietly be a third weaker than the number on its
 * card. So damage is derived backwards from a full magazine-plus-reload cycle
 * rather than from the fire interval alone.
 *
 *   weapon.power  + terrain fit -> damage per bullet
 *   weapon.range                -> how far the bullet keeps its damage
 *   weapon.weight               -> spread, recoil, how much moving costs you
 *   weapon.type                 -> the whole rhythm: magazine, reload, arc
 *
 * The hero then multiplies the result exactly as it did before: a commander
 * bends how the fight is fought, never what the weapon or the ground is worth.
 */

/**
 * The power a typical mid-campaign army fields, and how long it should take
 * that army to kill a full-health opponent.
 *
 * These two mirror the duel's constants in `combat.ts` deliberately — they are
 * the anchor the entire six-level ladder was tuned against, and changing
 * either one here silently retunes all six battles.
 */
const REFERENCE_POWER = 180
const TIME_TO_KILL = 14

/**
 * How much of a magazine an average player is assumed to actually land.
 *
 * A duel could not miss: a swing either reached or it did not, and the maths
 * above described a fight where every point of DPS arrived. A shooter can miss
 * every shot, so at identical power the arena would be strictly and invisibly
 * harder than the duel it replaced — the ladder would drift without a single
 * number in `src/data` changing.
 *
 * Rather than pretend, damage is scaled up by the reciprocal of this so that a
 * player hitting roughly this often experiences the time-to-kill the campaign
 * was tuned for. Shooting better than this is the skill reward; shooting worse
 * is the skill floor. It is the one honest fudge in the file, and it is here
 * where it can be seen rather than buried in a per-weapon table.
 */
const ASSUMED_ACCURACY = 0.62

/**
 * How each kind of weapon fights, before the specific weapon speaks.
 *
 * `dpsScale` is carried over unchanged from the duel's TYPE_PROFILE — it is
 * what trades safety against damage, and it is part of the tuning, not part of
 * the presentation. Everything else here is new, because a duel never had a
 * magazine.
 */
interface TypeProfile {
  /** Seconds between shots, before the hero's cycle multiplier. */
  fireInterval: number
  magazine: number
  reloadTime: number
  automatic: boolean
  pellets: number
  /** Units per second. Infinity is hitscan. */
  muzzleSpeed: number
  gravity: number
  splash: number
  melee: boolean
  overheat: boolean
  adsZoom: number
  /** Multiplies the weight-derived spread. A musket is not a rifle. */
  spreadScale: number
  recoilScale: number
  /** The duel's own value. Do not retune without retuning the campaign. */
  dpsScale: number
}

const TYPE_PROFILE: Record<WeaponType, TypeProfile> = {
  // A swung weapon: no bullet at all, an arc in front of you and a lunge to
  // close the last stride. Fast and relentless, but you have to be close
  // enough to be hit back — which in an arena means walking through everything
  // the gunners are putting out to get there.
  melee: {
    fireInterval: 0.5,
    magazine: 1,
    reloadTime: 0,
    automatic: true,
    pellets: 1,
    muzzleSpeed: 0,
    gravity: 0,
    splash: 0,
    melee: true,
    overheat: false,
    adsZoom: 1,
    spreadScale: 0,
    recoilScale: 0.4,
    dpsScale: 1.15,
  },
  // An arrow: slow, heavy, and it drops. One shaft at a time, and the nock is
  // the reload. Rewards leading a target the way no other weapon here does.
  ranged: {
    fireInterval: 0.34,
    magazine: 1,
    reloadTime: 0.8,
    automatic: false,
    pellets: 1,
    muzzleSpeed: 42,
    gravity: 22,
    splash: 0,
    melee: false,
    overheat: false,
    adsZoom: 0.78,
    spreadScale: 0.25,
    recoilScale: 0.5,
    dpsScale: 0.85,
  },
  // The default gun. The per-weapon table below is what makes a pistol feel
  // nothing like an assault rifle, because the type alone cannot say it.
  firearm: {
    fireInterval: 0.16,
    magazine: 12,
    reloadTime: 1.3,
    automatic: false,
    pellets: 1,
    muzzleSpeed: 150,
    gravity: 0,
    splash: 0,
    melee: false,
    overheat: false,
    adsZoom: 0.72,
    spreadScale: 1,
    recoilScale: 1,
    dpsScale: 1,
  },
  // One heavy shot after a long, committed aim, and it arrives instantly.
  // Hitscan is not a shortcut here: it is the whole identity of the weapon.
  sniper: {
    fireInterval: 1.15,
    magazine: 5,
    reloadTime: 2.6,
    automatic: false,
    pellets: 1,
    muzzleSpeed: Number.POSITIVE_INFINITY,
    gravity: 0,
    splash: 0,
    melee: false,
    overheat: false,
    adsZoom: 0.42,
    spreadScale: 1.6,
    recoilScale: 3.4,
    dpsScale: 0.8,
  },
  // A lobbed shell. Slowest of all, and it takes its time getting there, but
  // it is the only thing in the armory that hits more than one of them at once
  // — which is exactly what an arena full of bodies is asking for.
  siege: {
    fireInterval: 0.8,
    magazine: 1,
    reloadTime: 2.6,
    automatic: false,
    pellets: 1,
    muzzleSpeed: 26,
    gravity: 30,
    splash: 4.5,
    melee: false,
    overheat: false,
    adsZoom: 0.9,
    spreadScale: 0.8,
    recoilScale: 2,
    dpsScale: 0.9,
  },
  // Near-instant bolts that never need a magazine — but hold the trigger down
  // and the gun takes itself away from you, which is a harsher punishment than
  // a reload because you do not get to choose when it happens.
  energy: {
    fireInterval: 0.11,
    magazine: 24,
    reloadTime: 1.9,
    automatic: true,
    pellets: 1,
    muzzleSpeed: 110,
    gravity: 0,
    splash: 0,
    melee: false,
    overheat: true,
    adsZoom: 0.7,
    spreadScale: 0.55,
    recoilScale: 0.45,
    dpsScale: 1,
  },
}

/**
 * What you can carry decides how still you have to stand to hit anything.
 *
 * `moving` is deliberately several times `still`: standing to shoot is the
 * central tension of a third-person shooter, and if moving cost nothing there
 * would be no reason to ever stop.
 */
const WEIGHT_PROFILE: Record<WeaponWeight, { still: number; moving: number; ads: number; recoil: number }> = {
  light: { still: 0.012, moving: 0.052, ads: 0.0035, recoil: 0.009 },
  medium: { still: 0.018, moving: 0.072, ads: 0.0055, recoil: 0.014 },
  heavy: { still: 0.028, moving: 0.105, ads: 0.009, recoil: 0.022 },
}

/**
 * The handful of weapons whose character genuinely cannot be read off their
 * type, power and range.
 *
 * This is an honest exception rather than a convenience. Four weapons share
 * the `firearm` type and they are supposed to feel completely different: a
 * pocket pistol, a muzzle-loading musket that throws a handful of shot, a
 * deliberate bolt rifle and a thirty-round automatic. No formula over
 * `power`/`range` expresses "buck and ball", so the ones that need it say so
 * by name. Everything not listed is derived, and adding a weapon to
 * `src/data/weapons.ts` still needs no entry here.
 */
const PER_WEAPON: Record<string, Partial<TypeProfile>> = {
  // Small, fast, forgiving. The free weapon that has to stay worth carrying.
  'basic-pistol': { fireInterval: 0.15, magazine: 15, reloadTime: 1.05, spreadScale: 0.85 },
  // Buck and ball: one barrel, a fistful of shot, and a very long reload.
  // Devastating in a corridor, useless across a desert — which is precisely
  // what its card already promised.
  musket: {
    fireInterval: 0.5,
    magazine: 1,
    reloadTime: 2.1,
    pellets: 6,
    spreadScale: 5.2,
    recoilScale: 2.2,
  },
  // Deliberate and accurate. The bridge between the pistol and the automatic.
  rifle: { fireInterval: 0.3, magazine: 8, reloadTime: 1.75, spreadScale: 0.7, recoilScale: 1.3 },
  // Thirty rounds, held down. The one weapon that lets you simply hose a wave.
  'assault-rifle': { fireInterval: 0.095, magazine: 30, reloadTime: 1.95, automatic: true },
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** The longest sightline the arena physically has, corner to corner. */
const ARENA_DIAGONAL = ARENA_HALF * 2 * Math.SQRT2

/**
 * The player's gun: this weapon, on this ground, in this commander's hands.
 *
 * @param veterancy the same value `veterancyOf(state)` feeds the engine, so
 *                  the power this is built from is the power the preparation
 *                  screen already showed the player.
 */
export function gunFor(weapon: Weapon, terrain: Terrain, hero: Hero, veterancy: number): GunStats {
  const power = projectPlayerPower(weapon, terrain, veterancy)
  const base = TYPE_PROFILE[weapon.type]
  const profile: TypeProfile = { ...base, ...PER_WEAPON[weapon.id] }
  const weight = WEIGHT_PROFILE[weapon.weight]

  // The hero's cycle multiplier lands on the fire interval before anything is
  // derived from it, so a commander who shoots slowly still trades evenly —
  // they simply deliver the same damage in bigger, rarer pieces, and every
  // miss costs them more. This is the same shape `playerCombatStats` used.
  const fireInterval = profile.fireInterval * hero.cycle

  const sustainedDps =
    (power / REFERENCE_POWER) * (MAX_HEALTH / TIME_TO_KILL) * profile.dpsScale * hero.damage

  // One full magazine plus the reload that follows it. Deriving damage from
  // this rather than from `fireInterval` alone is what keeps a five-round
  // sniper and a thirty-round automatic honest against each other.
  const cycleSeconds = fireInterval * profile.magazine + profile.reloadTime
  const damagePerCycle = (sustainedDps / ASSUMED_ACCURACY) * cycleSeconds
  const damage = damagePerCycle / (profile.magazine * profile.pellets)

  // Range maps onto the arena rather than onto the old 22-unit duel strip. The
  // ceiling matters: a sniper whose falloff ran past the arena diagonal would
  // be paying for reach the ground cannot give it, and the desert level exists
  // precisely to make that reach worth something.
  const reachFraction = clamp(weapon.range / 120, 0, 1)
  const falloffStart = profile.melee
    ? // A swing has no falloff; this is simply how far the arc sweeps, and it
      // has to stay comfortably longer than an enemy's own attack range or a
      // melee player could never trade at all.
      clamp(2.6 + reachFraction * 3.4, 2.6, 6) * hero.reach
    : clamp(7 + reachFraction * 26, 7, ARENA_DIAGONAL) * hero.reach

  const falloffEnd = profile.melee
    ? falloffStart
    : clamp(falloffStart * 1.9, falloffStart + 1, ARENA_DIAGONAL)

  return {
    id: weapon.id,
    name: weapon.name,
    emoji: weapon.emoji,

    damage,
    fireInterval,
    automatic: profile.automatic,

    magazine: profile.magazine,
    reloadTime: profile.reloadTime,
    pellets: profile.pellets,

    spread: weight.still * profile.spreadScale,
    spreadMoving: weight.moving * profile.spreadScale,
    spreadAds: weight.ads * profile.spreadScale,

    muzzleSpeed: profile.muzzleSpeed,
    gravity: profile.gravity,

    falloffStart,
    falloffEnd,
    // A sniper keeps most of its punch at the far end; everything else falls
    // off hard, which is what stops a pistol from being a sniper you can spam.
    falloffFloor: weapon.type === 'sniper' ? 0.55 : 0.4,

    splash: profile.splash,
    melee: profile.melee,
    // Enough to close the last stride onto a target that is backing away, and
    // not so much that a swing teleports you past them.
    lunge: profile.melee ? 2.4 : 0,

    overheat: profile.overheat,
    adsZoom: profile.adsZoom,
    recoil: weight.recoil * profile.recoilScale,

    power,
  }
}
