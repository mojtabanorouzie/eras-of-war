import { MAX_HEALTH } from '../balance'
import type { Enemy, Hero, Level, Terrain } from '../types'
import { coverFor, forceSize, wavesFor } from './squad'
import type {
  ArenaEnemy,
  ArenaEvent,
  ArenaEventKind,
  ArenaInput,
  ArenaPlayer,
  ArenaState,
  Bullet,
  Cover,
  EnemyKind,
  GunStats,
  Vec2,
  Vec3,
} from './types'
import {
  ACTOR_HEIGHT,
  ASSIST_FRICTION,
  ASSIST_FRICTION_CONE,
  ASSIST_PULL_CONE,
  ASSIST_PULL_RATE,
  ASSIST_RANGE,
  ACTOR_RADIUS,
  ADS_MULTIPLIER,
  ARENA_HALF,
  ARENA_MARGIN,
  ARENA_TIMEOUT,
  BRIEFING_SECONDS,
  FINISHER_HIT_STOP,
  FINISHER_SLOW_MOTION,
  GROUND_ACCEL,
  GROUND_FRICTION,
  HIT_MARKER_TIME,
  HIT_STOP_PER_DAMAGE,
  HURT_TIME,
  MAX_HIT_STOP,
  MAX_STEP,
  MUZZLE_HEIGHT,
  PITCH_LIMIT,
  ROLL_COOLDOWN,
  ROLL_IFRAMES,
  ROLL_SPEED,
  ROLL_TIME,
  SLOW_MOTION_SCALE,
  SPAWN_INSET,
  SPAWN_MIN_DISTANCE,
  SPRINT_MULTIPLIER,
  STREAK_WINDOW,
  WALK_SPEED,
} from './world'

/**
 * The arena.
 *
 * One deterministic step function drives the whole fight: state in, state
 * advanced by `dt`. It knows nothing about React, Three.js or the DOM, so the
 * renderer draws it without ever being able to change it, and the same fight
 * can be replayed frame-for-frame from the same inputs.
 *
 * This replaces `src/game/duel.ts`, and it inherits that file's two hardest-won
 * lessons rather than rediscovering them:
 *
 *   1. Hit-stop is measured in REAL time, never in fight time. A freeze that
 *      itself ran in slow motion would never end.
 *   2. The enemy wind-up is the player's only warning. Everything else in the
 *      fight is negotiable; that telegraph is not.
 *
 * What is new is that there is now ground to cross, cover to use and more than
 * one thing trying to kill you — so the loop it creates is different. The duel
 * asked "can you read one swing". The arena asks "can you pick which threat to
 * answer first, and can you do it before the clock runs out".
 */

/* ------------------------------------------------------------------ *
 *  Small maths
 * ------------------------------------------------------------------ */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function countDown(value: number, step: number): number {
  return value > 0 ? Math.max(0, value - step) : 0
}

/** Ground-plane forward vector for a yaw. A yaw of 0 faces -Z. */
function forwardOf(yaw: number): Vec2 {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) }
}

/** Ground-plane right vector for a yaw. */
function rightOf(yaw: number): Vec2 {
  return { x: Math.cos(yaw), z: -Math.sin(yaw) }
}

/* ------------------------------------------------------------------ *
 *  How each role fights
 * ------------------------------------------------------------------ */

/**
 * Behaviour, not budget.
 *
 * `squad.ts` decides how much health and damage each body is worth; this
 * decides how it spends them. Keeping the two apart is what lets the mix of
 * roles be a texture choice rather than a difficulty one.
 */
interface KindProfile {
  speed: number
  /** Seconds from one attack to the next. */
  cycle: number
  /**
   * Committed seconds before the blow lands.
   *
   * This is the number the whole fight is readable through. Under about a
   * third of a second a phone player cannot react at all; over about a second
   * the enemy stops feeling dangerous. Everything here lives in that window.
   */
  windUp: number
  /** How far out it is happy to sit. */
  preferredRange: number
  /** How far it can actually hurt you. */
  attackRange: number
  /** 0 for a body that has to touch you. */
  projectileSpeed: number
  /** Splash radius on its shots. */
  splash: number
  /** Arc on its shots. Above 0 it lobs. */
  gravity: number
}

const KIND_PROFILE: Record<EnemyKind, KindProfile> = {
  // Walks you down. The only threat in level one, so its telegraph is the
  // longest of the four — this is the swing the player learns the game on.
  rusher: {
    speed: 6.2,
    cycle: 1.5,
    windUp: 0.5,
    preferredRange: 1.7,
    attackRange: 2.8,
    projectileSpeed: 0,
    splash: 0,
    gravity: 0,
  },
  // Holds the middle distance and strafes. Punishes standing in the open, and
  // is the reason cover exists.
  gunner: {
    speed: 4.3,
    cycle: 2,
    windUp: 0.55,
    preferredRange: 13,
    attackRange: 24,
    projectileSpeed: 34,
    splash: 0,
    gravity: 0,
  },
  // Slow, tough, and it lobs over the top of whatever you are hiding behind.
  // The answer to a player who has found one rock and stopped moving.
  heavy: {
    speed: 2.7,
    cycle: 3.1,
    windUp: 0.9,
    preferredRange: 10,
    attackRange: 22,
    projectileSpeed: 24,
    splash: 3.6,
    gravity: 26,
  },
  // The Future Commander. Alternates between shelling from range and charging,
  // and stops being patient below half health.
  boss: {
    speed: 4.6,
    cycle: 1.7,
    windUp: 0.62,
    preferredRange: 8,
    attackRange: 26,
    projectileSpeed: 30,
    splash: 2.4,
    gravity: 0,
  },
}

/** The boss is physically bigger, so it is easier to hit and harder to miss. */
function radiusOf(kind: EnemyKind): number {
  return kind === 'boss' ? ACTOR_RADIUS * 2.1 : kind === 'heavy' ? ACTOR_RADIUS * 1.4 : ACTOR_RADIUS
}

function heightOf(kind: EnemyKind): number {
  return kind === 'boss' ? ACTOR_HEIGHT * 1.7 : kind === 'heavy' ? ACTOR_HEIGHT * 1.25 : ACTOR_HEIGHT
}

/* ------------------------------------------------------------------ *
 *  Cover geometry
 * ------------------------------------------------------------------ */

/**
 * The closest point on a piece of cover to a point on the ground, and how far
 * away it is. Boxes are solved in their own rotated frame.
 */
