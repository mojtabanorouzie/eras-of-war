import { CanvasTexture, ClampToEdgeWrapping, SRGBColorSpace } from 'three'
import type { Texture } from 'three'

/**
 * Every texture the arena needs, drawn at runtime with Canvas2D.
 *
 * This game ships no art. Generating what it needs from code keeps the bundle
 * at zero extra bytes and means a new terrain or a new commander in `src/data`
 * costs nothing to draw.
 *
 * Emoji are safe to rasterise: every glyph the game uses is a single base
 * codepoint (a few carry U+FE0F), so there is no shaping or bidi to lose.
 * Persian text is a different matter and never comes near this file — it stays
 * in the DOM above the canvas, where the browser can shape it properly.
 */

const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'

function surface(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  // Throwing here is caught by the arena screen, which falls back to settling
  // the battle on paper — the right outcome for a browser that cannot draw a
  // 2D canvas, since it certainly cannot render a 3D one either.
  if (!context) throw new Error('Canvas2D unavailable; cannot build textures')
  return context
}

function toTexture(context: CanvasRenderingContext2D): Texture {
  const texture = new CanvasTexture(context.canvas)
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  return texture
}

/** One emoji, centred, wearing a soft drop shadow so it reads against terrain. */
export function emojiTexture(emoji: string, size = 128): Texture {
  const context = surface(size, size)
  context.font = `${Math.round(size * 0.7)}px ${EMOJI_FONT}`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.shadowColor = 'rgba(0, 0, 0, 0.5)'
  context.shadowBlur = size * 0.09
  context.shadowOffsetY = size * 0.05
  context.fillText(emoji, size / 2, size * 0.52)
  return toTexture(context)
}

/**
 * A white radial falloff. Tinted by each material that uses it, this one
 * texture serves as ground shadow, wind-up tell, muzzle flash and every spark.
 */
export function radialTexture(size = 64): Texture {
  const context = surface(size, size)
  const half = size / 2
  const gradient = context.createRadialGradient(half, half, 0, half, half, half)
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
  gradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.6)')
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)
  return toTexture(context)
}
