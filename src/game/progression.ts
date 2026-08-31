import { LEVELS, TOTAL_LEVELS, findLevel } from '../data/levels'
import { findEnemy } from '../data/enemies'
import { findTerrain } from '../data/terrains'
import { WEAPONS, findWeapon } from '../data/weapons'
import { SCORE, VETERANCY_PER_WIN } from './balance'
import type { Enemy, GameState, Level, Terrain, Weapon } from './types'

/** Every win makes the whole army a little better, whatever they are holding. */
export function veterancyOf(state: GameState): number {
  return state.stats.battlesWon * VETERANCY_PER_WIN
}

export function ownedWeapons(state: GameState): Weapon[] {
  return WEAPONS.filter((weapon) => state.ownedWeaponIds.includes(weapon.id))
}

export function equippedWeapon(state: GameState): Weapon {
  // Storage guarantees the equipped id is owned, but fall back rather than throw.
  return findWeapon(state.equippedWeaponId) ?? WEAPONS[0]!
}

export function bestOwnedWeapon(state: GameState): Weapon {
  const owned = ownedWeapons(state)
  return owned.reduce<Weapon>((best, weapon) => (weapon.power > best.power ? weapon : best), owned[0] ?? WEAPONS[0]!)
}

/** Everything a battle screen needs, resolved from ids in one place. */
export interface BattleSetup {
  level: Level
  terrain: Terrain
  enemy: Enemy
}

export function battleSetupFor(levelId: number): BattleSetup | undefined {
  const level = findLevel(levelId)
  if (!level) return undefined
  const terrain = findTerrain(level.terrainId)
  const enemy = findEnemy(level.enemyId)
  if (!terrain || !enemy) return undefined
  return { level, terrain, enemy }
}

export function currentBattleSetup(state: GameState): BattleSetup | undefined {
  return battleSetupFor(state.currentLevel)
}

export function isCleared(state: GameState, levelId: number): boolean {
  return state.clearedLevelIds.includes(levelId)
}

export function campaignProgress(state: GameState): { cleared: number; total: number } {
  return { cleared: state.clearedLevelIds.length, total: TOTAL_LEVELS }
}

export function levelsWithStatus(
  state: GameState,
): { level: Level; cleared: boolean; current: boolean }[] {
  return LEVELS.map((level) => ({
    level,
    cleared: isCleared(state, level.id),
    current: level.id === state.currentLevel,
  }))
}

export function finalScore(state: GameState): number {
  const raw =
    state.stats.battlesWon * SCORE.perWin +
    state.stats.coinsEarned * SCORE.perCoinEarned +
    state.ownedWeaponIds.length * SCORE.perWeaponOwned +
    state.stats.battlesLost * SCORE.perLoss
  return Math.max(0, Math.round(raw))
}