function closestOnCover(piece: Cover, x: number, z: number): { x: number; z: number; distance: number } {
  if (piece.shape === 'cylinder') {
    const dx = x - piece.x
    const dz = z - piece.z
    const length = Math.hypot(dx, dz)
    if (length < 1e-6) return { x: piece.x + piece.halfX, z: piece.z, distance: 0 }
    const scale = Math.min(1, piece.halfX / length)
    return { x: piece.x + dx * scale, z: piece.z + dz * scale, distance: length - piece.halfX }
  }

  const cos = Math.cos(-piece.rotation)
  const sin = Math.sin(-piece.rotation)
  const dx = x - piece.x
  const dz = z - piece.z
  const localX = dx * cos - dz * sin
  const localZ = dx * sin + dz * cos

  const clampedX = clamp(localX, -piece.halfX, piece.halfX)
  const clampedZ = clamp(localZ, -piece.halfZ, piece.halfZ)
  const offX = localX - clampedX
  const offZ = localZ - clampedZ
  const distance = Math.hypot(offX, offZ)

  // Back out of the box's frame so the caller gets a world-space point.
  const backCos = Math.cos(piece.rotation)
  const backSin = Math.sin(piece.rotation)
  return {
    x: piece.x + (clampedX * backCos - clampedZ * backSin),
    z: piece.z + (clampedX * backSin + clampedZ * backCos),
    distance,
  }
}

/**
 * Pushes a circle out of anything it is standing inside, and back inside the
 * arena walls.
 *
 * Deliberately a position fix-up rather than a swept collision: bodies here
 * move a fraction of a unit per frame, so the cheap resolution never visibly
 * misbehaves, and it cannot tunnel because nothing moves further than its own
 * radius in a step at these speeds.
 */
function resolveAgainstWorld(pos: Vec2, radius: number, cover: readonly Cover[]): void {
  for (const piece of cover) {
    const near = closestOnCover(piece, pos.x, pos.z)
    if (near.distance >= radius) continue

    const dx = pos.x - near.x
    const dz = pos.z - near.z
    const length = Math.hypot(dx, dz)
    if (length < 1e-6) {
      // Dead centre of a box: pick any axis rather than dividing by zero.
      pos.x = near.x + radius
      continue
    }
    const push = radius - near.distance
    pos.x += (dx / length) * push
    pos.z += (dz / length) * push
  }

  const wall = ARENA_HALF - ARENA_MARGIN
  pos.x = clamp(pos.x, -wall, wall)
  pos.z = clamp(pos.z, -wall, wall)
}

/**
 * How far a ray travels before a piece of cover stops it.
 *
 * @returns the distance to the first blocker, or `maxDistance` if the shot has
 *          a clear lane. Low rubble is skipped once the shot is above it,
 *          which is what makes half-height cover a real decision.
 */
function coverBlockDistance(
  cover: readonly Cover[],
  origin: Vec3,
  dir: Vec3,
  maxDistance: number,
): number {
  let nearest = maxDistance

  for (const piece of cover) {
    // Step along the ray rather than solving each shape analytically. The step
    // is a fraction of the smallest piece in the game, so nothing is missed,
    // and it handles rotated boxes and cylinders with the same code.
    const reach = Math.max(piece.halfX, piece.halfZ)
    const toPiece = Math.hypot(piece.x - origin.x, piece.z - origin.z)
    if (toPiece - reach > nearest) continue

    const step = 0.35
    for (let travelled = 0; travelled < nearest; travelled += step) {
      const x = origin.x + dir.x * travelled
      const z = origin.z + dir.z * travelled
      const y = origin.y + dir.y * travelled
      if (y > piece.height || y < 0) continue
      if (closestOnCover(piece, x, z).distance <= 0) {
        nearest = Math.min(nearest, travelled)
        break
      }
    }
  }

  return nearest
}

/** True when nothing solid stands between two points. */
function hasLineOfSight(cover: readonly Cover[], from: Vec3, to: Vec3): boolean {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dz = to.z - from.z
  const distance = Math.hypot(dx, dy, dz)
  if (distance < 1e-4) return true
  const dir = { x: dx / distance, y: dy / distance, z: dz / distance }
  return coverBlockDistance(cover, from, dir, distance) >= distance
}

/**
 * The first enemy a ray passes through.
 *
 * Bodies are vertical cylinders. That is a deliberate simplification: a capsule
 * would be more correct and completely unnoticeable at these speeds, and the
 * cheaper test lets a shotgun fire six of these in a frame on a phone.
 */
function raycastEnemies(
  enemies: readonly ArenaEnemy[],
  origin: Vec3,
  dir: Vec3,
  maxDistance: number,
): { enemy: ArenaEnemy; distance: number } | null {
  let best: { enemy: ArenaEnemy; distance: number } | null = null

  for (const enemy of enemies) {
    if (!enemy.alive) continue
    const radius = radiusOf(enemy.kind)

    const ox = origin.x - enemy.pos.x
    const oz = origin.z - enemy.pos.z
    const a = dir.x * dir.x + dir.z * dir.z
    if (a < 1e-8) continue
    const b = 2 * (ox * dir.x + oz * dir.z)
    const c = ox * ox + oz * oz - radius * radius
    const discriminant = b * b - 4 * a * c
    if (discriminant < 0) continue

    const root = Math.sqrt(discriminant)
    // The near intersection, unless the ray started inside the body.
    let distance = (-b - root) / (2 * a)
    if (distance < 0) distance = (-b + root) / (2 * a)
    if (distance < 0 || distance > maxDistance) continue

    const y = origin.y + dir.y * distance
    if (y < 0 || y > heightOf(enemy.kind)) continue

    if (!best || distance < best.distance) best = { enemy, distance }
  }

  return best
}

/* ------------------------------------------------------------------ *
 *  Events
 * ------------------------------------------------------------------ */

function emit(
  state: ArenaState,
  kind: ArenaEventKind,
  pos: Vec3,
  amount: number,
  critical = false,
): void {
  const event: ArenaEvent = { id: state.nextEventId, kind, pos, amount, critical }
  state.nextEventId += 1
  state.events.push(event)
}

/* ------------------------------------------------------------------ *
 *  Building a fight
 * ------------------------------------------------------------------ */

