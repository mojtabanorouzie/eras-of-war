import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DuelStage } from '../components/DuelStage'
import { terrainVars } from '../components/theme'
import { useDuel } from '../components/useDuel'
import { useReducedMotion } from '../components/useReducedMotion'
import { isWebGLAvailable } from '../components/webglSupport'
import { playCue } from '../game/audio'
import { enemyCombatStats, playerCombatStats } from '../game/combat'
import type { DuelResult, DuelState } from '../game/duel'
import { inReach } from '../game/duel'
import { faNumber } from '../game/format'
import type { BattleSetup } from '../game/progression'
import type { Weapon } from '../game/types'

/**
 * Three.js lands in its own chunk and is fetched the first time a battle
 * starts, so the home screen never downloads a renderer it will not use. Until
 * it arrives — and on every device without WebGL — `DuelStage` runs the very
 * same fight in the DOM.
 */
const BattleCanvas = lazy(() => import('../components/BattleCanvas'))

/** How long the finish is held on screen before the report takes over. */
const OUTRO_MS = 1700

/** Floating damage numbers reuse this many nodes, round robin. */
const DAMAGE_SLOTS = 10

/** Matches WORLD_MIN_WIDTH, so a number pops where the blow landed. */
const STAGE_SPAN = 22

/** Below this fraction of health, the screen starts warning you. */
const DANGER = 0.3

interface BattleProps {
  setup: BattleSetup
  playerWeapon: Weapon
  /** Veterancy earned so far; the same value the engine is given. */
  veterancy: number
  onFinished: (result: DuelResult) => void
}

