import { CanvasTexture, ClampToEdgeWrapping, RepeatWrapping, SRGBColorSpace } from 'three'
import type { Texture } from 'three'
import type { RGB } from './palette'
import { css, shade } from './palette'

/**
 * Every texture in the battle is drawn at runtime with Canvas2D.
 *
 * This game ships no art. Generating the scenery from the terrain's own colours
 * keeps the bundle at zero extra bytes, gives all five battlefields their own
 * silhouette, and means a new terrain in `src/data` gets a backdrop for free.
 *
 * Emoji are safe to rasterise: every glyph the game uses is a single base
 * codepoint (a few carry U+FE0F), so there is no shaping or bidi to lose.
 * Persian text is a different matter and never comes near this file.
 */

/** How a battlefield's horizon is shaped. */
export type SceneryStyle = 'peaks' | 'dunes' | 'trees' | 'ruins' | 'waves'

// Powers of two, so horizontal repeat wrapping and mipmaps work everywhere.
const RIDGE_WIDTH = 512
const RIDGE_HEIGHT = 128

const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'

function surface(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  // Throwing hands the whole battlefield back to the CSS fallback, which is
  // the right outcome for a browser that cannot draw a 2D canvas.
  if (!context) throw new Error('Canvas2D unavailable; cannot build scenery')
  return context
}

function toTexture(context: CanvasRenderingContext2D, tiles: boolean): Texture {
  const texture = new CanvasTexture(context.canvas)
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = tiles ? RepeatWrapping : ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  return texture
}

/** Deterministic noise: the same terrain must look the same every battle. */
function seededRandom(seed: string): () => number {
  let hashed = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    hashed ^= seed.charCodeAt(i)
    hashed = Math.imul(hashed, 16777619)
  }

  let state = hashed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Conifers on a flat ridge, inset so no trunk straddles the tiling seam. */
function drawTrees(context: CanvasRenderingContext2D, random: () => number, baseY: number): void {
  const margin = 28
  const count = 13
  for (let i = 0; i < count; i += 1) {
    const x = margin + ((i + 0.5) / count) * (RIDGE_WIDTH - margin * 2)
    const height = RIDGE_HEIGHT * (0.3 + random() * 0.3)
    const half = height * 0.3
    context.beginPath()
    context.moveTo(x, baseY - height)
    context.lineTo(x + half, baseY + 2)
    context.lineTo(x - half, baseY + 2)
    context.closePath()
    context.fill()
  }
}

/** A broken skyline of blocks, likewise inset from the seam. */
function drawRuins(context: CanvasRenderingContext2D, random: () => number, baseY: number): void {
  const margin = 24
  const count = 13
  const span = (RIDGE_WIDTH - margin * 2) / count
  for (let i = 0; i < count; i += 1) {
    const width = span * (0.42 + random() * 0.36)
    const height = RIDGE_HEIGHT * (0.14 + random() * 0.34)
    context.fillRect(margin + i * span + span * 0.1, baseY - height, width, height + 3)
  }
}

export interface RidgeOptions {
  style: SceneryStyle
  fill: RGB
  seed: string
}

/**
 * One parallax band: a filled silhouette across the bottom, transparent above.
 * The profile is periodic over the texture width so it tiles without a seam.
 */