function createPlayer(maxHealth: number, gun: GunStats): ArenaPlayer {
  return {
    pos: { x: 0, z: 0 },
    vel: { x: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    health: maxHealth,
    maxHealth,
    ammo: gun.magazine,
    reloadLeft: 0,
    heat: 0,
    overheated: false,
    fireCooldown: 0,
    rollLeft: 0,
    rollDir: { x: 0, z: 0 },
    rollCooldown: 0,
    invulnerable: 0,
    sprinting: false,
    ads: 0,
    hurt: 0,
    recoilKick: 0,
    streak: 0,
    streakWindow: 0,
    alive: true,
    kills: 0,
    shotsFired: 0,
    shotsHit: 0,
    damageTaken: 0,
  }
}

export interface ArenaOptions {
  gun: GunStats
  hero: Hero
  enemy: Enemy
  terrain: Terrain
  level: Level
}

export function createArena({ gun, hero, enemy, terrain, level }: ArenaOptions): ArenaState {
  const waves = wavesFor(enemy, terrain, level)

  return {
    phase: 'briefing',
    elapsed: 0,
    timeLimit: ARENA_TIMEOUT,
    briefingLeft: BRIEFING_SECONDS,

    // The hero multiplies health exactly as it did in the duel, so a commander
    // still changes how a fight is fought and never what it is worth.
    player: createPlayer(MAX_HEALTH * hero.health, gun),
    gun,
    enemies: [],
    enemyEmoji: enemy.emoji,
    bullets: [],
    cover: coverFor(terrain),

    waves,
    waveIndex: 0,
    waveDelay: 0,
    killed: 0,
    totalEnemies: forceSize(waves),

    events: [],
    shake: 0,
    hitStop: 0,
    slowMotion: 0,
    hitMarker: 0,

    result: null,

    nextBulletId: 1,
    nextEventId: 1,
    nextEnemyId: 1,
  }
}

/**
 * Walks the next wave onto the field.
 *
 * Spawn angles are derived from the wave and member index rather than drawn
 * from a generator, so the arena stays reproducible without the state having
 * to carry a PRNG around. They are pushed away from the player when the ring
 * would otherwise drop somebody in their lap.
 */
function spawnWave(state: ArenaState): void {
  const wave = state.waves[state.waveIndex]
  if (!wave) return

  const count = wave.members.length
  const ring = ARENA_HALF - SPAWN_INSET

  wave.members.forEach((member, index) => {
    const profile = KIND_PROFILE[member.kind]
    const base = (index / count) * Math.PI * 2 + state.waveIndex * 0.7

    let x = 0
    let z = 0
    // Rotate around the ring until the drop point is far enough from the
    // player. Eight tries covers the whole circle in 45-degree steps; if none
    // of them work the player is standing in the middle of the ring anyway,
    // and the last candidate is as good as any.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const angle = base + attempt * (Math.PI / 4)
      x = Math.cos(angle) * ring
      z = Math.sin(angle) * ring
      if (Math.hypot(x - state.player.pos.x, z - state.player.pos.z) >= SPAWN_MIN_DISTANCE) break
    }

    const pos = { x, z }
    resolveAgainstWorld(pos, radiusOf(member.kind), state.cover)

    state.enemies.push({
      id: state.nextEnemyId,
      kind: member.kind,
      emoji: state.enemyEmoji,
      pos,
      vel: { x: 0, z: 0 },
      yaw: Math.atan2(-(state.player.pos.x - pos.x), -(state.player.pos.z - pos.z)),
      health: member.health,
      maxHealth: member.health,
      damage: member.damage,
      cycle: profile.cycle,
      // Staggered on purpose. A wave whose cooldowns all started at zero would
      // wind up in unison and land as one unreadable wall of damage instead of
      // a sequence of threats the player can actually answer one at a time.
      attackCooldown: 0.5 + index * 0.45,
      windUp: 0,
      speed: profile.speed,
      preferredRange: profile.preferredRange,
      attackRange: profile.attackRange,
      projectileSpeed: profile.projectileSpeed,
      hurt: 0,
      stagger: 0,
      alive: true,
      age: 0,
      deathAge: 0,
      strafeDir: index % 2 === 0 ? 1 : -1,
      repathIn: 0,
      goal: { x: state.player.pos.x, z: state.player.pos.z },
    })
    state.nextEnemyId += 1
  })

  emit(state, 'wave', { x: 0, y: 0, z: 0 }, state.waveIndex + 1)
  state.waveIndex += 1
}

/* ------------------------------------------------------------------ *
 *  Damage
 * ------------------------------------------------------------------ */

function hurtEnemy(state: ArenaState, enemy: ArenaEnemy, amount: number, at: Vec3): void {
  if (!enemy.alive) return

  enemy.health -= amount
  enemy.hurt = HURT_TIME
  state.hitMarker = HIT_MARKER_TIME

  if (enemy.health <= 0) {
    enemy.health = 0
    enemy.alive = false
    state.killed += 1
    state.player.kills += 1
    state.player.streak += 1
    state.player.streakWindow = STREAK_WINDOW

    const last = state.killed >= state.totalEnemies
    emit(state, 'kill', at, amount, last)
    state.hitStop = last ? FINISHER_HIT_STOP : Math.min(MAX_HIT_STOP, amount * HIT_STOP_PER_DAMAGE)
    if (last) state.slowMotion = Math.max(state.slowMotion, FINISHER_SLOW_MOTION)
    state.shake = Math.min(1, state.shake + 0.25)
    return
  }

  emit(state, 'hit', at, amount)
  state.hitStop = Math.min(MAX_HIT_STOP, amount * HIT_STOP_PER_DAMAGE)
  state.shake = Math.min(1, state.shake + amount / 90)
}

/**
 * @param from where the blow came from, so the HUD can point at it. In a
 *             third-person shooter the thing that kills you is very often
 *             off-screen, and an unexplained health drop reads as unfair.
 */
function hurtPlayer(state: ArenaState, amount: number, from: Vec3): void {
  const { player } = state
  if (!player.alive || player.invulnerable > 0) return

  player.health = Math.max(0, player.health - amount)
  player.hurt = HURT_TIME
  player.damageTaken += amount
  // Getting hit is what ends a streak, so pressure is the way to keep one.
  player.streak = 0
  player.streakWindow = 0

  emit(state, 'hurt', from, amount)
  state.hitStop = Math.min(MAX_HIT_STOP, amount * HIT_STOP_PER_DAMAGE)
  state.shake = Math.min(1, state.shake + amount / 34)

  if (player.health <= 0) player.alive = false
}

/** Damage after distance has taken its cut. */
function withFalloff(gun: GunStats, distance: number): number {
  if (distance <= gun.falloffStart) return gun.damage
  const span = Math.max(1e-3, gun.falloffEnd - gun.falloffStart)
  const t = clamp((distance - gun.falloffStart) / span, 0, 1)
  return gun.damage * (1 + (gun.falloffFloor - 1) * t)
}

/** Splash hurts everything in the radius, tapering to nothing at the edge. */
function detonate(state: ArenaState, at: Vec3, radius: number, damage: number, owner: 'player' | 'enemy'): void {
  emit(state, 'explosion', at, radius)
  state.shake = Math.min(1, state.shake + 0.4)

  if (owner === 'player') {
    for (const enemy of state.enemies) {
      if (!enemy.alive) continue
      const distance = Math.hypot(enemy.pos.x - at.x, enemy.pos.z - at.z)
      if (distance > radius) continue
      const share = 1 - distance / radius
      hurtEnemy(state, enemy, damage * share, { x: enemy.pos.x, y: ACTOR_HEIGHT * 0.5, z: enemy.pos.z })
    }
    return
  }

  const distance = Math.hypot(state.player.pos.x - at.x, state.player.pos.z - at.z)
  if (distance <= radius) hurtPlayer(state, damage * (1 - distance / radius), at)
}

/* ------------------------------------------------------------------ *
 *  Shooting
 * ------------------------------------------------------------------ */