export function Battle({ setup, playerWeapon, veterancy, onFinished }: BattleProps) {
  const { terrain, enemy } = setup
  const reducedMotion = useReducedMotion()

  const stats = useMemo(
    () => ({
      player: playerCombatStats(playerWeapon, terrain, veterancy),
      enemy: enemyCombatStats(enemy, terrain),
    }),
    [playerWeapon, terrain, veterancy, enemy],
  )

  const duel = useDuel(stats.player, stats.enemy)
  const { phase, result, subscribe, attack, dodge } = duel

  const [webglFailed, setWebglFailed] = useState(false)
  const [canvasLive, setCanvasLive] = useState(false)
  const showCanvas = !webglFailed && isWebGLAvailable()

  const handleCanvasReady = useCallback(() => setCanvasLive(true), [])
  const handleCanvasFailure = useCallback(() => {
    setWebglFailed(true)
    setCanvasLive(false)
  }, [])

  // Everything below updates sixty times a second, so it is written straight to
  // the DOM from the fight loop rather than through React state.
  const field = useRef<HTMLDivElement>(null)
  const playerBar = useRef<HTMLElement>(null)
  const enemyBar = useRef<HTMLElement>(null)
  const playerGhost = useRef<HTMLElement>(null)
  const enemyGhost = useRef<HTMLElement>(null)
  const attackButton = useRef<HTMLButtonElement>(null)
  const dodgeButton = useRef<HTMLButtonElement>(null)
  const cue = useRef<HTMLParagraphElement>(null)
  const damageLayer = useRef<HTMLDivElement>(null)
  const comboLabel = useRef<HTMLDivElement>(null)
  const perfectFlash = useRef<HTMLDivElement>(null)

  // Holding a control keeps firing it, which is what an action game should do.
  const held = useRef({ attack: false, dodge: false })
  const motion = useRef(reducedMotion)
  useEffect(() => {
    motion.current = reducedMotion
  }, [reducedMotion])

  useEffect(() => {
    let wasInReach: boolean | null = null
    let shownCombo = 0
    let previousNow = 0
    // Ghost bars trail the real ones, so you can see what a blow just cost.
    let playerGhostAt = 1
    let enemyGhostAt = 1
    let slot = 0

    const slots = damageLayer.current
      ? (Array.from(damageLayer.current.children) as HTMLElement[])
      : []

    const pop = (state: DuelState) => {
      for (const event of state.events) {
        const node = slots[slot % Math.max(1, slots.length)]
        slot += 1
        if (!node) continue

        node.textContent = faNumber(Math.max(1, Math.round(event.damage)))
        node.className = `dmg${event.counter ? ' dmg--counter' : ''}${event.target === 'player' ? ' dmg--taken' : ''}`
        node.style.left = `${((event.x / STAGE_SPAN + 0.5) * 100).toFixed(1)}%`
        // Stagger the rise so simultaneous hits do not stack on one another.
        node.style.top = `${28 + (event.id % 3) * 8}%`
        // Restarting a CSS animation needs the reflow between the two writes.
        node.style.animation = 'none'
        void node.offsetWidth
        node.style.animation = ''

        playCue(event.target === 'player' ? 'hurt' : 'hit')
      }
    }

    return subscribe((state, now) => {
      const dt = previousNow === 0 ? 0 : Math.min(0.1, (now - previousNow) / 1000)
      previousNow = now

      if (held.current.attack) attack()
      if (held.current.dodge) dodge()

      const playerAt = state.player.health / state.stats.player.maxHealth
      const enemyAt = state.enemy.health / state.stats.enemy.maxHealth

      const scale = (bar: HTMLElement | null, fraction: number) => {
        if (bar) bar.style.transform = `scaleX(${Math.max(0, fraction).toFixed(3)})`
      }
      scale(playerBar.current, playerAt)
      scale(enemyBar.current, enemyAt)

      // The ghost catches up slowly, and only ever downward.
      playerGhostAt = playerAt > playerGhostAt ? playerAt : playerGhostAt + (playerAt - playerGhostAt) * Math.min(1, dt * 2.6)
      enemyGhostAt = enemyAt > enemyGhostAt ? enemyAt : enemyGhostAt + (enemyAt - enemyGhostAt) * Math.min(1, dt * 2.6)
      scale(playerGhost.current, playerGhostAt)
      scale(enemyGhost.current, enemyGhostAt)

      const ready = (button: HTMLButtonElement | null, remaining: number, total: number) => {
        if (!button) return
        button.style.setProperty('--charge', (total <= 0 ? 1 : 1 - Math.min(1, remaining / total)).toFixed(3))
      }
      ready(attackButton.current, state.player.attackCooldown, state.stats.player.cycle)
      ready(dodgeButton.current, state.player.dodgeCooldown, state.stats.player.dodgeCooldown)

      const box = field.current
      if (box) {
        // Shake the whole arena, not the camera inside it, so the fallback
        // shakes too and nothing drifts out of register with the HUD.
        const shake = motion.current ? 0 : state.shake
        box.style.transform =
          shake > 0.01
            ? `translate(${((Math.random() - 0.5) * shake * 9).toFixed(1)}px, ${((Math.random() - 0.5) * shake * 6).toFixed(1)}px)`
            : ''
        box.classList.toggle('is-slowmo', state.slowMotion > 0 && !motion.current)
        box.classList.toggle('is-danger', playerAt > 0 && playerAt < DANGER)
      }

      pop(state)

      if (state.perfectDodge) {
        playCue('perfect')
        const flash = perfectFlash.current
        if (flash) {
          flash.style.animation = 'none'
          void flash.offsetWidth
          flash.style.animation = ''
        }
      }

      if (state.player.combo !== shownCombo) {
        shownCombo = state.player.combo
        const label = comboLabel.current
        if (label) {
          label.textContent = shownCombo >= 3 ? `×${faNumber(shownCombo)}` : ''
          label.classList.toggle('is-on', shownCombo >= 3)
          if (shownCombo >= 3) {
            label.style.animation = 'none'
            void label.offsetWidth
            label.style.animation = ''
          }
        }
      }

      if (state.phase === 'fighting') {
        const reachable = inReach(state)
        if (reachable !== wasInReach) {
          wasInReach = reachable
          if (cue.current) {
            cue.current.textContent = reachable ? '🎯 در برد — بزن!' : 'هنوز دور است…'
          }
        }
      }
    })
  }, [subscribe, attack, dodge])

  useEffect(() => {
    if (phase === 'fighting') playCue('battle')
  }, [phase])

  useEffect(() => {
    if (phase !== 'over' || !result) return
    playCue(result.winner === 'player' ? 'victory' : 'defeat')
    const timer = window.setTimeout(() => onFinished(result), OUTRO_MS)
    return () => window.clearTimeout(timer)
  }, [phase, result, onFinished])

  // Desktop players get the keyboard; the buttons are for thumbs.
  useEffect(() => {
    const isAttack = (key: string) => key === ' ' || key === 'Enter'
    const isDodge = (key: string) => key === 'Shift' || key === 'ArrowDown' || key === 'ArrowLeft'

    const down = (event: KeyboardEvent) => {
      if (isAttack(event.key)) {
        event.preventDefault()
        held.current.attack = true
      } else if (isDodge(event.key)) {
        event.preventDefault()
        held.current.dodge = true
      }
    }
    const up = (event: KeyboardEvent) => {
      if (isAttack(event.key)) held.current.attack = false
      else if (isDodge(event.key)) held.current.dodge = false
    }

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const press = useCallback(
    (control: 'attack' | 'dodge') => (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      held.current[control] = true
    },
    [],
  )

  const release = useCallback(
    (control: 'attack' | 'dodge') => () => {
      held.current[control] = false
    },
    [],
  )

  const status =
    phase === 'intro'
      ? 'سپاه‌ها وارد میدان می‌شوند…'
      : phase === 'over'
        ? result?.winner === 'player'
          ? '🏆 خطشان شکست!'
          : '💀 خط تو شکست!'
        : null

  return (
    <div className="screen">
      <div className="shell battle">
        <div className="hp">
          <div className="hp__side">
            <span className="hp__name">سپاه تو</span>
            <div className="hp__track">
              <i ref={playerGhost} className="hp__ghost" />
              <i ref={playerBar} className="hp__fill hp__fill--player" />
            </div>
          </div>
          <div className="hp__side hp__side--enemy">
            <span className="hp__name">{enemy.name}</span>
            <div className="hp__track">
              <i ref={enemyGhost} className="hp__ghost hp__ghost--enemy" />
              <i ref={enemyBar} className="hp__fill hp__fill--enemy" />
            </div>
          </div>
        </div>

        <div ref={field} className="battle__field" style={terrainVars(terrain)}>
          {showCanvas ? (
            // No Suspense fallback: the DOM field below is already running the
            // fight, so a slow chunk costs nothing. It steps aside once the
            // canvas has painted its first frame.
            <Suspense fallback={null}>
              <BattleCanvas
                terrain={terrain}
                playerEmoji={playerWeapon.emoji}
                enemyEmoji={enemy.emoji}
                reducedMotion={reducedMotion}
                subscribe={subscribe}
                onReady={handleCanvasReady}
                onUnavailable={handleCanvasFailure}
              />
            </Suspense>
          ) : null}

          {canvasLive ? null : (
            <DuelStage
              playerEmoji={playerWeapon.emoji}
              enemyEmoji={enemy.emoji}
              subscribe={subscribe}
            />
          )}

          {/* Persian numerals, in the DOM where they belong. */}
          <div ref={damageLayer} className="dmg-layer" aria-hidden="true">
            {Array.from({ length: DAMAGE_SLOTS }, (_, index) => (
              <span key={index} className="dmg" />
            ))}
          </div>

          <div ref={comboLabel} className="combo" aria-hidden="true" />
          <div ref={perfectFlash} className="perfect" aria-hidden="true">
            عالی!
          </div>
          <div className="danger-edge" aria-hidden="true" />
        </div>

        <p ref={cue} className="battle__status" aria-live="polite">
          {status}
        </p>

        <div className="controls">
          <button
            ref={attackButton}
            type="button"
            className="ctrl ctrl--attack"
            onPointerDown={press('attack')}
            onPointerUp={release('attack')}
            onPointerCancel={release('attack')}
            onPointerLeave={release('attack')}
          >
            <span className="ctrl__icon" aria-hidden="true">
              {playerWeapon.emoji}
            </span>
            <span className="ctrl__label">حمله</span>
          </button>
          <button
            ref={dodgeButton}
            type="button"
            className="ctrl ctrl--dodge"
            onPointerDown={press('dodge')}
            onPointerUp={release('dodge')}
            onPointerCancel={release('dodge')}
            onPointerLeave={release('dodge')}
          >
            <span className="ctrl__icon" aria-hidden="true">
              💨
            </span>
            <span className="ctrl__label">جاخالی</span>
          </button>
        </div>
      </div>
    </div>
  )
}
