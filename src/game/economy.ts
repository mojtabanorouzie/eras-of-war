import { SALVAGE_RATE } from './balance'
import type { GameState, Level, Weapon } from './types'

export function isOwned(state: GameState, weaponId: string): boolean {
  return state.ownedWeaponIds.includes(weaponId)
}

export function canAfford(state: GameState, weapon: Weapon): boolean {
  return state.coins >= weapon.cost
}

/**
 * Buying is permanent and never consumes anything. Returns a new state, or the
 * same state when the purchase is not legal.
 */
export function purchaseWeapon(state: GameState, weapon: Weapon): GameState {
  if (isOwned(state, weapon.id) || !canAfford(state, weapon)) return state
  return {
    ...state,
    coins: state.coins - weapon.cost,
    ownedWeaponIds: [...state.ownedWeaponIds, weapon.id],
    stats: { ...state.stats, coinsSpent: state.stats.coinsSpent + weapon.cost },
  }
}

/**
 * What a battle pays out. A defeat still returns salvage so a player who spent
 * badly can always climb back — losing is a setback, never a dead end.
 */
export function payoutFor(level: Level, won: boolean, alreadyCleared: boolean): number {
  if (!won) return Math.round(level.reward * SALVAGE_RATE)
  return alreadyCleared ? Math.round(level.reward * SALVAGE_RATE) : level.reward
}
