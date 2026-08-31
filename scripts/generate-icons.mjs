/**
 * Generates the PWA icons as real PNGs, with no image dependencies.
 *
 * Run with:  node scripts/generate-icons.mjs
 *
 * The output is committed, so this only needs re-running when the mark changes.
 */
import { deflateSync, crc32 as nodeCrc32 } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

/* ---------------------------------------------------------------- colours */

const INK_TOP = [0x3a, 0x2b, 0x8c]
const INK_BOTTOM = [0x14, 0x0e, 0x38]
const GOLD = [0xff, 0xc6, 0x3d]
const GOLD_DEEP = [0xc8, 0x8c, 0x10]
const GOLD_LIGHT = [0xff, 0xf1, 0xbd]

const lerp = (a, b, t) => a + (b - a) * t
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]

/* ----------------------------------------------------------------- shapes */

/** Distance from a point to a line segment, plus how far along it landed. */
function projectOntoSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const lengthSq = dx * dx + dy * dy
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq))
  return { d: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), t }
}

function insideRoundedSquare(u, v, radius) {
  const dx = Math.max(radius - u, 0, u - (1 - radius))
  const dy = Math.max(radius - v, 0, v - (1 - radius))
  return Math.hypot(dx, dy) <= radius
}

/**
 * One sample of the mark. `inset` shrinks the artwork for maskable icons,
 * where platforms crop up to 20% off every edge.
 */
function sample(u, v, { radius, inset, opaque }) {
  if (!opaque && !insideRoundedSquare(u, v, radius)) return null

  // Backdrop: vertical gradient plus a soft highlight near the top.
  let colour = mix(INK_TOP, INK_BOTTOM, Math.min(1, v * 1.15))
  const glow = Math.max(0, 1 - Math.hypot(u - 0.5, (v - 0.02) * 1.4) * 2.1)
  colour = mix(colour, [0x6b, 0x54, 0xd8], glow * 0.45)

  // Two crossed swords, drawn inside the inset box. Each runs hilt (a) to tip (b).
  const k = 1 - inset * 2
  const s = (n) => 0.5 + (n - 0.5) * k
  const blades = [
    [s(0.24), s(0.82), s(0.76), s(0.2)],
    [s(0.76), s(0.82), s(0.24), s(0.2)],
  ]
  const maxWidth = k * 0.062
  const edge = k * 0.012

  for (const [ax, ay, bx, by] of blades) {
    const nx = (by - ay) / Math.hypot(bx - ax, by - ay)
    const ny = -(bx - ax) / Math.hypot(bx - ax, by - ay)

    // Cross-guard: a short bar across the blade, just above the grip.
    const guardX = lerp(ax, bx, 0.24)
    const guardY = lerp(ay, by, 0.24)
    const guard = projectOntoSegment(
      u, v,
      guardX - nx * k * 0.12, guardY - ny * k * 0.12,
      guardX + nx * k * 0.12, guardY + ny * k * 0.12,
    )
    if (guard.d <= k * 0.026) colour = mix(GOLD, GOLD_DEEP, 0.35)

    // Blade: full width at the grip, tapering to a point.
    const { d, t } = projectOntoSegment(u, v, ax, ay, bx, by)
    const width = t < 0.24 ? maxWidth * 0.72 : maxWidth * (1 - ((t - 0.24) / 0.76) ** 1.7)
    if (d <= width + edge) {
      const rim = Math.min(1, Math.max(0, (d - width * 0.5) / (width * 0.5 + edge)))
      const metal = t < 0.24 ? mix(GOLD_DEEP, GOLD, 0.25) : mix(GOLD_LIGHT, GOLD, 0.5)
      colour = mix(metal, t < 0.24 ? GOLD_DEEP : mix(GOLD_DEEP, GOLD, 0.4), rim)
    }

    // Pommel at the hilt end.
    if (Math.hypot(u - ax, v - ay) <= k * 0.05) colour = mix(GOLD, GOLD_DEEP, 0.3)
  }

  // Spark where the blades meet.
  const sparkRadius = Math.hypot(u - 0.5, v - s(0.51))
  if (sparkRadius <= k * 0.05) {
    colour = mix(GOLD_LIGHT, [0xff, 0xff, 0xff], 1 - sparkRadius / (k * 0.05))
  }

  return colour
}

/** Renders an RGBA buffer using 4x4 supersampling for smooth edges. */
function render(size, options) {
  const pixels = Buffer.alloc(size * size * 4)
  const steps = 4
  const total = steps * steps

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      let hits = 0

      for (let sy = 0; sy < steps; sy += 1) {
        for (let sx = 0; sx < steps; sx += 1) {
          const colour = sample((x + (sx + 0.5) / steps) / size, (y + (sy + 0.5) / steps) / size, options)
          if (!colour) continue
          r += colour[0]
          g += colour[1]
          b += colour[2]
          hits += 1
        }
      }

      const offset = (y * size + x) * 4
      if (hits === 0) continue
      pixels[offset] = Math.round(r / hits)
      pixels[offset + 1] = Math.round(g / hits)
      pixels[offset + 2] = Math.round(b / hits)
      pixels[offset + 3] = Math.round((hits / total) * 255)
    }
  }

  return pixels
}

/* -------------------------------------------------------------- png encode */

const crcTable = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  if (typeof nodeCrc32 === 'function') return nodeCrc32(buffer) >>> 0
  let c = 0xffffffff
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  // One filter byte (0 = none) per scanline.
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ------------------------------------------------------------------ output */

const TARGETS = [
  { file: 'icon-192.png', size: 192, radius: 0.22, inset: 0.06, opaque: false },
  { file: 'icon-512.png', size: 512, radius: 0.22, inset: 0.06, opaque: false },
  { file: 'icon-maskable-512.png', size: 512, radius: 0, inset: 0.17, opaque: true },
  { file: 'apple-touch-icon.png', size: 180, radius: 0, inset: 0.1, opaque: true },
]

mkdirSync(OUT_DIR, { recursive: true })

for (const target of TARGETS) {
  const pixels = render(target.size, target)
  writeFileSync(join(OUT_DIR, target.file), encodePng(target.size, pixels))
  console.log(`wrote public/${target.file} (${target.size}x${target.size})`)
}
