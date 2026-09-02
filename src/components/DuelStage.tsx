import { useEffect, useRef } from 'react'
import type { DuelState } from '../game/duel'

/**
 * The battlefield without WebGL.
 *
 * This is not a decorative fallback — it is the same fight, fully playable, on
 * any device that cannot give us a GL context. It subscribes to the same loop
 * the canvas does and writes transforms straight onto two DOM nodes, so it
 * costs no React renders either.
 *
 * The span matches WORLD_MIN_WIDTH in `src/render/world.ts`, so an army stands
 * in the same place whichever field is drawing it and the handover between them
 * is invisible.
 */
const STAGE_SPAN = 22

/** Enough for the fastest weapon's shots in flight at once. */
const SHOT_POOL = 6

interface DuelStageProps {
  playerEmoji: string
  enemyEmoji: string
  subscribe: (draw: (state: DuelState) => void) => () => void
}

export function DuelStage({ playerEmoji, enemyEmoji, subscribe }: DuelStageProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<HTMLSpanElement>(null)
  const enemyRef = useRef<HTMLSpanElement>(null)
  const shotsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const stage = stageRef.current
    const playerEl = playerRef.current
    const enemyEl = enemyRef.current
    const shotLayer = shotsRef.current
    if (!stage || !playerEl || !enemyEl || !shotLayer) return

    const shots = Array.from(shotLayer.children) as HTMLElement[]
    let width = stage.getBoundingClientRect().width

    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            const entry = entries[0]
            if (entry) width = entry.contentRect.width
          })
    observer?.observe(stage)

    // Toggling a class every frame would thrash style recalculation, so the
    // tell is only touched when it actually changes.
    let playerWinding = false
    let enemyWinding = false

    const place = (
      element: HTMLElement,
      side: DuelState['player'],
      facing: number,
      wasWinding: boolean,
    ): boolean => {
      const offset = (side.x / STAGE_SPAN) * width
      const flinch = side.hurt > 0 ? side.hurt / 0.22 : 0
      const lean = side.windUp > 0 ? 0.26 : 0
      const defeated = side.health <= 0
      // Reeling from a perfect dodge reads as a wobble.
      const reel = side.stagger > 0 ? Math.sin(side.stagger * 34) * 9 : 0
      const tilt = defeated ? facing * 30 : facing * (lean - flinch * 0.3) * 40 + reel

      element.style.transform = `translate(-50%, 0) translateX(${offset.toFixed(1)}px) rotate(${tilt.toFixed(1)}deg)`
      element.style.opacity = defeated ? '0.5' : side.invulnerable > 0 ? '0.45' : '1'

      const winding = side.windUp > 0 && side.stagger <= 0
      if (winding !== wasWinding) element.classList.toggle('is-winding', winding)
      element.classList.toggle('is-quick', winding && side.quickSwing)
      element.classList.toggle('is-staggered', side.stagger > 0)
      element.classList.toggle('is-loaded', side.counter)
      return winding
    }

    const unsubscribe = subscribe((state) => {
      // The player holds the right of the field and faces left.
      playerWinding = place(playerEl, state.player, 1, playerWinding)
      enemyWinding = place(enemyEl, state.enemy, -1, enemyWinding)

      for (let i = 0; i < shots.length; i += 1) {
        const element = shots[i]
        if (!element) continue
        const shot = state.projectiles[i]
        if (!shot) {
          element.style.opacity = '0'
          continue
        }
        element.style.opacity = '1'
        const offset = (shot.x / STAGE_SPAN) * width
        const lift = (shot.height / STAGE_SPAN) * width
        element.style.transform = `translate(-50%, 0) translate(${offset.toFixed(1)}px, ${(-lift).toFixed(1)}px)`
      }
    })

    return () => {
      unsubscribe()
      observer?.disconnect()
    }
  }, [subscribe])

  return (
    <div ref={stageRef} className="battle__stage battle__stage--dom" aria-hidden="true">
      <span ref={enemyRef} className="duelist duelist--enemy">
        {enemyEmoji}
      </span>
      <span ref={playerRef} className="duelist duelist--player">
        {playerEmoji}
      </span>
      <div ref={shotsRef} className="duel-shots">
        {Array.from({ length: SHOT_POOL }, (_, index) => (
          <i key={index} className="duel-shot" />
        ))}
      </div>
    </div>
  )
}
