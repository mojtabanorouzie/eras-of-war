import { MAX_HEALTH } from '../balance'
import { projectEnemyPower } from '../battleEngine'
import type { Enemy, Level, Terrain } from '../types'
import type { Cover, EnemyKind, WavePlan } from './types'
import { ARENA_HALF, ARENA_MARGIN } from './world'

/**
 * What stands on the ground, and what walks onto it.
 *
 * Two jobs live here because they answer the same question from two sides:
 * how hard is this battle. `coverFor` decides what the terrain gives you to
 * hide behind, and `wavesFor` decides how much is coming. Both are pure and
 * deterministic — no `Math.random()` anywhere in this file — so the same
 * battle always builds the same arena, and a fight can be replayed.
 *
 * The tuned six-level ladder is preserved here the same way `loadout.ts`
 * preserves it for the player: the enemy force is sized from the power the
 * existing engine already computes, so a boss that was 264 points on paper is
 * a 264-point problem in the arena.
 */

/* ------------------------------------------------------------------ *
 *  Determinism
 * ------------------------------------------------------------------ */

/** FNV-1a. Any stable string-to-number hash would do; this one is short. */
function hashSeed(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * Mulberry32. Small, fast, and good enough to scatter trees convincingly.
 *
 * The arena must never call `Math.random()`: a battle that laid its cover out
 * differently on every mount would make the fight unreproducible, and would
 * also mean the renderer and the simulation could disagree about where a tree
 * is if either ever rebuilt.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ------------------------------------------------------------------ *
 *  Cover
 * ------------------------------------------------------------------ */

/**
 * How each battlefield is furnished.
 *
 * These numbers are the terrain descriptions in `src/data/terrains.ts` made
 * physical. A forest that "blocks every long shot" has to actually block them,
 * or the sniper rifle would quietly be the best weapon on every map and the
 * game's one lesson would stop being true.
 */
interface CoverPlan {
  count: number
  shape: 'box' | 'cylinder'
  /** Ground footprint, picked uniformly between the two. */
  minSize: number
  maxSize: number
  minHeight: number
  maxHeight: number
  /**
   * Fraction of the pieces that are tall enough to stop a bullet. The rest are
   * low rubble you can shoot over but not walk through — which is what makes
   * a piece of cover a decision rather than a wall.
   */
  tallFraction: number
}

const COVER_PLANS: Record<string, CoverPlan[]> = {
  // Trunks, close together. Nothing sees far, everything is a corner.
  forest: [
    { count: 28, shape: 'cylinder', minSize: 0.45, maxSize: 0.95, minHeight: 5, maxHeight: 7.5, tallFraction: 1 },
    { count: 10, shape: 'cylinder', minSize: 1.1, maxSize: 1.9, minHeight: 0.9, maxHeight: 1.4, tallFraction: 0 },
  ],
  // Open ground with a few dunes. The long lanes are the point of the level.
  desert: [
    { count: 9, shape: 'box', minSize: 2.4, maxSize: 4.4, minHeight: 1, maxHeight: 1.7, tallFraction: 0 },
    { count: 5, shape: 'box', minSize: 1.2, maxSize: 2.2, minHeight: 2.6, maxHeight: 3.8, tallFraction: 1 },
  ],
  // The densest cover in the game, and the most vertical. Every fight here
  // happens around a corner, which is exactly what the pistol wants.
  city: [
    { count: 16, shape: 'box', minSize: 1.4, maxSize: 3.6, minHeight: 3, maxHeight: 4.6, tallFraction: 1 },
    { count: 12, shape: 'box', minSize: 1.2, maxSize: 2.8, minHeight: 0.9, maxHeight: 1.4, tallFraction: 0 },
  ],
  // Boulders under snow: mid-height, scattered, nothing continuous.
  snow: [
    { count: 13, shape: 'cylinder', minSize: 1.2, maxSize: 2.3, minHeight: 1.8, maxHeight: 3.2, tallFraction: 0.7 },
    { count: 7, shape: 'cylinder', minSize: 0.8, maxSize: 1.6, minHeight: 0.9, maxHeight: 1.3, tallFraction: 0 },
  ],
  // The fairest ground: some rock, plenty of sky. Second-most open after desert.
  coast: [
    { count: 10, shape: 'cylinder', minSize: 1, maxSize: 2.4, minHeight: 1.6, maxHeight: 3, tallFraction: 0.6 },
    { count: 8, shape: 'box', minSize: 1.4, maxSize: 3, minHeight: 0.9, maxHeight: 1.3, tallFraction: 0 },
  ],
}

/**
 * The player drops into the middle, so the middle stays clear.
 *
 * Without this a fight could begin with the commander standing inside a tree,
 * and the collision resolver would shove them somewhere arbitrary before they
 * ever touched a control.
 */
const SPAWN_CLEARANCE = 6

/** Two pieces closer than this read as one lump, so the sampler rejects them. */
const MIN_COVER_GAP = 1.1

/** How many placements to try before giving up on a piece and moving on. */
const PLACEMENT_ATTEMPTS = 24

export function coverFor(terrain: Terrain): Cover[] {
  const random = mulberry32(hashSeed(terrain.id))
  const plans = COVER_PLANS[terrain.id] ?? COVER_PLANS.coast ?? []
  const placed: Cover[] = []
  let nextId = 1

  for (const plan of plans) {
    for (let i = 0; i < plan.count; i += 1) {
      const halfX = plan.minSize + random() * (plan.maxSize - plan.minSize)
      // Boxes get an independent second extent so the city reads as walls and
      // slabs rather than as a field of identical cubes.
      const halfZ =
        plan.shape === 'box' ? plan.minSize + random() * (plan.maxSize - plan.minSize) : halfX
      const height = plan.minHeight + random() * (plan.maxHeight - plan.minHeight)
      const reach = Math.max(halfX, halfZ)
      const limit = ARENA_HALF - ARENA_MARGIN - reach

      for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt += 1) {
        const x = (random() * 2 - 1) * limit
        const z = (random() * 2 - 1) * limit

        if (Math.hypot(x, z) < SPAWN_CLEARANCE + reach) continue

        let blocked = false
        for (const other of placed) {
          const gap = Math.hypot(x - other.x, z - other.z)
          if (gap < reach + Math.max(other.halfX, other.halfZ) + MIN_COVER_GAP) {
            blocked = true
            break
          }
        }
        if (blocked) continue

        placed.push({
          id: nextId,
          x,
          z,
          halfX,
          halfZ,
          height,
          rotation: plan.shape === 'box' ? random() * Math.PI : 0,
          shape: plan.shape,
          blocksSight: random() < plan.tallFraction,
        })
        nextId += 1
        break
      }
    }
  }

  return placed
}

