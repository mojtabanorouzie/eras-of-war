import {
  BackSide,
  BoxGeometry,
  CanvasTexture,
  ClampToEdgeWrapping,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  FogExp2,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  RingGeometry,
  SRGBColorSpace,
  SphereGeometry,
  Vector3,
} from 'three'
import type { BufferGeometry, Material, Texture } from 'three'
import { ARENA_HALF, CAMERA_FAR } from '../../game/arena/world'
import type { Terrain, TerrainId } from '../../game/types'
import { css, mix, parseColor, shade } from '../palette'
import type { RGB } from '../palette'
import type { CoverView } from './view'

/**
 * The ground the fight happens on: the floor, the air above it, the light
 * falling on it, every piece of cover standing in it — and, since the visual
 * overhaul, the world visible beyond the wall. An arena that ends at its own
 * boundary reads as a box; one with a treeline, a ruined skyline or an open
 * sea behind the fog reads as a place, and that difference costs almost
 * nothing because everything out there is a handful of instanced silhouettes.
 *
 * Everything here is built once and then never touched again. Cover does not
 * move, the sun does not travel and the fog does not roll in, so nothing in
 * this file has a per-frame cost beyond being drawn — which is the whole point
 * on a phone. The one exception is `clearFraction`, which the camera calls
 * every frame to find out how far back it is allowed to sit; that is a pure
 * arithmetic query against flat arrays and allocates nothing.
 *
 * No shadow maps. A mobile-first game cannot afford a depth pass per light, so
 * actors carry painted blob shadows instead (see `arenaActors.ts`). The cost of
 * that decision is that cover casts nothing; the benefit is roughly half the
 * frame time back.
 *
 * Every colour is derived from the terrain's own two gradient stops, exactly as
 * the 2D battlefield's was, so the arena, the CSS field behind it and the
 * TerrainBanner above it are provably the same palette.
 */

/* ------------------------------------------------------------------ *
 *  Framing constants
 * ------------------------------------------------------------------ */

/**
 * Exponential-squared fog density.
 *
 * Tuned against the arena diagonal (about 73 units): at that range the far
 * corner sits under roughly a third of a fog veil, which is enough to read as
 * distance without hiding an enemy. Raise it and the far half of a desert fight
 * becomes unfightable; lower it and the arena stops fading out, which is the
 * whole reason the fog is here — it is what turns the edge of the world into a
 * horizon instead of a cliff. Per-terrain mood scales it a little either way;
 * the horizon silhouettes are placed to still read through the result.
 */
const FOG_DENSITY = 0.0085

/**
 * The floor reaches the far clip plane in every direction, so the fog always
 * gets to finish the ground off before geometry runs out. Anything smaller and
 * a player looking outward sees the plane end in mid-air.
 */
const GROUND_SPAN = CAMERA_FAR * 2

/** World units covered by one repeat of the floor texture. */
const FLOOR_TILE = 4

/**
 * How tall the boundary haze stands.
 *
 * It has to be taller than a fighter so it reads as a wall rather than a kerb,
 * and short enough that it never fills the screen when the player backs into a
 * corner.
 */
const BOUNDARY_HEIGHT = 5.5

/**
 * Light intensities are in the post-r155 units, where the old implicit factor
 * of PI is gone — these are roughly 0.8 and 0.65 in the numbers the 2D scene
 * would have used. Both are tinted from the terrain, so a snow fight is lit
 * cold and a desert fight is lit hot without either one needing its own asset.
 */
const HEMISPHERE_INTENSITY = 2.5
const SUN_INTENSITY = 2.05

/**
 * How many samples the camera probe takes along its segment.
 *
 * Sixteen over the hip-fire distance of 5.4 units is a step of 0.34, which is
 * smaller than the probe radius below — so the march cannot step over a wall.
 * Drop it and the camera starts tunnelling through thin cover in the city.
 */
const PROBE_STEPS = 16

/**
 * Where the world beyond the wall lives, in units from the centre.
 *
 * Near enough that the fog leaves it legible, far enough that its scale is
 * ambiguous — a twelve-unit cone at fifty units reads as a mountain precisely
 * because nothing walks next to it to give the game away.
 */
const HORIZON_NEAR = ARENA_HALF + 8
const HORIZON_FAR = ARENA_HALF + 44

/** Ground scatter never spawns inside this radius: the player drops in there. */
const SCATTER_CLEARING = 5

/* ------------------------------------------------------------------ *
 *  Canvas textures
 * ------------------------------------------------------------------ */

function surface(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  // Throwing here hands the whole arena back to the caller's fallback, which is
  // the right outcome for a browser that cannot draw a 2D canvas.
  if (!context) throw new Error('Canvas2D unavailable; cannot build the arena')
  return context
}

function toTexture(context: CanvasRenderingContext2D, tiles: boolean): Texture {
  const texture = new CanvasTexture(context.canvas)
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = tiles ? RepeatWrapping : ClampToEdgeWrapping
  texture.wrapT = tiles ? RepeatWrapping : ClampToEdgeWrapping
  return texture
}

function colorOf(rgb: RGB): Color {
  return new Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, SRGBColorSpace)
}

/** Deterministic noise, so a battlefield looks the same every time it is fought. */
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

/**
 * The arena floor.
 *
 * A featureless plane is the single worst thing a third-person shooter can
 * stand on: with nothing passing under the feet, running reads as sliding, and
 * the player loses all sense of their own speed. So the tile carries a faint
 * seam, a scatter of grit, and one terrain-specific mark — wind ripples in the
 * desert, paving cracks in the city, leaf litter under the trees — so each
 * ground is recognisably its own even in a screenshot of nothing but floor.
 */
