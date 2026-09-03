/**
 * Every tunable number in the game, in one place.
 *
 * If a battle feels unfair, the fix is almost always here or in `src/data`,
 * not in a component.
 */

/** Both armies start from the same footing; weapons and ground decide the rest. */
export const ARMY_BASE_POWER = 100

/**
 * A fighter at full health.
 *
 * Damage on both sides is scaled against this, so it is the unit the whole
 * arena is measured in: `loadout.ts` spends a weapon's tuned power as a
 * fraction of it per second, and `squad.ts` sizes the enemy force in multiples
 * of it. Changing it silently retunes every battle in the campaign.
 */
export const MAX_HEALTH = 100

/** Bringing a weapon to the terrain it was designed for is the biggest single swing. */
export const MATCH_BONUS = 25

/** Weapon range is scored relative to this. 60 is "normal" reach. */
export const RANGE_PIVOT = 60

/** Range bonus = rangeSlope x (range - RANGE_PIVOT) / RANGE_STEP. */
export const RANGE_STEP = 10

/** Terrain range bonus never exceeds this in either direction. */
export const MAX_RANGE_BONUS = 20

/** Luck is +/- this. Small enough to reward good choices, big enough to keep hope alive. */
export const LUCK_SWING = 10

/** Your army learns. Every win makes the next battle a little easier. */
export const VETERANCY_PER_WIN = 8

export const STARTING_COINS = 5000

/** A defeat still pays this fraction of the reward, so a bad purchase never softlocks a run. */
export const SALVAGE_RATE = 0.2

/** Final-score weights, shown on the victory screen. */
export const SCORE = {
  perWin: 100,
  perCoinEarned: 0.01,
  perWeaponOwned: 40,
  perLoss: -25,
} as const
