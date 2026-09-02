import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DuelStage } from '../components/DuelStage'
import { terrainVars } from '../components/theme'
import { useDuel } from '../components/useDuel'
import { useReducedMotion } from '../components/useReducedMotion'
import { isWebGLAvailable } from '../components/webglSupport'
import { playCue } from '../game/audio'
import { enemyCombatStats, playerCombatStats } from '../game/combat'
import type { DuelResult } from '../game/duel'
import { inReach } from '../game/duel'
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
  const playerBar = useRef<HTMLElement>(null)
  const enemyBar = useRef<HTMLElement>(null)
  const attackButton = useRef<HTMLButtonElement>(null)
  const dodgeButton = useRef<HTMLButtonElement>(null)
  const cue = useRef<HTMLParagraphElement>(null)

  // Holding a control keeps firing it, which is what an action game should do.
  const held = useRef({ attack: false, dodge: false })

  useEffect(() => {
    let wasInReach: boolean | null = null

    return subscribe((state) => {
      if (held.current.attack) attack()
      if (held.current.dodge) dodge()

      const scale = (bar: HTMLElement | null, fraction: number) => {
        if (bar) bar.style.transform = `scaleX(${Math.max(0, fraction).toFixed(3)})`
      }
      scale(playerBar.current, state.player.health / state.stats.player.maxHealth)
      scale(enemyBar.current, state.enemy.health / state.stats.enemy.maxHealth)

      const ready = (button: HTMLButtonElement | null, remaining: number, total: number) => {
        if (!button) return
        const charge = total <= 0 ? 1 : 1 - Math.min(1, remaining / total)
        button.style.setProperty('--charge', charge.toFixed(3))
      }
      ready(attackButton.current, state.player.attackCooldown, state.stats.player.cycle)
      ready(dodgeButton.current, state.player.dodgeCooldown, state.stats.player.dodgeCooldown)

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

  const press = useCallback((control: 'attack' | 'dodge') => {
    return (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      held.current[control] = true
    }
  }, [])

  const release = useCallback((control: 'attack' | 'dodge') => {
    return () => {
      held.current[control] = false
    }
  }, [])

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
              <i ref={playerBar} className="hp__fill hp__fill--player" />
            </div>
          </div>
          <div className="hp__side hp__side--enemy">
            <span className="hp__name">{enemy.name}</span>
            <div className="hp__track">
              <i ref={enemyBar} className="hp__fill hp__fill--enemy" />
            </div>
          </div>
        </div>

        <div className="battle__field" style={terrainVars(terrain)}>
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
