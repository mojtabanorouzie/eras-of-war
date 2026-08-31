import { TOTAL_LEVELS } from '../data/levels'
import { STARTER_WEAPON_IDS, findWeapon } from '../data/weapons'
import { STARTING_COINS } from './balance'
import type { GameState, GameStats } from './types'

const STORAGE_KEY = 'eras-of-war:save'

/** Bump this when the save shape changes in a way older saves cannot satisfy. */
const SAVE_VERSION = 1

export function createInitialState(): GameState {
  return {
    version: SAVE_VERSION,
    coins: STARTING_COINS,
    ownedWeaponIds: [...STARTER_WEAPON_IDS],
    equippedWeaponId: STARTER_WEAPON_IDS[0] ?? '',
    currentLevel: 1,
    clearedLevelIds: [],
    campaignComplete: false,
    muted: false,
    stats: { battlesWon: 0, battlesLost: 0, coinsEarned: 0, coinsSpent: 0 },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function readStats(value: unknown): GameStats {
  const fallback = createInitialState().stats
  if (!isRecord(value)) return fallback
  return {
    battlesWon: readNumber(value['battlesWon'], 0, 0, Number.MAX_SAFE_INTEGER),
    battlesLost: readNumber(value['battlesLost'], 0, 0, Number.MAX_SAFE_INTEGER),
    coinsEarned: readNumber(value['coinsEarned'], 0, 0, Number.MAX_SAFE_INTEGER),
    coinsSpent: readNumber(value['coinsSpent'], 0, 0, Number.MAX_SAFE_INTEGER),
  }
}

/**
 * Turn anything at all into a playable state.
 *
 * A corrupted or hand-edited save must never crash the game or show the player
 * an error, so every field is repaired independently and the run continues.
 */
export function sanitizeState(raw: unknown): GameState {
  const initial = createInitialState()
  if (!isRecord(raw) || raw['version'] !== SAVE_VERSION) return initial

  const ownedFromSave = Array.isArray(raw['ownedWeaponIds'])
    ? raw['ownedWeaponIds'].filter(
        (id): id is string => typeof id === 'string' && findWeapon(id) !== undefined,
      )
    : []
  // Starter weapons can never be lost, even if a save says otherwise.
  const ownedWeaponIds = [...new Set([...STARTER_WEAPON_IDS, ...ownedFromSave])]

  const equippedCandidate = raw['equippedWeaponId']
  const equippedWeaponId =
    typeof equippedCandidate === 'string' && ownedWeaponIds.includes(equippedCandidate)
      ? equippedCandidate
      : initial.equippedWeaponId

  const clearedLevelIds = Array.isArray(raw['clearedLevelIds'])
    ? [
        ...new Set(
          raw['clearedLevelIds'].filter(
            (id): id is number =>
              typeof id === 'number' && Number.isInteger(id) && id >= 1 && id <= TOTAL_LEVELS,
          ),
        ),
      ].sort((a, b) => a - b)
    : []

  // You can never be further along than your cleared list allows, so a save
  // claiming level 99 restarts at the first battle it has not actually won.
  const furthestReachable = Math.min(
    TOTAL_LEVELS,
    (clearedLevelIds.length === 0 ? 0 : Math.max(...clearedLevelIds)) + 1,
  )
  const currentLevel = Math.min(
    readNumber(raw['currentLevel'], 1, 1, TOTAL_LEVELS),
    furthestReachable,
  )

  return {
    version: SAVE_VERSION,
    coins: readNumber(raw['coins'], initial.coins, 0, Number.MAX_SAFE_INTEGER),
    ownedWeaponIds,
    equippedWeaponId,
    currentLevel,
    clearedLevelIds,
    campaignComplete: readBoolean(raw['campaignComplete'], false),
    muted: readBoolean(raw['muted'], false),
    stats: readStats(raw['stats']),
  }
}

export function loadState(): GameState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return createInitialState()
    return sanitizeState(JSON.parse(raw))
  } catch {
    // Unreadable storage (private mode, quota, bad JSON) is not the player's problem.
    return createInitialState()
  }
}

export function saveState(state: GameState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Saving is best-effort; the game stays playable in-memory either way.
  }
}

export function clearState(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to do — the caller resets in-memory state regardless.
  }
}
