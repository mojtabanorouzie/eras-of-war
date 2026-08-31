import type { Level } from '../game/types'

/**
 * The campaign. Six battles, roughly 10-20 minutes.
 *
 * The order is deliberate:
 *   1 Forest  - the free Stone Axe wins outright. Terrain matters, teach it early.
 *   2 Desert  - nothing you own works. First real purchase.
 *   3 City    - the free Basic Pistol beats weapons worth 40,000 coins.
 *   4 Snow    - heavy gear sinks. Your catapult is suddenly useless.
 *   5 Coast   - that same cheap catapult is now the best thing you own.
 *   6 Boss    - the machine army holds the capital. Rubble, not open ground.
 */
export const LEVELS: Level[] = [
  {
    id: 1,
    name: 'به سوی جنگل',
    terrainId: 'forest',
    enemyId: 'wolf-clan',
    reward: 5000,
    isBoss: false,
  },
  {
    id: 2,
    name: 'شن‌زار بلند',
    terrainId: 'desert',
    enemyId: 'sand-legion',
    reward: 12000,
    isBoss: false,
  },
  {
    id: 3,
    name: 'خیابان‌های زنگ‌زده',
    terrainId: 'city',
    enemyId: 'rust-syndicate',
    reward: 20000,
    isBoss: false,
  },
  {
    id: 4,
    name: 'گذرگاه یخ‌زده',
    terrainId: 'snow',
    enemyId: 'frost-company',
    reward: 35000,
    isBoss: false,
  },
  {
    id: 5,
    name: 'شکستن موج',
    terrainId: 'coast',
    enemyId: 'steel-vanguard',
    reward: 60000,
    isBoss: false,
  },
  {
    id: 6,
    name: 'آخرین پایتخت',
    terrainId: 'city',
    enemyId: 'future-commander',
    reward: 100000,
    isBoss: true,
  },
]

export const TOTAL_LEVELS = LEVELS.length

export function findLevel(id: number): Level | undefined {
  return LEVELS.find((level) => level.id === id)
}
