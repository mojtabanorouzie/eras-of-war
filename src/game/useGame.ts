import { useCallback, useEffect, useMemo, useReducer } from 'react'
import { TOTAL_LEVELS } from '../data/levels'
import { findWeapon } from '../data/weapons'
import { setMuted } from './audio'
import { payoutFor, purchaseWeapon } from './economy'
import { createInitialState, loadState, saveState, clearState } from './storage'
import type { GameState, Level } from './types'

export type GameAction =
  | { type: 'equip'; weaponId: string }
  | { type: 'buy'; weaponId: string }
  | { type: 'battleResolved'; level: Level; won: boolean }
  | { type: 'toggleMute' }
  | { type: 'reset' }

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'equip': {
      if (!state.ownedWeaponIds.includes(action.weaponId)) return state
      return { ...state, equippedWeaponId: action.weaponId }
    }

    case 'buy': {
      const weapon = findWeapon(action.weaponId)
      if (!weapon) return state
      const bought = purchaseWeapon(state, weapon)
      if (bought === state) return state
      // Buying always equips: it is what the player wanted to do anyway.
      return { ...bought, equippedWeaponId: weapon.id }
    }

    case 'battleResolved': {
      const { level, won } = action
      const alreadyCleared = state.clearedLevelIds.includes(level.id)
      const payout = payoutFor(level, won, alreadyCleared)

      return {
        ...state,
        coins: state.coins + payout,
        clearedLevelIds:
          won && !alreadyCleared ? [...state.clearedLevelIds, level.id] : state.clearedLevelIds,
        currentLevel: won ? Math.min(TOTAL_LEVELS, level.id + 1) : level.id,
        campaignComplete: state.campaignComplete || (won && level.isBoss),
        stats: {
          ...state.stats,
          battlesWon: state.stats.battlesWon + (won ? 1 : 0),
          battlesLost: state.stats.battlesLost + (won ? 0 : 1),
          coinsEarned: state.stats.coinsEarned + payout,
        },
      }
    }

    case 'toggleMute':
      return { ...state, muted: !state.muted }

    case 'reset':
      // Sound preference is a device setting, not campaign progress.
      return { ...createInitialState(), muted: state.muted }
  }
}

export interface GameApi {
  state: GameState
  equip: (weaponId: string) => void
  buy: (weaponId: string) => void
  resolveBattle: (level: Level, won: boolean) => void
  toggleMute: () => void
  resetGame: () => void
}

export function useGame(): GameApi {
  const [state, dispatch] = useReducer(gameReducer, undefined, loadState)

  useEffect(() => {
    saveState(state)
  }, [state])

  useEffect(() => {
    setMuted(state.muted)
  }, [state.muted])

  const equip = useCallback((weaponId: string) => dispatch({ type: 'equip', weaponId }), [])
  const buy = useCallback((weaponId: string) => dispatch({ type: 'buy', weaponId }), [])
  const resolveBattle = useCallback(
    (level: Level, won: boolean) => dispatch({ type: 'battleResolved', level, won }),
    [],
  )
  const toggleMute = useCallback(() => dispatch({ type: 'toggleMute' }), [])
  const resetGame = useCallback(() => {
    clearState()
    dispatch({ type: 'reset' })
  }, [])

  return useMemo(
    () => ({ state, equip, buy, resolveBattle, toggleMute, resetGame }),
    [state, equip, buy, resolveBattle, toggleMute, resetGame],
  )
}
