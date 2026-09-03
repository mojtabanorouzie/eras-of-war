import { useEffect, useRef, useState } from 'react'
import type { ArenaInput } from '../game/arena/types'
import { MOUSE_SENSITIVITY, TOUCH_LOOK_SPEED, TOUCH_PITCH_SPEED } from '../game/arena/world'
import { createPadReader } from './gamepad'
import { useReducedMotion } from './useReducedMotion'
import type { ArenaDraw } from './useArena'

/**
 * Every way a player can drive the commander.
 *
 * Touch is the first-class path here, not a compromise bolted onto a desktop
 * game — this is a phone game that happens to run on a laptop. The keyboard
 * and mouse path exists and works, but the layout, the sizes and the tuning
 * are all decided by what a thumb can reach.
 *
 * MULTI-TOUCH IS THE WHOLE PROBLEM. Two thumbs are on the glass at once and
 * they must never interfere: the finger steering must not be stolen by the
 * finger aiming, lifting one must not cancel the other, and a thumb that
 * slides off its half of the screen must keep its stick. Every one of those is
 * a bug that only appears with two fingers down, which is exactly the case a
 * desktop browser never reproduces. The defence is uniform and deliberate:
 *
 *   - Every gesture is keyed by `pointerId` and looked up by it, never by
 *     "the current touch". A `pointermove` that does not match a live gesture
 *     is dropped rather than applied to whichever stick happens to be active.
 *   - A stick is claimed on `pointerdown` and released only by its own
 *     `pointerup`/`pointercancel`. Nothing else can take it.
 *   - `pointermove`/`pointerup` are bound to the window rather than to the
 *     stick's element, so dragging beyond the element — or off the screen
 *     entirely — still tracks and still releases cleanly.
 *
 * The sticks are floating: they appear wherever the thumb lands rather than
 * sitting at a fixed spot. On a phone held one-handed there is no reliable
 * place to put a fixed stick, and a thumb that misses one is a death.
 */

/** How far, in CSS pixels, a thumb has to travel for full deflection. */
const STICK_RADIUS = 54

/** Below this the stick reads as noise. Movement wants more than aim does. */
const MOVE_DEAD_ZONE = 0.14
const LOOK_DEAD_ZONE = 0.06

/** Past this deflection the commander breaks into a run. */
const SPRINT_THRESHOLD = 0.85

/**
 * A press inside the look area that never really moved, and did not linger, is
 * a shot rather than an aim.
 *
 * This is what makes the game playable with one thumb: drag to aim, tap to
 * fire. Without it the right thumb would have to leave the aim stick to reach
 * the trigger, and the player would lose their aim every time they shot. The
 * slop is generous because a thumb is not a mouse.
 */
const TAP_SLOP = 16
const TAP_TIME = 280

/**
 * Where the movement stick rests before a thumb has claimed it, measured from
 * the left edge and up from the bottom.
 *
 * The sticks float, which is right for aiming — the whole right side is the
 * aim surface and there is nothing to miss. It is wrong for movement: a player
 * opening the arena for the first time saw no controls at all and had to guess
 * that the left half was a stick. Drawing the movement stick faintly at its
 * home fixes that without giving up floating, because the moment a thumb lands
 * anywhere on the left the stick still moves to meet it.
 */
const MOVE_STICK_HOME = { x: 96, up: 132 }
/** How long a tap holds the trigger down, so an automatic gets exactly one shot. */
const TAP_FIRE_MS = 90

interface Gesture {
  pointerId: number
  originX: number
  originY: number
  /** -1..1, right positive. */
  x: number
  /** -1..1, up positive. */
  y: number
  startedAt: number
  /** The furthest this thumb ever got from where it landed, in pixels. */
  drift: number
}

interface ArenaControlsProps {
  input: React.RefObject<ArenaInput>
  /** Registers a per-frame callback with the running fight. */
  subscribe: (draw: ArenaDraw) => () => void
  /** False during the drop-in and after the fight, so stray taps do nothing. */
  active: boolean
  /** A swung weapon has no sights, so the aim button is not offered. */
  melee: boolean
}