function floorTexture(base: RGB, id: TerrainId): Texture {
  const size = 256
  const context = surface(size, size)
  const random = seededRandom(id)

  context.fillStyle = css(base)
  context.fillRect(0, 0, size, size)

  for (let i = 0; i < 220; i += 1) {
    const x = random() * size
    const y = random() * size
    context.fillStyle = css(shade(base, random() > 0.5 ? 0.13 : -0.16), 0.5)
    context.beginPath()
    context.arc(x, y, 1 + random() * 3.4, 0, Math.PI * 2)
    context.fill()
  }

  if (id === 'desert') {
    // Wind ripples: long, soft, parallel. The angle is fixed so neighbouring
    // tiles agree about which way the wind blew.
    context.strokeStyle = css(shade(base, -0.1), 0.35)
    context.lineWidth = 2
    for (let i = 0; i < 9; i += 1) {
      const y = (i + random() * 0.5) * (size / 9)
      context.beginPath()
      context.moveTo(0, y)
      context.bezierCurveTo(size * 0.3, y + 6, size * 0.7, y - 6, size, y)
      context.stroke()
    }
  } else if (id === 'city') {
    // Paving cracks and a scorch: broken ground, not a plaza.
    context.strokeStyle = css(shade(base, -0.3), 0.5)
    context.lineWidth = 1.5
    for (let i = 0; i < 5; i += 1) {
      let x = random() * size
      let y = random() * size
      context.beginPath()
      context.moveTo(x, y)
      for (let leg = 0; leg < 4; leg += 1) {
        x += (random() - 0.5) * 60
        y += (random() - 0.5) * 60
        context.lineTo(x, y)
      }
      context.stroke()
    }
    context.fillStyle = css(shade(base, -0.34), 0.4)
    context.beginPath()
    context.arc(random() * size, random() * size, 16 + random() * 12, 0, Math.PI * 2)
    context.fill()
  } else if (id === 'forest') {
    // Leaf litter: darker blotches, denser than the grit above.
    for (let i = 0; i < 40; i += 1) {
      context.fillStyle = css(mix(base, [46, 74, 40], 0.6), 0.35)
      context.beginPath()
      context.ellipse(
        random() * size,
        random() * size,
        3 + random() * 5,
        2 + random() * 3,
        random() * Math.PI,
        0,
        Math.PI * 2,
      )
      context.fill()
    }
  } else if (id === 'snow') {
    // Scuffed patches where the snow has been walked thin.
    for (let i = 0; i < 12; i += 1) {
      context.fillStyle = css(shade(base, -0.12), 0.3)
      context.beginPath()
      context.ellipse(
        random() * size,
        random() * size,
        8 + random() * 10,
        4 + random() * 5,
        random() * Math.PI,
        0,
        Math.PI * 2,
      )
      context.fill()
    }
  } else {
    // Coast: wet-sand banding, running one way like a tide line.
    context.fillStyle = css(shade(base, -0.14), 0.28)
    for (let i = 0; i < 5; i += 1) {
      const y = (i + 0.3 + random() * 0.4) * (size / 5)
      context.fillRect(0, y, size, 5 + random() * 8)
    }
  }

  // The seam sits on the tile edge rather than through the middle, so two
  // neighbouring tiles share one line instead of drawing two next to each other.
  context.strokeStyle = css(shade(base, -0.22), 0.55)
  context.lineWidth = 2
  context.strokeRect(0, 0, size, size)

  return toTexture(context, true)
}

/**
 * The wall of light at the arena edge.
 *
 * Bright along the ground and gone by head height, with vertical ticks so the
 * player can read sideways movement against it. It is the only thing telling
 * them where the world stops, and a hard opaque wall would read as a level
 * boundary bug rather than as a fence.
 */
function boundaryTexture(tint: RGB): Texture {
  const width = 64
  const height = 256
  const context = surface(width, height)

  const gradient = context.createLinearGradient(0, height, 0, 0)
  gradient.addColorStop(0, css(shade(tint, 0.55), 0.85))
  gradient.addColorStop(0.08, css(shade(tint, 0.4), 0.34))
  gradient.addColorStop(1, css(tint, 0))
  context.fillStyle = gradient
  context.fillRect(0, 0, width, height)

  context.fillStyle = css(shade(tint, 0.7), 0.3)
  context.fillRect(width * 0.46, height * 0.3, width * 0.08, height * 0.7)

  return toTexture(context, true)
}

/**
 * What kind of sky a battlefield fights under, and how the world beyond its
 * wall is furnished. Kept as data so a sixth terrain gets a mood by adding a
 * row, not a renderer.
 */
interface Mood {
  /** Multiplies FOG_DENSITY. Above 1 closes the weather in. */
  fogScale: number
  /** Multiplies the two light intensities. The city fights at dusk. */
  lightScale: number
  celestial: 'sun' | 'paleSun' | 'moon' | 'none'
  stars: boolean
}

function moodFor(id: TerrainId): Mood {
  switch (id) {
    case 'forest':
      return { fogScale: 1.15, lightScale: 1, celestial: 'none', stars: false }
    case 'desert':
      return { fogScale: 0.9, lightScale: 1.06, celestial: 'sun', stars: false }
    case 'city':
      // The last capital falls at dusk. Dimmer light, a moon, the first stars —
      // and the fog pulled in a touch so the ruined skyline swims out of it.
      return { fogScale: 1.1, lightScale: 0.82, celestial: 'moon', stars: true }
    case 'snow':
      return { fogScale: 1, lightScale: 1.02, celestial: 'paleSun', stars: false }
    case 'coast':
    default:
      return { fogScale: 0.95, lightScale: 1, celestial: 'sun', stars: false }
  }
}

/**
 * The dome. Sphere UVs run v=0 at the bottom pole to v=1 at the top, and
 * `flipY` puts canvas row 0 at v=1 — so the sky is painted at the top of the
 * image and the horizon at the middle, where the fogged floor meets it.
 *
 * The celestial bodies are painted straight into this texture rather than hung
 * as meshes: a sun that is part of the sky can never poke through a mesa, and
 * it costs zero extra draw calls. The texture is wide enough that the disc
 * lands at one azimuth instead of smearing around the dome.
 */
