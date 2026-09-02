import { AdditiveBlending, Mesh, MeshBasicMaterial } from 'three'
import type { BufferGeometry, Texture } from 'three'
import type { FighterView, ProjectileView, ViewSide } from './view'
import { GROUND_Y, LAYER_Z, RENDER_ORDER } from './world'

/**
 * The two armies, their shots, and the burst where a blow lands.
 *
 * Positions come from the fight; nothing here decides anything. What this file
 * owns is legibility — above all the wind-up tell, which is the only warning
 * the player gets before a hit, and the one thing the fight is unplayable
 * without.
 */

const TELL_COLOUR = 0xffb347
const QUICK_TELL_COLOUR = 0xff4d4d

/** Enough for the fastest weapon's shots plus headroom. */
const PROJECTILE_POOL = 12

const SPARK_COUNT = 10
const BURST_SECONDS = 0.42

function basic(map: Texture, quad: BufferGeometry, order: number): [Mesh, MeshBasicMaterial] {
  const material = new MeshBasicMaterial({
    map,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
  const mesh = new Mesh(quad, material)
  mesh.renderOrder = order
  return [mesh, material]
}

export interface Actor {
  readonly meshes: readonly Mesh[]
  apply(view: FighterView, side: ViewSide, size: number): void
}

export function createActor(
  emoji: Texture,
  radial: Texture,
  quad: BufferGeometry,
  renderOrder: number,
): Actor {
  const [mesh, material] = basic(emoji, quad, renderOrder)

  // Black over the white radial map gives a soft contact shadow.
  const [shadow, shadowMaterial] = basic(radial, quad, RENDER_ORDER.shadows)
  shadowMaterial.color.setHex(0x000000)

  // The wind-up tell. It blooms behind the army about to swing, and it is the
  // player's whole read on when to dodge, so it is additive and unmissable.
  const [tell, tellMaterial] = basic(radial, quad, renderOrder - 1)
  tellMaterial.blending = AdditiveBlending

  return {
    meshes: [shadow, tell, mesh],

    apply(view, side, size) {
      // The player holds the right of the field and faces left.
      const facing = side === 'player' ? -1 : 1
      const defeated = view.health <= 0

      // Purely cosmetic offsets; the fight owns the real position.
      const flinch = view.hurt > 0 ? view.hurt / 0.22 : 0
      const lean = view.windUp > 0 ? 0.26 : view.recover > 0 ? -0.12 : 0
      const punch = view.recover > 0 ? Math.min(1, view.recover / 0.4) : 0

      const scale = size * (1 + punch * 0.08 - flinch * 0.05)
      const x = view.x - facing * flinch * 0.3
      const y = GROUND_Y + size * 0.42 + (defeated ? -size * 0.12 : 0)

      mesh.position.set(x, y, LAYER_Z.actors)
      mesh.scale.set(scale, scale, 1)
      // Leaning into the swing, rocking back when hit, toppling when beaten.
      mesh.rotation.z = defeated ? -facing * 0.5 : -facing * (lean - flinch * 0.3)
      material.opacity = defeated ? 0.5 : view.invulnerable > 0 ? 0.45 : 1
      // Dodges read as a pale after-image rather than a disappearance.
      material.color.setScalar(flinch > 0.3 ? 1.6 : 1)

      shadow.position.set(x, GROUND_Y - size * 0.06, LAYER_Z.actors - 0.1)
      shadow.scale.set(scale * 0.95, scale * 0.3, 1)
      shadowMaterial.opacity = (defeated ? 0.2 : 0.38) * (view.invulnerable > 0 ? 0.4 : 1)

      // Reeling from a perfect dodge: wobble, and go cold.
      if (view.stagger > 0) {
        mesh.rotation.z = Math.sin(view.stagger * 34) * 0.16
        material.color.setRGB(0.62, 0.72, 1)
      } else if (view.counter) {
        // A loaded counter glows gold until it is spent.
        material.color.setRGB(1.5, 1.28, 0.7)
      }

      const winding = view.windUp > 0 && view.stagger <= 0
      tell.visible = winding
      if (winding) {
        // Blooms as the blow approaches, so the dodge window is visible.
        const charge = 1 - Math.min(1, view.windUp / 0.45)
        const tellSize = size * (1.1 + charge * 1.5)
        tell.position.set(view.x, y, LAYER_Z.actors - 0.05)
        tell.scale.set(tellSize, tellSize, 1)
        tellMaterial.opacity = 0.25 + charge * 0.5
        tellMaterial.color.setHex(view.quickSwing ? QUICK_TELL_COLOUR : TELL_COLOUR)
      }
    },
  }
}

export interface Projectiles {
  readonly meshes: readonly Mesh[]
  apply(shots: readonly ProjectileView[], size: number): void
}

export function createProjectiles(radial: Texture, quad: BufferGeometry): Projectiles {
  const material = new MeshBasicMaterial({
    map: radial,
    color: 0xffeaa7,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: AdditiveBlending,
  })

  const meshes = Array.from({ length: PROJECTILE_POOL }, () => {
    const mesh = new Mesh(quad, material)
    mesh.renderOrder = RENDER_ORDER.projectiles
    mesh.visible = false
    return mesh
  })

  return {
    meshes,

    apply(shots, size) {
      for (let i = 0; i < meshes.length; i += 1) {
        const mesh = meshes[i]
        if (!mesh) continue

        const shot = shots[i]
        if (!shot) {
          mesh.visible = false
          continue
        }

        mesh.visible = true
        mesh.position.set(shot.x, GROUND_Y + size * 0.45 + shot.height, LAYER_Z.actors + 0.1)
        // Lobbed shells read as heavier, so they are drawn a little larger.
        const scale = size * (shot.arc > 0 ? 0.38 : 0.26)
        mesh.scale.set(scale, scale, 1)
      }
    },
  }
}

export interface ImpactBurst {
  readonly meshes: readonly Mesh[]
  /** Starts a burst at a point in the world. */
  strike(x: number, y: number): void
  update(dt: number, size: number): void
}

export function createImpact(radial: Texture, quad: BufferGeometry): ImpactBurst {
  const ringMaterial = new MeshBasicMaterial({
    map: radial,
    color: 0xffe6a2,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: AdditiveBlending,
  })
  const ring = new Mesh(quad, ringMaterial)
  ring.renderOrder = RENDER_ORDER.impact

  // One material for every spark: they are born and die together.
  const sparkMaterial = new MeshBasicMaterial({
    map: radial,
    color: 0xfff3cc,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: AdditiveBlending,
  })

  const sparks = Array.from({ length: SPARK_COUNT }, (_, index) => {
    const angle = (index / SPARK_COUNT) * Math.PI * 2 + (index % 3) * 0.21
    const reach = 0.7 + (index % 4) * 0.22
    const mesh = new Mesh(quad, sparkMaterial)
    mesh.renderOrder = RENDER_ORDER.impact + 1
    return { mesh, dx: Math.cos(angle) * reach, dy: Math.sin(angle) * reach }
  })

  let life = 0
  let originX = 0
  let originY = 0

  return {
    meshes: [ring, ...sparks.map((spark) => spark.mesh)],

    strike(x, y) {
      life = BURST_SECONDS
      originX = x
      originY = y
    },

    update(dt, size) {
      life = Math.max(0, life - dt)
      const lit = life > 0
      const progress = lit ? 1 - life / BURST_SECONDS : 0
      const strength = lit ? (life / BURST_SECONDS) ** 2 : 0

      ring.visible = lit
      ringMaterial.opacity = strength * 0.9
      const ringSize = size * (0.4 + progress * 2.4)
      ring.position.set(originX, originY, LAYER_Z.actors + 0.2)
      ring.scale.set(ringSize, ringSize, 1)

      sparkMaterial.opacity = strength
      const spread = size * (0.3 + progress * 1.9)
      const sparkSize = size * 0.26 * (1 - progress * 0.6)
      const fall = progress * progress * size * 0.35

      for (const spark of sparks) {
        spark.mesh.visible = lit
        spark.mesh.position.set(
          originX + spark.dx * spread,
          originY + spark.dy * spread - fall,
          LAYER_Z.actors + 0.3,
        )
        spark.mesh.scale.set(sparkSize, sparkSize, 1)
      }
    },
  }
}
