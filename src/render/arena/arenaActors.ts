import {
  AdditiveBlending,
  BoxGeometry,
  CapsuleGeometry,
  Color,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three'
import type { BufferGeometry, Texture } from 'three'
import { ACTOR_HEIGHT, ACTOR_RADIUS, MUZZLE_HEIGHT, ROLL_TIME } from '../../game/arena/world'
import { emojiTexture, radialTexture } from '../textures'
import type { ArenaViewEnemyKind, EnemyView, PlayerView } from './view'

/**
 * The bodies in the arena: the commander seen from behind, and the squad coming
 * at them.
 *
 * The game ships no models, so everything here is stacked primitives. That is a
 * constraint worth leaning into rather than apologising for — a capsule, a
 * head and two boxes give a silhouette that reads at forty units in fog, which
 * a detailed mesh at this budget would not.
 *
 * What this file really owns is legibility, and above all the WIND-UP TELL. An
 * enemy's `windUp` is the player's only warning before a blow lands; it was the
 * whole read of the 2D duel and it is the whole read here. It gets three
 * simultaneous channels — a growing pool of light on the ground, a ring
 * converging on the enemy's feet like a countdown, and the enemy's own body
 * heating toward the tell colour — because one channel is one thing to miss on
 * a phone screen in daylight.
 *
 * Nothing here draws Persian text. Emoji are rasterised through `textures.ts`
 * and hung on billboards; every label lives in the DOM above the canvas.
 */

/* ------------------------------------------------------------------ *
 *  Shared feel constants
 * ------------------------------------------------------------------ */

/**
 * The reference wind-up, in seconds.
 *
 * `windUp` counts down and each enemy kind commits for a different length of
 * time, so the tell is drawn against a fixed window instead: a blow more than
 * this far away shows the tell at its faintest, and the last half-second is
 * where it ramps. Widen it and slow enemies telegraph too early to feel
 * dangerous; narrow it and the player gets no time to move.
 */
const TELL_WINDOW = 0.55

/** The duel's own tell colours, carried over so the read is already learned. */
const TELL_EARLY = new Color(0xffb347)
const TELL_LATE = new Color(0xff4d4d)

/** A hit reads white-hot; reeling from a stagger reads cold. */
const HURT_GLOW = new Color(0xffe9c4)
const COLD_TINT = new Color(0x9ec6ff)

/** Seconds a body takes to fall, sink and be gone. */
const DEATH_TIME = 0.7

/** Seconds of the drop-in scale-up. Shorter than the briefing, on purpose. */
const DROP_IN_TIME = 0.42

/** How far above the arena an enemy falls in from. */
const DROP_IN_HEIGHT = 7

/**
 * Enemy slots allocated up front.
 *
 * Waves top out well below this; twelve leaves room for the boss wave plus
 * stragglers still collapsing from the wave before. Nothing is ever allocated
 * beyond it — a thirteenth enemy simply is not drawn, which is a far better
 * failure than a stutter mid-fight.
 */
const ENEMY_POOL = 12

/* ------------------------------------------------------------------ *
 *  Scratch
 * ------------------------------------------------------------------ */

const scratchPosition = new Vector3()
const scratchScale = new Vector3()
const scratchAxis = new Vector3()
const scratchQuaternion = new Quaternion()
const scratchTumble = new Quaternion()
const scratchEuler = new Euler(0, 0, 0, 'YXZ')
const scratchMatrix = new Matrix4()
const scratchColor = new Color()

/** Overshoots past 1 and settles: the drop-in lands with weight. */
function backOut(t: number): number {
  const p = t - 1
  return 1 + 2.4 * p * p * p + 1.4 * p * p
}

/* ------------------------------------------------------------------ *
 *  The commander
 * ------------------------------------------------------------------ */

/** Slate armour and a gold pack: neither one blends into any of the five terrains. */
const ARMOUR_COLOUR = 0x38455a
const TRIM_COLOUR = 0xf0b429
const GUN_COLOUR = 0x1d232e

/** Radians the body tips into a sprint. Enough to read; not enough to obscure. */
const SPRINT_LEAN = 0.19

/** How close to the floor the hips drop mid-roll. */
const ROLL_HIP_HEIGHT = 0.62

export interface Commander {
  readonly group: Group
  /**
   * Writes the world position of the gun's muzzle into `target` and returns it.
   *
   * The simulation's `muzzle` event carries the aim ray's origin, which sits on
   * the commander's centre line; the flash has to come off the actual barrel or
   * it looks like the player is firing out of their chest.
   */
  muzzle(target: Vector3): Vector3
  apply(player: PlayerView, dt: number, elapsed: number, reducedMotion: boolean): void
}

export function createCommander(heroEmoji: string): Commander {
  const group = new Group()

  const hip = ACTOR_HEIGHT * 0.5

  // Everything below hangs off `rig`, whose origin is the commander's HIP, not
  // their feet. That is what lets the dodge roll tumble about the body's centre
  // instead of pivoting around the heels like a felled tree.
  const rig = new Group()
  rig.rotation.order = 'YXZ'
  group.add(rig)

  const armour = new MeshLambertMaterial({ color: ARMOUR_COLOUR })
  const trim = new MeshLambertMaterial({ color: TRIM_COLOUR })
  const gunMetal = new MeshLambertMaterial({ color: GUN_COLOUR })
  const tintable: readonly MeshLambertMaterial[] = [armour, trim, gunMetal]

  // The capsule is 0.62 of mid-section plus a cap at each end, so it stands
  // 1.39 tall; hung off a hip at 0.9 it has to drop by 0.2 to put its feet on
  // the floor instead of hovering a boot's height above it.
  const torso = new Mesh(new CapsuleGeometry(ACTOR_RADIUS * 0.86, 0.62, 4, 12), armour)
  torso.position.y = -0.2
  rig.add(torso)

  const head = new Mesh(new SphereGeometry(ACTOR_RADIUS * 0.62, 12, 10), armour)
  head.position.y = 0.66
  rig.add(head)

  // The pack rides the shoulders and is the first thing the camera sees, so it
  // carries the accent colour and the hero's badge.
  const pack = new Mesh(new BoxGeometry(0.5, 0.5, 0.24), trim)
  pack.position.set(0, 0.2, 0.28)
  rig.add(pack)

  // The commander faces -Z, so their back faces +Z — straight at the camera.
  // A plane's front face is +Z already, so the badge needs no rotation.
  const badge = new Mesh(
    new PlaneGeometry(0.34, 0.34),
    new MeshBasicMaterial({ map: emojiTexture(heroEmoji), transparent: true, depthWrite: false }),
  )
  badge.position.set(0, 0.21, 0.41)
  rig.add(badge)

  // Held out on the right, where the over-the-shoulder camera can see it.
  const gun = new Group()
  gun.position.set(ACTOR_RADIUS * 0.78, MUZZLE_HEIGHT - hip, -0.2)
  rig.add(gun)

  const barrel = new Mesh(new BoxGeometry(0.09, 0.11, 0.92), gunMetal)
  barrel.position.z = -0.22
  gun.add(barrel)

  const grip = new Mesh(new BoxGeometry(0.08, 0.26, 0.12), gunMetal)
  grip.position.set(0, -0.15, 0.1)
  gun.add(grip)

  /**
   * Where the round actually leaves. Kept as a local offset so the world
   * position is one transform away and never needs the scene graph updated.
   */
  const muzzleLocal = new Vector3(ACTOR_RADIUS * 0.78, MUZZLE_HEIGHT - hip, -0.88)

  // The blob shadow. It is a sibling of the rig rather than a child, because it
  // must stay flat on the floor while the body above it leans, flinches and
  // tumbles. This is the same trick the 2D scene used, and the reason we can
  // skip shadow maps entirely on a phone.
  const shadow = new Mesh(
    new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({
      map: radialTexture(),
      color: 0x000000,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    }),
  )
  group.add(shadow)

  let deathTime = 0

  return {
    group,

    muzzle(target) {
      return target.copy(muzzleLocal).applyQuaternion(rig.quaternion).add(rig.position)
    },

    apply(player, dt, elapsed, reducedMotion) {
      const rolling = player.rollLeft > 0
      const rollProgress = rolling ? 1 - Math.min(1, player.rollLeft / ROLL_TIME) : 0
      deathTime = player.alive ? 0 : deathTime + dt

      /* --- Where the hips are ------------------------------------- */

      // Mid-roll the commander is on the ground; the dip is a half sine so they
      // go down and come back up rather than snapping between two heights.
      const rollDip = rolling ? Math.sin(rollProgress * Math.PI) : 0
      const fall = Math.min(1, deathTime / DEATH_TIME)
      // A running bob at twice the stride rate. Frozen for reduced motion, where
      // a bobbing camera-anchor is exactly the thing that makes people ill.
      const stride =
        reducedMotion || rolling || !player.alive
          ? 0
          : Math.min(1, Math.hypot(player.vel.x, player.vel.z) / 8) *
            Math.sin(elapsed * 11) *
            0.035

      rig.position.set(
        player.pos.x,
        (hip - rollDip * (hip - ROLL_HIP_HEIGHT)) * (1 - fall * 0.55) + stride,
        player.pos.z,
      )

      /* --- Which way it is facing ---------------------------------- */

      if (rolling) {
        // A real tumble, not a spin: one full turn about the horizontal axis
        // perpendicular to the roll direction, over the roll's whole duration.
        // Cross-multiplying up by the roll direction gives that axis directly.
        scratchAxis.set(player.rollDir.z, 0, -player.rollDir.x)
        if (scratchAxis.lengthSq() < 1e-6) scratchAxis.set(1, 0, 0)
        scratchAxis.normalize()
        scratchTumble.setFromAxisAngle(scratchAxis, rollProgress * Math.PI * 2)
        scratchEuler.set(0, player.yaw, 0)
        scratchQuaternion.setFromEuler(scratchEuler)
        // World-space tumble on the left, body yaw on the right: the commander
        // keeps looking where they were aiming while the body goes over.
        rig.quaternion.copy(scratchTumble).multiply(scratchQuaternion)
      } else {
        // Leaning into a sprint means pitching toward -Z, which is a NEGATIVE
        // rotation about X. Getting this sign wrong makes them run backwards.
        const flinch = player.hurt > 0 ? Math.min(1, player.hurt / 0.3) : 0
        const pitch = -(player.sprinting ? SPRINT_LEAN : 0.05) + flinch * 0.34 + fall * 1.45
        scratchEuler.set(pitch, player.yaw, flinch * 0.16)
        rig.quaternion.setFromEuler(scratchEuler)
      }

      /* --- Where the gun is ---------------------------------------- */

      // Brought in tight against the body while aiming, and swung down out of
      // the way while sprinting — both are the postures the player expects to
      // see for the state they just put the commander in.
      const ads = player.ads
      gun.position.x = ACTOR_RADIUS * (0.78 - ads * 0.72)
      gun.position.y = MUZZLE_HEIGHT - hip + ads * 0.06
      gun.rotation.x = player.sprinting ? -0.85 : -player.pitch * 0.35
      muzzleLocal.set(gun.position.x, gun.position.y, -0.88)

      /* --- Skin ----------------------------------------------------- */

      // I-frames strobe rather than fade: a half-transparent commander would
      // have to move to the transparent pass and start sorting against the
      // arena, and the strobe reads better anyway.
      const strobe =
        player.invulnerable > 0 && !reducedMotion ? 0.35 + Math.abs(Math.sin(elapsed * 26)) * 0.5 : 0
      const glow = Math.max(strobe, player.hurt > 0 ? Math.min(1, player.hurt / 0.3) * 0.8 : 0)
      for (const material of tintable) {
        material.emissive.copy(player.hurt > 0 ? TELL_LATE : HURT_GLOW)
        material.emissiveIntensity = glow
      }

      /* --- Contact shadow ------------------------------------------ */

      const shadowSize = ACTOR_RADIUS * 5.4 * (1 - rollDip * 0.2) * (1 - fall * 0.4)
      shadow.position.set(player.pos.x, 0.02, player.pos.z)
      shadow.scale.set(shadowSize, 1, shadowSize)
    },
  }
}

/* ------------------------------------------------------------------ *
 *  The enemies
 * ------------------------------------------------------------------ */

/**
 * What each of the four roles looks like.
 *
 * They have to be told apart in a glance, at range, in fog, so they differ in
 * silhouette first and colour second: the rusher is thin and hunched, the
 * gunner stands square holding a rifle, the heavy is squat and shoulder-heavy,
 * and the boss is simply much bigger than any of them, with horns.
 */
interface KindProfile {
  readonly color: number
  /** Multiplier on ACTOR_HEIGHT. */
  readonly height: number
  /** Multiplier on ACTOR_RADIUS. */
  readonly girth: number
  /** Radians the body is permanently hunched forward. */
  readonly hunch: number
  /** Two symmetric props: shoulder plates, or horns off the head. */
  readonly sides: 'none' | 'pauldrons' | 'horns'
  /** One prop held out front: a rifle, or a blade. */
  readonly front: 'none' | 'rifle' | 'blade'
}

const KINDS: Record<ArenaViewEnemyKind, KindProfile> = {
  // Orange, lean and already leaning at you before it moves.
  rusher: { color: 0xff7a3c, height: 0.94, girth: 0.78, hunch: 0.2, sides: 'none', front: 'blade' },
  // Cyan and upright: the one that is dangerous while it is standing still.
  gunner: { color: 0x3fb6f2, height: 1.0, girth: 0.98, hunch: 0.02, sides: 'none', front: 'rifle' },
  // Violet, wide, low. Reads as something you do not out-trade at close range.
  heavy: { color: 0xa96bf0, height: 0.96, girth: 1.5, hunch: 0.06, sides: 'pauldrons', front: 'none' },
  // Gold and half again as tall as anything else on the field.
  boss: { color: 0xf5c518, height: 1.55, girth: 1.62, hunch: 0.04, sides: 'horns', front: 'blade' },
}

/** One pooled body. Every field is written in place; none of it is reallocated. */
interface EnemySlot {
  readonly rig: Group
  readonly body: Mesh
  readonly head: Mesh
  readonly sideLeft: Mesh
  readonly sideRight: Mesh
  readonly front: Mesh
  readonly badge: Sprite
  readonly badgeMaterial: SpriteMaterial
  readonly pip: Group
  readonly pipFill: Mesh
  readonly pipFillMaterial: MeshBasicMaterial
  readonly material: MeshLambertMaterial
  /** Which enemy is currently living in this slot, or -1 for nobody. */
  id: number
  kind: ArenaViewEnemyKind | null
  emoji: string
  /** Seconds since this body stopped being alive. Drives the collapse. */
  deathTime: number
  /** Cached from the profile, so `apply` never touches the KINDS table. */
  height: number
  radius: number
  hunch: number
}

export interface EnemyPool {
  readonly group: Group
  /**
   * @param cameraQuaternion orientation the health pips billboard themselves to.
   */
  apply(
    enemies: readonly EnemyView[],
    dt: number,
    cameraQuaternion: Quaternion,
    reducedMotion: boolean,
  ): void
  /**
   * Frees what the scene-graph walker cannot see: emoji textures that were
   * swapped off a billboard and are no longer hanging on any material.
   */
  dispose(): void
}

/** Half-width and height of the health pip, in world units. */
const PIP_WIDTH = 0.86
const PIP_HEIGHT = 0.1

export function createEnemyPool(): EnemyPool {
  const group = new Group()

  /*
   * One geometry per shape for the whole squad. Twelve bodies share five
   * BufferGeometries between them; the per-enemy differences are all scale.
   */
  const capsule: BufferGeometry = new CapsuleGeometry(0.5, 1, 4, 12)
  const sphere: BufferGeometry = new SphereGeometry(1, 12, 10)
  const box: BufferGeometry = new BoxGeometry(1, 1, 1)
  const quad: BufferGeometry = new PlaneGeometry(1, 1)
  const flatQuad: BufferGeometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  const ring: BufferGeometry = new RingGeometry(0.74, 1, 32).rotateX(-Math.PI / 2)

  const radial = radialTexture()

  /* --- Ground layers, instanced ---------------------------------- */

  // Shadows, tell pools and tell rings are three draw calls for the entire
  // squad rather than three per enemy. On a phone that is the whole margin.
  const shadows = new InstancedMesh(
    flatQuad,
    new MeshBasicMaterial({
      map: radial,
      color: 0x000000,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    }),
    ENEMY_POOL,
  )

  const tellPool = new InstancedMesh(
    flatQuad,
    new MeshBasicMaterial({
      map: radial,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      // The tell must not be dimmed by distance. It is the one thing on screen
      // that has to be as loud at thirty units as it is at five.
      fog: false,
    }),
    ENEMY_POOL,
  )

  const tellRing = new InstancedMesh(
    ring,
    new MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
    }),
    ENEMY_POOL,
  )

  for (const mesh of [shadows, tellPool, tellRing]) {
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    // Seeded black so `instanceColor` exists before the first frame asks for it,
    // and so an unused slot contributes nothing to an additive pass.
    for (let i = 0; i < ENEMY_POOL; i += 1) {
      mesh.setMatrixAt(i, scratchMatrix.makeScale(0, 0, 0))
      mesh.setColorAt(i, scratchColor.setRGB(0, 0, 0))
    }
    // Instances move every frame, so any bounding sphere computed here would be
    // stale by the next one. Twelve flat quads are not worth a per-frame bounds
    // rebuild, so the culler is simply told to leave them alone.
    mesh.frustumCulled = false
    group.add(mesh)
  }

  /* --- Bodies ----------------------------------------------------- */

  const pipBack = new MeshBasicMaterial({
    color: 0x0b0f16,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
    fog: false,
  })

  // Emoji are rasterised once per distinct glyph. A wave normally shares one,
  // so this is usually a single 128px texture for the entire fight.
  const emojiCache = new Map<string, Texture>()
  function emojiFor(emoji: string): Texture {
    const existing = emojiCache.get(emoji)
    if (existing) return existing
    const created = emojiTexture(emoji)
    emojiCache.set(emoji, created)
    return created
  }

  const slots: EnemySlot[] = []
  for (let i = 0; i < ENEMY_POOL; i += 1) {
    const rig = new Group()
    rig.rotation.order = 'YXZ'
    rig.visible = false
    group.add(rig)

    const material = new MeshLambertMaterial({ color: 0xffffff })

    const body = new Mesh(capsule, material)
    const head = new Mesh(sphere, material)
    const sideLeft = new Mesh(box, material)
    const sideRight = new Mesh(box, material)
    const front = new Mesh(box, material)
    rig.add(body, head, sideLeft, sideRight, front)

    const badgeMaterial = new SpriteMaterial({ transparent: true, depthWrite: false, fog: false })
    const badge = new Sprite(badgeMaterial)
    rig.add(badge)

    // The pip is a plain billboard group rather than sprites, so the fill can
    // be anchored to one edge in the group's own space.
    const pip = new Group()
    pip.visible = false
    rig.add(pip)

    const pipBackMesh = new Mesh(quad, pipBack)
    pipBackMesh.scale.set(PIP_WIDTH, PIP_HEIGHT, 1)
    pip.add(pipBackMesh)

    const pipFillMaterial = new MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false })
    const pipFill = new Mesh(quad, pipFillMaterial)
    pipFill.position.z = 0.005
    pip.add(pipFill)

    slots.push({
      rig,
      body,
      head,
      sideLeft,
      sideRight,
      front,
      badge,
      badgeMaterial,
      pip,
      pipFill,
      pipFillMaterial,
      material,
      id: -1,
      kind: null,
      emoji: '',
      deathTime: 0,
      height: ACTOR_HEIGHT,
      radius: ACTOR_RADIUS,
      hunch: 0,
    })
  }

  /** Reshapes a slot for a role. Only ever runs when a slot changes occupant. */
  function dress(slot: EnemySlot, kind: ArenaViewEnemyKind): void {
    const profile = KINDS[kind]
    slot.kind = kind
    slot.height = ACTOR_HEIGHT * profile.height
    slot.radius = ACTOR_RADIUS * profile.girth
    slot.hunch = profile.hunch
    slot.material.color.setHex(profile.color)

    // The capsule is radius 0.5 and two units tall before scaling, so a width
    // scale of 2r gives radius r and a height scale of h/2 gives height h.
    const bodyHeight = slot.height * 0.78
    slot.body.scale.set(slot.radius * 2, bodyHeight / 2, slot.radius * 2)
    slot.body.position.y = bodyHeight / 2

    const headRadius = slot.radius * 0.72
    slot.head.scale.setScalar(headRadius)
    slot.head.position.set(0, bodyHeight + headRadius * 0.35, 0)

    slot.sideLeft.visible = profile.sides !== 'none'
    slot.sideRight.visible = profile.sides !== 'none'
    if (profile.sides === 'pauldrons') {
      // Wide flat plates that push the shoulders out past the hips.
      slot.sideLeft.scale.set(slot.radius * 0.9, slot.radius * 0.5, slot.radius * 1.5)
      slot.sideRight.scale.copy(slot.sideLeft.scale)
      slot.sideLeft.position.set(-slot.radius * 1.05, bodyHeight * 0.86, 0)
      slot.sideRight.position.set(slot.radius * 1.05, bodyHeight * 0.86, 0)
      slot.sideLeft.rotation.set(0, 0, 0.3)
      slot.sideRight.rotation.set(0, 0, -0.3)
    } else if (profile.sides === 'horns') {
      slot.sideLeft.scale.set(slot.radius * 0.16, slot.radius * 1.5, slot.radius * 0.16)
      slot.sideRight.scale.copy(slot.sideLeft.scale)
      const hornY = bodyHeight + headRadius * 1.1
      slot.sideLeft.position.set(-headRadius * 0.7, hornY, 0)
      slot.sideRight.position.set(headRadius * 0.7, hornY, 0)
      slot.sideLeft.rotation.set(0, 0, 0.42)
      slot.sideRight.rotation.set(0, 0, -0.42)
    }

    slot.front.visible = profile.front !== 'none'
    if (profile.front === 'rifle') {
      // Held level across the chest and pointing -Z, the way the enemy faces.
      slot.front.scale.set(slot.radius * 0.2, slot.radius * 0.2, slot.radius * 2.4)
      slot.front.position.set(slot.radius * 0.7, bodyHeight * 0.78, -slot.radius * 1.1)
      slot.front.rotation.set(0, 0, 0)
    } else if (profile.front === 'blade') {
      slot.front.scale.set(slot.radius * 0.12, slot.radius * 2.2, slot.radius * 0.36)
      slot.front.position.set(slot.radius * 0.85, bodyHeight * 0.6, -slot.radius * 0.7)
      slot.front.rotation.set(-0.5, 0, 0.25)
    }

    const badgeSize = slot.radius * 1.9
    slot.badge.scale.set(badgeSize, badgeSize, 1)
    slot.badge.position.set(0, slot.height + badgeSize * 0.6, 0)
    slot.pip.position.set(0, slot.height + 0.16, 0)
  }

  /**
   * Takes a slot off the field.
   *
   * It deliberately leaves `slot.id` alone. Clearing it would make the next
   * frame see a fresh occupant, reset the collapse timer, and stand the corpse
   * back up to fall over again — forever, for as long as the simulation keeps
   * the body in its list.
   */
  function retire(slot: EnemySlot, index: number): void {
    slot.rig.visible = false
    shadows.setMatrixAt(index, scratchMatrix.makeScale(0, 0, 0))
    tellPool.setMatrixAt(index, scratchMatrix)
    tellRing.setMatrixAt(index, scratchMatrix)
    tellPool.setColorAt(index, scratchColor.setRGB(0, 0, 0))
    tellRing.setColorAt(index, scratchColor)
  }

  return {
    group,

    apply(enemies, dt, cameraQuaternion, reducedMotion) {
      for (let index = 0; index < ENEMY_POOL; index += 1) {
        const slot = slots[index]
        if (!slot) continue

        // Anything past the pool simply is not drawn. See ENEMY_POOL.
        const enemy = index < enemies.length ? enemies[index] : undefined
        if (!enemy) {
          retire(slot, index)
          continue
        }

        // A slot changing occupant resets every animation timer it was holding,
        // or a fresh enemy inherits the collapse of the one it replaced.
        if (slot.id !== enemy.id) {
          slot.id = enemy.id
          slot.deathTime = 0
        }
        if (slot.kind !== enemy.kind) dress(slot, enemy.kind)
        if (slot.emoji !== enemy.emoji) {
          slot.emoji = enemy.emoji
          slot.badgeMaterial.map = emojiFor(enemy.emoji)
          slot.badgeMaterial.needsUpdate = true
        }

        slot.deathTime = enemy.alive ? 0 : slot.deathTime + dt
        const fall = Math.min(1, slot.deathTime / DEATH_TIME)
        if (fall >= 1) {
          retire(slot, index)
          continue
        }

        /* --- Drop-in, collapse, and where the body sits ------------ */

        const drop = Math.min(1, enemy.age / DROP_IN_TIME)
        const dropScale = enemy.alive ? backOut(drop) : 1
        // Falling in from above and landing with an overshoot: the arrival has
        // to be visible or a wave appears to teleport onto the player.
        const dropLift = (1 - drop) * (1 - drop) * DROP_IN_HEIGHT

        slot.rig.visible = true
        // Once the body is on its way down it also sinks, and the opaque floor
        // swallows it — which is why nothing here ever has to go transparent.
        slot.rig.position.set(enemy.pos.x, dropLift - fall * slot.height * 0.5, enemy.pos.z)
        slot.rig.scale.setScalar(dropScale * (1 - fall * 0.15))

        /* --- The tell ---------------------------------------------- */

        // `stagger` cancels the read: a reeling enemy is not about to hit you,
        // and leaving the tell up would train the player to dodge nothing.
        const winding = enemy.windUp > 0 && enemy.stagger <= 0 && enemy.alive
        const charge = winding ? 1 - Math.min(1, enemy.windUp / TELL_WINDOW) : 0

        /* --- Pose --------------------------------------------------- */

        const hurt = enemy.hurt > 0 ? Math.min(1, enemy.hurt / 0.3) : 0
        const reel =
          enemy.stagger > 0 && !reducedMotion ? Math.sin(enemy.stagger * 30) * 0.18 : 0
        scratchEuler.set(
          // Coiling forward as the blow charges, thrown back when hit, face
          // down once dead.
          slot.hunch + charge * 0.26 - hurt * 0.3 + fall * (Math.PI / 2) * 0.92,
          enemy.yaw,
          reel,
        )
        slot.rig.quaternion.setFromEuler(scratchEuler)

        /* --- Skin --------------------------------------------------- */

        if (enemy.stagger > 0) {
          slot.material.color.lerpColors(
            scratchColor.setHex(KINDS[enemy.kind].color),
            COLD_TINT,
            0.7,
          )
        } else {
          slot.material.color.setHex(KINDS[enemy.kind].color)
        }

        // One emissive channel, driven by whichever of the two is louder. The
        // wind-up wins ties, because a flinch is information the player already
        // has and an incoming blow is information they do not.
        if (charge > 0) {
          slot.material.emissive.lerpColors(TELL_EARLY, TELL_LATE, charge)
          slot.material.emissiveIntensity = 0.12 + charge * 0.85
        } else {
          slot.material.emissive.copy(HURT_GLOW)
          slot.material.emissiveIntensity = hurt * 0.9
        }

        /* --- Billboards --------------------------------------------- */

        slot.badge.material.opacity = enemy.alive ? 1 : 1 - fall

        const fraction = Math.max(0, Math.min(1, enemy.health / Math.max(1, enemy.maxHealth)))
        // Hidden until it has been hurt: twelve full bars over a fresh wave is
        // noise, and the one that is nearly dead is the one worth marking.
        slot.pip.visible = enemy.alive && fraction < 0.999
        if (slot.pip.visible) {
          slot.pip.quaternion.copy(cameraQuaternion)
          // Drains right to left. The arena has no reading direction of its
          // own, but the game around it is Persian, and a bar that empties
          // toward the right would read backwards to the player holding it.
          slot.pipFill.scale.set(PIP_WIDTH * fraction, PIP_HEIGHT * 0.66, 1)
          slot.pipFill.position.x = (PIP_WIDTH * (1 - fraction)) / 2
          slot.pipFillMaterial.color.setRGB(
            1 - fraction * 0.75,
            0.24 + fraction * 0.66,
            0.28 * fraction,
          )
        }

        /* --- Ground layers ------------------------------------------ */

        const shadowSize = slot.radius * 5 * dropScale * (1 - fall * 0.6)
        scratchPosition.set(enemy.pos.x, 0.02, enemy.pos.z)
        scratchScale.set(shadowSize, 1, shadowSize)
        shadows.setMatrixAt(
          index,
          scratchMatrix.compose(scratchPosition, scratchQuaternion.identity(), scratchScale),
        )

        if (!winding) {
          tellPool.setMatrixAt(index, scratchMatrix.makeScale(0, 0, 0))
          tellRing.setMatrixAt(index, scratchMatrix)
          tellPool.setColorAt(index, scratchColor.setRGB(0, 0, 0))
          tellRing.setColorAt(index, scratchColor)
          continue
        }

        // The pool of light BLOOMS outward while the ring CONVERGES inward, and
        // the two meet on the enemy's feet exactly as the blow lands. Growth
        // alone is easy to miss in peripheral vision; the closing ring is what
        // turns it into a countdown.
        const poolSize = slot.radius * (3.4 + charge * 5.2)
        scratchPosition.set(enemy.pos.x, 0.05, enemy.pos.z)
        scratchScale.set(poolSize, 1, poolSize)
        tellPool.setMatrixAt(
          index,
          scratchMatrix.compose(scratchPosition, scratchQuaternion.identity(), scratchScale),
        )
        scratchColor.lerpColors(TELL_EARLY, TELL_LATE, charge).multiplyScalar(0.4 + charge * 0.95)
        tellPool.setColorAt(index, scratchColor)

        const ringSize = slot.radius * (7.6 - charge * 5.4)
        scratchPosition.y = 0.07
        scratchScale.set(ringSize, 1, ringSize)
        tellRing.setMatrixAt(
          index,
          scratchMatrix.compose(scratchPosition, scratchQuaternion.identity(), scratchScale),
        )
        scratchColor.lerpColors(TELL_EARLY, TELL_LATE, charge).multiplyScalar(0.7 + charge * 1.6)
        tellRing.setColorAt(index, scratchColor)
      }

      shadows.instanceMatrix.needsUpdate = true
      tellPool.instanceMatrix.needsUpdate = true
      tellRing.instanceMatrix.needsUpdate = true
      if (tellPool.instanceColor) tellPool.instanceColor.needsUpdate = true
      if (tellRing.instanceColor) tellRing.instanceColor.needsUpdate = true
    },

    dispose() {
      for (const texture of emojiCache.values()) texture.dispose()
      emojiCache.clear()
    },
  }
}
