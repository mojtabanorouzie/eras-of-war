import type { Difficulty, DifficultyId } from '../game/types'

/**
 * The three difficulties.
 *
 * All three fight the same campaign with the same weapons on the same ground —
 * every multiplier here is on the enemy side, so the tuned six-level ladder
 * and the whole "right weapon for the ground" lesson are identical everywhere.
 * What changes is the margin for error: how hard a mistake hits back, and how
 * much warning the wind-up gives before it does.
 *
 * Easy is tuned for someone still learning to read the telegraphs (blows land
 * at 60% and the wind-up runs a third longer), hard for someone who dodges on
 * instinct (heavier blows on shorter warnings, and tougher bodies so a fight
 * cannot be ended before it starts). Neither touches the clock, the coins or
 * the player's own gun.
 */
export const DIFFICULTIES: Difficulty[] = [
  {
    id: 'easy',
    name: 'آسان',
    emoji: '🕊️',
    blurb: 'ضربه‌ها سبک‌ترند و دشمن دیرتر می‌زند — برای یاد گرفتنِ میدان.',
    enemyDamage: 0.6,
    enemyHealth: 0.85,
    windUp: 1.3,
    enemySpeed: 0.9,
  },
  {
    id: 'normal',
    name: 'عادی',
    emoji: '⚔️',
    blurb: 'همان تجربهٔ اصلی — منصفانه، خوانا و بی‌تخفیف.',
    enemyDamage: 1,
    enemyHealth: 1,
    windUp: 1,
    enemySpeed: 1,
  },
  {
    id: 'hard',
    name: 'سخت',
    emoji: '💀',
    blurb: 'ضربه‌ها سنگین‌تر و مهلت‌ها کوتاه‌تر — برای وقتی جاخالی عادتت شده.',
    enemyDamage: 1.45,
    enemyHealth: 1.2,
    windUp: 0.8,
    enemySpeed: 1.1,
  },
]

/** The difficulty every campaign starts on, and the repair for a bad save. */
export const DEFAULT_DIFFICULTY_ID: DifficultyId = 'normal'

const DIFFICULTIES_BY_ID = new Map(DIFFICULTIES.map((d) => [d.id, d]))

export function findDifficulty(id: string): Difficulty | undefined {
  return DIFFICULTIES_BY_ID.get(id as DifficultyId)
}
