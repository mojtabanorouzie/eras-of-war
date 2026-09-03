/**
 * Every type the 3D arena is built from.
 *
 * The project's rule still holds: rules live in `src/game`, numbers live in
 * `src/data`, and nothing in `src/components` or `src/screens` invents either.
 * This file is the contract the simulation, the renderer and the input layer
 * all agree on, so none of the three needs to import the other two.
 *
 * COORDINATES — Three.js convention, right-handed. The arena is the XZ plane,
 * +Y is up, and the ground is y = 0. A yaw of 0 faces -Z; yaw increases
 * counter-clockwise seen from above, so +X sits at yaw = -PI/2. Every angle in
 * this file is in radians.
 *
 * The document is `dir="rtl"` and every label the player reads is Persian, but
 * an arena has no reading direction — the player turns the camera themselves.
 * The RTL constraint that survives is the one that always mattered: no Persian
 * text is ever drawn into WebGL. Labels stay in the DOM above the canvas.
 */

import type { Difficulty } from '../types'

export type ArenaPhase = 'briefing' | 'fighting' | 'over'

export type Side = 'player' | 'enemy'

/**
 * The four things that come at you.
 *
 * They are roles, not reskins: each punishes a different mistake, so a squad
 * built from all four has no single answer.
 */
export type EnemyKind =
  /** Sprints straight in and swings. Punishes standing still. */
  | 'rusher'
  /** Holds mid range and fires aimed shots. Punishes open ground. */
  | 'gunner'
  /** Slow, tough, lobs splash. Punishes hiding behind one piece of cover. */
  | 'heavy'
  /** Level six only. Everything above, with a health pool and phases. */
  | 'boss'

/** A point on the ground plane. */
export interface Vec2 {
  x: number
  z: number
}

/** A point in the arena. */
export interface Vec3 {
  x: number
  y: number
  z: number
}

/* ------------------------------------------------------------------ *
 *  The gun
 * ------------------------------------------------------------------ */

/**
 * What an armory weapon becomes once it has to be fired by hand.
 *
 * BALANCE CONTRACT — load-bearing, and must not be broken. The old duel spent
 * `projectPlayerPower` as damage-per-second so that a matchup 30 points in
 * your favour on paper was 30 points in your favour in the fight. The shooter
 * keeps exactly that promise:
 *
 *     sustained DPS = (power / REFERENCE_POWER) * (MAX_HEALTH / TIME_TO_KILL)
 *                     * dpsScale
 *
 * where *sustained* accounts for magazine and reload — a gun that spends a
 * third of its time reloading has to hit correspondingly harder per shot.
 * Every other field below is texture: it changes how the damage feels to
 * deliver, never how much of it there is. That is what keeps the tuned
 * six-level ladder, and the whole "right weapon for the ground" lesson, intact.
 */
export interface GunStats {
  id: string
  /** Persian display name, straight off the weapon. */
  name: string
  emoji: string

  /** Damage one bullet does at point-blank range. */
  damage: number
  /** Seconds between shots. */
  fireInterval: number
  /** True if holding the trigger keeps firing; false needs a tap per shot. */
  automatic: boolean

  /** Rounds per magazine. */
  magazine: number
  reloadTime: number

  /** Bullets per trigger pull. Above 1 is a spread of pellets. */
  pellets: number

  /** Cone half-angle when standing still and hip-firing. */
  spread: number
  /** Cone half-angle while moving. Always the worst of the three. */
  spreadMoving: number
  /** Cone half-angle when aiming down sights. Always the best. */
  spreadAds: number

  /**
   * Units per second. `Infinity` means hitscan: the shot arrives the frame it
   * is fired, and the renderer draws a tracer rather than a projectile.
   */
  muzzleSpeed: number
  /** Above 0 the shot arcs — units per second squared pulling it down. */
  gravity: number

  /** Full damage out to here. */
  falloffStart: number
  /** `falloffFloor` of the damage from here on. */
  falloffEnd: number
  falloffFloor: number

