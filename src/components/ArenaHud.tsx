import { useEffect, useRef } from 'react'
import { playCue } from '../game/audio'
import { aimSpread, enemiesLeft } from '../game/arena/sim'
import { ARENA_HALF } from '../game/arena/world'
import { faNumber } from '../game/format'
import type { ArenaEnemy } from '../game/arena/types'
import type { ArenaDraw } from './useArena'

/**
 * Everything the player reads while fighting.
 *
 * All of it is Persian, and all of it is in the DOM. That is not a stylistic
 * preference: Arabic-script shaping and bidi do not survive a WebGL text
 * pipeline, so no label can ever be drawn into the canvas. The HUD floats
 * above it instead, where the browser can shape and lay out properly.
 *
 * Nothing here goes through React state. Every value below changes sixty times
 * a second, so it is written straight onto DOM nodes from inside the fight's
 * own frame callback — the same technique the old battle screen used, and the
 * reason a battle costs three renders instead of thousands.
 */

/** Pooled nodes for floating damage numbers, reused round robin. */
const DAMAGE_SLOTS = 8

/** Pooled arcs pointing at whatever just hit you. */
const HURT_SLOTS = 4

/**
 * The minimap.
 *
 * Player-centred and rotating, so straight up on the map is always the way the
 * commander is facing — the question it exists to answer is "what is flanking
 * me relative to where I am looking", and a fixed north-up map would make the
 * player do that rotation in their head mid-fight.
 *
 * The rotation is nearly free: the arena's cover never moves, so it is painted
 * once onto a small canvas that spins as a whole under one CSS transform, and
 * only the dozen enemy blips are repositioned per frame.
 *
 * FACING-UP MATHS, derived once and then trusted: the commander's forward on
 * the ground is (-sin yaw, -cos yaw) in (x, z), and the map draws +x to the
 * right and +z downward. A CSS rotation by +yaw sends that vector to (0, -1) —
 * straight up — for every yaw, so the rotor's transform is simply the yaw.
 */
const MINIMAP_SIZE = 104

/** Map pixels per world unit. At 2.5 the visible circle spans ~21 units. */
const MINIMAP_SCALE = 2.5

/** The full arena, in map pixels. */
const MINIMAP_WORLD = ARENA_HALF * 2 * MINIMAP_SCALE

/** Matches the renderer's enemy pool: there are never more bodies than this. */
const MINIMAP_BLIPS = 12

/** Health packs shown on the map. Matches the drop rule's practical ceiling. */
const MINIMAP_PACKS = 6

/** Blips stop this many pixels short of the rim, so edge threats stay visible. */
const MINIMAP_RIM = 6

/** Below this fraction of health the screen starts warning you. */
const DANGER = 0.3

/** Seconds left on the clock before the timer starts shouting. */
const URGENT_SECONDS = 15

/**
 * How many pixels of crosshair gap one radian of spread is worth.
 *
 * The crosshair is the only honest read the player has on their own accuracy,
 * so it is tied directly to the number the simulation actually fires with
 * rather than to an animation. Moving, sprinting and aiming all visibly change
 * it, which is what teaches the player to stop moving before they shoot.
 */
const SPREAD_TO_PIXELS = 340

interface ArenaHudProps {
  subscribe: (draw: ArenaDraw) => () => void
  /** Shown while the commander drops in. */
  enemyName: string
  /**
   * The starting readings.
   *
   * Every field below is owned by the frame callback, but the very first paint
   * happens before any frame has run — and in a backgrounded tab, where
   * `requestAnimationFrame` is throttled, it can be the only paint for a while.
   * Rendering a truthful magazine and clock instead of zeroes costs nothing and
   * stops the HUD from ever briefly lying about the fight.
   */
  magazine: number
  timeLimit: number
  waves: number
  /** A swung weapon has no magazine, so it is given no ammo readout at all. */
  melee: boolean
  weaponEmoji: string
  reducedMotion: boolean
}