function skyTexture(horizon: RGB, high: RGB, mood: Mood): Texture {
  const width = 256
  const height = 256
  const context = surface(width, height)

  const gradient = context.createLinearGradient(0, 0, 0, height)
  gradient.addColorStop(0, css(high))
  gradient.addColorStop(0.34, css(mix(high, horizon, 0.55)))
  gradient.addColorStop(0.5, css(horizon))
  gradient.addColorStop(1, css(horizon))
  context.fillStyle = gradient
  context.fillRect(0, 0, width, height)

  if (mood.stars) {
    const random = seededRandom('stars')
    for (let i = 0; i < 46; i += 1) {
      const x = random() * width
      const y = random() * height * 0.34
      context.fillStyle = css([255, 255, 255], 0.25 + random() * 0.55)
      context.fillRect(x, y, 1.5, 1.5)
    }
  }

  if (mood.celestial !== 'none') {
    // Roughly matching the directional light's azimuth, so the brightest patch
    // of sky and the direction shadows would fall agree with each other.
    const x = width * 0.66
    const y = height * (mood.celestial === 'moon' ? 0.22 : 0.3)
    const radius = mood.celestial === 'moon' ? 9 : mood.celestial === 'paleSun' ? 8 : 11

    const glow = context.createRadialGradient(x, y, 0, x, y, radius * 3.4)
    const core: RGB =
      mood.celestial === 'moon'
        ? [232, 238, 252]
        : mood.celestial === 'paleSun'
          ? [255, 252, 240]
          : [255, 236, 180]
    glow.addColorStop(0, css(core, mood.celestial === 'sun' ? 0.95 : 0.85))
    glow.addColorStop(0.28, css(core, 0.5))
    glow.addColorStop(1, css(core, 0))
    context.fillStyle = glow
    context.fillRect(x - radius * 4, y - radius * 4, radius * 8, radius * 8)

    context.fillStyle = css(core, mood.celestial === 'moon' ? 0.9 : 1)
    context.beginPath()
    context.arc(x, y, radius, 0, Math.PI * 2)
    context.fill()

    if (mood.celestial === 'moon') {
      // One bite of shadow makes it a moon instead of a pale sun.
      context.fillStyle = css(mix(horizon, [20, 24, 48], 0.7), 0.55)
      context.beginPath()
      context.arc(x - radius * 0.42, y - radius * 0.2, radius * 0.8, 0, Math.PI * 2)
      context.fill()
    }
  }

  return toTexture(context, false)
}

/** Crossed blades of grass with a transparent background, for the tuft quads. */
function tuftTexture(base: RGB): Texture {
  const size = 64
  const context = surface(size, size)
  const random = seededRandom('tuft')

  context.strokeStyle = css(shade(base, -0.05))
  context.lineWidth = 3
  for (let i = 0; i < 9; i += 1) {
    const rootX = size * (0.25 + random() * 0.5)
    const tipX = rootX + (random() - 0.5) * size * 0.5
    context.strokeStyle = css(shade(base, -0.15 + random() * 0.35), 0.9)
    context.beginPath()
    context.moveTo(rootX, size)
    context.quadraticCurveTo(rootX, size * 0.5, tipX, size * (0.05 + random() * 0.25))
    context.stroke()
  }

  return toTexture(context, false)
}

/* ------------------------------------------------------------------ *
 *  Terrain dressing
 * ------------------------------------------------------------------ */

/**
 * How each battlefield dresses the abstract blocks and cylinders the simulation
 * hands over. The collision numbers are identical in all five; only the paint
 * and the thing sitting on top change.
 */
interface CoverStyle {
  /** Main mass of every piece. */
  body: RGB
  /** A little self-lit colour, so wet rock and snow do not go flat in shadow. */
  sheen: RGB
  sheenStrength: number
  /** Ratio of a cylinder's top radius to its bottom. Below 1 tapers it. */
  taper: number
  cap: 'none' | 'canopy' | 'snow'
  capColor: RGB
}

function coverStyleFor(id: TerrainId, light: RGB, dark: RGB): CoverStyle {
  const grey: RGB = [136, 138, 152]

  switch (id) {
    case 'forest':
      // Trunks read as bark, not as green pillars, or the forest turns to soup.
      return {
        body: mix(shade(dark, -0.35), [92, 62, 40], 0.62),
        sheen: [40, 26, 16],
        sheenStrength: 0.12,
        taper: 0.74,
        cap: 'canopy',
        capColor: shade(light, -0.1),
      }
    case 'desert':
      return {
        body: mix(shade(light, 0.24), [222, 196, 148], 0.5),
        sheen: shade(light, 0.4),
        sheenStrength: 0.1,
        taper: 0.86,
        cap: 'none',
        capColor: light,
      }
    case 'city':
      // Concrete is deliberately pulled most of the way to grey: ruins that took
      // the terrain's blue would stop reading as broken buildings.
      return {
        body: mix(mix(light, dark, 0.4), grey, 0.68),
        sheen: [0, 0, 0],
        sheenStrength: 0,
        taper: 0.97,
        cap: 'none',
        capColor: grey,
      }
    case 'snow':
      return {
        body: mix(shade(dark, -0.25), grey, 0.34),
        sheen: shade(light, 0.3),
        sheenStrength: 0.14,
        taper: 0.9,
        cap: 'snow',
        capColor: [246, 250, 255],
      }
    case 'coast':
    default:
      // Wet rock: dark, with just enough self-lit blue to look like it is
      // holding water rather than sitting in the dark.
      return {
        body: shade(dark, -0.42),
        sheen: mix(light, [255, 255, 255], 0.2),
        sheenStrength: 0.2,
        taper: 0.92,
        cap: 'none',
        capColor: light,
      }
  }
}

/* ------------------------------------------------------------------ *
 *  The scratch pad
 * ------------------------------------------------------------------ */

const UP = new Vector3(0, 1, 0)
/* Reused by every build loop and by every camera probe. Nothing here escapes. */
const buildPosition = new Vector3()
const buildScale = new Vector3()
const buildRotation = new Quaternion()
const buildMatrix = new Matrix4()
const probePoint = new Vector3()

/** Composes one instance matrix from the scratch pad. */
function place(
  mesh: InstancedMesh,
  index: number,
  x: number,
  y: number,
  z: number,
  yaw: number,
  scaleX: number,
  scaleY: number,
  scaleZ: number,
): void {
  buildPosition.set(x, y, z)
  buildRotation.setFromAxisAngle(UP, yaw)
  buildScale.set(scaleX, scaleY, scaleZ)
  mesh.setMatrixAt(index, buildMatrix.compose(buildPosition, buildRotation, buildScale))
}

/** Finishes an InstancedMesh whose instances are scattered across the world. */
function finish(mesh: InstancedMesh): void {
  mesh.instanceMatrix.needsUpdate = true
  // Without this the mesh keeps the single-instance bounds it was born with and
  // gets frustum-culled the moment the origin leaves the screen.
  mesh.computeBoundingSphere()
}

/* ------------------------------------------------------------------ *
 *  The world beyond the wall
 * ------------------------------------------------------------------ */

/**
 * A ring of silhouettes outside the arena, one shape per terrain.
 *
 * This is the single cheapest thing in the whole overhaul and the one that
 * kills the "fighting in a box" feeling: every sightline that crosses the
 * boundary now lands on something — a treeline, a mesa, a drowned skyline —
 * already half-eaten by the fog.
 */
