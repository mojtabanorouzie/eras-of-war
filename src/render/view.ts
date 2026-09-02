/**
 * What the renderer needs to know about a fight.
 *
 * Declared here rather than imported from `src/game/duel` on purpose: TypeScript
 * is structural, so the real `DuelState` satisfies these shapes without
 * `src/render/**` ever depending on the rules, and without copying the state
 * into a new object sixty times a second.
 */

export type ViewSide = 'player' | 'enemy'

export interface FighterView {
  x: number
  health: number
  /** Seconds of commitment left before this side's blow lands. */
  windUp: number
  /** Seconds of dodge invulnerability left. */
  invulnerable: number
  /** Seconds left on the flinch. */
  hurt: number
  /** Seconds left on the follow-through. */
  recover: number
  /** True while the current wind-up is the fast one. */
  quickSwing: boolean
}

export interface ProjectileView {
  id: number
  x: number
  /** World units above the shooter's shoulder. */
  height: number
  owner: ViewSide
  /** Above zero for lobbed shots. */
  arc: number
}

export interface DuelView {
  phase: 'intro' | 'fighting' | 'over'
  player: FighterView
  enemy: FighterView
  projectiles: readonly ProjectileView[]
  /** 0..1. Spent on screen shake. */
  shake: number
  result: { winner: ViewSide } | null
}
