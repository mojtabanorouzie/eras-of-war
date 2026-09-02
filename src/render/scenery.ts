import { Mesh, MeshBasicMaterial } from 'three'
import type { BufferGeometry, Texture } from 'three'
import { mix, parseColor, shade } from './palette'
import { groundTexture, ridgeTexture } from './textures'
import type { SceneryStyle } from './textures'
import { LAYER_Z, RENDER_ORDER } from './world'

/**
 * The three parallax bands behind the armies: a far ridge, a nearer ridge and
 * the ground they stand on.
 *
 * Each band is one quad spanning the world, wearing a horizontally repeating
 * texture. Parallax is the texture offset drifting at a different rate per
 * band — no mesh moves, so a wider frame costs nothing extra.
 */

/** Which horizon each battlefield gets, keyed by terrain id. */
const STYLES: Record<string, SceneryStyle> = {
  forest: 'trees',
  desert: 'dunes',
  city: 'ruins',
  snow: 'peaks',
  coast: 'waves',
}

interface Band {
  mesh: Mesh
  texture: Texture
  /** World y of the band's top edge; it fills from there to the bottom. */
  topY: number
  /** World units covered by one repeat of the texture. */
  tileWidth: number
  /** World units per second the band drifts. Negative is leftward. */
  drift: number
}

export interface Scenery {
  readonly meshes: readonly Mesh[]
  resize(worldWidth: number, worldHeight: number): void
  update(elapsed: number): void
}

export function createScenery(
  seed: string,
  colors: readonly [string, string],
  quad: BufferGeometry,
): Scenery {
  const light = parseColor(colors[0])
  const dark = parseColor(colors[1])
  const style = STYLES[seed] ?? 'peaks'

  /*
   * A silhouette only reads if it is darker than the sky *behind it*, and the
   * sky is a gradient — so each band is tinted against the gradient at its own
   * height rather than against the gradient's end colour. Nearer bands are
   * darker and more opaque, which is what the eye reads as distance.
   */
  const behindFar = mix(light, dark, 0.35)
  const behindMid = mix(light, dark, 0.55)

  const plans = [
    {
      texture: ridgeTexture({ style, fill: shade(behindFar, -0.16), seed: `${seed}:far` }),
      topY: 2,
      tileWidth: 21,
      drift: -0.06,
      z: LAYER_Z.far,
      order: RENDER_ORDER.far,
      opacity: 0.55,
    },
    {
      texture: ridgeTexture({ style, fill: shade(behindMid, -0.3), seed: `${seed}:mid` }),
      topY: 0.4,
      tileWidth: 14,
      drift: -0.15,
      z: LAYER_Z.mid,
      order: RENDER_ORDER.mid,
      opacity: 0.9,
    },
    {
      texture: groundTexture(shade(dark, -0.2), `${seed}:ground`),
      topY: -1.2,
      tileWidth: 10,
      drift: -0.34,
      z: LAYER_Z.ground,
      order: RENDER_ORDER.ground,
      opacity: 1,
    },
  ]

  const bands: Band[] = plans.map((plan) => {
    const material = new MeshBasicMaterial({
      map: plan.texture,
      transparent: true,
      opacity: plan.opacity,
      depthTest: false,
      depthWrite: false,
    })

    const mesh = new Mesh(quad, material)
    mesh.position.z = plan.z
    mesh.renderOrder = plan.order

    return {
      mesh,
      texture: plan.texture,
      topY: plan.topY,
      tileWidth: plan.tileWidth,
      drift: plan.drift,
    }
  })

  return {
    meshes: bands.map((band) => band.mesh),

    resize(worldWidth, worldHeight) {
      // Each band fills from its own top edge down to the bottom of the frame,
      // which moves as the viewport changes shape.
      const bottom = -worldHeight / 2
      for (const band of bands) {
        band.mesh.scale.set(worldWidth, band.topY - bottom, 1)
        band.mesh.position.y = (band.topY + bottom) / 2
        band.texture.repeat.x = worldWidth / band.tileWidth
      }
    },

    update(elapsed) {
      for (const band of bands) {
        band.texture.offset.x = (elapsed * band.drift) / band.tileWidth
      }
    },
  }
}