function buildHorizon(
  group: Group,
  id: TerrainId,
  light: RGB,
  dark: RGB,
  random: () => number,
): void {
  if (id === 'forest') {
    // Two depths of treeline. The far ring is darker and taller, so the forest
    // appears to continue rather than to be a fence of identical cones.
    const trees = new InstancedMesh(
      new ConeGeometry(1, 1, 7).translate(0, 0.5, 0),
      new MeshLambertMaterial({ color: colorOf(mix(shade(dark, -0.2), [16, 40, 26], 0.5)) }),
      64,
    )
    for (let i = 0; i < 64; i += 1) {
      const far = i >= 36
      const angle = (i / (far ? 28 : 36)) * Math.PI * 2 + random() * 0.2
      const radius = far ? HORIZON_NEAR + 12 + random() * 10 : HORIZON_NEAR + random() * 6
      const height = far ? 9 + random() * 5 : 6 + random() * 3
      place(
        trees,
        i,
        Math.cos(angle) * radius,
        0,
        Math.sin(angle) * radius,
        0,
        height * 0.42,
        height,
        height * 0.42,
      )
    }
    finish(trees)
    group.add(trees)
    return
  }

  if (id === 'desert') {
    // Mesas: huge flat-topped slabs, wind-carved. Deliberately few — an empty
    // horizon with three landmarks reads as distance, a crowded one as a wall.
    const mesas = new InstancedMesh(
      new BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      new MeshLambertMaterial({ color: colorOf(mix(shade(dark, 0.05), [188, 132, 86], 0.45)) }),
      7,
    )
    for (let i = 0; i < 7; i += 1) {
      const angle = (i / 7) * Math.PI * 2 + random() * 0.5
      const radius = HORIZON_NEAR + 18 + random() * (HORIZON_FAR - HORIZON_NEAR - 18)
      place(
        mesas,
        i,
        Math.cos(angle) * radius,
        0,
        Math.sin(angle) * radius,
        random() * Math.PI,
        12 + random() * 12,
        6 + random() * 9,
        8 + random() * 6,
      )
    }
    finish(mesas)
    group.add(mesas)
    return
  }

  if (id === 'city') {
    // The rest of the fallen capital. Near-black towers of jagged height
    // against the dusk, and a scatter of windows still burning in them — the
    // one warm note in the whole battlefield, and worth its single draw call.
    const towers = new InstancedMesh(
      new BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      new MeshLambertMaterial({ color: colorOf(mix(dark, [14, 14, 24], 0.72)) }),
      26,
    )
    const towerSpots: { x: number; z: number; height: number; width: number }[] = []
    for (let i = 0; i < 26; i += 1) {
      const angle = (i / 26) * Math.PI * 2 + random() * 0.18
      const radius = HORIZON_NEAR + 6 + random() * 22
      const height = 8 + random() * 15
      const width = 3.5 + random() * 4.5
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      place(towers, i, x, 0, z, random() * Math.PI, width, height, width)
      towerSpots.push({ x, z, height, width })
    }
    finish(towers)
    group.add(towers)

    const windows = new InstancedMesh(
      new PlaneGeometry(0.5, 0.7),
      new MeshBasicMaterial({ color: colorOf([255, 196, 110]), side: DoubleSide }),
      30,
    )
    for (let i = 0; i < 30; i += 1) {
      const tower = towerSpots[i % towerSpots.length]
      if (!tower) continue
      // On the arena-facing side of the tower, at a lit floor somewhere up it.
      const toward = Math.atan2(-tower.z, -tower.x)
      const face = tower.width * 0.52
      place(
        windows,
        i,
        tower.x + Math.cos(toward) * face,
        1.5 + random() * (tower.height - 3),
        tower.z + Math.sin(toward) * face,
        -toward + Math.PI / 2,
        1,
        1,
        1,
      )
    }
    finish(windows)
    group.add(windows)
    return
  }

  if (id === 'snow') {
    // Peaks. Big, white-lit cones far out; the fog does the aerial perspective.
    const peaks = new InstancedMesh(
      new ConeGeometry(1, 1, 6).translate(0, 0.5, 0),
      new MeshLambertMaterial({ color: colorOf(mix(shade(light, 0.3), [240, 246, 252], 0.55)) }),
      9,
    )
    for (let i = 0; i < 9; i += 1) {
      const angle = (i / 9) * Math.PI * 2 + random() * 0.4
      const radius = HORIZON_NEAR + 16 + random() * (HORIZON_FAR - HORIZON_NEAR - 12)
      const height = 16 + random() * 14
      place(
        peaks,
        i,
        Math.cos(angle) * radius,
        0,
        Math.sin(angle) * radius,
        random() * Math.PI,
        height * 0.75,
        height,
        height * 0.75,
      )
    }
    finish(peaks)
    group.add(peaks)
    return
  }

  // Coast: the arena becomes an island. A sea runs from the wall to the fog on
  // every side, with a lighthouse on a far rock and a few sails between — the
  // only battlefield whose horizon is mostly empty on purpose.
  const sea = new Mesh(
    new RingGeometry(ARENA_HALF + 0.6, CAMERA_FAR * 0.8, 40, 1).rotateX(-Math.PI / 2),
    new MeshLambertMaterial({ color: colorOf(mix(shade(dark, -0.1), [16, 76, 96], 0.55)) }),
  )
  // A hand's width below the arena floor: the boundary haze hides the step, and
  // the drop is what makes the ground read as a shore rather than a carpet edge.
  sea.position.y = -0.4
  group.add(sea)

  const rockAngle = 0.9
  const rockRadius = HORIZON_NEAR + 16
  const rock = new Mesh(
    new IcosahedronGeometry(3.2, 1),
    new MeshLambertMaterial({ color: colorOf(shade(dark, -0.45)) }),
  )
  rock.position.set(Math.cos(rockAngle) * rockRadius, -0.6, Math.sin(rockAngle) * rockRadius)
  group.add(rock)

  const lighthouse = new Group()
  const towerMaterial = new MeshLambertMaterial({ color: colorOf([236, 238, 240]) })
  const tower = new Mesh(new CylinderGeometry(0.55, 0.8, 6.4, 8).translate(0, 3.2, 0), towerMaterial)
  lighthouse.add(tower)
  const lampMaterial = new MeshBasicMaterial({ color: colorOf([255, 214, 130]) })
  const lamp = new Mesh(new CylinderGeometry(0.42, 0.42, 0.6, 8).translate(0, 6.6, 0), lampMaterial)
  lighthouse.add(lamp)
  const capMaterial = new MeshLambertMaterial({ color: colorOf([164, 40, 44]) })
  const cap = new Mesh(new ConeGeometry(0.62, 0.9, 8).translate(0, 7.3, 0), capMaterial)
  lighthouse.add(cap)
  lighthouse.position.copy(rock.position).y += 1.6
  group.add(lighthouse)

  const sails = new InstancedMesh(
    new ConeGeometry(0.5, 1, 3),
    new MeshLambertMaterial({ color: colorOf([238, 234, 224]), side: DoubleSide }),
    5,
  )
  for (let i = 0; i < 5; i += 1) {
    const angle = 2.4 + i * 0.75 + random() * 0.3
    const radius = HORIZON_NEAR + 10 + random() * 18
    const height = 1.6 + random() * 1.4
    place(
      sails,
      i,
      Math.cos(angle) * radius,
      height * 0.5 - 0.4,
      Math.sin(angle) * radius,
      random() * Math.PI,
      height * 0.5,
      height,
      height * 0.5,
    )
  }
  finish(sails)
  group.add(sails)
}

