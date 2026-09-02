import { ARENA_HALF, DUEL_TIMEOUT } from './combat'
import type { CombatStats } from './combat'

/**
 * The real-time duel.
 *
 * One deterministic step function drives the whole fight: state in, state
 * advanced by `dt`. It knows nothing about React, Three.js or the DOM, so the
 * WebGL field and the CSS fallback run the same fight, and the same fight can
 * be replayed frame-for-frame from the same inputs.
 *
 * ORIENTATION — the document is `dir="rtl"`. The player holds the RIGHT of the
 * field (+X) and fires leftward; the enemy holds the LEFT (-X). Distance
 * between them is therefore always `player.x - enemy.x`.
 *
 * The loop it creates: the enemy walks you down, so you spend your reach on the
 * way in, then dodge at the last moment to buy the distance back. Attacking
 * commits you for the wind-up, so greed is what gets you hit.
 */

export type Side = 'player' | 'enemy'
export type DuelPhase = 'intro' | 'fighting' | 'over'

/** Longest step the fight will take at once, so a stalled tab cannot tunnel. */
const MAX_STEP = 1 / 30

const INTRO_SECONDS = 0.85
const START_X = 6.5

/** How close the enemy wants to be. Must stay inside the shortest weapon's reach. */
const ENGAGE_DISTANCE = 1.9

/** The armies never occupy the same ground. */
const MIN_GAP = 1.4

/** A shot counts as arriving once it is this close to its target. */
const HIT_RADIUS = 1.1

/** A tap this recently still fires the moment the weapon comes off cooldown. */
const INPUT_BUFFER = 0.18

/**
 * Hit-stop, in seconds per point of damage, and its ceiling.
 *
 * Deliberately proportional rather than a flat per-hit freeze: a flat one costs
 * a fast weapon far more clock than a slow one — the stone axe lands five blows
 * for every one the enemy swings — and quietly taxes exactly the weapons whose
 * whole identity is rate of fire.
 */
const HIT_STOP_PER_DAMAGE = 0.005
const MAX_HIT_STOP = 0.08

const HURT_TIME = 0.22
const RECOVER_TIME = 0.4

export interface Fighter {
  x: number
  health: number
  /** Seconds of commitment left before the blow lands. Cannot dodge while > 0. */
  windUp: number
  /** Seconds until this side may attack again. */
  attackCooldown: number
  /** Seconds of dodge invulnerability left. */
  invulnerable: number
  dodgeCooldown: number
  /** Seconds left on the flinch, for the renderer. */
  hurt: number
  /** Seconds left on the follow-through, for the renderer. */
  recover: number
  hitsLanded: number
  attacksMade: number
  /** True while this wind-up is the fast one, so the renderer can colour it. */
  quickSwing: boolean
}

export interface Projectile {
  id: number
  x: number
  /** 0 at the shooter's shoulder; lobbed shots rise and fall from there. */
  height: number
  velocity: number
  owner: Side
  damage: number
  /** How high this shot arcs, in world units. 0 flies flat. */
  arc: number
  travelled: number
  span: number
}

export interface DuelResult {
  winner: Side
  playerHealth: number
  enemyHealth: number
  duration: number
  playerHits: number
  enemyHits: number
  /** True when the clock ran out and health decided it. */
  timedOut: boolean
}

export interface DuelState {
  phase: DuelPhase
  elapsed: number
  introProgress: number
  player: Fighter
  enemy: Fighter
  stats: { player: CombatStats; enemy: CombatStats }
  projectiles: Projectile[]
  result: DuelResult | null
  /** 0..1, decaying. Renderers spend it on screen shake. */
  shake: number
  /** Seconds of hit-stop left. The world holds still while this is above zero. */
  hitStop: number
  nextProjectileId: number
}

/** Set by the input layer; the fight consumes it. */
export interface DuelInput {
  attack: boolean
  dodge: boolean
  /** Seconds since the tap, so a slightly early press is not thrown away. */
  attackAge: number
  dodgeAge: number
}

