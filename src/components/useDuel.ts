import { useCallback, useEffect, useRef, useState } from 'react'
import type { CombatStats } from '../game/combat'
import { advanceDuel, createDuel, createInput } from '../game/duel'
import type { DuelPhase, DuelResult, DuelState } from '../game/duel'

/**
 * Runs the fight.
 *
 * The loop lives here rather than in the renderer because the game has to stay
 * playable with WebGL unavailable — the CSS field and the canvas are both just
 * subscribers to the same fight.
 *
 * React state is deliberately almost empty: only the phase and the final result
 * cross back into rendering, so a battle costs three re-renders rather than
 * sixty a second. Everything moving is read from the live state each frame.
 */

export interface DuelController {
  phase: DuelPhase
  result: DuelResult | null
  attack: () => void
  dodge: () => void
  /** Called with the fight state and the frame timestamp, once per frame. */
  subscribe: (draw: (state: DuelState, now: number) => void) => () => void
}

export function useDuel(player: CombatStats, enemy: CombatStats): DuelController {
  // Built once, from the stats as they stood when the battle began. A lazy
  // useState initialiser rather than a ref: the value never changes, so this is
  // stable without reading a ref during render.
  const [state] = useState(() => createDuel(player, enemy))

  const inputRef = useRef(createInput())
  const subscribers = useRef(new Set<(state: DuelState, now: number) => void>())

  const [phase, setPhase] = useState<DuelPhase>('intro')
  const [result, setResult] = useState<DuelResult | null>(null)

  useEffect(() => {
    let frame = 0
    let previous = 0
    let lastPhase: DuelPhase = state.phase

    const tick = (now: number) => {
      // The first frame has no predecessor, so it advances nothing.
      const dt = previous === 0 ? 0 : (now - previous) / 1000
      previous = now

      advanceDuel(state, dt, inputRef.current)
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

  const attack = useCallback(() => {
    inputRef.current.attack = true
    inputRef.current.attackAge = 0
  }, [])

  const dodge = useCallback(() => {
    inputRef.current.dodge = true
    inputRef.current.dodgeAge = 0
  }, [])

  const subscribe = useCallback((draw: (state: DuelState, now: number) => void) => {
    const set = subscribers.current
    set.add(draw)
    return () => {
      set.delete(draw)
    }
  }, [])

  return { phase, result, attack, dodge, subscribe }
}