/** The direction the gun is pointing, including the recoil the player has earned. */
function aimDirection(player: ArenaPlayer): Vec3 {
  const pitch = clamp(player.pitch + player.recoilKick, -PITCH_LIMIT, PITCH_LIMIT)
  const cosPitch = Math.cos(pitch)
  return {
    x: -Math.sin(player.yaw) * cosPitch,
    y: Math.sin(pitch),
    z: -Math.cos(player.yaw) * cosPitch,
  }
}

/**
 * Nudges a direction inside a cone.
 *
 * The offset is derived from the shot's own id rather than from `Math.random`,
 * which keeps the whole fight reproducible. The two irrational multipliers are
 * there so consecutive pellets from one trigger pull do not land in a neat
 * line — a shotgun whose spread was a visible pattern would read as a bug.
 */
function applySpread(dir: Vec3, spread: number, seed: number): Vec3 {
  if (spread <= 0) return dir

  const angle = seed * 2.399963229728653
  const radius = spread * Math.sqrt(((seed * 0.6180339887) % 1))
  const offsetX = Math.cos(angle) * radius
  const offsetY = Math.sin(angle) * radius

  // Build a frame around the aim direction and lean inside it. For the small
  // angles a spread cone actually uses, this is indistinguishable from a
  // proper rotation and costs a fraction as much.
  const flatLength = Math.hypot(dir.x, dir.z) || 1e-6
  const rightX = dir.z / flatLength
  const rightZ = -dir.x / flatLength

  const x = dir.x + rightX * offsetX
  const y = dir.y + offsetY
  const z = dir.z + rightZ * offsetX
  const length = Math.hypot(x, y, z) || 1
  return { x: x / length, y: y / length, z: z / length }
}

export function aimSpread(state: ArenaState): number {
  const { player, gun } = state
  const speed = Math.hypot(player.vel.x, player.vel.z)
  const moving = clamp(speed / WALK_SPEED, 0, 1)
  const hip = gun.spread + (gun.spreadMoving - gun.spread) * moving
  return hip + (gun.spreadAds - hip) * player.ads
}

/** The muzzle, in world space. */
function muzzleOf(player: ArenaPlayer): Vec3 {
  return { x: player.pos.x, y: MUZZLE_HEIGHT, z: player.pos.z }
}

/**
 * A swung weapon: an arc in front of the commander rather than a projectile.
 *
 * Melee has to stay genuinely viable — level one is designed to be won with
 * the free Stone Axe — so the arc is generous and the lunge closes the last
 * stride onto a target that is backing off.
 */
function swing(state: ArenaState): void {
  const { player, gun } = state
  const forward = forwardOf(player.yaw)

  // A generous 60 degrees either side. Narrower and a swing that visibly
  // connected would miss, which reads as broken rather than as difficult.
  const halfAngle = Math.PI / 3

  /**
   * How far this swing may carry the commander.
   *
   * The lunge exists to close the last stride onto something backing away, so
   * it must never carry them *through* it. A flat lunge does exactly that at
   * the range melee is supposed to be lethal: standing a stride from a rusher
   * and swinging would put the commander a stride behind it, the arc would
   * then be measured from there, and the blow that visibly landed would miss.
   * So the step is capped at whatever is needed to arrive in contact with the
   * nearest body already in front of the swing.
   */
  let reach = gun.lunge
  for (const enemy of state.enemies) {
    if (!enemy.alive) continue
    const dx = enemy.pos.x - player.pos.x
    const dz = enemy.pos.z - player.pos.z
    const distance = Math.hypot(dx, dz)
    const dot = (dx * forward.x + dz * forward.z) / (distance || 1e-6)
    if (dot < Math.cos(halfAngle)) continue
    const contact = ACTOR_RADIUS + radiusOf(enemy.kind) + 0.15
    reach = Math.min(reach, Math.max(0, distance - contact))
  }

  player.pos.x += forward.x * reach
  player.pos.z += forward.z * reach
  resolveAgainstWorld(player.pos, ACTOR_RADIUS, state.cover)

  // One swing is one shot however many bodies are caught in the arc, so
  // cleaving three enemies reads as a single clean hit rather than as 300%
  // accuracy on the report screen.
  let connected = false

  for (const enemy of state.enemies) {
    if (!enemy.alive) continue
    const dx = enemy.pos.x - player.pos.x
    const dz = enemy.pos.z - player.pos.z
    const distance = Math.hypot(dx, dz)
    if (distance > gun.falloffEnd + radiusOf(enemy.kind)) continue

    const dot = (dx * forward.x + dz * forward.z) / (distance || 1e-6)
    if (dot < Math.cos(halfAngle)) continue

    connected = true
    hurtEnemy(state, enemy, gun.damage, {
      x: enemy.pos.x,
      y: ACTOR_HEIGHT * 0.6,
      z: enemy.pos.z,
    })
  }

  if (connected) player.shotsHit += 1
}

function fireOnce(state: ArenaState): void {
  const { player, gun } = state
  const origin = muzzleOf(player)

  emit(state, 'muzzle', origin, 1)

  if (gun.melee) {
    // A swing is one shot; `swing` decides whether it counted as a hit.
    player.shotsFired += 1
    swing(state)
    return
  }

  // Every pellet is its own shot. Counting a buck-and-ball load as one would
  // let the musket report six hits from one trigger pull and hand the report
  // screen an accuracy above 100%.
  player.shotsFired += gun.pellets

  const spread = aimSpread(state)
  const base = aimDirection(player)

  for (let pellet = 0; pellet < gun.pellets; pellet += 1) {
    const seed = state.nextBulletId + pellet * 7
    const dir = applySpread(base, spread, seed)

    if (gun.muzzleSpeed === Number.POSITIVE_INFINITY) {
      // Hitscan. The shot arrives this frame, so it resolves here and never
      // becomes a Bullet — which is the whole identity of the sniper rifle.
      const reach = gun.falloffEnd
      const blocked = coverBlockDistance(state.cover, origin, dir, reach)
      const target = raycastEnemies(state.enemies, origin, dir, Math.min(reach, blocked))

      const distance = target ? target.distance : blocked
      const at = {
        x: origin.x + dir.x * distance,
        y: origin.y + dir.y * distance,
        z: origin.z + dir.z * distance,
      }

      if (target) {
        player.shotsHit += 1
        hurtEnemy(state, target.enemy, withFalloff(gun, target.distance), at)
      } else {
        emit(state, 'impact', at, 1)
      }
      continue
    }

    state.bullets.push({
      id: state.nextBulletId,
      owner: 'player',
      pos: { ...origin },
      vel: { x: dir.x * gun.muzzleSpeed, y: dir.y * gun.muzzleSpeed, z: dir.z * gun.muzzleSpeed },
      damage: gun.damage,
      splash: gun.splash,
      gravity: gun.gravity,
      // Long enough to cross the arena diagonal at the slowest muzzle speed
      // in the game, so a catapult shell is never deleted mid-flight.
      life: 4,
      origin: { ...origin },
    })
    state.nextBulletId += 1
  }

  player.recoilKick += gun.recoil
}

