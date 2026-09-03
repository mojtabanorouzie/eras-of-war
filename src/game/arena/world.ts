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

/**
 * How fast the commander reaches full speed, and how fast they stop.
 *
 * Both are exponential rate constants, in reciprocal seconds, applied as
 * `1 - exp(-rate * dt)`. That form is what makes them frame-rate independent:
 * the earlier linear version accelerated measurably differently on a 60Hz
 * phone and a 120Hz one, and was slow enough besides that the commander took
 * most of a second to reach a walk and felt like they were wading.
 *
 * At this rate a standing start is at full speed in about a fifth of a second,
 * which is the difference between a shooter that answers the stick and one
 * that argues with it.
 */
export const GROUND_ACCEL = 16
export const GROUND_FRICTION = 14

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

/**
 * Radians of yaw per unit of full right-stick deflection, per second.
 *
 * Raised from 2.6 after playtesters reported the game unplayable on phones: at
 * 2.6 a full about-turn took 1.2 seconds, which against a flanking rusher is a
 * death sentence. The response curve below is what makes the higher ceiling
 * safe — small deflections still aim finely.
 */
export const TOUCH_LOOK_SPEED = 3.6
/** Pitch is deliberately slower than yaw — it is the axis you overshoot. */
export const TOUCH_PITCH_SPEED = 2.3

/**
 * Response curve on the touch aim stick. Above 1 means small pushes turn
 * slowly. Same reasoning as PAD_LOOK_CURVE: a linear stick forces a choice
 * between turning fast and aiming precisely, and a curve grants both. Gentler
 * than the pad's, because glass gives a thumb a longer, finer throw than a
 * physical stick's spring allows.
 */
export const TOUCH_LOOK_CURVE = 1.8

/** Radians per CSS pixel of mouse movement. */
export const MOUSE_SENSITIVITY = 0.0027

/* ------------------------------------------------------------------ *
 *  Aim assist
 * ------------------------------------------------------------------ */

/**
 * Assist exists because a thumb is not a mouse. Every serious mobile shooter
 * ships it, and the two playtesters who called this game unplayable on a phone
 * were reporting its absence. It has two parts, both applied in the simulation
 * so a replayed fight replays identically:
 *
 *   FRICTION — while the aim ray is angularly close to an enemy, incoming look
 *   deltas are scaled down, so the crosshair "sticks" as it crosses a target
 *   instead of skating past it. This is the part that makes tracking possible.
 *
 *   MAGNETISM — while the trigger is held, the view is eased a little toward
 *   the nearest target inside a tight cone, correcting the last few degrees a
 *   thumb cannot. It never acquires targets on its own: outside the cone it
 *   does nothing, so it aids a shot the player already lined up.
 *
 * Neither applies to a mouse (`ArenaInput.assisted` is set by the input layer
 * per look source): a mouse can already do both, and assisted mouse aim reads
 * as the game wrestling the cursor.
 */

/** Targets further than this get no assist — the player is not "on" them. */
export const ASSIST_RANGE = 34

/** Half-angle inside which friction engages. Wide enough to catch a pass-over. */
export const ASSIST_FRICTION_CONE = 0.12

/** What friction multiplies look deltas by. Lower is stickier. */
export const ASSIST_FRICTION = 0.45

/** Half-angle inside which magnetism pulls. Deliberately tighter than friction. */
export const ASSIST_PULL_CONE = 0.085

/**
 * Exponential approach rate toward the target while firing, per second.
 * At 4.5 the view closes about a third of the remaining error each tenth of a
 * second — enough to finish a lined-up shot, never enough to feel steered.
 */
export const ASSIST_PULL_RATE = 4.5

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