  /** Splash radius in units. 0 means it only hurts what it hits. */
  splash: number

  /** True for a swung weapon: an arc in front of the player, no projectile. */
  melee: boolean
  /** Units the player lunges forward on a melee swing. */
  lunge: number

  /**
   * Energy weapons overheat instead of reloading. When true, `magazine` is the
   * shots it takes to redline and `reloadTime` is the cool-down from full.
   * Venting early is free; redlining locks the gun for the whole cool-down.
   */
  overheat: boolean

  /** FOV multiplier while aiming. 1 is no zoom; a sniper sits near 0.45. */
  adsZoom: number
  /** Radians the view kicks up per shot. */
  recoil: number

  /** The luck-free power this was derived from, for the report screen. */
  power: number
}

/* ------------------------------------------------------------------ *
 *  The actors
 * ------------------------------------------------------------------ */

export interface ArenaPlayer {
  pos: Vec2
  vel: Vec2
  /** Where the commander is looking. Movement is relative to this. */
  yaw: number
  /** Clamped to +-PITCH_LIMIT. Feeds the camera and the aim ray. */
  pitch: number

  health: number
  maxHealth: number

  /** Rounds left, or shots left before redline on an overheating gun. */
  ammo: number
  /** Seconds left of a reload. Above 0 means the gun cannot fire. */
  reloadLeft: number
  /** 0..1 for energy weapons. At 1 the gun locks until it has vented. */
  heat: number
  overheated: boolean
  fireCooldown: number

  /** Seconds left of the roll. Movement is locked to `rollDir` while above 0. */
  rollLeft: number
  rollDir: Vec2
  rollCooldown: number
  /** Seconds of i-frames left. Bullets pass straight through. */
  invulnerable: number

  sprinting: boolean
  /** 0..1, eased. The camera and the spread cone both read it. */
  ads: number

  /** Seconds left on the flinch, for the renderer. */
  hurt: number
  /** Accumulated recoil in radians, decaying back to zero. */
  recoilKick: number

  /** Consecutive kills without taking a hit. */
  streak: number
  streakWindow: number

  alive: boolean
  kills: number
  shotsFired: number
  shotsHit: number
  damageTaken: number
}

export interface ArenaEnemy {
  id: number
  kind: EnemyKind
  /** Drawn on the billboard over its head. Comes from the level's enemy. */
  emoji: string

  pos: Vec2
  vel: Vec2
  yaw: number

  health: number
  maxHealth: number

  /** Damage of one landed attack. */
  damage: number
  /** Seconds from one attack to the next. */
  cycle: number
  attackCooldown: number
  /**
   * Seconds of commitment left before the blow lands. This is the player's
   * only warning, exactly as the duel's wind-up was, and the renderer has to
   * make it unmissable.
   */
  windUp: number
  /** Units per second this one moves. */
  speed: number
  /** How far out it is happy to sit. */
  preferredRange: number
  /** How far it can actually hurt you. */
  attackRange: number
  /** Above 0 for a shooter: the speed of the round it puts out. */
  projectileSpeed: number

  hurt: number
  /** Seconds spent reeling. Cannot move or attack. */
  stagger: number
  alive: boolean
  /** Seconds since it entered the arena, for the drop-in animation. */
  age: number
  /**
   * Seconds since it died, for the collapse. Bodies are swept once this passes
   * a short grace period — measured from the death rather than from the spawn,
   * so an enemy that survived a long fight still gets its death animation.
   */
  deathAge: number

  /** Which way it is circling. Flips when it is blocked or shot. */
  strafeDir: number
  /** Seconds until it picks a new spot to stand. */
  repathIn: number
  /** Where it is walking to right now. */
  goal: Vec2
}