export function ArenaControls({ input, subscribe, active, melee }: ArenaControlsProps) {
  const layerRef = useRef<HTMLDivElement>(null)
  const moveBaseRef = useRef<HTMLDivElement>(null)
  const moveKnobRef = useRef<HTMLDivElement>(null)
  const lookBaseRef = useRef<HTMLDivElement>(null)
  const lookKnobRef = useRef<HTMLDivElement>(null)

  const move = useRef<Gesture | null>(null)
  const look = useRef<Gesture | null>(null)

  // Held state that the per-frame writer folds into the input. Kept in refs
  // rather than React state because these change on every touch and no pixel
  // of the React tree depends on them.
  const held = useRef({ fire: false, ads: false, tapFireUntil: 0 })
  const keys = useRef({ forward: 0, back: 0, left: 0, right: 0, sprint: false, fire: false, ads: false })

  const [touch, setTouch] = useState(false)
  const [aiming, setAiming] = useState(false)
  const [pad, setPad] = useState(false)

  // Polled every frame rather than listened to: the Gamepad API reports that a
  // pad connected but never that a stick moved, so there is nothing to listen
  // for. The reader is built once because it remembers which buttons were down.
  const padReader = useRef(createPadReader())
  const reducedMotion = useReducedMotion()
  const haptics = useRef(!reducedMotion)
  useEffect(() => {
    // Rumble is a sensory effect like screen shake, so the same preference
    // silences it. There is no separate media query for haptics.
    haptics.current = !reducedMotion
  }, [reducedMotion])

  // Only used to decide whether the on-screen buttons are worth showing. The
  // actual reading does not depend on these events firing.
  useEffect(() => {
    const update = () => {
      const pads =
        typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : []
      setPad(Array.from(pads).some((entry) => entry?.connected))
    }
    update()
    window.addEventListener('gamepadconnected', update)
    window.addEventListener('gamepaddisconnected', update)
    return () => {
      window.removeEventListener('gamepadconnected', update)
      window.removeEventListener('gamepaddisconnected', update)
    }
  }, [])

  // Coarse pointers get the sticks; fine pointers get the mouse. Checked
  // rather than assumed, because a laptop with a touchscreen is both.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(pointer: coarse)')
    const apply = () => setTouch(query.matches)
    apply()
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [])

  /* ----------------------------------------------------------------- *
   *  Touch
   * ----------------------------------------------------------------- */

  useEffect(() => {
    const layer = layerRef.current
    if (!layer || !active) return

    /**
     * @param home where to park the stick when no thumb is on it. Omitted for
     *             the aim stick, which vanishes instead — drawing a resting
     *             stick on the right would suggest the aim surface is only
     *             that circle, when in fact it is the whole half of the screen.
     */
    const paint = (
      base: HTMLDivElement | null,
      knob: HTMLDivElement | null,
      gesture: Gesture | null,
      home?: { x: number; up: number },
    ) => {
      if (!base || !knob) return
      if (!gesture) {
        if (!home) {
          base.style.opacity = '0'
          return
        }
        const rect = layer.getBoundingClientRect()
        base.style.opacity = '0.34'
        base.style.transform = `translate(${home.x}px, ${rect.height - home.up}px) translate(-50%, -50%)`
        knob.style.transform = 'translate(0px, 0px) translate(-50%, -50%)'
        return
      }
      base.style.opacity = '1'
      base.style.transform = `translate(${gesture.originX}px, ${gesture.originY}px) translate(-50%, -50%)`
      knob.style.transform = `translate(${gesture.x * STICK_RADIUS}px, ${-gesture.y * STICK_RADIUS}px) translate(-50%, -50%)`
    }

    paint(moveBaseRef.current, moveKnobRef.current, null, MOVE_STICK_HOME)
    paint(lookBaseRef.current, lookKnobRef.current, null)

    const down = (event: PointerEvent) => {
      // Buttons are children of this layer and mark themselves, so a thumb
      // that lands on the trigger never also starts a stick underneath it.
      if ((event.target as HTMLElement | null)?.closest('[data-arena-button]')) return

      const rect = layer.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      const leftHalf = x < rect.width / 2

      const gesture: Gesture = {
        pointerId: event.pointerId,
        originX: x,
        originY: y,
        x: 0,
        y: 0,
        startedAt: event.timeStamp,
        drift: 0,
      }

      // One stick per side, and a side that is already claimed stays claimed.
      // A second finger landing on the same half is simply ignored, which is
      // far better than having it yank the stick out from under the first.
      if (leftHalf) {
        if (move.current) return
        move.current = gesture
        paint(moveBaseRef.current, moveKnobRef.current, gesture, MOVE_STICK_HOME)
      } else {
        if (look.current) return
        look.current = gesture
        paint(lookBaseRef.current, lookKnobRef.current, gesture)
      }
    }

    const update = (gesture: Gesture, event: PointerEvent, rect: DOMRect, dead: number) => {
      const dx = event.clientX - rect.left - gesture.originX
      const dy = event.clientY - rect.top - gesture.originY
      gesture.drift = Math.max(gesture.drift, Math.hypot(dx, dy))

      let nx = dx / STICK_RADIUS
      // Screen Y grows downward; the stick's Y grows upward.
      let ny = -dy / STICK_RADIUS
      const length = Math.hypot(nx, ny)
      if (length > 1) {
        nx /= length
        ny /= length
      }
      if (Math.hypot(nx, ny) < dead) {
        nx = 0
        ny = 0
      }
      gesture.x = nx
      gesture.y = ny
    }

    const moved = (event: PointerEvent) => {
      const rect = layer.getBoundingClientRect()
      // Matched by id, never by "whichever stick is active". This single line
      // is what keeps two thumbs from trading places.
      if (move.current?.pointerId === event.pointerId) {
        update(move.current, event, rect, MOVE_DEAD_ZONE)
        paint(moveBaseRef.current, moveKnobRef.current, move.current, MOVE_STICK_HOME)
      } else if (look.current?.pointerId === event.pointerId) {
        update(look.current, event, rect, LOOK_DEAD_ZONE)
        paint(lookBaseRef.current, lookKnobRef.current, look.current)
      }
    }

    const up = (event: PointerEvent) => {
      if (move.current?.pointerId === event.pointerId) {
        move.current = null
        paint(moveBaseRef.current, moveKnobRef.current, null, MOVE_STICK_HOME)
        return
      }
      if (look.current?.pointerId !== event.pointerId) return

      const gesture = look.current
      look.current = null
      paint(lookBaseRef.current, lookKnobRef.current, null)

      // A thumb that pressed and lifted without really going anywhere meant to
      // shoot, not to aim.
      if (gesture.drift < TAP_SLOP && event.timeStamp - gesture.startedAt < TAP_TIME) {
        held.current.tapFireUntil = event.timeStamp + TAP_FIRE_MS
      }
    }

    layer.addEventListener('pointerdown', down)
    // On the window, so a thumb dragged off the arena keeps its stick and
    // still releases it. Bound to the element these would silently strand a
    // gesture whenever a finger left the box.
    window.addEventListener('pointermove', moved)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)

    return () => {
      layer.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', moved)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      move.current = null
      look.current = null
    }
  }, [active])

  /* ----------------------------------------------------------------- *
   *  Keyboard and mouse
   * ----------------------------------------------------------------- */

  useEffect(() => {
    if (!active) return

    const set = (key: string, value: boolean): boolean => {
      const k = keys.current
      switch (key.toLowerCase()) {
        case 'w':
        case 'arrowup':
          k.forward = value ? 1 : 0
          return true
        case 's':
        case 'arrowdown':
          k.back = value ? 1 : 0
          return true
        case 'a':
        case 'arrowleft':
          k.left = value ? 1 : 0
          return true
        case 'd':
        case 'arrowright':
          k.right = value ? 1 : 0
          return true
        case 'shift':
          k.sprint = value
          return true
        default:
          return false
      }
    }

    const down = (event: KeyboardEvent) => {
      if (event.repeat) return
      if (set(event.key, true)) {
        event.preventDefault()
        return
      }
      if (event.key === ' ') {
        event.preventDefault()
        input.current.dodge = true
      } else if (event.key.toLowerCase() === 'r') {
        input.current.reload = true
      }
    }
    const up = (event: KeyboardEvent) => {
      if (set(event.key, false)) event.preventDefault()
    }

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      keys.current = { forward: 0, back: 0, left: 0, right: 0, sprint: false, fire: false, ads: false }
    }
  }, [active, input])

  useEffect(() => {
    // Bound to the control layer, NOT to the canvas underneath it.
    //
    // This layer is a full-bleed sibling painted over the arena, so it is what
    // every click actually lands on. Asking the canvas for pointer lock meant
    // asking an element that could never receive the click, so lock was never
    // granted and the mouse never turned the commander — leaving a player who
    // could walk with WASD but only ever in the direction they spawned facing,
    // because movement is relative to a camera they had no way to turn.
    const element = layerRef.current
    if (!element || touch || !active) return

    const locked = () => document.pointerLockElement === element

    // Pointer lock has to be asked for by a gesture, so the first click into
    // the arena is what buys mouse-look rather than firing a shot.
    const click = () => {
      if (!locked()) void element.requestPointerLock?.()
    }

    const moved = (event: MouseEvent) => {
      if (!locked()) return
      input.current.lookX += event.movementX * MOUSE_SENSITIVITY
      input.current.lookY += event.movementY * MOUSE_SENSITIVITY
    }

    const down = (event: MouseEvent) => {
      if (!locked()) return
      if (event.button === 0) keys.current.fire = true
      if (event.button === 2) keys.current.ads = true
    }
    const up = (event: MouseEvent) => {
      if (event.button === 0) keys.current.fire = false
      if (event.button === 2) keys.current.ads = false
    }
    const menu = (event: Event) => event.preventDefault()

    element.addEventListener('click', click)
    window.addEventListener('mousemove', moved)
    window.addEventListener('mousedown', down)
    window.addEventListener('mouseup', up)
    element.addEventListener('contextmenu', menu)

    return () => {
      element.removeEventListener('click', click)
      window.removeEventListener('mousemove', moved)
      window.removeEventListener('mousedown', down)
      window.removeEventListener('mouseup', up)
      element.removeEventListener('contextmenu', menu)
      if (document.pointerLockElement === element) document.exitPointerLock()
    }
  }, [touch, active, input])

  /* ----------------------------------------------------------------- *
   *  Folding it all into one input, once a frame
   * ----------------------------------------------------------------- */

  useEffect(() => {
    let previous = 0

    return subscribe((state, now) => {
      const dt = previous === 0 ? 0 : Math.min(0.1, (now - previous) / 1000)
      previous = now

      // Read the pad even while inactive, so its edge-detector keeps up with
      // buttons pressed during the drop-in and does not fire them all at once
      // the moment control is handed over.
      const gamepad = padReader.current.read(dt)

      const command = input.current
      if (!active) {
        command.moveX = 0
        command.moveZ = 0
        command.fire = false
        command.sprint = false
        return
      }

      const k = keys.current
      const keyX = k.right - k.left
      const keyZ = k.forward - k.back
      const stick = move.current

      // Whichever surface is being pushed hardest wins, so a machine with a
      // touchscreen, a keyboard and a pad all attached can switch between them
      // mid-fight without any of the three fighting the other two. Comparing
      // magnitudes rather than tracking a "current input device" means the
      // handover needs no state and can never get stuck on the wrong one.
      const surfaces = [
        {
          x: stick ? stick.x : 0,
          z: stick ? stick.y : 0,
          push: stick ? Math.hypot(stick.x, stick.y) : 0,
          sprint: stick ? Math.hypot(stick.x, stick.y) > SPRINT_THRESHOLD : false,
        },
        { x: keyX, z: keyZ, push: Math.hypot(keyX, keyZ), sprint: k.sprint },
        {
          x: gamepad.moveX,
          z: gamepad.moveZ,
          push: gamepad.movePush,
          // Either click the stick or simply run it to the edge.
          sprint: gamepad.sprint || gamepad.movePush > SPRINT_THRESHOLD,
        },
      ]
      const driving = surfaces.reduce((best, next) => (next.push > best.push ? next : best))

      command.moveX = driving.x
      command.moveZ = driving.z
      command.sprint = driving.sprint

      // Both look sticks are rates, not positions: held over, they keep
      // turning. Scaling by this frame's own dt is what keeps the turn speed
      // identical on a 60Hz phone and a 120Hz one.
      //
      // The sign is subtracted because a stick pushed up reports positive here
      // and the simulation subtracts `lookY` from pitch — so adding it would
      // make pushing up look *down*, inverted against both the mouse and every
      // other stick in the game.
      const aim = look.current
      if (aim) {
        command.lookX += aim.x * TOUCH_LOOK_SPEED * dt
        command.lookY -= aim.y * TOUCH_PITCH_SPEED * dt
      }
      // Already scaled and signed by the reader.
      command.lookX += gamepad.lookX
      command.lookY += gamepad.lookY

      command.fire =
        held.current.fire || k.fire || gamepad.fire || now < held.current.tapFireUntil
      command.ads = held.current.ads || k.ads || gamepad.ads

      // Edges are latched rather than assigned: the simulation clears these
      // once it acts, and overwriting them with `false` here would swallow a
      // button pressed on a frame the fight had already consumed.
      if (gamepad.reload) command.reload = true
      if (gamepad.dodge) command.dodge = true

      if (gamepad.connected && haptics.current) {
        for (const event of state.events) {
          // Taking a hit is the one thing worth a strong buzz — it is the
          // feedback a third-person camera is worst at giving you, because
          // whatever hit you is very often off screen.
          if (event.kind === 'hurt') padReader.current.rumble(0.75, 170)
          else if (event.kind === 'kill') padReader.current.rumble(0.35, 90)
        }
      }
    })
  }, [subscribe, input, active])

  const press = (control: 'fire') => (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    held.current[control] = true
  }
  const release = (control: 'fire') => () => {
    held.current[control] = false
  }

  const tap = (action: 'reload' | 'dodge') => (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    input.current[action] = true
  }

  const toggleAds = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    held.current.ads = !held.current.ads
    setAiming(held.current.ads)
  }

  return (
    <div ref={layerRef} className="arena-controls" aria-hidden="true">
      {touch ? (
        <>
          <div ref={moveBaseRef} className="stick stick--move">
            <div ref={moveKnobRef} className="stick__knob" />
          </div>
          <div ref={lookBaseRef} className="stick stick--look">
            <div ref={lookKnobRef} className="stick__knob" />
          </div>
        </>
      ) : null}

      {/* These are thumb controls, and they are offered only to a thumb.

          A connected pad has every one of them under a finger already, and a
          mouse has the keyboard: showing them there is not just clutter, it is
          actively harmful, because they sit over the arena and swallow exactly
          the clicks that are supposed to buy pointer lock. Hidden rather than
          unmounted, so unplugging a pad brings them straight back. */}
      <div className={`arena-buttons${!touch || pad ? ' is-hidden' : ''}`}>
        {melee ? null : (
          <button
            type="button"
            data-arena-button=""
            className={`abtn abtn--ads${aiming ? ' is-on' : ''}`}
            onPointerDown={toggleAds}
          >
            ◎
          </button>
        )}
        <button
          type="button"
          data-arena-button=""
          className="abtn abtn--reload"
          onPointerDown={tap('reload')}
        >
          ⟳
        </button>
        <button
          type="button"
          data-arena-button=""
          className="abtn abtn--dodge"
          onPointerDown={tap('dodge')}
        >
          ⤢
        </button>
        <button
          type="button"
          data-arena-button=""
          className="abtn abtn--fire"
          onPointerDown={press('fire')}
          onPointerUp={release('fire')}
          onPointerCancel={release('fire')}
          onPointerLeave={release('fire')}
        >
          ⦿
        </button>
      </div>
    </div>
  )
}
