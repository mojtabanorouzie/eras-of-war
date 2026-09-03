import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three'
import { radialTexture } from '../textures'
import type { ArenaEventView, BulletView } from './view'

/**
 * Everything that flashes, streaks, sparks and blows up.
 *
 * Five pools, all instanced, all allocated in full before the first frame. A
 * shooter spawns effects in bursts — a shotgun is eight impacts in one frame —
 * and the one thing that must never happen at that moment is a heap allocation,
 * so every pool here is a fixed ring of plain objects that are written over
 * rather than replaced. Nothing in this file constructs anything after
 * `createArenaFx` returns.
 *
 * Each pool is one draw call for however many of it are on screen, which is why
 * a grenade going off in a crowd costs the same as a single rifle shot.
 */

/* ------------------------------------------------------------------ *
 *  Pool sizes
 * ------------------------------------------------------------------ */

/**
 * Rounds in flight. A shotgun's pellets all exist at once and the enemy squad
 * is firing at the same time, so this has to clear a full spread plus the
 * field's return fire. Beyond it a bullet is simply not drawn — the simulation
 * still fires it, so the fight stays honest.
 */
const MAX_BULLETS = 40

/** Hitscan streaks. They live a couple of frames, so a handful is plenty. */
const MAX_TRACERS = 16
const TRACER_LIFE = 0.07
/** Thickness of a tracer in world units. Any thinner and it aliases away. */
const TRACER_WIDTH = 0.045

const MAX_FLASHES = 8
const FLASH_LIFE = 0.055

/**
 * Sparks and dust. One impact is six, a body hit is eight and an explosion is
 * fourteen, so this holds roughly five simultaneous events before the ring
 * starts overwriting its own oldest particles — which is the correct thing to
 * lose first.
 */
const MAX_PUFFS = 72

const MAX_BLASTS = 6
const BLAST_LIFE = 0.34

/**
 * Units per second squared pulling sparks down. Lower than real gravity: these
 * are embers, not bricks, and 9.8 makes them look like falling rubble.
 */
const SPARK_GRAVITY = 14
/** Exponential velocity decay, per second. Sparks lose their throw and hang. */
const SPARK_DRAG = 7.2

/* ------------------------------------------------------------------ *
 *  Colours
 * ------------------------------------------------------------------ */

const MUZZLE_COLOUR = new Color(0xffd27a)
/**
 * There is only one tracer colour because there is only ever one source of
 * tracers: a `muzzle` event is the commander's shot, and the view gives no way
 * to attribute an `impact` to anyone else. Enemy fire is all travelling rounds,
 * which the player reads from the bullet meshes instead.
 */
const TRACER_COLOUR = new Color(0xfff0b8)
const BULLET_PLAYER = new Color(0xffe08a)
const BULLET_ENEMY = new Color(0xff6a5a)
const BULLET_SPLASH = new Color(0xffa53d)
const DUST_COLOUR = new Color(0xd8d2c4)
const BLOOD_COLOUR = new Color(0xff5f5f)
const CRIT_COLOUR = new Color(0xffd166)
const BLAST_COLOUR = new Color(0xffa03c)
const DODGE_COLOUR = new Color(0xbfe4ff)
const HURT_COLOUR = new Color(0xff3d3d)

/* ------------------------------------------------------------------ *
 *  Scratch
 * ------------------------------------------------------------------ */

const FORWARD = new Vector3(0, 0, 1)
const ZERO_MATRIX = new Matrix4().makeScale(0, 0, 0)
const scratchPosition = new Vector3()
const scratchScale = new Vector3()
const scratchDirection = new Vector3()
const scratchQuaternion = new Quaternion()
const scratchMatrix = new Matrix4()
const scratchColor = new Color()
const frameMuzzle = new Vector3()

/* ------------------------------------------------------------------ *
 *  Pool records
 * ------------------------------------------------------------------ */

interface Puff {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  life: number
  maxLife: number
  size: number
  colour: Color
}

