import { AdditiveBlending, BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry } from 'three'
import type { PackView } from './view'

/**
 * Supplies lying on the field: medkits and ammo boxes.
 *
 * Two small cases, told apart the way the whole game tells things apart — by
 * colour and silhouette at a glance. The medkit is dark with a bright cross
 * and pools green light, the one green glow in the arena; the ammo box is a
 * squat crate in gunmetal with three brass rounds standing proud of the lid,
 * pooling amber. Neither can be read as a threat, and neither can be read as
 * the other.
 *
 * Everything is pooled and built once; per frame each supply costs three
 * transform writes. The bob and spin run off the pack's own `age`, which is
 * simulation time: pausing the fight freezes every crate mid-bob for free.
 */

/** Per kind. More than the alternating drop rule can field at once. */
const POOL = 6

const KIT_CASE = 0x1d3a2a
const KIT_CROSS = 0x49f2a5

const AMMO_CASE = 0x3a3226
const AMMO_BRASS = 0xffc63d

/** Metres above the ground the case floats, and how far the bob carries it. */
const HOVER = 0.55
const BOB = 0.12

interface Pool {
  readonly kits: Group[]
}

export interface ArenaPacks {
  readonly group: Group
  /** Places every supply currently on the field. */
  apply(packs: readonly PackView[], reducedMotion: boolean): void
}

export function createArenaPacks(): ArenaPacks {
  const group = new Group()

  // Shared geometry; materials differ per kind.
  const caseGeometry = new BoxGeometry(0.52, 0.34, 0.52)
  const barGeometry = new BoxGeometry(0.34, 0.09, 0.11)
  const roundGeometry = new CylinderGeometry(0.05, 0.05, 0.22, 6)
  const glowGeometry = new PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2)

  function glowMaterial(color: number): MeshBasicMaterial {
    return new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.22,
      blending: AdditiveBlending,
      depthWrite: false,
    })
  }

  function buildPool(build: (kit: Group) => void): Pool {
    const kits: Group[] = []
    for (let i = 0; i < POOL; i += 1) {
      const kit = new Group()
      build(kit)
      kit.visible = false
      group.add(kit)
      kits.push(kit)
    }
    return { kits }
  }

  const kitCase = new MeshLambertMaterial({ color: KIT_CASE })
  const kitCross = new MeshBasicMaterial({ color: KIT_CROSS })
  const kitGlow = glowMaterial(KIT_CROSS)
  const health = buildPool((kit) => {
    kit.add(new Mesh(caseGeometry, kitCase))
    // The cross sits proud of the lid so it reads from the over-shoulder
    // camera, which looks down on everything low.
    const across = new Mesh(barGeometry, kitCross)
    across.position.y = 0.19
    kit.add(across)
    const along = new Mesh(barGeometry, kitCross)
    along.position.y = 0.19
    along.rotation.y = Math.PI / 2
    kit.add(along)
    const glow = new Mesh(glowGeometry, kitGlow)
    glow.position.y = -HOVER + 0.03
    kit.add(glow)
  })

  const ammoCase = new MeshLambertMaterial({ color: AMMO_CASE })
  const ammoBrass = new MeshBasicMaterial({ color: AMMO_BRASS })
  const ammoGlow = glowMaterial(AMMO_BRASS)
  const ammo = buildPool((kit) => {
    const crate = new Mesh(caseGeometry, ammoCase)
    // Squatter than the medkit, so the silhouettes differ before colour does.
    crate.scale.y = 0.72
    kit.add(crate)
    for (let round = 0; round < 3; round += 1) {
      const shell = new Mesh(roundGeometry, ammoBrass)
      shell.position.set((round - 1) * 0.14, 0.2, 0)
      kit.add(shell)
    }
    const glow = new Mesh(glowGeometry, ammoGlow)
    glow.position.y = -HOVER + 0.03
    kit.add(glow)
  })

  function drive(pool: Pool, packs: readonly PackView[], kind: 'health' | 'ammo', reducedMotion: boolean): void {
    let at = 0
    for (const pack of packs) {
      if (pack.kind !== kind || at >= pool.kits.length) continue
      const kit = pool.kits[at]
      if (!kit) continue
      kit.visible = true
      const bob = reducedMotion ? 0 : Math.sin(pack.age * 3) * BOB
      kit.position.set(pack.pos.x, HOVER + bob, pack.pos.z)
      kit.rotation.y = reducedMotion ? 0 : pack.age * 1.4
      at += 1
    }
    for (; at < pool.kits.length; at += 1) {
      const kit = pool.kits[at]
      if (kit) kit.visible = false
    }
  }

  return {
    group,

    apply(packs, reducedMotion) {
      drive(health, packs, 'health', reducedMotion)
      drive(ammo, packs, 'ammo', reducedMotion)
    },
  }
}
