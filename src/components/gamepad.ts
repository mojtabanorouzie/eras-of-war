import {
  PAD_LOOK_CURVE,
  PAD_LOOK_DEAD_ZONE,
  PAD_LOOK_SPEED,
  PAD_MOVE_DEAD_ZONE,
  PAD_PITCH_SPEED,
  PAD_TRIGGER_THRESHOLD,
} from '../game/arena/world'

/**
 * Reading a gamepad.
 *
 * The Gamepad API has no events for sticks or triggers — the browser only tells
 * you a pad connected, never that it moved — so the only way to read one is to
 * poll it every frame. That suits this game exactly: the arena already runs one
 * loop that everything subscribes to, so the pad is read in the same place the
 * thumb sticks and the keyboard are, and all three fold into one `ArenaInput`.
 *
 * Kept free of React and of the DOM beyond `navigator.getGamepads` so the
 * mapping, the dead zones and the response curve can be tested against
 * synthetic pads without a physical controller plugged in.
 *
 * BUTTON LAYOUT — the W3C "standard" mapping, which is what Xbox, PlayStation
 * and most third-party pads report on every current browser. The bindings are
 * the console-shooter convention rather than anything invented here, because a
 * player who has held a controller before already knows them: left trigger
 * aims, right trigger fires, the bottom face button dodges, the left face
 * button reloads, and clicking the left stick sprints.
 */

/** Indices into `Gamepad.buttons` under the standard mapping. */
const BUTTON = {
  /** A on Xbox, Cross on PlayStation. */
  dodge: 0,
  /** X on Xbox, Square on PlayStation. */
  reload: 2,
  /** Left bumper — an alternate for aiming, for pads with stiff triggers. */
  adsBumper: 4,
  /** Right bumper — an alternate for firing. */
  fireBumper: 5,
  /** Left trigger. Analog. */
  ads: 6,
  /** Right trigger. Analog. */
  fire: 7,
  /** Left stick click. */
  sprint: 10,
  /** Start / Options / Menu — the one button every pad reserves for pausing. */
  pause: 9,
} as const

/** Axis indices under the standard mapping. */
const AXIS = { moveX: 0, moveY: 1, lookX: 2, lookY: 3 } as const

export interface PadReading {
  /** True when a pad is connected and reporting. */
  connected: boolean
  /** -1..1, right positive. */
  moveX: number
  /** -1..1, forward positive. */
  moveZ: number
  /** Yaw delta for this frame, in radians, already scaled by dt. */
  lookX: number
  /** Pitch delta for this frame, in radians, already scaled by dt. */
  lookY: number
  fire: boolean
  ads: boolean
  sprint: boolean
  /** True only on the frame the button went down. */
  reload: boolean
  /** True only on the frame the button went down. */
  dodge: boolean
  /** True only on the frame Start went down. */
  pause: boolean
  /** How far from centre the movement stick is, 0..1. Drives the sprint gate. */
  movePush: number
}

function emptyReading(): PadReading {
  return {
    connected: false,
    moveX: 0,
    moveZ: 0,
    lookX: 0,
    lookY: 0,
    fire: false,
    ads: false,
    sprint: false,
    reload: false,
    dodge: false,
    pause: false,
    movePush: 0,
  }
}

/**
 * Applies a radial dead zone and rescales what is left back to a full 0..1.
 *
 * The rescale is the part that matters. Without it a stick leaving the dead
 * zone jumps straight from nothing to the dead zone's own width, so the
 * commander lurches into a walk instead of easing into one, and the slowest
 * speed available is whatever the dead zone happens to be.
 *
 * @param curve exponent on the magnitude. 1 is linear.
 */
function stick(
  x: number,
  y: number,
  dead: number,
  curve: number,
): { x: number; y: number; push: number } {
  const length = Math.hypot(x, y)
  if (!Number.isFinite(length) || length <= dead) return { x: 0, y: 0, push: 0 }

  const rescaled = Math.min(1, (length - dead) / (1 - dead))
  const shaped = curve === 1 ? rescaled : rescaled ** curve
  return { x: (x / length) * shaped, y: (y / length) * shaped, push: rescaled }
}

