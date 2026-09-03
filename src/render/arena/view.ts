/**
 * What the 3D renderer needs to know about a fight.
 *
 * Declared here rather than imported from `src/game/arena` on purpose, exactly
 * as `src/render/view.ts` was: TypeScript is structural, so the real
 * `ArenaState` satisfies these shapes without `src/render/**` ever depending on
 * the rules, and without copying the state into a new object sixty times a
 * second.
 *
 * The renderer may read anything here. It may write nothing, anywhere.
 */

export type ArenaViewSide = 'player' | 'enemy'

export type ArenaViewEnemyKind = 'rusher' | 'gunner' | 'heavy' | 'boss'

export interface Vec2View {
  readonly x: number
  readonly z: number
}

export interface Vec3View {
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface PlayerView {
  readonly pos: Vec2View
  readonly vel: Vec2View
  readonly yaw: number
  readonly pitch: number
  readonly health: number
  readonly maxHealth: number
  /** Seconds left of the roll. Above 0 means the commander is on the ground. */
  readonly rollLeft: number
  readonly rollDir: Vec2View
  readonly invulnerable: number
  readonly sprinting: boolean
  /** 0..1, eased. Drives the camera pull-in and the FOV. */
  readonly ads: number
  readonly hurt: number
  readonly recoilKick: number
  readonly alive: boolean
  readonly reloadLeft: number
}

export interface EnemyView {
  readonly id: number
  readonly kind: ArenaViewEnemyKind
  readonly emoji: string
  readonly pos: Vec2View
  readonly yaw: number
  readonly health: number
  readonly maxHealth: number
  /** The wind-up tell. The single most important thing on screen. */
  readonly windUp: number
  readonly hurt: number
  readonly stagger: number
  readonly alive: boolean
  readonly age: number
}

export interface BulletView {
  readonly id: number
  readonly owner: ArenaViewSide
  readonly pos: Vec3View
  readonly vel: Vec3View
  readonly origin: Vec3View
  readonly splash: number
}

export interface CoverView {
  readonly id: number
  readonly x: number
  readonly z: number
  readonly halfX: number
  readonly halfZ: number
  readonly height: number
  readonly rotation: number
  readonly shape: 'box' | 'cylinder'
  readonly blocksSight: boolean
}

export interface ArenaEventView {
  readonly id: number
  readonly kind:
    | 'hit'
    | 'kill'
    | 'hurt'
    | 'muzzle'
    | 'impact'
    | 'explosion'
    | 'reload'
    | 'dodge'
    | 'empty'
    | 'wave'
  readonly pos: Vec3View
  readonly amount: number
  readonly critical: boolean
}

export interface ArenaView {
  readonly phase: 'briefing' | 'fighting' | 'over'
  readonly elapsed: number
  readonly briefingLeft: number
  readonly player: PlayerView
  /**
   * Enough of the gun to draw it. The renderer never reads damage or reach —
   * it classifies a silhouette from how the weapon mechanically behaves, so a
   * new weapon in `src/data` gets a sensible model without anyone drawing one.
   */
  readonly gun: {
    readonly adsZoom: number
    readonly emoji: string
    readonly melee: boolean
    readonly automatic: boolean
    readonly pellets: number
    readonly splash: number
    readonly gravity: number
    readonly overheat: boolean
    readonly muzzleSpeed: number
  }
  readonly enemies: readonly EnemyView[]
  readonly bullets: readonly BulletView[]
  readonly cover: readonly CoverView[]
  readonly events: readonly ArenaEventView[]
  /** 0..1. Spent on camera shake. */
  readonly shake: number
  readonly slowMotion: number
  readonly result: { readonly winner: ArenaViewSide } | null
}