/**
 * Shafts of light through the forest canopy: three tall, faint, tilted quads.
 * Static, additive-feeling without additive blending (which would bloom over
 * the fog), and cheap enough to be a rounding error.
 */
function buildLightShafts(group: Group, light: RGB, random: () => number): void {
  const material = new MeshBasicMaterial({
    color: colorOf(shade(light, 0.5)),
    transparent: true,
    opacity: 0.07,
    side: DoubleSide,
    depthWrite: false,
    fog: false,
  })
  const geometry = new PlaneGeometry(1, 1)
  for (let i = 0; i < 3; i += 1) {
    const shaft = new Mesh(geometry, material)
    const angle = random() * Math.PI * 2
    const radius = 6 + random() * (ARENA_HALF - 10)
    shaft.position.set(Math.cos(angle) * radius, 7, Math.sin(angle) * radius)
    shaft.scale.set(2.2 + random() * 2, 14, 1)
    shaft.rotation.set(0.16, random() * Math.PI, 0.1)
    shaft.renderOrder = 2
    group.add(shaft)
  }
}

/* ------------------------------------------------------------------ *
 *  Ground scatter
 * ------------------------------------------------------------------ */

/**
 * The small stuff underfoot. All of it is far below knee height or pressed
 * against the boundary, so none of it needs collision — it is texture with
 * parallax, which is exactly what running past it turns it into.
 */
function buildScatter(
  group: Group,
  id: TerrainId,
  light: RGB,
  dark: RGB,
  random: () => number,
): void {
  /** A seeded spot inside the arena, outside the drop-in clearing. */
  const spot = (): { x: number; z: number } => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const x = (random() * 2 - 1) * (ARENA_HALF - 1.6)
      const z = (random() * 2 - 1) * (ARENA_HALF - 1.6)
      if (Math.hypot(x, z) > SCATTER_CLEARING) return { x, z }
    }
    return { x: ARENA_HALF - 3, z: ARENA_HALF - 3 }
  }

  const scatterInstanced = (
    geometry: BufferGeometry,
    material: Material,
    count: number,
    build: (mesh: InstancedMesh, index: number, at: { x: number; z: number }) => void,
  ): void => {
    const mesh = new InstancedMesh(geometry, material, count)
    for (let i = 0; i < count; i += 1) build(mesh, i, spot())
    finish(mesh)
    group.add(mesh)
  }

  if (id === 'forest') {
    // Tufts: two crossed quads per clump would double the count, so each tuft
    // is one quad given a random yaw — from any angle most read edge-on-ish,
    // and at this size nobody can tell.
    const tuft = tuftTexture(mix(light, [70, 120, 60], 0.5))
    scatterInstanced(
      new PlaneGeometry(1, 1).translate(0, 0.5, 0),
      new MeshLambertMaterial({ map: tuft, transparent: true, side: DoubleSide, depthWrite: false }),
      70,
      (mesh, i, at) => {
        const size = 0.5 + random() * 0.5
        place(mesh, i, at.x, 0, at.z, random() * Math.PI, size, size * 0.9, 1)
      },
    )
    return
  }

  if (id === 'desert') {
    scatterInstanced(
      new IcosahedronGeometry(1, 0),
      new MeshLambertMaterial({ color: colorOf(mix(shade(light, 0.05), [196, 168, 130], 0.5)) }),
      44,
      (mesh, i, at) => {
        const size = 0.12 + random() * 0.3
        place(mesh, i, at.x, size * 0.3, at.z, random() * Math.PI, size, size * 0.7, size)
      },
    )
    return
  }

  if (id === 'city') {
    // Debris chunks, and pale scraps of paper lying flat — the one thing that
    // says "people lived here" without a single texture.
    scatterInstanced(
      new BoxGeometry(1, 1, 1),
      new MeshLambertMaterial({ color: colorOf(mix(dark, [120, 120, 132], 0.6)) }),
      36,
      (mesh, i, at) => {
        const size = 0.2 + random() * 0.4
        place(mesh, i, at.x, size * 0.32, at.z, random() * Math.PI, size, size * 0.6, size)
      },
    )
    scatterInstanced(
      new PlaneGeometry(0.42, 0.56).rotateX(-Math.PI / 2),
      new MeshLambertMaterial({ color: colorOf([206, 200, 186]) }),
      22,
      (mesh, i, at) => {
        place(mesh, i, at.x, 0.02, at.z, random() * Math.PI, 1, 1, 1)
      },
    )
    return
  }

  if (id === 'snow') {
    scatterInstanced(
      new SphereGeometry(1, 8, 6),
      new MeshLambertMaterial({ color: colorOf([240, 246, 253]) }),
      30,
      (mesh, i, at) => {
        const size = 0.5 + random() * 0.9
        place(mesh, i, at.x, -size * 0.66, at.z, random() * Math.PI, size, size * 0.5, size)
      },
    )
    return
  }

  // Coast: reeds in clumps near the walls, shells anywhere.
  scatterInstanced(
    new ConeGeometry(0.03, 1, 4).translate(0, 0.5, 0),
    new MeshLambertMaterial({ color: colorOf(mix(dark, [96, 130, 84], 0.55)), side: DoubleSide }),
    60,
    (mesh, i, at) => {
      // Pulled toward the boundary: reeds grow at the water, not mid-beach.
      const pull = 0.62 + random() * 0.36
      const x = at.x * pull + Math.sign(at.x) * (1 - pull) * (ARENA_HALF - 2)
      const z = at.z * pull + Math.sign(at.z) * (1 - pull) * (ARENA_HALF - 2)
      const height = 0.7 + random() * 0.8
      place(mesh, i, x, 0, z, random() * Math.PI, 1, height, 1)
    },
  )
  scatterInstanced(
    new SphereGeometry(1, 6, 4),
    new MeshLambertMaterial({ color: colorOf([226, 214, 196]) }),
    18,
    (mesh, i, at) => {
      const size = 0.08 + random() * 0.1
      place(mesh, i, at.x, size * 0.4, at.z, random() * Math.PI, size, size * 0.5, size)
    },
  )
}

