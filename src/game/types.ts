/**
 * Every type the game is built from.
 *
 * Rule of thumb for this project: rules live in `src/game`, numbers live in
 * `src/data`, and nothing in `src/components` or `src/screens` invents either.
 */

export type EraId = 'ancient' | 'medieval' | 'industrial' | 'modern' | 'future'

export type TerrainId = 'forest' | 'desert' | 'city' | 'snow' | 'coast'

/** How a weapon fights. Terrains react to this more than to raw power. */
export type WeaponType = 'melee' | 'ranged' | 'firearm' | 'sniper' | 'siege' | 'energy'

/** How hard the weapon is to carry. Snow cares a lot about this. */
export type WeaponWeight = 'light' | 'medium' | 'heavy'

export interface Weapon {
  id: string
  /** Display name. The whole interface is Persian; code identifiers stay English. */
  name: string
  emoji: string
  era: EraId
  /** Price in coins. `0` means it is a starter weapon. */
  cost: number
  power: number
  range: number
  type: WeaponType
  weight: WeaponWeight
  /** Terrain this weapon was designed for; earns MATCH_BONUS when they line up. */
  bestTerrain: TerrainId
  blurb: string
}

export interface Terrain {
  id: TerrainId
  name: string
  emoji: string
  /** One line, shown under the terrain name on the battle-prep screen. */
  tagline: string
  /** Two or three sentences, shown in How to Play. */
  description: string
  typeModifiers: Record<WeaponType, number>
  weightModifiers: Record<WeaponWeight, number>
  /**
   * Bonus per 10 points of weapon range above `RANGE_PIVOT`.
   * Positive = open ground rewards reach. Negative = tight ground punishes it.
   */
  rangeSlope: number
  /** Two-stop gradient used for the terrain banner. */
  colors: [string, string]
}

/** The enemy's kit. Cosmetic name + the single number that sets difficulty. */
export interface EnemyWeapon {
  name: string
  emoji: string
  power: number
}

export interface Enemy {
  id: string
  name: string
  emoji: string
  era: EraId
  weapon: EnemyWeapon
  /**
   * How well this army knows its ground. Can be negative: the Frost Company
   * drags heavy guns through snow and suffers for it.
   */
  terrainEdge: number
  taunt: string
}

export interface Level {
  id: number
  name: string
  terrainId: TerrainId
  enemyId: string
  /** Coins awarded the first time this battle is won. */
  reward: number
  isBoss: boolean
}

/** One labelled line of the "why is my power this number" breakdown. */
export interface BonusNote {
  label: string
  value: number
}

export interface TerrainFit {
  typeBonus: number
  weightBonus: number
  rangeBonus: number
  matchBonus: number
  total: number
  notes: BonusNote[]
}

export interface SideBreakdown {
  base: number
  weapon: number
  terrain: number
  veterancy: number
  luck: number
}

export interface BattleOutcome {
  playerPower: number
  enemyPower: number
  winner: 'player' | 'enemy'
  terrainBonus: number
  explanation: string
  /** Positive when the player won. */
  margin: number
  player: SideBreakdown
  enemy: SideBreakdown
  fit: TerrainFit
}

export interface GameStats {
  battlesWon: number
  battlesLost: number
  coinsEarned: number
  coinsSpent: number
}

export interface GameState {
  /** Bumped whenever the shape below changes; older saves are discarded. */
  version: number
  coins: number
  ownedWeaponIds: string[]
  equippedWeaponId: string
  /** 1-based index of the next battle to fight. */
  currentLevel: number
  /** Level ids already cleared, so rewards are only paid once. */
  clearedLevelIds: number[]
  campaignComplete: boolean
  muted: boolean
  stats: GameStats
}
