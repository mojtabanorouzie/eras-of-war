import { ARMY_BASE_POWER } from './balance'
import { evaluateTerrainFit, explainFit, projectEnemyPower, projectPlayerPower } from './battleEngine'
import type { Odds } from './battleEngine'
import type { DuelResult } from './duel'
import { faNumber } from './format'
import type { BattleOutcome, Enemy, Terrain, Weapon, WeaponType, WeaponWeight } from './types'

/**
 * Turns the game's tuned strategy numbers into real-time combat stats.
 *
 * Nothing in `src/data` or `balance.ts` changes. This module reads the powers
 * the existing engine already computes — `projectPlayerPower` and
 * `projectEnemyPower`, which fold in weapon power, terrain fit, veterancy and
 * the enemy's ground advantage — and spends them as damage, reach and footwork.
 *
 * The six-level ladder therefore keeps its exact shape: a matchup that was 30
 * points in your favour on paper is 30 points in your favour in the fight. What
 * changes is that the fight, not a dice roll, decides who wins.
 *
 *   weapon.power + terrain fit  ->  damage per second
 *   weapon.range                ->  how far you can hit from
 *   weapon.weight               ->  how fast and far you can dodge
 *   weapon.type                 ->  attack rhythm: rate, wind-up, projectile
 */

/** Both armies field the same number of soldiers; power decides how hard they hit. */
export const MAX_HEALTH = 100

/** Half-width of the fighting ground, in world units. */
export const ARENA_HALF = 9

/** A fight that reaches this many seconds is decided on remaining health. */
export const DUEL_TIMEOUT = 30

/**
 * The power a "typical" mid-campaign army fields. Damage is scaled against it,
 * so an army at this power kills a full-health opponent in TIME_TO_KILL seconds.
 */
const REFERENCE_POWER = 180
const TIME_TO_KILL = 14

/** How a weapon type fights. dpsScale trades safety against damage. */
const TYPE_PROFILE: Record<
  WeaponType,
  { cycle: number; windUp: number; reachScale: number; projectileSpeed: number; dpsScale: number }
> = {
  // Fast and relentless, but you have to be close enough to be hit back.
  melee: { cycle: 0.45, windUp: 0.1, reachScale: 0.8, projectileSpeed: 0, dpsScale: 1.15 },
  // Arcing shots: safe, deliberate, not much damage per second.
  ranged: { cycle: 0.8, windUp: 0.2, reachScale: 1, projectileSpeed: 17, dpsScale: 0.85 },
  // A steady stream of small hits.
  firearm: { cycle: 0.35, windUp: 0.06, reachScale: 1, projectileSpeed: 32, dpsScale: 1 },
  // One heavy shot after a long, committed aim. Reaches nearly the whole field.
  sniper: { cycle: 1.6, windUp: 0.45, reachScale: 1.15, projectileSpeed: 46, dpsScale: 0.8 },
  // Slowest of all, and the shell takes its time getting there.
  siege: { cycle: 2, windUp: 0.55, reachScale: 1.1, projectileSpeed: 13, dpsScale: 0.9 },
  // Near-instant bolts on a short cycle.
  energy: { cycle: 0.5, windUp: 0.12, reachScale: 1, projectileSpeed: 60, dpsScale: 1 },
}

/** What you can carry decides how well you can get out of the way. */
const WEIGHT_PROFILE: Record<
  WeaponWeight,
  { dodgeDistance: number; dodgeCooldown: number; dodgeInvulnerable: number }
> = {
  light: { dodgeDistance: 3.4, dodgeCooldown: 0.7, dodgeInvulnerable: 0.3 },
  medium: { dodgeDistance: 2.7, dodgeCooldown: 0.95, dodgeInvulnerable: 0.26 },
  heavy: { dodgeDistance: 1.9, dodgeCooldown: 1.3, dodgeInvulnerable: 0.22 },
}

