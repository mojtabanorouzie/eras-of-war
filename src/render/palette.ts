import { Color, SRGBColorSpace } from 'three'

/**
 * Colour arithmetic in sRGB — the space a browser mixes a CSS gradient in.
 *
 * Everything the scene paints is derived from the terrain's own two stops, so
 * the WebGL field, the CSS gradient behind it and the TerrainBanner above it
 * are all provably the same palette. Nothing here invents a colour.
 */

/** sRGB channels in 0..255. */
export type RGB = readonly [number, number, number]

const WHITE: RGB = [255, 255, 255]
const BLACK: RGB = [0, 0, 0]

// Three's parser handles every CSS notation; reused rather than reallocated.
const scratch = new Color()
const channels = { r: 0, g: 0, b: 0 }

export function parseColor(style: string): RGB {
  scratch.setStyle(style, SRGBColorSpace)
  scratch.getRGB(channels, SRGBColorSpace)
  return [channels.r * 255, channels.g * 255, channels.b * 255]
}

export function mix(from: RGB, to: RGB, t: number): RGB {
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ]
}

/** Positive lightens toward white, negative darkens toward black. */
export function shade(color: RGB, amount: number): RGB {
  return amount >= 0 ? mix(color, WHITE, amount) : mix(color, BLACK, -amount)
}

/** A `rgba(...)` string for Canvas2D. */
export function css(color: RGB, alpha = 1): string {
  return `rgba(${Math.round(color[0])}, ${Math.round(color[1])}, ${Math.round(color[2])}, ${alpha})`
}

/** 0..1 components, the form a shader uniform wants. */
export function unit(color: RGB): [number, number, number] {
  return [color[0] / 255, color[1] / 255, color[2] / 255]
}