export function ridgeTexture({ style, fill, seed }: RidgeOptions): Texture {
  const context = surface(RIDGE_WIDTH, RIDGE_HEIGHT)
  const random = seededRandom(seed)
  context.fillStyle = css(fill)

  context.beginPath()
  context.moveTo(0, RIDGE_HEIGHT)

  if (style === 'dunes' || style === 'waves') {
    const amplitude = RIDGE_HEIGHT * (style === 'dunes' ? 0.3 : 0.26)
    const baseline = RIDGE_HEIGHT * (style === 'dunes' ? 0.54 : 0.58)
    const overtone = style === 'dunes' ? 3 : 3
    const phaseA = random() * Math.PI * 2
    const phaseB = random() * Math.PI * 2
    // Integer harmonics of the full width, so profile(0) === profile(width).
    for (let x = 0; x <= RIDGE_WIDTH; x += 4) {
      const angle = (x / RIDGE_WIDTH) * Math.PI * 2
      const y =
        baseline -
        Math.sin(angle + phaseA) * amplitude -
        Math.sin(angle * overtone + phaseB) * amplitude * (style === 'waves' ? 0.5 : 0.3)
      context.lineTo(x, y)
    }
  } else if (style === 'peaks') {
    const count = 5
    const valley = RIDGE_HEIGHT * 0.68
    context.lineTo(0, valley)
    for (let i = 0; i < count; i += 1) {
      const left = (i / count) * RIDGE_WIDTH
      const right = ((i + 1) / count) * RIDGE_WIDTH
      context.lineTo((left + right) / 2, RIDGE_HEIGHT * (0.14 + random() * 0.24))
      context.lineTo(right, valley)
    }
  } else {
    const baseline = RIDGE_HEIGHT * 0.74
    context.lineTo(0, baseline)
    context.lineTo(RIDGE_WIDTH, baseline)
  }

  context.lineTo(RIDGE_WIDTH, RIDGE_HEIGHT)
  context.closePath()
  context.fill()

  if (style === 'trees') drawTrees(context, random, RIDGE_HEIGHT * 0.74)
  if (style === 'ruins') drawRuins(context, random, RIDGE_HEIGHT * 0.74)

  return toTexture(context, true)
}

/** Where the ground has faded fully in, as a fraction of the texture height. */
const GROUND_FADE = 0.16

/** The strip the armies stand on: a vertical falloff plus a little grit. */
export function groundTexture(base: RGB, seed: string): Texture {
  const context = surface(RIDGE_WIDTH, RIDGE_HEIGHT)
  const random = seededRandom(seed)

  // The top edge fades in rather than cutting a hard line across the field —
  // a straight horizon here reads as a UI seam, not as terrain.
  const gradient = context.createLinearGradient(0, 0, 0, RIDGE_HEIGHT)
  gradient.addColorStop(0, css(shade(base, 0.12), 0))
  gradient.addColorStop(GROUND_FADE, css(shade(base, 0.06), 1))
  gradient.addColorStop(1, css(shade(base, -0.4), 1))
  context.fillStyle = gradient
  context.fillRect(0, 0, RIDGE_WIDTH, RIDGE_HEIGHT)

  const gritTop = RIDGE_HEIGHT * (GROUND_FADE + 0.04)
  for (let i = 0; i < 150; i += 1) {
    // Inset so a speck never lands across the tiling seam, and kept below the
    // fade so none of them float on the transparent edge.
    const x = 4 + random() * (RIDGE_WIDTH - 8)
    const y = gritTop + random() * (RIDGE_HEIGHT - gritTop)
    context.fillStyle = css(shade(base, random() > 0.5 ? 0.18 : -0.24), 0.45)
    context.beginPath()
    context.arc(x, y, 1 + random() * 2.2, 0, Math.PI * 2)
    context.fill()
  }

  return toTexture(context, true)
}

/** One emoji, centred, wearing the same drop shadow as the CSS fighters. */
export function emojiTexture(emoji: string, size = 128): Texture {
  const context = surface(size, size)
  context.font = `${Math.round(size * 0.7)}px ${EMOJI_FONT}`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.shadowColor = 'rgba(0, 0, 0, 0.5)'
  context.shadowBlur = size * 0.09
  context.shadowOffsetY = size * 0.05
  context.fillText(emoji, size / 2, size * 0.52)
  return toTexture(context, false)
}

/**
 * A white radial falloff. Tinted by each material that uses it, this one
 * texture serves as ground shadow, impact ring and every spark.
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
  return toTexture(context, false)
}