/* ------------------------------------------------------------------ *
 *  The enemy force
 * ------------------------------------------------------------------ */

/**
 * What each role is worth, relative to the others.
 *
 * These are shares of a budget, not absolute numbers. The budget itself comes
 * from the campaign's tuned power, and these decide how it is cut up — so a
 * squad of one heavy and three rushers is exactly as dangerous as the same
 * points spent on six gunners, and the mix is a texture choice rather than a
 * difficulty one.
 */
const ROLE_WEIGHT: Record<EnemyKind, { health: number; damage: number }> = {
  rusher: { health: 0.75, damage: 0.8 },
  gunner: { health: 0.9, damage: 1 },
  heavy: { health: 1.9, damage: 1.7 },
  boss: { health: 5, damage: 2.2 },
}

/**
 * How much of a live squad can actually reach you at any one moment.
 *
 * Never all of it: some are crossing the arena, some are behind cover, some
 * are winding up. Sizing per-enemy damage as if the whole force could fire at
 * once would make every wave a wipe.
 */
const ENGAGED_FRACTION = 0.55

/**
 * The fraction of incoming attacks a competent player is expected to avoid.
 *
 * The duel had nowhere to go: the enemy closed, swung, and either you dodged
 * that one blow or you wore it. An arena has cover, distance and a roll, so
 * far less of what is thrown actually lands — and if per-enemy damage were not
 * scaled up to account for that, every battle would become a long, safe slog
 * that the clock decided.
 *
 * Together with ENGAGED_FRACTION this is the honest counterpart to
 * `ASSUMED_ACCURACY` in `loadout.ts`: both sides of the fight are sized for a
 * competent player rather than a perfect or a helpless one.
 */
const PLAYER_EVASION = 0.6

/**
 * Total enemy health, as a multiple of one duel opponent, per level.
 *
 * The duel gave every enemy exactly `MAX_HEALTH`. An arena has to last longer
 * than a duel to be worth entering, and later battles have to last longer than
 * earlier ones, so the force grows with the level — while the *rate* it hurts
 * you at stays pinned to the tuned power. More bodies, not tougher ones.
 *
 * The slope is gentler than it first looks like it should be, and that is
 * measured rather than guessed. Health alone says how long a fight takes only
 * if the player is always shooting; in an arena they are also crossing ground,
 * breaking line of sight and reloading, so real fights run well over their
 * on-paper length. A budget steep enough to feel right on paper put the last
 * two battles past the clock in practice.
 */