/**
 * Everything about pulling and holding a trigger.
 *
 * Reload and overheat are deliberately different punishments. A reload is a
 * cost you choose when to pay; overheating is one the gun chooses for you, and
 * it is why the laser rifle is not simply the best weapon in the armory.
 */
function updateWeapon(state: ArenaState, input: ArenaInput, step: number): void {
  const { player, gun } = state

  player.fireCooldown = countDown(player.fireCooldown, step)
  player.recoilKick = Math.max(0, player.recoilKick - step * 2.4)

  /**
   * Does this weapon have a magazine at all?
   *
   * A swung weapon does not. Running an axe through the ammo system would let
   * it take exactly one swing per battle and then sit at zero rounds forever,
   * because a reload of zero seconds never starts and so never finishes — and
   * the first level of the campaign is designed to be won with that axe.
   */
  const magazineFed = !gun.overheat && gun.magazine > 0 && gun.reloadTime > 0

  if (gun.overheat) {
    if (player.overheated) {
      // Redlined: the gun is gone for the full cool-down, no early out.
      player.heat = Math.max(0, player.heat - step / gun.reloadTime)
      if (player.heat <= 0) {
        player.overheated = false
        player.ammo = gun.magazine
        emit(state, 'reload', muzzleOf(player), 1)
      }
    } else if (!input.fire) {
      // Venting while the trigger is off is free, and is the skill in the gun.
      player.heat = Math.max(0, player.heat - (step / gun.reloadTime) * 1.35)
      player.ammo = Math.round((1 - player.heat) * gun.magazine)
    }
  } else if (player.reloadLeft > 0) {
    player.reloadLeft = Math.max(0, player.reloadLeft - step)
    if (player.reloadLeft === 0) {
      player.ammo = gun.magazine
      emit(state, 'reload', muzzleOf(player), 1)
    }
  } else if (!magazineFed) {
    // Nothing to load: the swing is always ready, and the fire interval alone
    // paces it.
    player.ammo = gun.magazine
  }

  // A manual reload. Refused when it would do nothing, so the button never
  // silently eats a full magazine — and refused outright for a weapon that has
  // nothing to reload.
  if (input.reload) {
    input.reload = false
    if (magazineFed && !gun.overheat && player.reloadLeft <= 0 && player.ammo < gun.magazine) {
      player.reloadLeft = gun.reloadTime
    }
  }

  if (!input.fire) return
  if (player.fireCooldown > 0 || player.reloadLeft > 0 || player.overheated) return
  // Rolling is a commitment: it buys invulnerability and costs the trigger.
  if (player.rollLeft > 0) return

  if (magazineFed && player.ammo <= 0) {
    // Pulling the trigger dry starts the reload for you. Making the player
    // press a second button to recover from a mistake they can already hear is
    // punishment without a decision in it.
    if (!gun.overheat && player.reloadLeft <= 0) {
      emit(state, 'empty', muzzleOf(player), 0)
      player.reloadLeft = gun.reloadTime
    }
    return
  }

  fireOnce(state)
  player.fireCooldown = gun.fireInterval

  if (gun.overheat) {
    player.heat = Math.min(1, player.heat + 1 / gun.magazine)
    player.ammo = Math.max(0, Math.round((1 - player.heat) * gun.magazine))
    // Trip on the round count, never on the float.
    //
    // Adding 1/24 twenty-four times lands on 0.9999999999999996, so a
    // `heat >= 1` test is false at exactly the moment the gun is empty: it
    // would never enter its cool-down, and because a redlined gun reports zero
    // rounds it would sit jammed at zero for the rest of the battle with no
    // way back. The integer count has no such gap.
    if (player.ammo <= 0) {
      player.heat = 1
      player.overheated = true
      emit(state, 'empty', muzzleOf(player), 0, true)
    }
  } else if (magazineFed) {
    player.ammo -= 1
  }

  // A semi-automatic needs the trigger released between shots. Clearing the
  // flag here rather than asking the input layer to track edges keeps every
  // control surface — thumb, mouse, key — honest by construction.
  if (!gun.automatic) input.fire = false
}

/* ------------------------------------------------------------------ *
 *  The player
 * ------------------------------------------------------------------ */

/** Smallest signed angle from `from` to `to`. */
function angleBetween(from: number, to: number): number {
  const raw = (to - from) % (Math.PI * 2)
  return raw > Math.PI ? raw - Math.PI * 2 : raw < -Math.PI ? raw + Math.PI * 2 : raw
}

/**
 * Aim assist for stick-driven aim. See the essay on the constants in
 * `world.ts` for why this exists and why a mouse never gets it.
 *
 * It runs inside the simulation, before the look deltas are consumed, for one
 * load-bearing reason: determinism. Assist applied in the input layer would
 * depend on the renderer's frame times, and a replayed fight would stop
 * replaying. Here it is part of the same fixed step as everything else.
 */
function assistAim(state: ArenaState, input: ArenaInput, step: number): void {
  const { player } = state

  // The nearest target by angle, not by distance: assist is about finishing
  // the shot the player is already making, so the enemy closest to the
  // crosshair is the one they mean.
  let bestYawError = 0
  let bestPitchError = 0
  let bestAngle = Number.POSITIVE_INFINITY

  for (const enemy of state.enemies) {
    if (!enemy.alive) continue
    const dx = enemy.pos.x - player.pos.x
    const dz = enemy.pos.z - player.pos.z
    const distance = Math.hypot(dx, dz)
    if (distance < 0.001 || distance > ASSIST_RANGE) continue

    // The same yaw convention as forwardOf: a yaw of 0 faces -Z.
    const wantYaw = Math.atan2(-dx, -dz)
    const yawError = angleBetween(player.yaw, wantYaw)

    // Aim at the torso, from the muzzle — matching where the sim itself aims
    // when an enemy shoots back, so the two agree about what "on target" is.
    const wantPitch = Math.atan2(ACTOR_HEIGHT * 0.55 - MUZZLE_HEIGHT, distance)
    const pitchError = wantPitch - player.pitch

    const angle = Math.hypot(yawError, pitchError)
    if (angle < bestAngle) {
      bestAngle = angle
      bestYawError = yawError
      bestPitchError = pitchError
    }
  }

  if (bestAngle > ASSIST_FRICTION_CONE) return

  // Friction: the crosshair thickens over a target, so a pass-over becomes a
  // hold without the player changing anything about their push.
  input.lookX *= ASSIST_FRICTION
  input.lookY *= ASSIST_FRICTION

  // Magnetism: only while firing, only inside the tighter cone, and as an
  // exponential approach so it can finish an aim but never snap one.
  if (input.fire && bestAngle <= ASSIST_PULL_CONE) {
    const pull = 1 - Math.exp(-ASSIST_PULL_RATE * step)
    player.yaw += bestYawError * pull
    player.pitch = clamp(player.pitch + bestPitchError * pull, -PITCH_LIMIT, PITCH_LIMIT)
  }
}

