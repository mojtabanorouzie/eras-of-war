import {
  ARMY_BASE_POWER,
  LUCK_SWING,
  MATCH_BONUS,
  MAX_RANGE_BONUS,
  RANGE_PIVOT,
  RANGE_STEP,
} from './balance'
import { faNumber, faSigned } from './format'
import type {
  BattleOutcome,
  BonusNote,
  EnemyWeapon,
  SideBreakdown,
  Terrain,
  TerrainFit,
  Weapon,
} from './types'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

const TYPE_LABELS: Record<Weapon['type'], string> = {
  melee: 'سلاح نزدیک‌زن',
  ranged: 'سلاح پرتابی',
  firearm: 'سلاح گرم',
  sniper: 'تک‌تیرانداز',
  siege: 'ماشین محاصره',
  energy: 'سلاح انرژی',
}

const WEIGHT_LABELS: Record<Weapon['weight'], string> = {
  light: 'تجهیزات سبک',
  medium: 'تجهیزات متوسط',
  heavy: 'تجهیزات سنگین',
}

/**
 * How well a weapon suits a battlefield, broken into the parts the UI shows
 * the player before they commit. Pure, deterministic, no randomness.
 */
export function evaluateTerrainFit(weapon: Weapon, terrain: Terrain): TerrainFit {
  const typeBonus = terrain.typeModifiers[weapon.type]
  const weightBonus = terrain.weightModifiers[weapon.weight]
  const rangeBonus = clamp(
    Math.round((terrain.rangeSlope * (weapon.range - RANGE_PIVOT)) / RANGE_STEP),
    -MAX_RANGE_BONUS,
    MAX_RANGE_BONUS,
  )
  const matchBonus = weapon.bestTerrain === terrain.id ? MATCH_BONUS : 0

  const notes: BonusNote[] = []
  if (matchBonus !== 0) notes.push({ label: 'ساختهٔ همین زمین', value: matchBonus })
  if (typeBonus !== 0) notes.push({ label: TYPE_LABELS[weapon.type], value: typeBonus })
  if (weightBonus !== 0) notes.push({ label: WEIGHT_LABELS[weapon.weight], value: weightBonus })
  if (rangeBonus !== 0) {
    notes.push({
      label: weapon.range >= RANGE_PIVOT ? 'بردِ بلند' : 'بردِ کوتاه',
      value: rangeBonus,
    })
  }

  return {
    typeBonus,
    weightBonus,
    rangeBonus,
    matchBonus,
    total: typeBonus + weightBonus + rangeBonus + matchBonus,
    notes,
  }
}

/** The player's power with luck removed — what the battle-prep screen promises. */
export function projectPlayerPower(weapon: Weapon, terrain: Terrain, veterancy: number): number {
  return ARMY_BASE_POWER + weapon.power + evaluateTerrainFit(weapon, terrain).total + veterancy
}

/** The enemy's power with luck removed. */
export function projectEnemyPower(enemyWeapon: EnemyWeapon, enemyBonus: number): number {
  return ARMY_BASE_POWER + enemyWeapon.power + enemyBonus
}

/**
 * One readable sentence about why this weapon does well (or badly) here.
 * This is the whole point of the game, so it gets its own function.
 */
export function explainFit(weapon: Weapon, terrain: Terrain, fit: TerrainFit): string {
  if (fit.matchBonus > 0) {
    return `${weapon.emoji} ${weapon.name} دقیقاً برای ${terrain.name} ساخته شده — کامل ${faSigned(MATCH_BONUS)} امتیاز روی این زمین.`
  }

  const strongest = [...fit.notes].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0]
  if (!strongest) {
    return `${terrain.emoji} ${terrain.name} برای ${weapon.name} زمین بی‌طرفی است — نه سودی، نه ضرری.`
  }
  if (strongest.value > 0) {
    return `${terrain.emoji} ${terrain.name} به ${weapon.name} می‌آید: ${strongest.label} اینجا ${faSigned(strongest.value)} امتیاز می‌ارزد.`
  }
  return `${terrain.emoji} ${terrain.name} با ${weapon.name} سرِ ناسازگاری دارد: ${strongest.label} اینجا ${faSigned(strongest.value)} امتیاز خرج برمی‌دارد.`
}