interface Tracer {
  x: number
  y: number
  z: number
  /** Orientation is fixed the moment it is fired, so it is stored, not recomputed. */
  quaternion: Quaternion
  length: number
  life: number
  colour: Color
}

interface Flash {
  x: number
  y: number
  z: number
  size: number
  life: number
}

interface Blast {
  x: number
  y: number
  z: number
  radius: number
  life: number
}

export interface ArenaFx {
  readonly group: Group
  /**
   * Drains one frame of events into the pools.
   *
   * @param muzzle the barrel's world position, or null when the commander has
   *               not been placed yet. The simulation's `muzzle` event carries
   *               the aim ray's origin, which is on the body's centre line;
   *               this is where the flash actually belongs.
   */
  consume(events: readonly ArenaEventView[], muzzle: Vector3 | null): void
  /** Places every round currently in flight. */
  bullets(list: readonly BulletView[]): void
  /** Ages every pool and writes its instance buffers. */
  update(dt: number, cameraQuaternion: Quaternion): void
}

export function createArenaFx(): ArenaFx {
  const group = new Group()

  const radial = radialTexture()

  /**
   * Additive, unfogged, depth-tested but never depth-writing: an effect has to
   * hide behind cover, but must never hide another effect.
   *
   * Additive blending is also what lets a whole pool share one material — the
   * per-instance colour doubles as the per-instance opacity, so fading a single
   * spark never touches a material and never recompiles a shader.
   */
  function glow(mapped: boolean): MeshBasicMaterial {
    return new MeshBasicMaterial({
      map: mapped ? radial : null,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
    })
  }

  const bulletMesh = new InstancedMesh(new SphereGeometry(0.5, 8, 6), glow(false), MAX_BULLETS)
  const tracerMesh = new InstancedMesh(new BoxGeometry(1, 1, 1), glow(false), MAX_TRACERS)
  const flashMesh = new InstancedMesh(new PlaneGeometry(1, 1), glow(true), MAX_FLASHES)
  const puffMesh = new InstancedMesh(new PlaneGeometry(1, 1), glow(true), MAX_PUFFS)
  const blastMesh = new InstancedMesh(new IcosahedronGeometry(0.5, 2), glow(false), MAX_BLASTS)

  for (const mesh of [bulletMesh, tracerMesh, flashMesh, puffMesh, blastMesh]) {
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    for (let i = 0; i < mesh.count; i += 1) {
      mesh.setMatrixAt(i, ZERO_MATRIX)
      mesh.setColorAt(i, scratchColor.setRGB(0, 0, 0))
    }
    // Effects are scattered across the whole arena and move every frame, so
    // recomputing bounds would cost more than the culling could ever save.
    mesh.frustumCulled = false
    group.add(mesh)
  }

  const puffs: Puff[] = Array.from({ length: MAX_PUFFS }, () => ({
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 0,
    maxLife: 1,
    size: 0,
    colour: new Color(),
  }))
  let puffCursor = 0

  const tracers: Tracer[] = Array.from({ length: MAX_TRACERS }, () => ({
    x: 0,
    y: 0,
    z: 0,
    quaternion: new Quaternion(),
    length: 0,
    life: 0,
    colour: new Color(),
  }))
  let tracerCursor = 0

  const flashes: Flash[] = Array.from({ length: MAX_FLASHES }, () => ({
    x: 0,
    y: 0,
    z: 0,
    size: 0,
    life: 0,
  }))
  let flashCursor = 0

  const blasts: Blast[] = Array.from({ length: MAX_BLASTS }, () => ({
    x: 0,
    y: 0,
    z: 0,
    radius: 1,
    life: 0,
  }))
  let blastCursor = 0

  /* --- Spawning ---------------------------------------------------- */

  function spawnPuff(
    x: number,
    y: number,
    z: number,
    speed: number,
    life: number,
    size: number,
    colour: Color,
  ): void {
    const puff = puffs[puffCursor]
    puffCursor = (puffCursor + 1) % MAX_PUFFS
    if (!puff) return

    // A cosine-weighted direction on the upper hemisphere: sparks come off a
    // surface rather than out of a point, and an even sphere looks like a
    // firework instead of an impact.
    const theta = Math.random() * Math.PI * 2
    const rise = 0.25 + Math.random() * 0.75
    const flat = Math.sqrt(Math.max(0, 1 - rise * rise))
    const throwSpeed = speed * (0.55 + Math.random() * 0.75)

    puff.x = x
    puff.y = y
    puff.z = z
    puff.vx = Math.cos(theta) * flat * throwSpeed
    puff.vy = rise * throwSpeed
    puff.vz = Math.sin(theta) * flat * throwSpeed
    puff.life = life
    puff.maxLife = life
    puff.size = size
    puff.colour.copy(colour)
  }

  function burst(
    x: number,
    y: number,
    z: number,
    count: number,
    speed: number,
    life: number,
    size: number,
    colour: Color,
  ): void {
    for (let i = 0; i < count; i += 1) spawnPuff(x, y, z, speed, life, size, colour)
  }

  function spawnTracer(from: Vector3, x: number, y: number, z: number, colour: Color): void {
    const tracer = tracers[tracerCursor]
    tracerCursor = (tracerCursor + 1) % MAX_TRACERS
    if (!tracer) return

    scratchDirection.set(x - from.x, y - from.y, z - from.z)
    const length = scratchDirection.length()
    // A hitscan shot that lands on the barrel is a wall the player is standing
    // against; drawing a zero-length streak there would just flicker.
    if (length < 0.4) return

    scratchDirection.divideScalar(length)
    tracer.quaternion.setFromUnitVectors(FORWARD, scratchDirection)
    tracer.x = (from.x + x) / 2
    tracer.y = (from.y + y) / 2
    tracer.z = (from.z + z) / 2
    tracer.length = length
    tracer.life = TRACER_LIFE
    tracer.colour.copy(colour)
  }

  function spawnFlash(x: number, y: number, z: number, size: number): void {
    const flash = flashes[flashCursor]
    flashCursor = (flashCursor + 1) % MAX_FLASHES
    if (!flash) return
    flash.x = x
    flash.y = y
    flash.z = z
    flash.size = size
    flash.life = FLASH_LIFE
  }

  function spawnBlast(x: number, y: number, z: number, radius: number): void {
    const blast = blasts[blastCursor]
    blastCursor = (blastCursor + 1) % MAX_BLASTS
    if (!blast) return
    blast.x = x
    blast.y = y
    blast.z = z
    blast.radius = Math.max(0.6, radius)
    blast.life = BLAST_LIFE
  }

  return {
    group,

    consume(events, muzzle) {
      /*
       * A hitscan shot arrives as a `muzzle` and its `impact` or `hit` in the
       * SAME frame, in that order. So the streak is drawn by remembering where
       * this frame's shot left from and connecting it to whatever it reached.
       * A travelling round has no muzzle event on the frame it lands, which is
       * exactly right — the bullet mesh already drew that path itself.
       */
      let fired = false

      for (const event of events) {
        const { pos } = event

        switch (event.kind) {
          case 'muzzle': {
            // The event's own position is the aim ray's origin, on the body's
            // centre line. The gun is a hand's width to the right of it.
            if (muzzle) frameMuzzle.copy(muzzle)
            else frameMuzzle.set(pos.x, pos.y, pos.z)
            fired = true
            spawnFlash(frameMuzzle.x, frameMuzzle.y, frameMuzzle.z, 0.52)
            break
          }

          case 'impact': {
            if (fired) spawnTracer(frameMuzzle, pos.x, pos.y, pos.z, TRACER_COLOUR)
            burst(pos.x, pos.y, pos.z, 6, 4.2, 0.26, 0.1, DUST_COLOUR)
            break
          }

          case 'hit': {
            const colour = event.critical ? CRIT_COLOUR : BLOOD_COLOUR
            if (fired) spawnTracer(frameMuzzle, pos.x, pos.y, pos.z, TRACER_COLOUR)
            // A landed hit is the feedback the whole gunfight is built on, so
            // it is deliberately brighter and longer-lived than a wall strike.
            burst(pos.x, pos.y, pos.z, event.critical ? 11 : 8, 5.4, 0.3, 0.14, colour)
            break
          }

          case 'kill': {
            burst(pos.x, pos.y, pos.z, 12, 6.4, 0.46, 0.19, CRIT_COLOUR)
            break
          }

          case 'explosion': {
            // `amount` is the splash radius, so the shell is exactly as big as
            // the damage it did — the player can learn the blast from the FX.
            spawnBlast(pos.x, pos.y, pos.z, event.amount)
            burst(pos.x, pos.y, pos.z, 14, 7.5, 0.5, 0.26, BLAST_COLOUR)
            break
          }

          case 'hurt': {
            burst(pos.x, pos.y, pos.z, 9, 4.6, 0.34, 0.17, HURT_COLOUR)
            break
          }

          case 'dodge': {
            // Low, cool and fast: it marks the ground the commander left, which
            // is the information a dodge actually conveys.
            burst(pos.x, pos.y + 0.1, pos.z, 8, 3.4, 0.28, 0.13, DODGE_COLOUR)
            break
          }

          // `reload`, `empty` and `wave` are HUD business. Nothing in the world
          // changes when a magazine does, and a Persian label cannot be drawn
          // into WebGL anyway.
          case 'reload':
          case 'empty':
          case 'wave':
            break
        }
      }
    },

    bullets(list) {
      for (let i = 0; i < MAX_BULLETS; i += 1) {
        const bullet = i < list.length ? list[i] : undefined
        if (!bullet) {
          bulletMesh.setMatrixAt(i, ZERO_MATRIX)
          continue
        }

        scratchDirection.set(bullet.vel.x, bullet.vel.y, bullet.vel.z)
        const speed = scratchDirection.length()
        if (speed > 1e-4) {
          scratchDirection.divideScalar(speed)
          scratchQuaternion.setFromUnitVectors(FORWARD, scratchDirection)
        } else {
          scratchQuaternion.identity()
        }

        const splash = bullet.splash > 0
        // Fat and slow reads as a lobbed shell; thin and stretched reads as a
        // rifle round. The stretch is capped so a fast round does not become a
        // metre-long worm.
        const width = splash ? 0.34 : 0.13
        const stretch = splash ? 1.2 : Math.min(5, 1 + speed * 0.024)

        scratchPosition.set(bullet.pos.x, bullet.pos.y, bullet.pos.z)
        scratchScale.set(width, width, width * stretch)
        bulletMesh.setMatrixAt(
          i,
          scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale),
        )
        bulletMesh.setColorAt(
          i,
          splash ? BULLET_SPLASH : bullet.owner === 'player' ? BULLET_PLAYER : BULLET_ENEMY,
        )
      }

      bulletMesh.instanceMatrix.needsUpdate = true
      if (bulletMesh.instanceColor) bulletMesh.instanceColor.needsUpdate = true
    },

    update(dt, cameraQuaternion) {
      /* --- Sparks and dust ---------------------------------------- */

      const drag = Math.exp(-SPARK_DRAG * dt)
      for (let i = 0; i < MAX_PUFFS; i += 1) {
        const puff = puffs[i]
        if (!puff) continue

        if (puff.life <= 0) {
          puffMesh.setMatrixAt(i, ZERO_MATRIX)
          continue
        }

        puff.life -= dt
        if (puff.life <= 0) {
          puffMesh.setMatrixAt(i, ZERO_MATRIX)
          puffMesh.setColorAt(i, scratchColor.setRGB(0, 0, 0))
          continue
        }

        puff.vy -= SPARK_GRAVITY * dt
        puff.vx *= drag
        puff.vy *= drag
        puff.vz *= drag
        puff.x += puff.vx * dt
        puff.y += puff.vy * dt
        puff.z += puff.vz * dt

        const left = puff.life / puff.maxLife
        const size = puff.size * (0.4 + left * 0.9)
        scratchPosition.set(puff.x, puff.y, puff.z)
        scratchScale.set(size, size, size)
        puffMesh.setMatrixAt(
          i,
          scratchMatrix.compose(scratchPosition, cameraQuaternion, scratchScale),
        )
        // Additive blending means brightness IS opacity, so the fade is a
        // straight multiply on the colour and no material has to change.
        puffMesh.setColorAt(i, scratchColor.copy(puff.colour).multiplyScalar(left * left))
      }

      /* --- Tracers ------------------------------------------------- */

      for (let i = 0; i < MAX_TRACERS; i += 1) {
        const tracer = tracers[i]
        if (!tracer) continue

        if (tracer.life <= 0) {
          tracerMesh.setMatrixAt(i, ZERO_MATRIX)
          continue
        }

        tracer.life -= dt
        const left = Math.max(0, tracer.life / TRACER_LIFE)
        scratchPosition.set(tracer.x, tracer.y, tracer.z)
        // Thins as it fades rather than only dimming, so it reads as a streak
        // dissipating instead of a bar being turned down.
        scratchScale.set(TRACER_WIDTH * left, TRACER_WIDTH * left, tracer.length)
        tracerMesh.setMatrixAt(
          i,
          scratchMatrix.compose(scratchPosition, tracer.quaternion, scratchScale),
        )
        tracerMesh.setColorAt(i, scratchColor.copy(tracer.colour).multiplyScalar(left))
      }

      /* --- Muzzle flashes ------------------------------------------ */

      for (let i = 0; i < MAX_FLASHES; i += 1) {
        const flash = flashes[i]
        if (!flash) continue

        if (flash.life <= 0) {
          flashMesh.setMatrixAt(i, ZERO_MATRIX)
          continue
        }

        flash.life -= dt
        const left = Math.max(0, flash.life / FLASH_LIFE)
        // Biggest on the first frame and gone by the third. A flash that eases
        // in looks like a lamp; a flash that starts at full looks like a shot.
        const size = flash.size * (0.5 + left * 0.7)
        scratchPosition.set(flash.x, flash.y, flash.z)
        scratchScale.set(size, size, size)
        flashMesh.setMatrixAt(
          i,
          scratchMatrix.compose(scratchPosition, cameraQuaternion, scratchScale),
        )
        flashMesh.setColorAt(i, scratchColor.copy(MUZZLE_COLOUR).multiplyScalar(left * 1.6))
      }

      /* --- Blasts --------------------------------------------------- */

      for (let i = 0; i < MAX_BLASTS; i += 1) {
        const blast = blasts[i]
        if (!blast) continue

        if (blast.life <= 0) {
          blastMesh.setMatrixAt(i, ZERO_MATRIX)
          continue
        }

        blast.life -= dt
        const left = Math.max(0, blast.life / BLAST_LIFE)
        const grown = 1 - left
        // Overshoots the real splash radius slightly at the end: the shell has
        // to be seen leaving the damage behind, not sitting on top of it.
        const size = blast.radius * 2 * (0.3 + grown * 0.95)
        scratchPosition.set(blast.x, blast.y, blast.z)
        scratchScale.set(size, size, size)
        blastMesh.setMatrixAt(
          i,
          scratchMatrix.compose(scratchPosition, scratchQuaternion.identity(), scratchScale),
        )
        blastMesh.setColorAt(i, scratchColor.copy(BLAST_COLOUR).multiplyScalar(left * left * 1.4))
      }

      puffMesh.instanceMatrix.needsUpdate = true
      tracerMesh.instanceMatrix.needsUpdate = true
      flashMesh.instanceMatrix.needsUpdate = true
      blastMesh.instanceMatrix.needsUpdate = true
      if (puffMesh.instanceColor) puffMesh.instanceColor.needsUpdate = true
      if (tracerMesh.instanceColor) tracerMesh.instanceColor.needsUpdate = true
      if (flashMesh.instanceColor) flashMesh.instanceColor.needsUpdate = true
      if (blastMesh.instanceColor) blastMesh.instanceColor.needsUpdate = true
    },
  }
}
