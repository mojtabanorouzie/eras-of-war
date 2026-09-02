/**
 * The shared coordinate system every layer of the battle scene agrees on.
 *
 * The world is measured in units, not pixels. The camera always frames at least
 * WORLD_MIN_WIDTH across and WORLD_MIN_HEIGHT down, overshooting on whichever
 * axis the viewport has to spare — so the whole fighting ground is guaranteed
 * visible on a 360px phone and a 1440px desktop alike. Fixing only the height
 * would let a tall field squeeze the arena off the sides.
 *
 * ORIENTATION — the document is `dir="rtl"`. The player's army stands on the
 * RIGHT (+X) and fires leftward; the enemy stands on the LEFT (-X). That is not
 * a stylistic choice, it is what a Persian reader expects, and the existing CSS
 * already does it. Anything placed in this world honours the same signs.
 */

/**
 * Must stay wider than twice `ARENA_HALF` in `src/game/combat.ts`, or an army
 * could stand outside the frame. The margin is deliberate breathing room.
 */
export const WORLD_MIN_WIDTH = 22
export const WORLD_MIN_HEIGHT = 12

/** The line both armies stand on. */
export const GROUND_Y = -3.4

/** Depth of each parallax layer. Nearer the camera means larger z. */
export const LAYER_Z = {
  backdrop: -10,
  far: -6,
  mid: -3,
  ground: -1,
  actors: 0,
} as const

/**
 * Painter's order for the whole scene.
 *
 * Everything is a flat quad, so depth testing is off and this is the only thing
 * deciding what covers what. Keeping it in one list is the only way to see the
 * stack at a glance.
 */
export const RENDER_ORDER = {
  backdrop: -1,
  far: 10,
  mid: 20,
  ground: 30,
  shadows: 35,
  enemy: 40,
  player: 44,
  projectiles: 48,
  impact: 50,
} as const

/** The camera sits in front of every layer, looking down -Z. */
export const CAMERA_Z = 10

export interface Frustum {
  width: number
  height: number
}

/** @param aspect the canvas's CSS width divided by its CSS height. */
export function frustumFor(aspect: number): Frustum {
  if (aspect >= WORLD_MIN_WIDTH / WORLD_MIN_HEIGHT) {
    // Wide enough already: fix the height and let the width run.
    return { width: WORLD_MIN_HEIGHT * aspect, height: WORLD_MIN_HEIGHT }
  }
  return { width: WORLD_MIN_WIDTH, height: WORLD_MIN_WIDTH / aspect }
}