export interface BattleParams {
  playerWeapon: Weapon
  enemyWeapon: EnemyWeapon
  terrain: Terrain
  /** Veterancy earned from previous wins. */
  playerBonus: number
  /** How well the enemy army knows this ground. May be negative. */
  enemyBonus: number
  /** Injectable so the engine stays testable. Defaults to Math.random. */
  rng?: (() => number) | undefined
}

function rollLuck(rng: () => number): number {
  return Math.round((rng() * 2 - 1) * LUCK_SWING)
}

/**
 * Resolve one battle.
 *
 *   power = base army + weapon + terrain fit + veterancy + luck
 *
 * Both sides use the same shape, so the numbers on screen always add up.
 */
export function simulateBattle(params: BattleParams): BattleOutcome {
  const { playerWeapon, enemyWeapon, terrain, playerBonus, enemyBonus } = params
  const rng = params.rng ?? Math.random

  const fit = evaluateTerrainFit(playerWeapon, terrain)

  const player: SideBreakdown = {
    base: ARMY_BASE_POWER,
    weapon: playerWeapon.power,
    terrain: fit.total,
    veterancy: playerBonus,
    luck: rollLuck(rng),
  }
  const enemy: SideBreakdown = {
    base: ARMY_BASE_POWER,
    weapon: enemyWeapon.power,
    terrain: enemyBonus,
    veterancy: 0,
    luck: rollLuck(rng),
  }

  const playerPower = player.base + player.weapon + player.terrain + player.veterancy + player.luck
  const enemyPower = enemy.base + enemy.weapon + enemy.terrain + enemy.veterancy + enemy.luck
  const margin = playerPower - enemyPower
  const winner = margin >= 0 ? 'player' : 'enemy'

  const fitLine = explainFit(playerWeapon, terrain, fit)
  const resultLine =
    winner === 'player'
      ? `${faNumber(margin)} امتیاز جلوتر تمام کردی.`
      : `${faNumber(Math.abs(margin))} امتیاز جلوتر از تو تمام کردند — با یک سلاح دیگر این عدد عوض می‌شود.`

  return {
    playerPower,
    enemyPower,
    winner,
    terrainBonus: fit.total,
    explanation: `${fitLine} ${resultLine}`,
    margin,
    player,
    enemy,
    fit,
  }
}

/**
 * The best weapon for this terrain out of the ones passed in.
 * Used to nudge the player after a defeat instead of just saying "you lost".
 */
export function bestWeaponFor(weapons: Weapon[], terrain: Terrain): Weapon | undefined {
  return [...weapons].sort(
    (a, b) =>
      b.power +
      evaluateTerrainFit(b, terrain).total -
      (a.power + evaluateTerrainFit(a, terrain).total),
  )[0]
}

export type OddsTone = 'good' | 'even' | 'bad'

export interface Odds {
  tone: OddsTone
  headline: string
  detail: string
}

/**
 * Turns the pre-battle gap into plain language.
 *
 * Luck can swing the result by at most 2 x LUCK_SWING, so anything outside
 * that window is already decided — and the player deserves to know that
 * before they commit rather than after.
 */
export function readOdds(edge: number): Odds {
  const decisive = LUCK_SWING * 2

  if (edge > decisive) {
    return {
      tone: 'good',
      headline: 'برد قطعی',
      detail: `${faNumber(edge)} امتیاز جلوتری — دورتر از جایی که شانس بتواند برسد.`,
    }
  }
  if (edge >= 6) {
    return {
      tone: 'good',
      headline: 'برتری با توست',
      detail: `پیش از آنکه تاس شانس بیفتد، ${faNumber(edge)} امتیاز جلوتری.`,
    }
  }
  if (edge >= -5) {
    return {
      tone: 'even',
      headline: 'خیلی نزدیک است',
      detail: 'این یکی را شانس تعیین می‌کند. سلاح مناسب‌تر، تکلیف را روشن می‌کرد.',
    }
  }
  if (edge >= -decisive) {
    return {
      tone: 'bad',
      headline: 'عقب افتاده‌ای',
      detail: `${faNumber(Math.abs(edge))} امتیاز عقبی — فقط یک شانس بزرگ نجاتت می‌دهد.`,
    }
  }
  return {
    tone: 'bad',
    headline: 'این نبرد را نمی‌بری',
    detail: `${faNumber(Math.abs(edge))} امتیاز عقبی. سلاحی بردار که به این زمین بیاید.`,
  }
}