export interface Bullet {
  id: number
  owner: Side
  pos: Vec3
  vel: Vec3
  damage: number
  /** Splash radius. 0 means it only hurts what it hits. */
  splash: number
  /** Units per second squared pulling it down. 0 flies flat. */
  gravity: number
  /** Seconds before it expires on its own. */
  life: number
  /** Where it started, so the renderer can stretch a tracer along its path. */
  origin: Vec3
}

/* ------------------------------------------------------------------ *
 *  The ground
 * ------------------------------------------------------------------ */

/**
 * One piece of cover.
 *
 * The simulation only ever treats cover as a vertical cylinder or a rotated
 * box. The renderer is free to dress it as a tree, a dune, a burnt-out wall or
 * an ice block, but collision reads these numbers and nothing else.
 */
export interface Cover {
  id: number
  x: number
  z: number
  /** Cylinder radius, or the box half-extent on its local X. */
  halfX: number
  /** Cylinder radius again, or the box half-extent on its local Z. */
  halfZ: number
  height: number
  /** Yaw of the box. Ignored for cylinders. */
  rotation: number
  shape: 'box' | 'cylinder'
  /**
   * False for low rubble: you can shoot over it but not walk through it. The
   * sim compares a bullet's height against `height` for these.
   */
  blocksSight: boolean
}

export type SupplyKind = 'health' | 'ammo'

/**
 * A supply lying where a body fell — a medkit or an ammo box.
 *
 * Deliberately not consumed when it would do nothing: a full-health player
 * walks over a medkit and leaves it lying, a full magazine leaves an ammo box
 * untouched, and a swung weapon never consumes one at all. So supplies can be
 * banked near the next wave's ground instead of wasted the moment they drop.
 *
 * The ammo box is a gift of TIME, not of damage: this game has no reserve
 * ammunition — magazines are infinite by design, and the balance contract
 * spends reload time as part of sustained damage — so what the box refunds is
 * the reload itself: the magazine refills on the spot, and an energy weapon
 * vents its heat. The tuned ladder survives untouched.
 */
export interface HealthPack {
  id: number
  kind: SupplyKind
  pos: Vec2
  /** Seconds since it landed, for the renderer's bob and spin. */
  age: number
}

/* ------------------------------------------------------------------ *
 *  Waves
 * ------------------------------------------------------------------ */

/** One group that walks in together. */
export interface WavePlan {
  /** Seconds after the previous wave dies before this one arrives. */
  delay: number
  members: { kind: EnemyKind; health: number; damage: number }[]
}

/* ------------------------------------------------------------------ *
 *  Events
 * ------------------------------------------------------------------ */

export type ArenaEventKind =
  /** One of the player's bullets found an enemy. */
  | 'hit'
  /** An enemy went down. */
  | 'kill'
  /** The player took damage. */
  | 'hurt'
  /** A shot left the player's gun. */
  | 'muzzle'
  /** A round hit the world rather than a body. */
  | 'impact'
  /** Splash went off. `amount` carries the radius. */
  | 'explosion'
  | 'reload'
  | 'dodge'
  /** The trigger was pulled on an empty magazine. */
  | 'empty'
  /** A medkit was collected. `amount` is the health actually restored. */
  | 'pickup'
  /** An ammo box was collected. `amount` is the rounds put back in the magazine. */
  | 'resupply'
  /** A fresh wave dropped in. `amount` carries the wave number, 1-based. */
  | 'wave'

/**
 * Something that happened this frame.
 *
 * The list is cleared at the top of every step, so a consumer that skips a
 * frame misses them. Both the renderer and the HUD drain it every frame; that
 * is deliberate, and it is why nothing here is a callback.
 */
export interface ArenaEvent {
  id: number
  kind: ArenaEventKind
  pos: Vec3
  /** Damage, or an explosion radius, or a wave number. */
  amount: number
  /** A headshot, a counter, or the shot that ended a wave. */
  critical: boolean
}

/* ------------------------------------------------------------------ *
 *  Result
 * ------------------------------------------------------------------ */