function updatePlayer(state: ArenaState, input: ArenaInput, step: number): void {
  const { player, gun } = state

  player.hurt = countDown(player.hurt, step)
  player.invulnerable = countDown(player.invulnerable, step)
  player.rollCooldown = countDown(player.rollCooldown, step)
  player.streakWindow = countDown(player.streakWindow, step)
  if (player.streakWindow <= 0) player.streak = 0

  // A stick gets help a mouse does not need. Applied before the deltas are
  // consumed, so friction scales what magnetism then finishes.
  if (input.assisted) assistAim(state, input, step)

  // Look. The deltas are rates the input layer has already scaled by its own
  // frame time, so they are consumed whole and zeroed.
  player.yaw -= input.lookX
  player.pitch = clamp(player.pitch - input.lookY, -PITCH_LIMIT, PITCH_LIMIT)
  input.lookX = 0
  input.lookY = 0

  // Aiming eases rather than snaps, because the camera rides this value and a
  // step change in it reads as a glitch rather than as a weapon coming up.
  const wantsAds = input.ads && !gun.melee && player.rollLeft <= 0
  player.ads = clamp(player.ads + (wantsAds ? step * 7 : -step * 9), 0, 1)

  // The roll. Edge-triggered, and it locks the direction at the moment it
  // starts — committing to it is the whole point, exactly as committing to a
  // swing was in the duel.
  if (input.dodge) {
    input.dodge = false
    if (player.rollCooldown <= 0 && player.rollLeft <= 0) {
      const forward = forwardOf(player.yaw)
      const right = rightOf(player.yaw)
      let dirX = right.x * input.moveX + forward.x * input.moveZ
      let dirZ = right.z * input.moveX + forward.z * input.moveZ
      const length = Math.hypot(dirX, dirZ)
      if (length < 0.15) {
        // Nothing on the stick: roll backwards, away from whatever is in front.
        dirX = -forward.x
        dirZ = -forward.z
      } else {
        dirX /= length
        dirZ /= length
      }
      player.rollLeft = ROLL_TIME
      player.rollDir = { x: dirX, z: dirZ }
      player.rollCooldown = ROLL_COOLDOWN
      // Deliberately shorter than the roll itself: the last part of it is
      // recovery, so a roll started too early still gets you hit.
      player.invulnerable = ROLL_IFRAMES
      emit(state, 'dodge', { x: player.pos.x, y: 0.4, z: player.pos.z }, 1)
    }
  }

  if (player.rollLeft > 0) {
    player.rollLeft = Math.max(0, player.rollLeft - step)
    player.vel.x = player.rollDir.x * ROLL_SPEED
    player.vel.z = player.rollDir.z * ROLL_SPEED
  } else {
    const forward = forwardOf(player.yaw)
    const right = rightOf(player.yaw)
    let wishX = right.x * input.moveX + forward.x * input.moveZ
    let wishZ = right.z * input.moveX + forward.z * input.moveZ
    const length = Math.hypot(wishX, wishZ)
    if (length > 1) {
      wishX /= length
      wishZ /= length
    }

    // Sprinting is refused while aiming: a weapon that could be sighted and
    // sprinted at once would make cover pointless.
    player.sprinting = input.sprint && length > 0.6 && player.ads < 0.3
    const speed =
      WALK_SPEED *
      (player.sprinting ? SPRINT_MULTIPLIER : 1) *
      (1 - (1 - ADS_MULTIPLIER) * player.ads)

    // Exponential, so the approach to full speed is identical at any frame
    // rate. A plain `rate * dt` lerp is only correct in the limit and visibly
    // drifts between a 60Hz phone and a 120Hz one.
    const blend = 1 - Math.exp(-GROUND_ACCEL * step)
    player.vel.x += (wishX * speed - player.vel.x) * blend
    player.vel.z += (wishZ * speed - player.vel.z) * blend

    if (length < 0.05) {
      const drop = Math.exp(-GROUND_FRICTION * step)
      player.vel.x *= drop
      player.vel.z *= drop
    }
  }

  player.pos.x += player.vel.x * step
  player.pos.z += player.vel.z * step
  resolveAgainstWorld(player.pos, ACTOR_RADIUS, state.cover)
}

/* ------------------------------------------------------------------ *
 *  Bullets in flight
 * ------------------------------------------------------------------ */

function advanceBullets(state: ArenaState, step: number): void {
  if (state.bullets.length === 0) return

  const survivors: Bullet[] = []

  for (const shot of state.bullets) {
    shot.life -= step
    if (shot.life <= 0) continue

    const previous = { x: shot.pos.x, y: shot.pos.y, z: shot.pos.z }
    shot.vel.y -= shot.gravity * step
    shot.pos.x += shot.vel.x * step
    shot.pos.y += shot.vel.y * step
    shot.pos.z += shot.vel.z * step

    const dx = shot.pos.x - previous.x
    const dy = shot.pos.y - previous.y
    const dz = shot.pos.z - previous.z
    const travelled = Math.hypot(dx, dy, dz)
    if (travelled < 1e-6) {
      survivors.push(shot)
      continue
    }
    const dir = { x: dx / travelled, y: dy / travelled, z: dz / travelled }

    // Test the segment actually covered this frame rather than the new point.
    // A laser bolt crosses several units per step, and a point test would let
    // it pass straight through a body standing between the two positions.
    const blocked = coverBlockDistance(state.cover, previous, dir, travelled)

    let impactAt: Vec3 | null = null
    let victim: ArenaEnemy | null = null

    if (shot.owner === 'player') {
      const hit = raycastEnemies(state.enemies, previous, dir, Math.min(travelled, blocked))
      if (hit) {
        if (shot.splash > 0) state.player.shotsHit += 1
        victim = hit.enemy
        impactAt = {
          x: previous.x + dir.x * hit.distance,
          y: previous.y + dir.y * hit.distance,
          z: previous.z + dir.z * hit.distance,
        }
      }
    } else {
      // Against the player, one cylinder test is enough.
      const ox = previous.x - state.player.pos.x
      const oz = previous.z - state.player.pos.z
      const a = dir.x * dir.x + dir.z * dir.z
      if (a > 1e-8) {
        const b = 2 * (ox * dir.x + oz * dir.z)
        const c = ox * ox + oz * oz - ACTOR_RADIUS * ACTOR_RADIUS
        const discriminant = b * b - 4 * a * c
        if (discriminant >= 0) {
          const root = Math.sqrt(discriminant)
          let distance = (-b - root) / (2 * a)
          if (distance < 0) distance = (-b + root) / (2 * a)
          if (distance >= 0 && distance <= Math.min(travelled, blocked)) {
            const y = previous.y + dir.y * distance
            if (y >= 0 && y <= ACTOR_HEIGHT) {
              impactAt = {
                x: previous.x + dir.x * distance,
                y,
                z: previous.z + dir.z * distance,
              }
            }
          }
        }
      }
    }

    if (impactAt) {
      if (shot.splash > 0) {
        detonate(state, impactAt, shot.splash, shot.damage, shot.owner)
      } else if (victim) {
        const range = Math.hypot(
          impactAt.x - shot.origin.x,
          impactAt.y - shot.origin.y,
          impactAt.z - shot.origin.z,
        )
        state.player.shotsHit += 1
        hurtEnemy(state, victim, withFalloff(state.gun, range), impactAt)
      } else {
        hurtPlayer(state, shot.damage, shot.origin)
      }
      continue
    }

    // Cover, or the ground.
    if (blocked < travelled || shot.pos.y <= 0) {
      const distance = Math.min(blocked, travelled)
      const at =
        shot.pos.y <= 0
          ? { x: shot.pos.x, y: 0, z: shot.pos.z }
          : {
              x: previous.x + dir.x * distance,
              y: previous.y + dir.y * distance,
              z: previous.z + dir.z * distance,
            }
      if (shot.splash > 0) detonate(state, at, shot.splash, shot.damage, shot.owner)
      else emit(state, 'impact', at, 1)
      continue
    }

    if (Math.abs(shot.pos.x) > ARENA_HALF + 6 || Math.abs(shot.pos.z) > ARENA_HALF + 6) continue

    survivors.push(shot)
  }

  state.bullets = survivors
}