export function createInput(): DuelInput {
  return { attack: false, dodge: false, attackAge: 0, dodgeAge: 0 }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function fighter(x: number, maxHealth: number): Fighter {
  return {
    x,
    health: maxHealth,
    windUp: 0,
    attackCooldown: 0,
    invulnerable: 0,
    dodgeCooldown: 0,
    hurt: 0,
    recover: 0,
    hitsLanded: 0,
    attacksMade: 0,
    quickSwing: false,
  }
}

export function createDuel(player: CombatStats, enemy: CombatStats): DuelState {
  return {
    phase: 'intro',
    elapsed: 0,
    introProgress: 0,
    player: fighter(ARENA_HALF + 3, player.maxHealth),
    enemy: fighter(-ARENA_HALF - 3, enemy.maxHealth),
    stats: { player, enemy },
    projectiles: [],
    result: null,
    shake: 0,
    hitStop: 0,
    nextProjectileId: 1,
  }
}

/** Distance between the two armies, in world units. Never negative. */
export function gap(state: DuelState): number {
  return state.player.x - state.enemy.x
}

/** True when the player's weapon could land right now. Drives the attack button. */
export function inReach(state: DuelState): boolean {
  return gap(state) <= state.stats.player.reach
}

function countDown(value: number, step: number): number {
  return value > 0 ? Math.max(0, value - step) : 0
}

function tickTimers(side: Fighter, step: number): void {
  side.attackCooldown = countDown(side.attackCooldown, step)
  side.invulnerable = countDown(side.invulnerable, step)
  side.dodgeCooldown = countDown(side.dodgeCooldown, step)
  side.hurt = countDown(side.hurt, step)
  side.recover = countDown(side.recover, step)
}

/** @returns true if the blow actually connected. */
function applyHit(state: DuelState, from: Side, damage: number): boolean {
  const attacker = from === 'player' ? state.player : state.enemy
  const target = from === 'player' ? state.enemy : state.player

  // A dodge in progress means the blow passes straight through.
  if (target.invulnerable > 0) return false

  target.health = Math.max(0, target.health - damage)
  target.hurt = HURT_TIME
  attacker.hitsLanded += 1
  state.hitStop = Math.min(MAX_HIT_STOP, damage * HIT_STOP_PER_DAMAGE)
  state.shake = Math.min(1, state.shake + damage / 26)
  return true
}

function fire(state: DuelState, from: Side): void {
  const attacker = from === 'player' ? state.player : state.enemy
  const target = from === 'player' ? state.enemy : state.player
  const stats = from === 'player' ? state.stats.player : state.stats.enemy
  attacker.recover = RECOVER_TIME

  if (stats.projectileSpeed <= 0) {
    // A blow rather than a shot: it lands now, if it can reach.
    if (Math.abs(attacker.x - target.x) <= stats.reach) applyHit(state, from, stats.damage)
    return
  }

  // The player fires leftward; the enemy fires rightward.
  const direction = from === 'player' ? -1 : 1
  state.projectiles.push({
    id: state.nextProjectileId,
    x: attacker.x,
    height: 0,
    velocity: direction * stats.projectileSpeed,
    owner: from,
    damage: stats.damage,
    arc: stats.projectileSpeed < 16 ? 2.6 : 0,
    travelled: 0,
    span: Math.max(1, Math.abs(attacker.x - target.x)),
  })
  state.nextProjectileId += 1
}

function resolveWindUp(state: DuelState, side: Side, step: number): void {
  const self = side === 'player' ? state.player : state.enemy
  if (self.windUp <= 0) return

  self.windUp -= step
  if (self.windUp <= 0) {
    self.windUp = 0
    fire(state, side)
  }
}

function advanceProjectiles(state: DuelState, step: number): void {
  if (state.projectiles.length === 0) return

  const survivors: Projectile[] = []
  for (const shot of state.projectiles) {
    shot.x += shot.velocity * step
    shot.travelled += Math.abs(shot.velocity) * step

    if (shot.arc > 0) {
      const progress = clamp(shot.travelled / shot.span, 0, 1)
      shot.height = Math.sin(progress * Math.PI) * shot.arc
    }

    const target = shot.owner === 'player' ? state.enemy : state.player
    const arrived =
      shot.owner === 'player' ? shot.x <= target.x + HIT_RADIUS : shot.x >= target.x - HIT_RADIUS

    if (arrived) {
      applyHit(state, shot.owner, shot.damage)
      continue
    }
    if (Math.abs(shot.x) <= ARENA_HALF + 4) survivors.push(shot)
  }
  state.projectiles = survivors
}

function runEnemy(state: DuelState, step: number): void {
  const { enemy } = state
  const stats = state.stats.enemy
  const distance = gap(state)

  // Standing still is the telegraph: while it is winding up, it does not move.
  if (enemy.windUp <= 0) {
    if (enemy.recover > 0) {
      // Steps off after swinging, which is the opening you shoot into.
      enemy.x -= stats.approachSpeed * 0.5 * step
    } else if (distance > ENGAGE_DISTANCE) {
      enemy.x += stats.approachSpeed * step
    }

    if (distance <= stats.reach && enemy.attackCooldown <= 0) {
      // Every third swing is a fast one. Deterministic, so it is a rhythm to
      // read rather than a coin flip, but enough that dodging on reflex alone
      // will not carry you through a fight.
      enemy.quickSwing = enemy.attacksMade % 3 === 2
      enemy.windUp = enemy.quickSwing ? stats.windUp * 0.55 : stats.windUp
      enemy.attackCooldown = stats.cycle
      enemy.attacksMade += 1
    }
  }
}

function finish(state: DuelState): void {
  const { player, enemy } = state
  const timedOut = player.health > 0 && enemy.health > 0

  // A tie on health goes to the player, matching the engine's `margin >= 0`.
  const winner: Side =
    enemy.health <= 0
      ? 'player'
      : player.health <= 0
        ? 'enemy'
        : player.health >= enemy.health
          ? 'player'
          : 'enemy'

  state.phase = 'over'
  state.result = {
    winner,
    playerHealth: player.health,
    enemyHealth: enemy.health,
    duration: state.elapsed,
    playerHits: player.hitsLanded,
    enemyHits: enemy.hitsLanded,
    timedOut,
  }
}

/**
 * Advances the fight in place.
 *
 * Mutates `state` and `input` rather than returning new objects: this runs
 * sixty times a second against a single owner, and the garbage from rebuilding
 * it each frame is not worth the purity.
 */
export function advanceDuel(state: DuelState, dt: number, input: DuelInput): void {
  const step = Math.min(Math.max(dt, 0), MAX_STEP)
  state.shake = Math.max(0, state.shake - step * 3.4)

  if (state.phase === 'over') {
    advanceProjectiles(state, step)
    return
  }

  if (state.phase === 'intro') {
    state.introProgress = Math.min(1, state.introProgress + step / INTRO_SECONDS)
    const eased = 1 - (1 - state.introProgress) ** 3
    state.player.x = ARENA_HALF + 3 + (START_X - (ARENA_HALF + 3)) * eased
    state.enemy.x = -(ARENA_HALF + 3) + (-START_X + (ARENA_HALF + 3)) * eased
    if (state.introProgress >= 1) state.phase = 'fighting'

    // Nothing the player presses during the march-in counts.
    input.attack = false
    input.dodge = false
    return
  }

  // Hit-stop: the whole world holds for a moment so the blow reads.
  if (state.hitStop > 0) {
    state.hitStop = Math.max(0, state.hitStop - step)
    return
  }

  const { player, enemy } = state
  const stats = state.stats.player

  state.elapsed += step
  tickTimers(player, step)
  tickTimers(enemy, step)

  if (input.dodge) {
    input.dodgeAge += step
    if (player.dodgeCooldown <= 0 && player.windUp <= 0) {
      player.x += stats.dodgeDistance
      player.invulnerable = stats.dodgeInvulnerable
      player.dodgeCooldown = stats.dodgeCooldown
      input.dodge = false
      input.dodgeAge = 0
    } else if (input.dodgeAge > INPUT_BUFFER) {
      input.dodge = false
      input.dodgeAge = 0
    }
  }

  if (input.attack) {
    input.attackAge += step
    if (player.attackCooldown <= 0 && player.windUp <= 0) {
      player.attacksMade += 1
      player.windUp = stats.windUp
      player.attackCooldown = stats.cycle
      input.attack = false
      input.attackAge = 0
    } else if (input.attackAge > INPUT_BUFFER) {
      input.attack = false
      input.attackAge = 0
    }
  }

  runEnemy(state, step)
  resolveWindUp(state, 'player', step)
  resolveWindUp(state, 'enemy', step)
  advanceProjectiles(state, step)

  // Neither army may leave the ground or walk through the other.
  player.x = clamp(player.x, enemy.x + MIN_GAP, ARENA_HALF)
  enemy.x = clamp(enemy.x, -ARENA_HALF, player.x - MIN_GAP)

  if (player.health <= 0 || enemy.health <= 0 || state.elapsed >= DUEL_TIMEOUT) finish(state)
}