function healthBudgetFor(level: Level): number {
  return MAX_HEALTH * (1.2 + level.id * 0.28)
}

/** The reference attack cycle the damage budget is expressed against. */
const REFERENCE_CYCLE = 1.4

/**
 * How the force is composed, level by level.
 *
 * The order teaches the game. Level one is nothing but rushers, so the player
 * has to learn exactly one thing — read the wind-up, roll — with no other
 * threat competing for their attention. Gunners arrive once that is learned
 * and punish standing in the open. Heavies arrive last and punish standing
 * still behind one rock, which is the habit gunners teach.
 */
function compositionFor(level: Level, terrain: Terrain): EnemyKind[][] {
  const tight = terrain.rangeSlope < 0

  // Tight ground favours what can close; open ground favours what can shoot.
  // This is the same terrain logic the strategy layer already runs on, applied
  // to who shows up rather than to what a weapon is worth.
  const brawler: EnemyKind = 'rusher'
  const shooter: EnemyKind = tight ? 'rusher' : 'gunner'

  switch (level.id) {
    case 1:
      return [[brawler, brawler], [brawler, brawler, brawler]]
    case 2:
      return [
        [brawler, shooter],
        [brawler, brawler, shooter, 'gunner'],
      ]
    case 3:
      return [
        [brawler, shooter],
        [brawler, shooter, 'gunner'],
        [brawler, brawler, shooter, 'gunner'],
      ]
    case 4:
      return [
        [brawler, shooter],
        [brawler, 'gunner', 'heavy'],
        [brawler, brawler, shooter, 'gunner', 'heavy'],
      ]
    case 5:
      return [
        [brawler, shooter, 'gunner'],
        [brawler, brawler, 'gunner', 'heavy'],
        [brawler, shooter, 'gunner', 'gunner', 'heavy'],
      ]
    default:
      // The last capital. The machine army sends escorts first and only walks
      // its commander out once the player has spent something getting there.
      return [
        [brawler, shooter, 'gunner'],
        [brawler, brawler, 'gunner', 'heavy'],
        [ 'boss', brawler, 'gunner', 'heavy'],
      ]
  }
}

/**
 * The force that holds this battlefield.
 *
 * @returns one plan per wave, in the order they arrive.
 */
export function wavesFor(enemy: Enemy, terrain: Terrain, level: Level): WavePlan[] {
  const power = projectEnemyPower(enemy.weapon, enemy.terrainEdge)

  // The DPS one duel opponent of this power would have put out. Everything the
  // squad does is cut from this, which is what keeps the ladder's shape.
  const duelDps = (power / 180) * (MAX_HEALTH / 14)

  const composition = compositionFor(level, terrain)
  const totalHealth = healthBudgetFor(level)

  // Sum the shares across the whole battle first, so that a wave of two
  // rushers and a wave of five mixed bodies are cut from one budget rather
  // than each being sized on its own and quietly doubling the fight.
  let healthShares = 0
  let damageShares = 0
  for (const wave of composition) {
    for (const kind of wave) {
      healthShares += ROLE_WEIGHT[kind].health
      damageShares += ROLE_WEIGHT[kind].damage
    }
  }

  const healthPerShare = healthShares > 0 ? totalHealth / healthShares : totalHealth

  // Damage is sized against the *largest* wave rather than the whole battle:
  // what the player feels is how much is being thrown at them right now, and
  // the biggest wave is the moment that has to be survivable.
  const peakShares = composition.reduce((peak, wave) => {
    const shares = wave.reduce((sum, kind) => sum + ROLE_WEIGHT[kind].damage, 0)
    return Math.max(peak, shares)
  }, 1)

  const damagePerShare =
    (duelDps * REFERENCE_CYCLE) / (peakShares * ENGAGED_FRACTION * (1 - PLAYER_EVASION))

  return composition.map((wave, index) => ({
    // The first wave is already walking in when the fight starts; later ones
    // leave a breath in between so a cleared field reads as an achievement
    // rather than as a gap the player failed to notice.
    delay: index === 0 ? 0 : 2.2,
    members: wave.map((kind) => ({
      kind,
      health: ROLE_WEIGHT[kind].health * healthPerShare,
      damage: ROLE_WEIGHT[kind].damage * damagePerShare,
    })),
  }))
}

/** Total bodies across every wave. The HUD counts down from it. */
export function forceSize(waves: WavePlan[]): number {
  return waves.reduce((sum, wave) => sum + wave.members.length, 0)
}

/** Only used by the report, and only to describe the fight afterwards. */
export { hashSeed, mulberry32 }