/* ------------------------------------------------------------------ *
 *  The enemy
 * ------------------------------------------------------------------ */

/**
 * How long a body stays on the field after it falls.
 *
 * Long enough for the collapse to read, short enough that the renderer's actor
 * pool is never asked to hold a whole battle's dead at once.
 */
const CORPSE_SECONDS = 1.2

/** How hard bodies shove each other apart, so a wave never stacks into one. */
const SEPARATION_FORCE = 5.5

function enemyAttack(state: ArenaState, enemy: ArenaEnemy): void {
  const profile = KIND_PROFILE[enemy.kind]
  const player = state.player
  const from: Vec3 = { x: enemy.pos.x, y: MUZZLE_HEIGHT, z: enemy.pos.z }

  if (enemy.projectileSpeed <= 0) {
    // A blow rather than a shot: it lands now, if it can still reach. Stepping
    // out of range during the wind-up is a real and intended escape.
    const distance = Math.hypot(player.pos.x - enemy.pos.x, player.pos.z - enemy.pos.z)
    if (distance <= enemy.attackRange) hurtPlayer(state, enemy.damage, from)
    return
  }

  // Lead the target, but only by the fraction of a perfect solution that makes
  // the shot dodgeable. A perfectly-led projectile is impossible to avoid by
  // moving, which would make the roll the only answer to every gunner.
  const flightTime =
    Math.hypot(player.pos.x - enemy.pos.x, player.pos.z - enemy.pos.z) / enemy.projectileSpeed
  const lead = 0.55
  const targetX = player.pos.x + player.vel.x * flightTime * lead
  const targetZ = player.pos.z + player.vel.z * flightTime * lead

  const dx = targetX - from.x
  const dy = ACTOR_HEIGHT * 0.55 - from.y
  const dz = targetZ - from.z
  const distance = Math.hypot(dx, dy, dz) || 1
  const dir = { x: dx / distance, y: dy / distance, z: dz / distance }

  // A lobbed shell has to be thrown upward or gravity puts it in the dirt.
  if (profile.gravity > 0) {
    dir.y += (profile.gravity * distance) / (2 * enemy.projectileSpeed * enemy.projectileSpeed)
    const length = Math.hypot(dir.x, dir.y, dir.z) || 1
    dir.x /= length
    dir.y /= length
    dir.z /= length
  }

  state.bullets.push({
    id: state.nextBulletId,
    owner: 'enemy',
    pos: { ...from },
    vel: {
      x: dir.x * enemy.projectileSpeed,
      y: dir.y * enemy.projectileSpeed,
      z: dir.z * enemy.projectileSpeed,
    },
    damage: enemy.damage,
    splash: profile.splash,
    gravity: profile.gravity,
    life: 4,
    origin: { ...from },
  })
  state.nextBulletId += 1
}

function updateEnemy(state: ArenaState, enemy: ArenaEnemy, step: number): void {
  const player = state.player
  const profile = KIND_PROFILE[enemy.kind]

  enemy.age += step
  enemy.hurt = countDown(enemy.hurt, step)
  enemy.stagger = countDown(enemy.stagger, step)
  enemy.attackCooldown = countDown(enemy.attackCooldown, step)
  enemy.repathIn = countDown(enemy.repathIn, step)

  if (enemy.stagger > 0) return

  const dx = player.pos.x - enemy.pos.x
  const dz = player.pos.z - enemy.pos.z
  const distance = Math.hypot(dx, dz) || 1e-6
  const toPlayerX = dx / distance
  const toPlayerZ = dz / distance

  // Always face the player. A body that attacked side-on would be unreadable.
  enemy.yaw = Math.atan2(-toPlayerX, -toPlayerZ)

  // Resolve the wind-up first, so a committed attack still lands even if the
  // body would otherwise have moved this frame.
  if (enemy.windUp > 0) {
    enemy.windUp -= step
    if (enemy.windUp <= 0) {
      enemy.windUp = 0
      enemyAttack(state, enemy)
    }
    return
  }

  // The boss stops being patient once it is hurt, which is the only difficulty
  // curve inside a single fight the game has.
  const wounded = enemy.kind === 'boss' && enemy.health < enemy.maxHealth * 0.5
  const preferred = wounded ? enemy.preferredRange * 0.45 : enemy.preferredRange
  const speed = enemy.speed * (wounded ? 1.25 : 1)

  if (enemy.repathIn <= 0) {
    // Flip the circling direction now and then so a gunner does not orbit
    // forever in one direction and become a predictable, free target.
    enemy.strafeDir = enemy.strafeDir * -1
    enemy.repathIn = 1.6 + (enemy.id % 5) * 0.35
  }

  // Close, hold, or back off, depending on how this one likes to fight.
  const gap = distance - preferred
  const approach = clamp(gap / 3, -1, 1)
  let moveX = toPlayerX * approach
  let moveZ = toPlayerZ * approach

  // Circling, so they do not all pile onto one line of fire.
  const strafeWeight = enemy.kind === 'rusher' ? 0.25 : 0.75
  moveX += -toPlayerZ * enemy.strafeDir * strafeWeight
  moveZ += toPlayerX * enemy.strafeDir * strafeWeight

  // Keep bodies out of each other. Without this a wave converges into a single
  // stack that reads as one enemy and dies to one grenade.
  for (const other of state.enemies) {
    if (other === enemy || !other.alive) continue
    const ox = enemy.pos.x - other.pos.x
    const oz = enemy.pos.z - other.pos.z
    const apart = Math.hypot(ox, oz)
    const wanted = radiusOf(enemy.kind) + radiusOf(other.kind) + 0.35
    if (apart >= wanted || apart < 1e-6) continue
    const push = (wanted - apart) / wanted
    moveX += (ox / apart) * push * SEPARATION_FORCE
    moveZ += (oz / apart) * push * SEPARATION_FORCE
  }

  const eye: Vec3 = { x: enemy.pos.x, y: MUZZLE_HEIGHT, z: enemy.pos.z }
  const aimAt: Vec3 = { x: player.pos.x, y: ACTOR_HEIGHT * 0.55, z: player.pos.z }
  const canSee = hasLineOfSight(state.cover, eye, aimAt)

  // Blocked by cover: slide around it rather than walking into it forever.
  // Rotating the whole desire vector is crude next to real pathfinding, and it
  // is enough, because every arena here is convex with scattered obstacles
  // rather than corridors.
  if (!canSee) {
    const angle = enemy.strafeDir * 0.9
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const rotatedX = moveX * cos - moveZ * sin
    const rotatedZ = moveX * sin + moveZ * cos
    moveX = rotatedX
    moveZ = rotatedZ
  }

  const wish = Math.hypot(moveX, moveZ)
  if (wish > 1e-6) {
    enemy.vel.x = (moveX / wish) * speed
    enemy.vel.z = (moveZ / wish) * speed
  } else {
    enemy.vel.x = 0
    enemy.vel.z = 0
  }

  enemy.pos.x += enemy.vel.x * step
  enemy.pos.z += enemy.vel.z * step
  resolveAgainstWorld(enemy.pos, radiusOf(enemy.kind), state.cover)

  // Commit to an attack only when it could actually connect. A shooter also
  // needs to be able to see what it is shooting at, or gunners would happily
  // fire into the back of a tree all fight.
  const canReach = distance <= enemy.attackRange
  const needsSight = enemy.projectileSpeed > 0
  if (canReach && enemy.attackCooldown <= 0 && (!needsSight || canSee)) {
    enemy.windUp = profile.windUp
    enemy.attackCooldown = enemy.cycle
  }
}

