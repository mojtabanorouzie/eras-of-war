import {
  BackSide,
  BoxGeometry,
  CanvasTexture,
  ClampToEdgeWrapping,
  Color,
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
  SRGBColorSpace,
  SphereGeometry,
  Vector3,
} from 'three'
import type { BufferGeometry, Texture } from 'three'
import { ARENA_HALF, CAMERA_FAR } from '../../game/arena/world'
import type { Terrain, TerrainId } from '../../game/types'
import { css, mix, parseColor, shade } from '../palette'
import type { RGB } from '../palette'
import type { CoverView } from './view'

/**
 * The ground the fight happens on: the floor, the air above it, the light
 * falling on it, and every piece of cover standing in it.
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
 * horizon instead of a cliff.
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
 * seam at its edges and a scatter of grit — subtle enough not to look like
 * graph paper, strong enough that motion is legible.
 */
function floorTexture(base: RGB, seed: string): Texture {
  const size = 256
  const context = surface(size, size)
  const random = seededRandom(seed)

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
 * The dome. Sphere UVs run v=0 at the bottom pole to v=1 at the top, and
 * `flipY` puts canvas row 0 at v=1 — so the sky is painted at the top of the
 * image and the horizon at the middle, where the fogged floor meets it.
 */
function skyTexture(horizon: RGB, high: RGB): Texture {
  const height = 256
  const context = surface(4, height)

  const gradient = context.createLinearGradient(0, 0, 0, height)
  gradient.addColorStop(0, css(high))
  gradient.addColorStop(0.34, css(mix(high, horizon, 0.55)))
  gradient.addColorStop(0.5, css(horizon))
  gradient.addColorStop(1, css(horizon))
  context.fillStyle = gradient
  context.fillRect(0, 0, 4, height)

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
/* Reused by the cover build and by every camera probe. Nothing here escapes. */
const buildPosition = new Vector3()
const buildScale = new Vector3()
const buildRotation = new Quaternion()
const buildMatrix = new Matrix4()
const probePoint = new Vector3()

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

  // The horizon is the terrain's dark stop lifted toward its light one: fog
  // that matched the dark stop exactly would read as night in every battlefield.
  const horizonRgb = mix(dark, light, 0.34)
  const horizon = colorOf(horizonRgb)
  const fog = new FogExp2(horizon, FOG_DENSITY)

  const group = new Group()

  /* --- Light ------------------------------------------------------ */

  // Sky colour above, bounced ground colour below. This does most of the work:
  // with no shadow maps the hemisphere is what keeps unlit sides from going
  // black, and it costs a single extra term in the shader.
  const hemisphere = new HemisphereLight(
    colorOf(shade(light, 0.42)),
    colorOf(shade(dark, -0.25)),
    HEMISPHERE_INTENSITY,
  )
  group.add(hemisphere)

  const sun = new DirectionalLight(colorOf(shade(light, 0.55)), SUN_INTENSITY)
  // High and off to one side, so vertical faces of cover separate from the
  // floor. Shadow casting stays off deliberately; see the file header.
  sun.position.set(ARENA_HALF * 0.6, ARENA_HALF * 1.4, ARENA_HALF * 0.4)
  group.add(sun)

  /* --- Sky -------------------------------------------------------- */

  const sky = new Mesh(
    new SphereGeometry(CAMERA_FAR * 0.86, 20, 14),
    new MeshBasicMaterial({
      map: skyTexture(horizonRgb, shade(light, 0.3)),
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
  buildScale.set(ARENA_HALF * 2, BOUNDARY_HEIGHT, 1)
  for (let i = 0; i < walls.length; i += 1) {
    const wall = walls[i]
    if (!wall) continue
    buildPosition.set(wall.x, BOUNDARY_HEIGHT / 2, wall.z)
    buildRotation.setFromAxisAngle(UP, wall.yaw)
    boundary.setMatrixAt(i, buildMatrix.compose(buildPosition, buildRotation, buildScale))
  }
  boundary.instanceMatrix.needsUpdate = true
  boundary.computeBoundingSphere()
  group.add(boundary)

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