export interface CombatStats {
  maxHealth: number
  /** Damage of one landed hit. */
  damage: number
  /** Seconds from one attack to the next. */
  cycle: number
  /** Committed seconds before the hit leaves. You cannot dodge during it. */
  windUp: number
  /** How far this weapon can reach, in world units. */
  reach: number
  /** World units per second. 0 means the hit lands the instant the wind-up ends. */
  projectileSpeed: number
  dodgeDistance: number
  dodgeCooldown: number
  dodgeInvulnerable: number
  /** World units per second this side closes the gap. */
  approachSpeed: number
  /** The luck-free power this was derived from, for the report screen. */
  power: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * The player's kit.
 *
 * @param veterancy the same value `veterancyOf(state)` feeds the engine.
 */
export function playerCombatStats(
  weapon: Weapon,
  terrain: Terrain,
  veterancy: number,
): CombatStats {
  const power = projectPlayerPower(weapon, terrain, veterancy)
  const type = TYPE_PROFILE[weapon.type]
  const weight = WEIGHT_PROFILE[weapon.weight]

  // Damage per second scales linearly with the tuned power, so the on-paper
  // gap and the in-fight gap are the same gap.
  const damagePerSecond = (power / REFERENCE_POWER) * (MAX_HEALTH / TIME_TO_KILL) * type.dpsScale

  return {
    maxHealth: MAX_HEALTH,
    damage: damagePerSecond * type.cycle,
    cycle: type.cycle,
    windUp: type.windUp,
    // range 10 -> a spear's length, range 120 -> most of the field. The floor
    // matters: a weapon that cannot out-reach ENGAGE_DISTANCE can never land a
    // blow at all, which would silently delete every melee weapon from the game.
    reach: clamp((2.8 + (weapon.range / 120) * 8.2) * type.reachScale, 2.6, ARENA_HALF * 1.3),
    projectileSpeed: type.projectileSpeed,
    dodgeDistance: weight.dodgeDistance,
    dodgeCooldown: weight.dodgeCooldown,
    dodgeInvulnerable: weight.dodgeInvulnerable,
    // The player never advances on their own; the enemy closes the distance.
    approachSpeed: 0,
    power,
  }
}

/** Reach an enemy army has on neutral ground, before the terrain speaks. */
const ENEMY_BASE_REACH = 4.8

/**
 * The enemy's kit.
 *
 * Enemies carry only a power number in `src/data`, so their damage comes
 * straight from that power and their rhythm is fixed. What scales with the
 * campaign is how fast they close — later armies give you less room.
 *
 * Their reach bends with the terrain's own `rangeSlope`, exactly as the
 * player's does. That symmetry is load-bearing: a forest that "blocks every
 * long shot" has to shorten the enemy's reach too, or the free Stone Axe never
 * gets the close-quarters fight the first level was designed to hand it.
 */
export function enemyCombatStats(enemy: Enemy, terrain: Terrain): CombatStats {
  const power = projectEnemyPower(enemy.weapon, enemy.terrainEdge)
  const damagePerSecond = (power / REFERENCE_POWER) * (MAX_HEALTH / TIME_TO_KILL)
  const cycle = 1.25

  // The weakest enemy sits near 158 power, the boss near 264.
  const menace = clamp((power - 158) / 106, 0, 1)

  return {
    maxHealth: MAX_HEALTH,
    damage: damagePerSecond * cycle,
    cycle,
    // Long enough to read and react to on a phone.
    windUp: 0.42,
    reach: clamp(ENEMY_BASE_REACH + terrain.rangeSlope * 0.55, 2.6, 7),
    projectileSpeed: 0,
    dodgeDistance: 0,
    dodgeCooldown: 0,
    dodgeInvulnerable: 0,
    approachSpeed: 3.2 + menace * 1.5,
    power,
  }
}

/**
 * Rebuilds the report screen's `BattleOutcome` from a finished fight.
 *
 * The breakdown it carries is still the honest one: those numbers are exactly
 * what set both sides' combat stats, so the terrain lesson the report teaches
 * is the lesson that decided the fight. What is gone is `luck` — a real-time
 * duel has no dice to roll, so both sides report zero and the report screen
 * drops those rows.
 */
export function reportDuel(
  weapon: Weapon,
  terrain: Terrain,
  veterancy: number,
  enemy: Enemy,
  result: DuelResult,
): BattleOutcome {
  const fit = evaluateTerrainFit(weapon, terrain)
  const playerPower = projectPlayerPower(weapon, terrain, veterancy)
  const enemyPower = projectEnemyPower(enemy.weapon, enemy.terrainEdge)
  const won = result.winner === 'player'

  const seconds = faNumber(Math.round(result.duration))
  const survived = faNumber(Math.round(won ? result.playerHealth : result.enemyHealth))
  const outcomeLine = result.timedOut
    ? `وقت میدان تمام شد و جانِ بیشتر تصمیم گرفت — ${survived} درصد باقی مانده بود.`
    : won
      ? `در ${seconds} ثانیه خطشان را شکستی و با ${survived} درصد جان بیرون آمدی.`
      : `در ${seconds} ثانیه افتادی؛ آن‌ها با ${survived} درصد جان سرِ پا ماندند.`

  return {
    playerPower,
    enemyPower,
    winner: result.winner,
    terrainBonus: fit.total,
    explanation: `${explainFit(weapon, terrain, fit)} ${outcomeLine}`,
    margin: playerPower - enemyPower,
    player: {
      base: ARMY_BASE_POWER,
      weapon: weapon.power,
      terrain: fit.total,
      veterancy,
      luck: 0,
    },
    enemy: {
      base: ARMY_BASE_POWER,
      weapon: enemy.weapon.power,
      terrain: enemy.terrainEdge,
      veterancy: 0,
      luck: 0,
    },
    fit,
  }
}

/**
 * How to read the pre-battle gap now that a fight, not a dice roll, settles it.
 *
 * `readOdds` in `battleEngine.ts` still describes the same power gap correctly,
 * but its wording promises that luck decides the close ones — and there is no
 * luck left to decide them. This says the true thing instead: the gap sets how
 * much room your play has to make up.
 */
export function readDuelOdds(edge: number): Odds {
  if (edge > 40) {
    return {
      tone: 'good',
      headline: 'برتری سنگین',
      detail: `${faNumber(edge)} امتیاز جلوتری — سخت‌تر ضربه می‌زنی و بیشتر دوام می‌آوری.`,
    }
  }
  if (edge >= 6) {
    return {
      tone: 'good',
      headline: 'برتری با توست',
      detail: `${faNumber(edge)} امتیاز جلوتری. اگر جاخالی‌ها را نبازی، این نبرد مالِ توست.`,
    }
  }
  if (edge >= -5) {
    return {
      tone: 'even',
      headline: 'برابر است',
      detail: 'هیچ‌کدام برتری ندارید؛ هر ضربه‌ای که جاخالی بدهی، همان تفاوت را می‌سازد.',
    }
  }
  if (edge >= -40) {
    return {
      tone: 'bad',
      headline: 'عقب افتاده‌ای',
      detail: `${faNumber(Math.abs(edge))} امتیاز عقبی — کندتر می‌زنی، پس باید تمیزتر جاخالی بدهی.`,
    }
  }
  return {
    tone: 'bad',
    headline: 'خیلی عقبی',
    detail: `${faNumber(Math.abs(edge))} امتیاز عقبی. می‌شود برد، اما تقریباً هیچ ضربه‌ای نباید بخوری — یا سلاحی بردار که به این زمین بیاید.`,
  }
}
