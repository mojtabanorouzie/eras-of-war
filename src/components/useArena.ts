import { useCallback, useEffect, useRef, useState } from 'react'
import { advanceArena, createArena } from '../game/arena/sim'
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

  useEffect(() => {
    let frame = 0
    let previous = 0
    let lastPhase: ArenaPhase = state.phase

    const tick = (now: number) => {
      // The first frame has no predecessor, so it advances nothing.
      const dt = previous === 0 ? 0 : (now - previous) / 1000
      previous = now

      advanceArena(state, dt, inputRef.current)
      for (const draw of subscribers.current) draw(state, now)

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

  const subscribe = useCallback((draw: ArenaDraw) => {
    const set = subscribers.current
    set.add(draw)
    return () => {
      set.delete(draw)
    }
  }, [])

  return { phase, result, state, input: inputRef, subscribe }
}
