/**
 * The numbers the arena itself is made of.
 *
 * Everything here is measured in world units and seconds. A world unit is
 * roughly a stride: the commander is about 1.8 tall, walks at 7, and the arena
 * is 52 across, which is a long sniper lane and a short sprint.
 *
 * These are shared by the simulation, the renderer and the input layer. Cover
 * layout, camera framing and enemy pathing all read the same bounds, so there
 * is exactly one place where the size of the world is decided.
 */

/**
 * Half-width of the arena on both X and Z. The playable square runs from
 * -ARENA_HALF to +ARENA_HALF on each axis.
 *
 * Chosen against the sniper rifle: its `falloffEnd` has to fit inside the
 * diagonal, or the longest weapon in the game would never get to be long.
 */
export const ARENA_HALF = 26

/** How far from the wall the player is stopped, so the camera never clips out. */
export const ARENA_MARGIN = 1.2

/** Standing height of a fighter. The camera and every hitbox read it. */
export const ACTOR_HEIGHT = 1.8

/** Radius of a fighter on the ground plane, for collision against cover. */
export const ACTOR_RADIUS = 0.45

/** Where a shot leaves the gun, and where the aim ray starts. */
export const MUZZLE_HEIGHT = 1.45

/* ------------------------------------------------------------------ *
 *  Footwork
 * ------------------------------------------------------------------ */

/** Units per second on the ground, before the weapon's weight speaks. */
export const WALK_SPEED = 7.2
export const SPRINT_MULTIPLIER = 1.5
/** Aiming down sights slows you to this fraction of a walk. */
export const ADS_MULTIPLIER = 0.45

/** How fast the commander reaches full speed, and how fast they stop. */
export const GROUND_ACCEL = 46
export const GROUND_FRICTION = 12

/** The dodge roll: how long it lasts, how fast it moves, how long it locks out. */
export const ROLL_TIME = 0.36
export const ROLL_SPEED = 17
export const ROLL_COOLDOWN = 0.9
/** Seconds of the roll that are actually invulnerable. Deliberately not all of it. */
export const ROLL_IFRAMES = 0.26

/** Radians per second the view eases toward the aim while sprinting. */
export const PITCH_LIMIT = 1.02

/* ------------------------------------------------------------------ *
 *  Camera
 * ------------------------------------------------------------------ */

/** Vertical field of view in degrees, hip-fired. */
export const CAMERA_FOV = 62

/** Where the camera sits relative to the commander, hip-fired. */
export const CAMERA_DISTANCE = 5.4
export const CAMERA_HEIGHT = 2.35
/** Positive pushes the camera over the right shoulder. */
export const CAMERA_SHOULDER = 0.95

/** The same three while aiming down sights. */
export const ADS_CAMERA_DISTANCE = 2.5
export const ADS_CAMERA_HEIGHT = 1.85
export const ADS_CAMERA_SHOULDER = 0.62

/** How quickly the camera catches up. Higher is stiffer. */
export const CAMERA_LERP = 13

export const CAMERA_NEAR = 0.1
export const CAMERA_FAR = 220

/* ------------------------------------------------------------------ *
 *  Look sensitivity
 * ------------------------------------------------------------------ */

/** Radians of yaw per unit of full right-stick deflection, per second. */
export const TOUCH_LOOK_SPEED = 2.6
/** Pitch is deliberately slower than yaw — it is the axis you overshoot. */
export const TOUCH_PITCH_SPEED = 1.7
/** Radians per CSS pixel of mouse movement. */
export const MOUSE_SENSITIVITY = 0.0027

/**
 * A gamepad turns faster than a thumb.
 *
 * A physical stick has a shorter throw than a thumb dragging across glass and
 * springs back to centre on its own, so a player expects more turn per unit of
 * deflection than the touch numbers give. Pitch stays proportionally slower
 * than yaw for the same reason it does on touch.
 */
export const PAD_LOOK_SPEED = 3.4
export const PAD_PITCH_SPEED = 2.2

/**
 * Radial dead zones for the two sticks.
 *
 * Radial, not per-axis: a per-axis dead zone leaves a cross-shaped hole where
 * a stick pushed diagonally reports movement on only one axis, which reads as
 * the commander refusing to walk diagonally. Aim gets the smaller zone because
 * a little drift while aiming is less objectionable than a stick that ignores
 * small, deliberate corrections.
 */
export const PAD_MOVE_DEAD_ZONE = 0.18
export const PAD_LOOK_DEAD_ZONE = 0.12

/**
 * Response curve on the aim stick. Above 1 means small pushes turn slowly.
 *
 * This is the single thing that decides whether a gamepad feels good to aim
 * with. A linear stick forces a choice between turning fast enough to spin
 * around and being precise enough to hit anything; an exponential one gives
 * fine control near centre and full speed at the edge, so it can do both.
 */
export const PAD_LOOK_CURVE = 2.2

/** How far an analog trigger must be pulled before it counts as pressed. */
export const PAD_TRIGGER_THRESHOLD = 0.4

/* ------------------------------------------------------------------ *
 *  Fight shape
 * ------------------------------------------------------------------ */

/** Seconds of drop-in before the player takes control. */
export const BRIEFING_SECONDS = 1.6

/**
 * Seconds to clear the field.
 *
 * Far longer than the duel's 30 because there is ground to cross now, and
 * because a clear time measured on paper always undercounts an arena — the
 * player spends real seconds walking, breaking line of sight and reloading
 * that no damage-per-second figure predicts. It is still tight enough that
 * hiding behind one rock forever is a losing plan.
 */
export const ARENA_TIMEOUT = 120

/** How close a wave spawns to the arena edge. */
export const SPAWN_INSET = 3.5

/** Enemies never spawn closer to the player than this. */
export const SPAWN_MIN_DISTANCE = 14

/* ------------------------------------------------------------------ *
 *  Feel
 * ------------------------------------------------------------------ */

/** Hit-stop per point of damage, and its ceiling. Same shape as the duel had. */
export const HIT_STOP_PER_DAMAGE = 0.0022
export const MAX_HIT_STOP = 0.055

/** The killing blow on the last enemy gets its own, longer hold. */
export const FINISHER_HIT_STOP = 0.16
export const FINISHER_SLOW_MOTION = 0.85
export const SLOW_MOTION_SCALE = 0.35

export const HURT_TIME = 0.3

/** Seconds a kill keeps the streak alive. */
export const STREAK_WINDOW = 4

/** Seconds the HUD holds a hit marker. */
export const HIT_MARKER_TIME = 0.14

/** Longest step the arena will take at once, so a stalled tab cannot tunnel. */
export const MAX_STEP = 1 / 30
