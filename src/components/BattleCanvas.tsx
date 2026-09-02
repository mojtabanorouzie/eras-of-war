import { useEffect, useRef } from 'react'
import type { Terrain } from '../game/types'
import { BattleScene } from '../render/BattleScene'
import type { DuelView } from '../render/view'

/**
 * The one React file allowed to touch `src/render/`, and the module the battle
 * screen lazy-loads. Importing it anywhere else would pull Three.js into the
 * initial bundle and make the home screen pay for a canvas it never shows.
 *
 * It has no loop of its own. The fight already runs one, and this subscribes to
 * it — so the canvas and the CSS fallback are drawing the same frame of the
 * same fight, and there is only ever one rAF per battle.
 *
 * It renders a bare stage and no text. Persian labels live in the DOM above it,
 * where the browser can shape and bidi them properly.
 *
 * The <canvas> itself is created by the effect rather than by React, and is
 * thrown away with the scene. That is not a style choice: releasing a context
 * with forceContextLoss() poisons its canvas for good, and getContext() on that
 * element afterwards hands back the same dead context. A canvas React kept
 * alive across an effect re-run — a StrictMode remount, a terrain change —
 * would take the next renderer down with it.
 */

interface BattleCanvasProps {
  terrain: Terrain
  playerEmoji: string
  enemyEmoji: string
  reducedMotion: boolean
  /** Registers a per-frame draw call with the running fight. */
  subscribe: (draw: (view: DuelView, now: number) => void) => () => void
  /** Fired once the first frame is on screen, so the caller can hand over. */
  onReady: () => void
  /** Fired when WebGL turns out to be unusable; the caller reverts to CSS. */
  onUnavailable: () => void
}

export default function BattleCanvas({
  terrain,
  playerEmoji,
  enemyEmoji,
  reducedMotion,
  subscribe,
  onReady,
  onUnavailable,
}: BattleCanvasProps) {
  const stageRef = useRef<HTMLDivElement>(null)

  // Callbacks live in a ref so a new identity never tears down the GPU context.
  const callbacks = useRef({ onReady, onUnavailable })
  useEffect(() => {
    callbacks.current = { onReady, onUnavailable }
  }, [onReady, onUnavailable])

  const motion = useRef(reducedMotion)
  useEffect(() => {
    motion.current = reducedMotion
  }, [reducedMotion])

  const [from, to] = terrain.colors

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    const canvas = document.createElement('canvas')
    stage.appendChild(canvas)

    let scene: BattleScene
    try {
      scene = new BattleScene({
        canvas,
        field: { seed: terrain.id, colors: [from, to], playerEmoji, enemyEmoji },
        onContextLost: () => callbacks.current.onUnavailable(),
      })
    } catch (error) {
      console.warn('Eras of War: WebGL battlefield unavailable, using CSS.', error)
      canvas.remove()
      callbacks.current.onUnavailable()
      return
    }

    const rect = stage.getBoundingClientRect()
    scene.resize(rect.width, rect.height)

    // A ResizeObserver, not a window listener: the field also changes size when
    // the layout reflows around it — rotation, keyboard, dynamic viewport units.
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            const entry = entries[0]
            if (entry) scene.resize(entry.contentRect.width, entry.contentRect.height)
          })
    observer?.observe(stage)

    let painted = false
    const unsubscribe = subscribe((view, now) => {
      if (scene.render(now, view, motion.current) && !painted) {
        painted = true
        callbacks.current.onReady()
      }
    })

    return () => {
      unsubscribe()
      observer?.disconnect()
      scene.dispose()
      canvas.remove()
    }
  }, [terrain.id, from, to, playerEmoji, enemyEmoji, subscribe])

  return <div ref={stageRef} className="battle__stage" aria-hidden="true" />
}