/* ------------------------------------------------------------------ *
 *  The terrain
 * ------------------------------------------------------------------ */

export interface ArenaTerrain {
  /** Every mesh and light. The scene adds this once and forgets about it. */
  readonly group: Group
  /** Fog and sky share this. The renderer clears to it so the horizon matches. */
  readonly horizon: Color
  readonly fog: FogExp2
  /**
   * Raises the cover. Called exactly once per fight, from the first frame that
   * carries a cover list — see the note in `ArenaScene`.
   */
  buildCover(cover: readonly CoverView[]): void
  /**
   * How far along `from` -> `to` a sphere of `radius` can travel before it is
   * inside cover or outside the arena wall, as a fraction in 0..1.
   *
   * This is the whole of the camera's collision. It is a march rather than a
   * raycast because a ray would happily thread the gap between two trees that a
   * camera with a real radius cannot fit through.
   */
  clearFraction(from: Vector3, to: Vector3, radius: number): number
}

export function createArenaTerrain(terrain: Terrain): ArenaTerrain {
  const light = parseColor(terrain.colors[0])
  const dark = parseColor(terrain.colors[1])
  const mood = moodFor(terrain.id)
  const random = seededRandom(terrain.id)

  // The horizon is the terrain's dark stop lifted toward its light one: fog
  // that matched the dark stop exactly would read as night in every battlefield.
  const horizonRgb = mix(dark, light, 0.34)
  const horizon = colorOf(horizonRgb)
  const fog = new FogExp2(horizon, FOG_DENSITY * mood.fogScale)

  const group = new Group()

  /* --- Light ------------------------------------------------------ */

  // Sky colour above, bounced ground colour below. This does most of the work:
  // with no shadow maps the hemisphere is what keeps unlit sides from going
  // black, and it costs a single extra term in the shader.
  const hemisphere = new HemisphereLight(
    colorOf(shade(light, 0.42)),
    colorOf(shade(dark, -0.25)),
    HEMISPHERE_INTENSITY * mood.lightScale,
  )
  group.add(hemisphere)

  const sun = new DirectionalLight(colorOf(shade(light, 0.55)), SUN_INTENSITY * mood.lightScale)
  // High and off to one side, so vertical faces of cover separate from the
  // floor. Shadow casting stays off deliberately; see the file header.
  sun.position.set(ARENA_HALF * 0.6, ARENA_HALF * 1.4, ARENA_HALF * 0.4)
  group.add(sun)

  /* --- Sky -------------------------------------------------------- */

  const sky = new Mesh(
    new SphereGeometry(CAMERA_FAR * 0.86, 20, 14),
    new MeshBasicMaterial({
      map: skyTexture(horizonRgb, shade(light, 0.3), mood),
      side: BackSide,
      depthWrite: false,
      // Fogging the dome would flatten it to one colour and undo the gradient
      // that makes the fogged floor blend into it.
      fog: false,
    }),
  )
  sky.renderOrder = -1
  group.add(sky)

  /* --- Floor ------------------------------------------------------ */

  // The plain that runs out to the fog. Flat colour: it is never close enough
  // for a texture to be visible, and one fewer sampled material is one less
  // thing for a phone to do per pixel.
  const plain = new Mesh(
    new PlaneGeometry(GROUND_SPAN, GROUND_SPAN).rotateX(-Math.PI / 2),
    new MeshLambertMaterial({ color: colorOf(shade(dark, -0.2)) }),
  )
  // Below the arena floor rather than coplanar with it, so no z-fighting seam
  // crawls across the boundary on a phone's low-precision depth buffer.
  plain.position.y = -0.05
  group.add(plain)

  const floorMap = floorTexture(mix(dark, light, 0.22), terrain.id)
  floorMap.repeat.set((ARENA_HALF * 2) / FLOOR_TILE, (ARENA_HALF * 2) / FLOOR_TILE)
  // Distant tiles alias badly at a grazing angle; the anisotropy is what stops
  // the far half of the arena shimmering as the player turns.
  floorMap.anisotropy = 4
  const floor = new Mesh(
    new PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2).rotateX(-Math.PI / 2),
    new MeshLambertMaterial({ map: floorMap }),
  )
  group.add(floor)

  /* --- Boundary --------------------------------------------------- */

  const boundaryMap = boundaryTexture(shade(light, 0.3))
  boundaryMap.repeat.set((ARENA_HALF * 2) / FLOOR_TILE, 1)
  const boundary = new InstancedMesh(
    new PlaneGeometry(1, 1),
    new MeshBasicMaterial({
      map: boundaryMap,
      transparent: true,
      depthWrite: false,
      // Both faces, because the camera is allowed to press right up against a
      // wall and would otherwise see straight through it from the inside.
      side: DoubleSide,
    }),
    4,
  )
  boundary.renderOrder = 1

  // Four walls, each rotated so its front faces the middle of the arena.
  const walls: readonly { x: number; z: number; yaw: number }[] = [
    { x: 0, z: -ARENA_HALF, yaw: 0 },
    { x: 0, z: ARENA_HALF, yaw: Math.PI },
    { x: ARENA_HALF, z: 0, yaw: -Math.PI / 2 },
    { x: -ARENA_HALF, z: 0, yaw: Math.PI / 2 },
  ]
  for (let i = 0; i < walls.length; i += 1) {
    const wall = walls[i]
    if (!wall) continue
    place(boundary, i, wall.x, BOUNDARY_HEIGHT / 2, wall.z, wall.yaw, ARENA_HALF * 2, BOUNDARY_HEIGHT, 1)
  }
  finish(boundary)
  group.add(boundary)

  /* --- The world beyond, and the small stuff within --------------- */

  buildHorizon(group, terrain.id, light, dark, random)
  buildScatter(group, terrain.id, light, dark, random)
  if (terrain.id === 'forest') buildLightShafts(group, light, random)

  /* --- Cover ------------------------------------------------------ */

  const style = coverStyleFor(terrain.id, light, dark)

  /*
   * Cover is stored as flat typed arrays rather than objects because the camera
   * probe walks the whole list up to sixteen times a frame, and a phone's GC is
   * the last thing a shooter wants to wake up.
   */
  let coverCount = 0
  let coverX = new Float32Array(0)
  let coverZ = new Float32Array(0)
  let coverHalfX = new Float32Array(0)
  let coverHalfZ = new Float32Array(0)
  let coverTop = new Float32Array(0)
  let coverSin = new Float32Array(0)
  let coverCos = new Float32Array(0)
  let coverRound = new Uint8Array(0)

  let built = false

  function coverMaterial(): MeshLambertMaterial {
    const material = new MeshLambertMaterial({ color: colorOf(style.body) })
    if (style.sheenStrength > 0) {
      material.emissive = colorOf(style.sheen)
      material.emissiveIntensity = style.sheenStrength
    }
    return material
  }

  /**
   * Whether this piece gets something on top of it.
   *
   * Canopies only crown round pieces tall enough to walk under — a fallen log
   * does not sprout one, and a waist-high stump wearing one would hide the very
   * enemy the player is trying to shoot over it. Snow caps everything.
   */
  function cappable(piece: CoverView): boolean {
    if (style.cap === 'none') return false
    if (style.cap === 'canopy') return piece.shape === 'cylinder' && piece.height >= 2
    return true
  }

  /** The shape a cap takes over a round or square piece, or null for neither. */
  function capGeometry(round: boolean): BufferGeometry | null {
    if (style.cap === 'canopy') return round ? new IcosahedronGeometry(1, 1) : null
    if (style.cap === 'snow') return round ? new CylinderGeometry(1, 1, 1, 10) : new BoxGeometry(1, 1, 1)
    return null
  }

  /**
   * The terrain-specific extras that need to know where the cover stands:
   * root flares under trunks, the jagged broken tops on city walls, and snow
   * drifted against the windward side of every boulder. All instanced, all
   * derived from each piece's own id so a rematch looks identical.
   */
  function dressCover(cover: readonly CoverView[]): void {
    if (terrain.id === 'forest') {
      const trunks = cover.filter((piece) => piece.shape === 'cylinder' && piece.height >= 2)
      if (trunks.length === 0) return
      const flares = new InstancedMesh(
        new CylinderGeometry(0.62, 1, 1, 7).translate(0, 0.5, 0),
        coverMaterial(),
        trunks.length,
      )
      for (let i = 0; i < trunks.length; i += 1) {
        const piece = trunks[i]
        if (!piece) continue
        // The flare is what plants the trunk: without it every tree meets the
        // ground at a perfect circle and reads as a peg in a hole.
        place(flares, i, piece.x, 0, piece.z, piece.id * 1.3, piece.halfX * 1.8, 0.55, piece.halfZ * 1.8)
      }
      finish(flares)
      group.add(flares)
      return
    }

    if (terrain.id === 'city') {
      const walls_ = cover.filter((piece) => piece.shape === 'box' && piece.height >= 2)
      if (walls_.length === 0) return
      // Three shards along the top of each tall wall, of uneven height, so no
      // ruin ends in the dead-straight line that screams "box". They hug the
      // wall's own top edge and footprint, so collision stays honest.
      const shards = new InstancedMesh(
        new BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
        coverMaterial(),
        walls_.length * 3,
      )
      let at = 0
      for (const piece of walls_) {
        const pieceRandom = seededRandom(`${terrain.id}:${piece.id}`)
        const cos = Math.cos(piece.rotation)
        const sin = Math.sin(piece.rotation)
        for (let s = 0; s < 3; s += 1) {
          const along = (s / 2 - 0.5) * piece.halfX * 1.5
          place(
            shards,
            at++,
            piece.x + along * cos,
            piece.height - 0.1,
            piece.z - along * sin,
            piece.rotation + (pieceRandom() - 0.5) * 0.3,
            piece.halfX * (0.4 + pieceRandom() * 0.3),
            0.4 + pieceRandom() * 1.1,
            piece.halfZ * 1.9,
          )
        }
      }
      finish(shards)
      group.add(shards)
      return
    }

    if (terrain.id === 'snow') {
      if (cover.length === 0) return
      const drifts = new InstancedMesh(
        new SphereGeometry(1, 8, 6),
        new MeshLambertMaterial({ color: colorOf([240, 246, 253]) }),
        cover.length,
      )
      for (let i = 0; i < cover.length; i += 1) {
        const piece = cover[i]
        if (!piece) continue
        // Drifted against the same side of everything, because wind has one
        // direction; sized to the piece so boulders get banks and rubble a dust.
        const reach = Math.max(piece.halfX, piece.halfZ)
        place(
          drifts,
          i,
          piece.x + reach * 0.75,
          -reach * 0.28,
          piece.z + reach * 0.55,
          piece.id * 0.9,
          reach * 1.15,
          reach * 0.62,
          reach * 1.15,
        )
      }
      finish(drifts)
      group.add(drifts)
    }
  }

  function buildCover(cover: readonly CoverView[]): void {
    if (built) return
    built = true

    coverCount = cover.length
    if (coverCount === 0) return

    coverX = new Float32Array(coverCount)
    coverZ = new Float32Array(coverCount)
    coverHalfX = new Float32Array(coverCount)
    coverHalfZ = new Float32Array(coverCount)
    coverTop = new Float32Array(coverCount)
    coverSin = new Float32Array(coverCount)
    coverCos = new Float32Array(coverCount)
    coverRound = new Uint8Array(coverCount)

    let rounds = 0
    for (let i = 0; i < coverCount; i += 1) {
      const piece = cover[i]
      if (!piece) continue
      coverX[i] = piece.x
      coverZ[i] = piece.z
      coverHalfX[i] = piece.halfX
      coverHalfZ[i] = piece.halfZ
      coverTop[i] = piece.height
      coverSin[i] = Math.sin(piece.rotation)
      coverCos[i] = Math.cos(piece.rotation)
      const round = piece.shape === 'cylinder'
      coverRound[i] = round ? 1 : 0
      if (round) rounds += 1
    }
    const blocks = coverCount - rounds

    // One material for every piece of cover in the arena: thirty forest trunks
    // are thirty instances of one draw call, which is the difference between a
    // phone holding 60fps in the forest and not.
    const material = coverMaterial()

    let cylinders: InstancedMesh | null = null
    let boxes: InstancedMesh | null = null
    if (rounds > 0) {
      cylinders = new InstancedMesh(
        new CylinderGeometry(style.taper, 1, 1, 10).translate(0, 0.5, 0),
        material,
        rounds,
      )
      group.add(cylinders)
    }
    if (blocks > 0) {
      boxes = new InstancedMesh(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), material, blocks)
      group.add(boxes)
    }

    let roundCaps = 0
    let blockCaps = 0
    for (const piece of cover) {
      if (!cappable(piece)) continue
      if (piece.shape === 'cylinder') roundCaps += 1
      else blockCaps += 1
    }

    const capMaterial =
      roundCaps + blockCaps === 0 ? null : new MeshLambertMaterial({ color: colorOf(style.capColor) })

    let roundCapMesh: InstancedMesh | null = null
    let blockCapMesh: InstancedMesh | null = null
    if (capMaterial && roundCaps > 0) {
      const geometry = capGeometry(true)
      if (geometry) {
        roundCapMesh = new InstancedMesh(geometry, capMaterial, roundCaps)
        group.add(roundCapMesh)
      }
    }
    if (capMaterial && blockCaps > 0) {
      const geometry = capGeometry(false)
      if (geometry) {
        blockCapMesh = new InstancedMesh(geometry, capMaterial, blockCaps)
        group.add(blockCapMesh)
      }
    }

    let roundAt = 0
    let blockAt = 0
    let roundCapAt = 0
    let blockCapAt = 0

    for (const piece of cover) {
      const round = piece.shape === 'cylinder'
      buildPosition.set(piece.x, 0, piece.z)
      buildRotation.setFromAxisAngle(UP, round ? 0 : piece.rotation)
      // Both geometries were translated up by half a unit at build time, so the
      // instance scale is simply the piece's real size and its origin sits on
      // the floor — no per-instance half-height arithmetic in this loop.
      buildScale.set(
        round ? piece.halfX : piece.halfX * 2,
        piece.height,
        round ? piece.halfZ : piece.halfZ * 2,
      )
      buildMatrix.compose(buildPosition, buildRotation, buildScale)

      if (round && cylinders) cylinders.setMatrixAt(roundAt++, buildMatrix)
      else if (!round && boxes) boxes.setMatrixAt(blockAt++, buildMatrix)

      if (!cappable(piece)) continue

      if (style.cap === 'canopy') {
        // Wide enough to be a tree rather than a lollipop, and lifted so its
        // underside clears head height and never hides an enemy. The yaw comes
        // off the piece's own id so neighbouring canopies do not read as clones.
        const spread = Math.min(2.4, Math.max(1.2, piece.halfX * 3.4))
        buildPosition.set(piece.x, piece.height + spread * 0.28, piece.z)
        buildRotation.setFromAxisAngle(UP, piece.id * 0.7)
        buildScale.set(spread, spread * 0.78, spread)
        buildMatrix.compose(buildPosition, buildRotation, buildScale)
        if (roundCapMesh) roundCapMesh.setMatrixAt(roundCapAt++, buildMatrix)
        continue
      }

      // Snow: a thin slab sitting slightly proud of the rock it caps, so the
      // silhouette gets a bright edge instead of a colour change.
      const capHeight = Math.min(0.34, piece.height * 0.16)
      buildPosition.set(piece.x, piece.height - capHeight * 0.35, piece.z)
      buildRotation.setFromAxisAngle(UP, round ? 0 : piece.rotation)
      buildScale.set(
        (round ? piece.halfX : piece.halfX * 2) * 1.07,
        capHeight,
        (round ? piece.halfZ : piece.halfZ * 2) * 1.07,
      )
      buildMatrix.compose(buildPosition, buildRotation, buildScale)
      if (round && roundCapMesh) roundCapMesh.setMatrixAt(roundCapAt++, buildMatrix)
      else if (!round && blockCapMesh) blockCapMesh.setMatrixAt(blockCapAt++, buildMatrix)
    }

    for (const mesh of [cylinders, boxes, roundCapMesh, blockCapMesh]) {
      if (!mesh) continue
      mesh.instanceMatrix.needsUpdate = true
      // Instances are scattered across the arena; without this the mesh keeps
      // the single-instance bounds it was born with and gets frustum-culled the
      // moment the origin leaves the screen.
      mesh.computeBoundingSphere()
    }

    dressCover(cover)
  }

  /* --- Queries ---------------------------------------------------- */

  /** True when a sphere at this point overlaps cover, or has left the arena. */
  function blocked(x: number, y: number, z: number, radius: number): boolean {
    if (
      x > ARENA_HALF - radius ||
      x < -ARENA_HALF + radius ||
      z > ARENA_HALF - radius ||
      z < -ARENA_HALF + radius
    ) {
      return true
    }

    for (let i = 0; i < coverCount; i += 1) {
      const top = coverTop[i]
      // Clearing the top of a piece is the common case in a city fight, and
      // testing it first is what keeps this loop cheap.
      if (top === undefined || y > top + radius) continue

      const dx = x - (coverX[i] ?? 0)
      const dz = z - (coverZ[i] ?? 0)
      const halfX = coverHalfX[i] ?? 0
      const halfZ = coverHalfZ[i] ?? 0

      if (coverRound[i] === 1) {
        const reach = halfX + radius
        if (dx * dx + dz * dz < reach * reach) return true
        continue
      }

      // Into the box's own frame, where the overlap test is two comparisons.
      const cos = coverCos[i] ?? 1
      const sin = coverSin[i] ?? 0
      const localX = dx * cos - dz * sin
      const localZ = dx * sin + dz * cos
      if (Math.abs(localX) < halfX + radius && Math.abs(localZ) < halfZ + radius) return true
    }

    return false
  }

  function clearFraction(from: Vector3, to: Vector3, radius: number): number {
    for (let step = 1; step <= PROBE_STEPS; step += 1) {
      const t = step / PROBE_STEPS
      probePoint.lerpVectors(from, to, t)
      if (blocked(probePoint.x, probePoint.y, probePoint.z, radius)) {
        return (step - 1) / PROBE_STEPS
      }
    }
    return 1
  }

  return { group, horizon, fog, buildCover, clearFraction }
}