export function ArenaHud({
  subscribe,
  enemyName,
  magazine,
  timeLimit,
  waves,
  melee,
  weaponEmoji,
  reducedMotion,
}: ArenaHudProps) {
  const healthFill = useRef<HTMLElement>(null)
  const healthGhost = useRef<HTMLElement>(null)
  const healthText = useRef<HTMLSpanElement>(null)
  const bossWrap = useRef<HTMLDivElement>(null)
  const bossName = useRef<HTMLSpanElement>(null)
  const bossFill = useRef<HTMLElement>(null)
  const bossGhost = useRef<HTMLElement>(null)
  const ammoText = useRef<HTMLSpanElement>(null)
  const ammoState = useRef<HTMLSpanElement>(null)
  const heatFill = useRef<HTMLElement>(null)
  const waveText = useRef<HTMLSpanElement>(null)
  const enemyCount = useRef<HTMLSpanElement>(null)
  const timerText = useRef<HTMLSpanElement>(null)
  const crosshair = useRef<HTMLDivElement>(null)
  const marker = useRef<HTMLDivElement>(null)
  const banner = useRef<HTMLDivElement>(null)
  const streakLabel = useRef<HTMLDivElement>(null)
  const damageLayer = useRef<HTMLDivElement>(null)
  const hurtLayer = useRef<HTMLDivElement>(null)
  const mapRotor = useRef<HTMLDivElement>(null)
  const mapWorld = useRef<HTMLDivElement>(null)
  const mapCanvas = useRef<HTMLCanvasElement>(null)
  const mapBlips = useRef<HTMLDivElement>(null)
  const mapPacks = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)

  const motion = useRef(reducedMotion)
  useEffect(() => {
    motion.current = reducedMotion
  }, [reducedMotion])

  useEffect(() => {
    const damageSlots = damageLayer.current
      ? (Array.from(damageLayer.current.children) as HTMLElement[])
      : []
    const hurtSlots = hurtLayer.current
      ? (Array.from(hurtLayer.current.children) as HTMLElement[])
      : []

    let damageSlot = 0
    let hurtSlot = 0
    let ghostAt = 1
    let previousNow = 0
    let shownStreak = 0
    let shownAmmo = -1
    let shownEnemies = -1
    let shownSeconds = -1
    let shownWave = 0
    let wasReloading = false
    let shotCue: 'shot' | 'shotBig' | 'shotEnergy' | 'swing' | null = null
    let bossOn = false
    let bossCritical = false
    let bossGhostAt = 1
    let mapDrawn = false
    const blipSlots = mapBlips.current
      ? (Array.from(mapBlips.current.children) as HTMLElement[])
      : []
    const blipKinds: string[] = blipSlots.map(() => '')
    const packSlots = mapPacks.current
      ? (Array.from(mapPacks.current.children) as HTMLElement[])
      : []

    /** Restarts a CSS animation. The reflow between the two writes is required. */
    const replay = (node: HTMLElement) => {
      node.style.animation = 'none'
      void node.offsetWidth
      node.style.animation = ''
    }

    return subscribe((state, now) => {
      const dt = previousNow === 0 ? 0 : Math.min(0.1, (now - previousNow) / 1000)
      previousNow = now

      const { player, gun } = state
      const healthAt = player.maxHealth > 0 ? player.health / player.maxHealth : 0

      /* -------- health -------- */
      if (healthFill.current) {
        healthFill.current.style.transform = `scaleX(${Math.max(0, healthAt).toFixed(3)})`
      }
      // The ghost only ever falls, and it falls slowly, so a blow you did not
      // see coming still leaves a visible mark of what it cost.
      ghostAt = healthAt > ghostAt ? healthAt : ghostAt + (healthAt - ghostAt) * Math.min(1, dt * 2.6)
      if (healthGhost.current) {
        healthGhost.current.style.transform = `scaleX(${Math.max(0, ghostAt).toFixed(3)})`
      }
      if (healthText.current) {
        healthText.current.textContent = faNumber(Math.max(0, Math.ceil(player.health)))
      }
      root.current?.classList.toggle('is-danger', healthAt > 0 && healthAt < DANGER)

      /* -------- ammo, reload and heat -------- */
      if (gun.overheat) {
        if (heatFill.current) {
          heatFill.current.style.transform = `scaleX(${player.heat.toFixed(3)})`
        }
        heatFill.current?.classList.toggle('is-redline', player.overheated)
        if (ammoState.current) {
          const label = player.overheated ? 'داغ شد!' : ''
          if (ammoState.current.textContent !== label) ammoState.current.textContent = label
        }
      } else if (player.ammo !== shownAmmo && ammoText.current) {
        shownAmmo = player.ammo
        ammoText.current.textContent = `${faNumber(player.ammo)} / ${faNumber(gun.magazine)}`
      }

      const reloading = player.reloadLeft > 0
      if (reloading !== wasReloading) {
        wasReloading = reloading
        if (ammoState.current && !gun.overheat) {
          ammoState.current.textContent = reloading ? 'بارگذاری…' : ''
        }
      }
      if (reloading && ammoState.current) {
        // A ring rather than a bar: it sits where the eye already is.
        ammoState.current.style.setProperty(
          '--reload',
          (1 - player.reloadLeft / Math.max(0.01, gun.reloadTime)).toFixed(3),
        )
      }

      /* -------- the field -------- */
      const left = enemiesLeft(state)
      if (left !== shownEnemies && enemyCount.current) {
        shownEnemies = left
        enemyCount.current.textContent = faNumber(left)
      }
      if (state.waveIndex !== shownWave && waveText.current) {
        shownWave = state.waveIndex
        waveText.current.textContent = `${faNumber(state.waveIndex)} از ${faNumber(state.waves.length)}`
      }

      /* -------- the boss bar -------- */
      // A plain loop, not a find(): this runs sixty times a second and a
      // closure per frame is exactly the garbage this file exists to avoid.
      let boss: ArenaEnemy | null = null
      for (const candidate of state.enemies) {
        if (candidate.kind === 'boss' && candidate.alive) {
          boss = candidate
          break
        }
      }

      if ((boss !== null) !== bossOn) {
        bossOn = boss !== null
        bossWrap.current?.classList.toggle('is-on', bossOn)
        if (bossOn) {
          // The name is written the moment the boss lands rather than at
          // mount, because only the fight knows which emoji leads the army.
          if (bossName.current) bossName.current.textContent = `${state.enemyEmoji} ${enemyName}`
          bossGhostAt = 1
        }
      }
      if (boss) {
        const bossAt = boss.maxHealth > 0 ? boss.health / boss.maxHealth : 0
        if (bossFill.current) {
          bossFill.current.style.transform = `scaleX(${Math.max(0, bossAt).toFixed(3)})`
        }
        // The same slow, downward-only ghost the player's bar has, so a big
        // sniper hit on the boss stays readable as a chunk rather than a blink.
        bossGhostAt = bossAt > bossGhostAt ? bossAt : bossGhostAt + (bossAt - bossGhostAt) * Math.min(1, dt * 2.6)
        if (bossGhost.current) {
          bossGhost.current.style.transform = `scaleX(${Math.max(0, bossGhostAt).toFixed(3)})`
        }
        const critical = bossAt > 0 && bossAt < 0.25
        if (critical !== bossCritical) {
          bossCritical = critical
          bossWrap.current?.classList.toggle('is-critical', critical)
        }
      }

      /* -------- the minimap -------- */
      // The static layer is painted the first time cover exists. Everything on
      // it is geometry, never text, so nothing here fights the RTL rule.
      if (!mapDrawn && state.cover.length > 0 && mapCanvas.current) {
        mapDrawn = true
        const canvas = mapCanvas.current
        const context = canvas.getContext('2d')
        if (context) {
          // Drawn at 2x and displayed at half, so the blips' crisp circles do
          // not sit on a blurry background on a high-density screen.
          const px = MINIMAP_WORLD * 2
          canvas.width = px
          canvas.height = px
          context.scale(2 * MINIMAP_SCALE, 2 * MINIMAP_SCALE)
          context.translate(ARENA_HALF, ARENA_HALF)

          context.strokeStyle = 'rgba(246, 243, 255, 0.4)'
          context.lineWidth = 0.5
          context.strokeRect(-ARENA_HALF, -ARENA_HALF, ARENA_HALF * 2, ARENA_HALF * 2)

          for (const piece of state.cover) {
            // Shoot-over rubble matters less to a route than a wall does.
            context.fillStyle = piece.blocksSight
              ? 'rgba(246, 243, 255, 0.34)'
              : 'rgba(246, 243, 255, 0.14)'
            if (piece.shape === 'cylinder') {
              context.beginPath()
              context.arc(piece.x, piece.z, piece.halfX, 0, Math.PI * 2)
              context.fill()
            } else {
              context.save()
              context.translate(piece.x, piece.z)
              // Canvas angles run the opposite way to the arena's yaw.
              context.rotate(-piece.rotation)
              context.fillRect(-piece.halfX, -piece.halfZ, piece.halfX * 2, piece.halfZ * 2)
              context.restore()
            }
          }
        }
      }

      if (mapRotor.current) {
        mapRotor.current.style.transform = `rotate(${player.yaw.toFixed(4)}rad)`
      }
      if (mapWorld.current) {
        const originX = MINIMAP_SIZE / 2 - (player.pos.x * MINIMAP_SCALE + MINIMAP_WORLD / 2)
        const originZ = MINIMAP_SIZE / 2 - (player.pos.z * MINIMAP_SCALE + MINIMAP_WORLD / 2)
        mapWorld.current.style.transform = `translate(${originX.toFixed(1)}px, ${originZ.toFixed(1)}px)`
      }

      // Blips. Clamped to the rim in WORLD space — a circle around the player
      // survives the rotor's rotation, so the clamp needs no angle maths.
      const rimWorld = (MINIMAP_SIZE / 2 - MINIMAP_RIM) / MINIMAP_SCALE
      let blip = 0
      for (const foe of state.enemies) {
        if (!foe.alive || blip >= blipSlots.length) continue
        const node = blipSlots[blip]
        if (!node) continue

        let x = foe.pos.x - player.pos.x
        let z = foe.pos.z - player.pos.z
        const away = Math.hypot(x, z)
        const clamped = away > rimWorld
        if (clamped && away > 0) {
          x = (x / away) * rimWorld
          z = (z / away) * rimWorld
        }

        const mapX = (player.pos.x + x) * MINIMAP_SCALE + MINIMAP_WORLD / 2
        const mapZ = (player.pos.z + z) * MINIMAP_SCALE + MINIMAP_WORLD / 2
        node.style.transform = `translate(${mapX.toFixed(1)}px, ${mapZ.toFixed(1)}px) translate(-50%, -50%)`

        // Class writes only on change: twelve className assignments a frame
        // would thrash style recalculation for nothing.
        const look = `${foe.kind}${clamped ? ' far' : ''}`
        if (blipKinds[blip] !== look) {
          blipKinds[blip] = look
          node.className = `minimap__blip minimap__blip--${foe.kind}${clamped ? ' is-far' : ''}`
        }
        if (node.style.opacity !== '1') node.style.opacity = '1'
        blip += 1
      }
      for (; blip < blipSlots.length; blip += 1) {
        const node = blipSlots[blip]
        if (node && node.style.opacity !== '0') {
          node.style.opacity = '0'
          blipKinds[blip] = ''
        }
      }

      // Pack blips share the enemies' rim clamp, so a heal dropped behind you
      // still shows as a green direction marker at the edge of the circle.
      let packAt = 0
      for (const pack of state.packs) {
        if (packAt >= packSlots.length) break
        const node = packSlots[packAt]
        if (!node) continue
        let px = pack.pos.x - player.pos.x
        let pz = pack.pos.z - player.pos.z
        const off = Math.hypot(px, pz)
        if (off > rimWorld && off > 0) {
          px = (px / off) * rimWorld
          pz = (pz / off) * rimWorld
        }
        const mx = (player.pos.x + px) * MINIMAP_SCALE + MINIMAP_WORLD / 2
        const mz = (player.pos.z + pz) * MINIMAP_SCALE + MINIMAP_WORLD / 2
        node.style.transform = `translate(${mx.toFixed(1)}px, ${mz.toFixed(1)}px) translate(-50%, -50%)`
        if (node.style.opacity !== '1') node.style.opacity = '1'
        packAt += 1
      }
      for (; packAt < packSlots.length; packAt += 1) {
        const node = packSlots[packAt]
        if (node && node.style.opacity !== '0') node.style.opacity = '0'
      }

      const remaining = Math.max(0, Math.ceil(state.timeLimit - state.elapsed))
      if (remaining !== shownSeconds && timerText.current) {
        shownSeconds = remaining
        timerText.current.textContent = faNumber(remaining)
        timerText.current.classList.toggle('is-urgent', remaining <= URGENT_SECONDS)
      }

      /* -------- crosshair -------- */
      if (crosshair.current) {
        const gap = 5 + aimSpread(state) * SPREAD_TO_PIXELS
        crosshair.current.style.setProperty('--gap', `${gap.toFixed(1)}px`)
        // A scoped weapon puts the player's eye on the sight, so the hip
        // crosshair gets out of the way rather than sitting on top of it.
        crosshair.current.style.opacity = gun.adsZoom < 0.6 && player.ads > 0.85 ? '0' : '1'
      }
      if (marker.current) {
        marker.current.style.opacity = state.hitMarker > 0 ? '1' : '0'
      }

      /* -------- streak -------- */
      if (player.streak !== shownStreak) {
        shownStreak = player.streak
        const label = streakLabel.current
        if (label) {
          label.textContent = shownStreak >= 2 ? `×${faNumber(shownStreak)}` : ''
          label.classList.toggle('is-on', shownStreak >= 2)
          if (shownStreak >= 2 && !motion.current) replay(label)
        }
      }

      /* -------- events -------- */
      for (const event of state.events) {
        if (event.kind === 'hit' || event.kind === 'kill') {
          const node = damageSlots[damageSlot % Math.max(1, damageSlots.length)]
          damageSlot += 1
          if (node) {
            node.textContent = faNumber(Math.max(1, Math.round(event.amount)))
            node.className = `arena-dmg${event.kind === 'kill' ? ' arena-dmg--kill' : ''}`
            // These are 3D world positions and this layer is flat, so there is
            // no honest way to place them without the camera matrix the HUD
            // deliberately does not have. They pop near the crosshair instead,
            // jittered off the event id so simultaneous hits do not stack —
            // which is what the player is looking at anyway.
            node.style.left = `${48 + ((event.id * 37) % 100) / 12}%`
            node.style.top = `${40 + ((event.id * 53) % 100) / 10}%`
            if (!motion.current) replay(node)
          }
          playCue('hit')
        } else if (event.kind === 'hurt') {
          const node = hurtSlots[hurtSlot % Math.max(1, hurtSlots.length)]
          hurtSlot += 1
          if (node) {
            // Where did that come from. In a third-person shooter the thing
            // that kills you is usually off-screen, and an unexplained health
            // drop reads as unfair rather than as difficult.
            const dx = event.pos.x - player.pos.x
            const dz = event.pos.z - player.pos.z
            const forwardX = -Math.sin(player.yaw)
            const forwardZ = -Math.cos(player.yaw)
            const rightX = Math.cos(player.yaw)
            const rightZ = -Math.sin(player.yaw)
            const bearing = Math.atan2(dx * rightX + dz * rightZ, dx * forwardX + dz * forwardZ)
            node.style.transform = `rotate(${bearing.toFixed(3)}rad)`
            if (!motion.current) replay(node)
          }
          playCue('hurt')
        } else if (event.kind === 'muzzle') {
          // Worked out once and remembered: it cannot change mid-fight, and
          // this runs on every shot of a ten-rounds-a-second automatic.
          if (shotCue === null) {
            shotCue = gun.melee
              ? 'swing'
              : gun.overheat
                ? 'shotEnergy'
                : gun.splash > 0 || gun.muzzleSpeed === Number.POSITIVE_INFINITY
                  ? 'shotBig'
                  : 'shot'
          }
          playCue(shotCue)
        } else if (event.kind === 'pickup') {
          playCue('heal')
          const node = damageSlots[damageSlot % Math.max(1, damageSlots.length)]
          damageSlot += 1
          if (node) {
            // The one green number in the game, and the only one with a plus.
            node.textContent = `+${faNumber(Math.max(1, Math.round(event.amount)))}`
            node.className = 'arena-dmg arena-dmg--heal'
            node.style.left = `${48 + ((event.id * 37) % 100) / 12}%`
            node.style.top = `${40 + ((event.id * 53) % 100) / 10}%`
            if (!motion.current) replay(node)
          }
        } else if (event.kind === 'reload') {
          playCue('reload')
        } else if (event.kind === 'explosion') {
          playCue('blast')
        } else if (event.kind === 'wave') {
          const node = banner.current
          if (node) {
            node.textContent = `موج ${faNumber(event.amount)}`
            node.classList.add('is-on')
            if (!motion.current) replay(node)
            window.setTimeout(() => node.classList.remove('is-on'), 1400)
          }
          playCue('battle')
        } else if (event.kind === 'empty') {
          playCue('dryFire')
        }
      }
    })
  }, [subscribe, enemyName])

  return (
    <div ref={root} className="arena-hud">
      <div className="arena-hud__top">
        <div className="arena-stat">
          <span className="arena-stat__label">موج</span>
          <span ref={waveText} className="arena-stat__value">
            {`${faNumber(1)} از ${faNumber(waves)}`}
          </span>
        </div>
        <div className="arena-stat arena-stat--timer">
          <span ref={timerText} className="arena-stat__value">
            {faNumber(timeLimit)}
          </span>
        </div>
        <div className="arena-stat">
          <span className="arena-stat__label">{enemyName}</span>
          <span ref={enemyCount} className="arena-stat__value">
            {faNumber(0)}
          </span>
        </div>
      </div>

      <div className="minimap" aria-hidden="true">
        <div ref={mapRotor} className="minimap__rotor">
          <div ref={mapWorld} className="minimap__world">
            <canvas ref={mapCanvas} className="minimap__ground" />
            <div ref={mapBlips} className="minimap__layer">
              {Array.from({ length: MINIMAP_BLIPS }, (_, index) => (
                <i key={index} className="minimap__blip" />
              ))}
            </div>
            <div ref={mapPacks} className="minimap__layer">
              {Array.from({ length: MINIMAP_PACKS }, (_, index) => (
                <i key={index} className="minimap__pack" />
              ))}
            </div>
          </div>
        </div>
        {/* Outside the rotor on purpose: the map turns, the player never does.
            The wedge above the arrow is the view cone, and it is honest — up
            IS where the camera points. */}
        <div className="minimap__cone" />
        <div className="minimap__player" />
      </div>

      {/* Empty and invisible until a boss actually stands on the field, so
          the five ordinary battles never pay for it. */}
      <div ref={bossWrap} className="arena-boss" aria-hidden="true">
        <span ref={bossName} className="arena-boss__name" />
        <div className="arena-boss__track">
          <i ref={bossGhost} className="arena-boss__ghost" />
          <i ref={bossFill} className="arena-boss__fill" />
        </div>
      </div>

      <div ref={crosshair} className="crosshair" aria-hidden="true">
        <i className="crosshair__arm crosshair__arm--up" />
        <i className="crosshair__arm crosshair__arm--down" />
        <i className="crosshair__arm crosshair__arm--left" />
        <i className="crosshair__arm crosshair__arm--right" />
        <div ref={marker} className="crosshair__marker" />
      </div>

      <div ref={damageLayer} className="arena-dmg-layer" aria-hidden="true">
        {Array.from({ length: DAMAGE_SLOTS }, (_, index) => (
          <span key={index} className="arena-dmg" />
        ))}
      </div>

      <div ref={hurtLayer} className="arena-hurt-layer" aria-hidden="true">
        {Array.from({ length: HURT_SLOTS }, (_, index) => (
          <i key={index} className="arena-hurt" />
        ))}
      </div>

      <div ref={banner} className="arena-banner" aria-hidden="true" />
      <div ref={streakLabel} className="arena-streak" aria-hidden="true" />

      <div className="arena-hud__bottom">
        <div className="arena-vitals">
          <span className="arena-vitals__label">جان</span>
          <div className="arena-vitals__track">
            <i ref={healthGhost} className="arena-vitals__ghost" />
            <i ref={healthFill} className="arena-vitals__fill" />
          </div>
          <span ref={healthText} className="arena-vitals__num">
            {faNumber(100)}
          </span>
        </div>

        <div className="arena-ammo">
          {melee ? (
            // Counting rounds for an axe would be a number with no meaning
            // behind it. The weapon itself is the only useful thing to show.
            <span className="arena-ammo__count arena-ammo__count--melee" aria-hidden="true">
              {weaponEmoji}
            </span>
          ) : (
            <>
              <span ref={ammoState} className="arena-ammo__state" />
              <span ref={ammoText} className="arena-ammo__count">
                {`${faNumber(magazine)} / ${faNumber(magazine)}`}
              </span>
              <div className="arena-ammo__heat">
                <i ref={heatFill} className="arena-ammo__heatfill" />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="arena-vignette" aria-hidden="true" />
    </div>
  )
}
