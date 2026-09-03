import { useEffect, useRef } from 'react'
import type { Terrain } from '../game/types'
import { ArenaScene } from '../render/arena/ArenaScene'
import type { ArenaView } from '../render/arena/view'

/**
 * The one React file allowed to touch `src/render/arena/`, and the module the
 * arena screen lazy-loads. Importing it anywhere else would pull Three.js into
 * the initial bundle and make the home screen pay for a scene it never shows.
 *
 * It has no loop of its own. The fight already runs one, and this subscribes to
 * it — so there is only ever one rAF per battle, and the HUD above the canvas
 * and the arena inside it are always drawing the same frame of the same fight.
 *
 * It renders a bare stage and no text. Persian labels live in the DOM above it,
 * where the browser can shape and bidi them properly; nothing Persian is ever
 * handed to WebGL.
 *
 * The <canvas> itself is created by the effect rather than by React, and is
 * thrown away with the scene. That is not a style choice: releasing a context
 * with forceContextLoss() poisons its canvas for good, and getContext() on that
 * element afterwards hands back the same dead context. A canvas React kept
 * alive across an effect re-run — a StrictMode remount, a terrain change —
 * would take the next renderer down with it.
 */

interface ArenaCanvasProps {
  terrain: Terrain
  /** Drawn as an insignia on the commander's pack. */
  heroEmoji: string
  reducedMotion: boolean
  /** Registers a per-frame draw call with the running fight. */
  subscribe: (draw: (view: ArenaView, now: number) => void) => () => void
  /** Fired once the first frame is on screen, so the caller can hand over. */
  onReady: () => void
  /** Fired when WebGL turns out to be unusable; the caller reverts. */
  onUnavailable: () => void
}

export default function ArenaCanvas({
  terrain,
  heroEmoji,
  reducedMotion,
  subscribe,
  onReady,
  onUnavailable,
}: ArenaCanvasProps) {
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

  /*
   * The terrain goes through a ref for the same reason the callbacks do: only
   * its id and its two gradient stops describe anything the renderer draws, and
   * everything else on it is combat arithmetic. A parent that rebuilds the
   * terrain object each render would otherwise cost the player a whole WebGL
   * context every frame. Effects run in declaration order, so this one has
   * already refreshed the ref by the time the effect below reads it.
   */
  const latestTerrain = useRef(terrain)
  useEffect(() => {
    latestTerrain.current = terrain
  }, [terrain])

  const [from, to] = terrain.colors

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    const canvas = document.createElement('canvas')
    stage.appendChild(canvas)

    let scene: ArenaScene
    try {
      scene = new ArenaScene({
        canvas,
        terrain: latestTerrain.current,
        heroEmoji,
        onContextLost: () => callbacks.current.onUnavailable(),
      })
    } catch (error) {
      console.warn('Eras of War: WebGL arena unavailable.', error)
      canvas.remove()
      callbacks.current.onUnavailable()
      return
    }

    const rect = stage.getBoundingClientRect()
    scene.resize(rect.width, rect.height)

    // A ResizeObserver, not a window listener: the stage also changes size when
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
  }, [terrain.id, from, to, heroEmoji, subscribe])

  return <div ref={stageRef} className="arena__stage" aria-hidden="true" />
}