/* ------------------------------------------------------------------ *
 *  Ending
 * ------------------------------------------------------------------ */

function finish(state: ArenaState, timedOut: boolean): void {
  const { player } = state
  const cleared = state.killed >= state.totalEnemies

  // A clean result on either wipe. On the clock, the field goes to whoever was
  // winning it — putting more than half the force down counts as holding the
  // ground, which mirrors the strategy layer's `margin >= 0` going to the
  // player rather than inventing a new tie-breaking rule for the arena.
  const winner = cleared
    ? 'player'
    : !player.alive
      ? 'enemy'
      : state.killed * 2 >= state.totalEnemies
        ? 'player'
        : 'enemy'

  state.phase = 'over'
  state.result = {
    winner,
    playerHealth: (player.health / player.maxHealth) * 100,
    enemyForceLeft:
      state.totalEnemies > 0
        ? ((state.totalEnemies - state.killed) / state.totalEnemies) * 100
        : 0,
    duration: state.elapsed,
    kills: state.killed,
    totalEnemies: state.totalEnemies,
    shotsFired: player.shotsFired,
    shotsHit: player.shotsHit,
    accuracy: player.shotsFired > 0 ? player.shotsHit / player.shotsFired : 0,
    bestStreak: player.streak,
    timedOut,
    // Something reached this code, so a fight demonstrably happened.
    resolvedOnPaper: false,
  }
}

/* ------------------------------------------------------------------ *
 *  The step
 * ------------------------------------------------------------------ */

export function enemiesLeft(state: ArenaState): number {
  let count = 0
  for (const enemy of state.enemies) if (enemy.alive) count += 1
  return count
}

/**
 * Advances the fight in place.
 *
 * Mutates `state` and `input` rather than returning new objects: this runs
 * sixty times a second against a single owner, and the garbage from rebuilding
 * it each frame is not worth the purity. That is the same call `advanceDuel`
 * made, for the same reason.
 */
export function advanceArena(state: ArenaState, dt: number, input: ArenaInput): void {
  // Real time first, before slow motion bends it.
  const real = Math.min(Math.max(dt, 0), MAX_STEP)
  state.events.length = 0
  state.slowMotion = countDown(state.slowMotion, real)
  state.shake = Math.max(0, state.shake - real * 3.2)
  state.hitMarker = countDown(state.hitMarker, real)

  // Slow motion bends the fight's clock, never the browser's.
  const step = state.slowMotion > 0 ? real * SLOW_MOTION_SCALE : real

  if (state.phase === 'over') {
    advanceBullets(state, step)
    return
  }

  if (state.phase === 'briefing') {
    state.briefingLeft = Math.max(0, state.briefingLeft - step)
    if (state.briefingLeft <= 0) {
      state.phase = 'fighting'
      spawnWave(state)
    }
    // Nothing the player presses during the drop-in counts.
    input.fire = false
    input.dodge = false
    input.reload = false
    input.lookX = 0
    input.lookY = 0
    return
  }

  // Hit-stop: the whole world holds for a moment so the blow reads. Measured
  // in real time — a freeze that itself ran in slow motion would never end.
  if (state.hitStop > 0) {
    state.hitStop = Math.max(0, state.hitStop - real)
    return
  }

  state.elapsed += step

  updatePlayer(state, input, step)
  updateWeapon(state, input, step)

  for (const enemy of state.enemies) {
    if (enemy.alive) updateEnemy(state, enemy, step)
  }

  advanceBullets(state, step)

  // Let the dead lie long enough to be seen falling, then sweep them. The
  // timer runs from the death rather than the spawn: measuring from the spawn
  // would delete anything that survived more than a moment the instant it
  // died, and the renderer would never get to animate the collapse.
  let sweep = false
  for (const enemy of state.enemies) {
    if (enemy.alive) continue
    enemy.deathAge += step
    if (enemy.deathAge > CORPSE_SECONDS) sweep = true
  }
  if (sweep) state.enemies = state.enemies.filter((enemy) => enemy.deathAge <= CORPSE_SECONDS)

  // Waves. The field has to be genuinely clear before the next one is called,
  // so a player who leaves one gunner alive gets a breather they earned.
  if (enemiesLeft(state) === 0 && state.waveIndex < state.waves.length) {
    const next = state.waves[state.waveIndex]
    state.waveDelay = state.waveDelay > 0 ? state.waveDelay - step : (next?.delay ?? 0)
    if (state.waveDelay <= 0) {
      spawnWave(state)
      state.waveDelay = 0
    }
  }

  const cleared = enemiesLeft(state) === 0 && state.waveIndex >= state.waves.length
  if (!state.player.alive || cleared) {
    finish(state, false)
    return
  }
  if (state.elapsed >= state.timeLimit) finish(state, true)
}