export interface ArenaResult {
  winner: Side
  /** 0..100, so the report screen reads it exactly as it read the duel's. */
  playerHealth: number
  /** 0..100. How much of the enemy force was still standing. */
  enemyForceLeft: number
  duration: number
  kills: number
  totalEnemies: number
  shotsFired: number
  shotsHit: number
  /** 0..1. */
  accuracy: number
  bestStreak: number
  /** True when the clock ran out rather than a side being wiped. */
  timedOut: boolean
  /**
   * True when no firefight happened at all.
   *
   * A 3D arena has no honest DOM fallback the way the old two-fighter duel
   * did, so a device that cannot give us a WebGL context settles the battle
   * with the campaign's original dice roll instead. The report has to be able
   * to say that plainly rather than describe a fight that never took place.
   */
  resolvedOnPaper: boolean
}

/* ------------------------------------------------------------------ *
 *  State and input
 * ------------------------------------------------------------------ */

export interface ArenaState {
  phase: ArenaPhase
  /** The multipliers this fight was started with. Frozen for its whole life. */
  difficulty: Difficulty
  elapsed: number
  /** Seconds the player has to clear the field. */
  timeLimit: number
  /** Seconds left of the drop-in before control is handed over. */
  briefingLeft: number

  player: ArenaPlayer
  gun: GunStats
  enemies: ArenaEnemy[]
  bullets: Bullet[]
  cover: Cover[]
  /** Packs currently lying on the field. */
  packs: HealthPack[]

  /**
   * The emoji every body in this battle wears, from the level's enemy.
   *
   * It lives on the state rather than being read off an existing enemy because
   * the first wave is spawned into an empty field — there is nobody to copy it
   * from at the moment it is first needed.
   */
  enemyEmoji: string

  waves: WavePlan[]
  /** Index of the wave currently on the field. */
  waveIndex: number
  /** Seconds until the next wave arrives. Above 0 means a lull. */
  waveDelay: number
  /** Enemies killed so far, across every wave. */
  killed: number
  /** How many will show up in total. */
  totalEnemies: number

  events: ArenaEvent[]
  /** 0..1, decaying. Renderers spend it on screen shake. */
  shake: number
  /** Seconds of hit-stop left. The world holds still while this is above zero. */
  hitStop: number
  /** Seconds of slow motion left, measured in real time, not arena time. */
  slowMotion: number
  /** Seconds left on the HUD hit marker. */
  hitMarker: number

  result: ArenaResult | null

  nextBulletId: number
  nextEventId: number
  nextEnemyId: number
  nextPackId: number
}

/**
 * What the player is asking for this frame.
 *
 * The input layer writes it; the simulation reads it and clears the two edges.
 * `moveX`/`moveZ` are camera-relative: +Z is the way the commander is facing,
 * +X is their right. That is what lets one field serve a thumb and WASD alike.
 */
export interface ArenaInput {
  /** -1..1. Strafe. */
  moveX: number
  /** -1..1. Forward is positive. */
  moveZ: number
  /** Yaw delta to apply this frame, in radians. Consumed and zeroed. */
  lookX: number
  /** Pitch delta to apply this frame, in radians. Consumed and zeroed. */
  lookY: number
  fire: boolean
  ads: boolean
  sprint: boolean
  /** Edge-triggered. The simulation clears it once it has acted. */
  reload: boolean
  /** Edge-triggered. The simulation clears it once it has acted. */
  dodge: boolean
  /**
   * True while the look deltas come from a stick — a thumb or a gamepad — and
   * aim assist should therefore apply. The input layer keys this off the last
   * device that actually moved the view, so a mouse is never assisted and a
   * phone always is.
   */
  assisted: boolean
}

export function createArenaInput(): ArenaInput {
  return {
    moveX: 0,
    moveZ: 0,
    lookX: 0,
    lookY: 0,
    fire: false,
    ads: false,
    sprint: false,
    reload: false,
    dodge: false,
    assisted: false,
  }
}
