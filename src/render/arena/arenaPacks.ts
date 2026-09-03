import { AdditiveBlending, BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry } from 'three'
import type { PackView } from './view'

/**
 * Health packs lying on the field.
 *
 * A small dark case with a bright cross and a pool of green light under it —
 * the one object in the arena that glows green, so it can never be mistaken
 * for a threat. Everything is pooled and built once; per frame each pack costs
 * three transform writes.
 *
 * The bob and spin run off the pack's own `age`, which is simulation time:
 * pausing the fight freezes every pack mid-bob for free, exactly as it
 * freezes everything else.
 */

/** More than the drop rule can ever put on the field at once. */
const PACK_POOL = 8

const CASE_COLOUR = 0x1d3a2a
const CROSS_COLOUR = 0x49f2a5

/** Metres above the ground the case floats, and how far the bob carries it. */
const HOVER = 0.55
const BOB = 0.12

export interface ArenaPacks {
  readonly group: Group
  /** Places every pack currently on the field. */
  apply(packs: readonly PackView[], reducedMotion: boolean): void
}

export function createArenaPacks(): ArenaPacks {
  const group = new Group()

  // One geometry and material set shared by the whole pool.
  const caseGeometry = new BoxGeometry(0.52, 0.34, 0.52)
  const barGeometry = new BoxGeometry(0.34, 0.09, 0.11)
  const caseMaterial = new MeshLambertMaterial({ color: CASE_COLOUR })
  const crossMaterial = new MeshBasicMaterial({ color: CROSS_COLOUR })
  const glowGeometry = new PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2)
  const glowMaterial = new MeshBasicMaterial({
    color: CROSS_COLOUR,
    transparent: true,
    opacity: 0.22,
    blending: AdditiveBlending,
    depthWrite: false,
  })

  const kits: Group[] = []
  for (let i = 0; i < PACK_POOL; i += 1) {
    const kit = new Group()

    const box = new Mesh(caseGeometry, caseMaterial)
    kit.add(box)

    // The cross sits proud of the lid so it reads from the over-shoulder
    // camera, which looks down on everything low.
    const barAcross = new Mesh(barGeometry, crossMaterial)
    barAcross.position.y = 0.19
    kit.add(barAcross)
    const barAlong = new Mesh(barGeometry, crossMaterial)
    barAlong.position.y = 0.19
    barAlong.rotation.y = Math.PI / 2
    kit.add(barAlong)

    const glow = new Mesh(glowGeometry, glowMaterial)
    // Just off the floor, additive, so it pools on the ground like light.
    glow.position.y = -HOVER + 0.03
    kit.add(glow)

    kit.visible = false
    group.add(kit)
    kits.push(kit)
  }

  return {
    group,

    apply(packs, reducedMotion) {
      for (let i = 0; i < kits.length; i += 1) {
        const kit = kits[i]
        if (!kit) continue
        const pack = packs[i]
        if (!pack) {
          kit.visible = false
          continue
        }
        kit.visible = true
        const bob = reducedMotion ? 0 : Math.sin(pack.age * 3) * BOB
        kit.position.set(pack.pos.x, HOVER + bob, pack.pos.z)
        kit.rotation.y = reducedMotion ? 0 : pack.age * 1.4
      }
    },
  }
}