/** Reads one button, tolerating pads that report fewer than the standard set. */
function pressed(pad: Gamepad, index: number): boolean {
  const button = pad.buttons[index]
  if (!button) return false
  // Analog triggers report a value; everything else is a clean boolean. Reading
  // both means a trigger that never quite reaches `pressed` still fires.
  return button.pressed || button.value >= PAD_TRIGGER_THRESHOLD
}

function axis(pad: Gamepad, index: number): number {
  const value = pad.axes[index]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** The first connected pad, or null. */
function activePad(): Gamepad | null {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null
  for (const pad of navigator.getGamepads()) {
    if (pad && pad.connected) return pad
  }
  return null
}

export interface PadReader {
  /** @param dt seconds since the previous frame. */
  read(dt: number): PadReading
  /**
   * Fires the pad's haptics, if it has any.
   *
   * @param strength 0..1
   * @param ms       how long to buzz for
   */
  rumble(strength: number, ms: number): void
}

/**
 * Builds a reader that remembers which buttons were already down.
 *
 * The state is why this is a factory rather than a plain function: `reload` and
 * `dodge` are edge-triggered, and an edge cannot be derived from a single
 * frame's snapshot. The simulation clears those two flags once it has acted on
 * them, so holding the button down must not keep re-arming them.
 */
export function createPadReader(): PadReader {
  const wasDown = new Map<number, boolean>()

  const edge = (pad: Gamepad, index: number): boolean => {
    const now = pressed(pad, index)
    const before = wasDown.get(index) ?? false
    wasDown.set(index, now)
    return now && !before
  }

  return {
    read(dt) {
      const pad = activePad()
      if (!pad) {
        wasDown.clear()
        return emptyReading()
      }

      // Movement is linear: walking speed should track the stick exactly, and
      // a curve here would make the commander feel sluggish to start.
      const move = stick(
        axis(pad, AXIS.moveX),
        axis(pad, AXIS.moveY),
        PAD_MOVE_DEAD_ZONE,
        1,
      )
      const look = stick(
        axis(pad, AXIS.lookX),
        axis(pad, AXIS.lookY),
        PAD_LOOK_DEAD_ZONE,
        PAD_LOOK_CURVE,
      )

      return {
        connected: true,
        moveX: move.x,
        // The pad reports up as negative on both sticks; forward is positive here.
        moveZ: -move.y,
        // A rate, not a position: holding the stick over keeps turning, and
        // scaling by this frame's own dt keeps the turn identical at 60Hz and
        // at 120Hz. Pitch passes the raw sign through, so pushing the stick up
        // looks up.
        lookX: look.x * PAD_LOOK_SPEED * dt,
        lookY: look.y * PAD_PITCH_SPEED * dt,
        fire: pressed(pad, BUTTON.fire) || pressed(pad, BUTTON.fireBumper),
        ads: pressed(pad, BUTTON.ads) || pressed(pad, BUTTON.adsBumper),
        sprint: pressed(pad, BUTTON.sprint),
        reload: edge(pad, BUTTON.reload),
        dodge: edge(pad, BUTTON.dodge),
        pause: edge(pad, BUTTON.pause),
        movePush: move.push,
      }
    },

    rumble(strength, ms) {
      const pad = activePad()
      // Not every pad or browser has haptics, and the shapes differ. This is
      // pure garnish, so anything unexpected is swallowed rather than allowed
      // to interrupt a fight.
      const actuator = pad?.vibrationActuator
      if (!actuator || typeof actuator.playEffect !== 'function') return
      try {
        void actuator
          .playEffect('dual-rumble', {
            duration: ms,
            strongMagnitude: strength,
            weakMagnitude: strength * 0.6,
          })
          ?.catch(() => undefined)
      } catch {
        // A pad that refuses the effect simply does not buzz.
      }
    },
  }
}
