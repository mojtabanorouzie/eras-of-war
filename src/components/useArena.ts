import { useCallback, useEffect, useRef, useState } from 'react'
import { advanceArena, createArena, resignArena } from '../game/arena/sim'
import { createArenaInput } from '../game/arena/types'
import type { ArenaInput, ArenaPhase, ArenaResult, ArenaState } from '../game/arena/types'
import type { ArenaOptions } from '../game/arena/sim'

/**
 * Runs the fight.
 *
 * The loop lives here rather than in the renderer for the same reason it did
 * for the duel: the canvas is one subscriber among several. The HUD, the
 * controls and the 3D field all read the same frame of the same fight, and
 * there is only ever one `requestAnimationFrame` per battle.
 *
 * React state is deliberately almost empty. Only the phase and the final
 * result cross back into rendering, so a battle costs three re-renders rather
 * than sixty a second — everything that moves is written straight to the DOM
 * or to the GPU by the subscribers themselves.
 */

export type ArenaDraw = (state: ArenaState, now: number) => void

export interface ArenaController {
  phase: ArenaPhase
  result: ArenaResult | null
  /**
   * The live, mutable fight.
   *
   * Handed out for imperative reads only — spread across a render it would be
   * a lie, because it is mutated in place sixty times a second.
   */
  state: ArenaState
  /** What the player is asking for. The control surfaces write it. */
  input: React.RefObject<ArenaInput>
  subscribe: (draw: ArenaDraw) => () => void
  /** True while the fight is held. The clock, the enemies and every subscriber freeze. */
  paused: boolean
  togglePause: () => void
  /** Strikes the colours: ends the fight as a defeat, through the sim's own rules. */
  resign: () => void
}

export function useArena(options: ArenaOptions): ArenaController {
  // Built once, from the kit as it stood when the battle began. A lazy
  // initialiser rather than a ref: the value never changes, so this is stable
  // without reading a ref during render. Buying or equipping something
  // mid-fight therefore cannot reach into the fight in progress.
  const [state] = useState(() => createArena(options))

  const inputRef = useRef<ArenaInput>(createArenaInput())
  const subscribers = useRef(new Set<ArenaDraw>())

  const [phase, setPhase] = useState<ArenaPhase>(state.phase)
  const [result, setResult] = useState<ArenaResult | null>(null)

  // Both a state and a ref: the button needs a render, the sixty-a-second tick
  // needs a read that costs nothing and is never a frame stale.
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(false)

  useEffect(() => {
    let frame = 0
    let previous = 0
    let lastPhase: ArenaPhase = state.phase

    const tick = (now: number) => {
      // The first frame has no predecessor, so it advances nothing.
      const dt = previous === 0 ? 0 : (now - previous) / 1000
      previous = now

      // A held fight is genuinely held: the sim does not advance, so the clock
      // and every cooldown stop for free, and the subscribers are not called,
      // so the last drawn frame simply stays on screen under the overlay.
      // `previous` keeps tracking, so resuming costs one ordinary frame rather
      // than the whole paused span (which the sim would clamp anyway).
      if (!pausedRef.current) {
        advanceArena(state, dt, inputRef.current)
        for (const draw of subscribers.current) draw(state, now)
      }

      if (state.phase !== lastPhase) {
        lastPhase = state.phase
        setPhase(state.phase)
        if (state.result) setResult(state.result)
      }

      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)

    return () => window.cancelAnimationFrame(frame)
  }, [state])

  const togglePause = useCallback(() => {
    if (state.phase === 'over') return
    setPaused((held) => {
      pausedRef.current = !held
      return !held
    })
  }, [state])

  const resign = useCallback(() => {
    resignArena(state)
    pausedRef.current = false
    setPaused(false)
    // Pushed into React immediately rather than waiting for the next tick, so
    // the defeat flow starts even on a frame the loop happens to be skipping.
    setPhase(state.phase)
    setResult(state.result)
  }, [state])

  const subscribe = useCallback((draw: ArenaDraw) => {
    const set = subscribers.current
    set.add(draw)
    return () => {
      set.delete(draw)
    }
  }, [])

  return { phase, result, state, input: inputRef, subscribe, paused, togglePause, resign }
}
