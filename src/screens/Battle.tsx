import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArenaControls } from '../components/ArenaControls'
import { ArenaHud } from '../components/ArenaHud'
import { useArena } from '../components/useArena'
import { useReducedMotion } from '../components/useReducedMotion'
import { isWebGLAvailable } from '../components/webglSupport'
import { gunFor } from '../game/arena/loadout'
import type { ArenaResult } from '../game/arena/types'
import { playCue } from '../game/audio'
import { simulateBattle } from '../game/battleEngine'
import { faNumber } from '../game/format'
import type { BattleSetup } from '../game/progression'
import type { Difficulty, Hero, Weapon } from '../game/types'

/**
 * The battlefield.
 *
 * Three.js lands in its own chunk and is fetched the first time a battle
 * starts, so the home screen never downloads a renderer it will not use.
 *
 * This screen deliberately breaks the layout every other screen keeps. The
 * campaign is a column of cards in a 520px shell; the arena takes the whole
 * viewport and puts its own HUD on top. A shooter that had to share the screen
 * with a top bar would be a worse shooter, and the player is never in here for
 * more than about ninety seconds.
 */
const ArenaCanvas = lazy(() => import('../components/ArenaCanvas'))

/** How long the finish is held on screen before the report takes over. */
const OUTRO_MS = 1900

interface BattleProps {
  setup: BattleSetup
  playerWeapon: Weapon
  /** The commander leading this fight. */
  hero: Hero
  /** Veterancy earned so far; the same value the engine is given. */
  veterancy: number
  /** Frozen when the battle starts, like the rest of the kit. */
  difficulty: Difficulty
  onFinished: (result: ArenaResult) => void
}

export function Battle({ setup, playerWeapon, hero, veterancy, difficulty, onFinished }: BattleProps) {
  const { terrain, enemy, level } = setup
  const reducedMotion = useReducedMotion()

  // The kit is frozen the moment the battle begins, so nothing bought or
  // equipped afterwards could reach into the fight in progress.
  const gun = useMemo(
    () => gunFor(playerWeapon, terrain, hero, veterancy),
    [playerWeapon, terrain, hero, veterancy],
  )

  const arena = useArena(
    useMemo(
      () => ({ gun, hero, enemy, terrain, level, difficulty }),
      [gun, hero, enemy, terrain, level, difficulty],
    ),
  )
  const { phase, result, subscribe, input } = arena

  const [webglFailed, setWebglFailed] = useState(false)
  const showCanvas = !webglFailed && isWebGLAvailable()

  const fieldRef = useRef<HTMLDivElement>(null)
  const briefingRef = useRef<HTMLDivElement>(null)

  const handleCanvasReady = useCallback(() => undefined, [])
  const handleCanvasFailure = useCallback(() => setWebglFailed(true), [])

  const motion = useRef(reducedMotion)
  useEffect(() => {
    motion.current = reducedMotion
  }, [reducedMotion])

  // Screen shake rides the field wrapper rather than the camera, so the HUD
  // above it stays perfectly still and legible while the world lurches.
  useEffect(() => {
    let shaking = false

    return subscribe((state) => {
      const box = fieldRef.current
      if (!box) return

      const shake = motion.current ? 0 : state.shake
      if (shake > 0.01) {
        shaking = true
        box.style.transform = `translate(${((Math.random() - 0.5) * shake * 10).toFixed(1)}px, ${((Math.random() - 0.5) * shake * 7).toFixed(1)}px)`
      } else if (shaking) {
        shaking = false
        box.style.transform = ''
      }

      const brief = briefingRef.current
      if (brief) {
        const showing = state.phase === 'briefing'
        brief.style.opacity = showing ? '1' : '0'
      }
    })
  }, [subscribe])

  useEffect(() => {
    if (phase === 'fighting') playCue('battle')
  }, [phase])

  useEffect(() => {
    if (phase !== 'over' || !result) return
    playCue(result.winner === 'player' ? 'victory' : 'defeat')
    const timer = window.setTimeout(() => onFinished(result), OUTRO_MS)
    return () => window.clearTimeout(timer)
  }, [phase, result, onFinished])

  /**
   * The way out for a device that cannot give us a WebGL context.
   *
   * There is no honest DOM version of a 3D arena the way there was of a
   * two-fighter duel, so rather than fake one, the battle falls back to the
   * campaign's original dice roll — the same `simulateBattle` the strategy
   * game shipped with. The player is told exactly that, and the run continues
   * instead of dead-ending on a device that cannot render the field.
   */
  const resolveOnPaper = useCallback(() => {
    playCue('tap')
    const outcome = simulateBattle({
      playerWeapon,
      enemyWeapon: enemy.weapon,
      terrain,
      playerBonus: veterancy,
      enemyBonus: enemy.terrainEdge,
    })
    const won = outcome.winner === 'player'
    const total = arena.state.totalEnemies

    onFinished({
      winner: outcome.winner,
      playerHealth: won ? 50 : 0,
      enemyForceLeft: won ? 0 : 50,
      duration: 0,
      kills: won ? total : Math.floor(total / 2),
      totalEnemies: total,
      shotsFired: 0,
      shotsHit: 0,
      accuracy: 0,
      bestStreak: 0,
      timedOut: false,
      resolvedOnPaper: true,
    })
  }, [playerWeapon, enemy, terrain, veterancy, arena.state.totalEnemies, onFinished])

  const finished = phase === 'over'

  return (
    <div className="arena">
      <div ref={fieldRef} className="arena__field">
        <div className="arena__stage">
          {showCanvas ? (
            <Suspense fallback={null}>
              <ArenaCanvas
                terrain={terrain}
                heroEmoji={hero.emoji}
                reducedMotion={reducedMotion}
                subscribe={subscribe}
                onReady={handleCanvasReady}
                onUnavailable={handleCanvasFailure}
              />
            </Suspense>
          ) : null}
        </div>
      </div>

      {showCanvas ? (
        <>
          <ArenaHud
            subscribe={subscribe}
            enemyName={enemy.name}
            magazine={gun.magazine}
            timeLimit={arena.state.timeLimit}
            waves={arena.state.waves.length}
            melee={gun.melee}
            weaponEmoji={gun.emoji}
            reducedMotion={reducedMotion}
          />
          <ArenaControls
            input={input}
            subscribe={subscribe}
            active={phase === 'fighting'}
            melee={gun.melee}
          />
        </>
      ) : null}

      {/* The drop-in. Persian, in the DOM, over the canvas — never inside it. */}
      {showCanvas ? (
        <div ref={briefingRef} className="arena-notice arena-notice--brief">
          <div className="arena-notice__card">
            <p className="arena-notice__title">
              {terrain.emoji} {level.name}
            </p>
            <p className="arena-notice__body">
              {enemy.emoji} {enemy.name} — «{enemy.taunt}»
            </p>
            <p className="arena-notice__body">
              {gun.emoji} {gun.name} · {faNumber(arena.state.totalEnemies)} دشمن در{' '}
              {faNumber(arena.state.waves.length)} موج
            </p>
          </div>
        </div>
      ) : null}

      {finished && result ? (
        <div className="arena-notice">
          <div className="arena-notice__card">
            <p className="arena-notice__title">
              {result.winner === 'player' ? '🏆 میدان مالِ توست!' : '💀 میدان را باختی'}
            </p>
            <p className="arena-notice__body">
              {faNumber(result.kills)} از {faNumber(result.totalEnemies)} دشمن ·{' '}
              {faNumber(Math.round(result.accuracy * 100))}٪ دقت
            </p>
          </div>
        </div>
      ) : null}

      {showCanvas ? null : (
        <div className="arena-notice">
          <div className="arena-notice__card">
            <p className="arena-notice__title">میدان سه‌بعدی اجرا نمی‌شود</p>
            <p className="arena-notice__body">
              مرورگر این دستگاه WebGL ندارد، پس نمی‌شود میدان را کشید. این نبرد را روی کاغذ حساب
              می‌کنیم — همان قاعدهٔ قدیمی: توانِ رزمی به‌علاوهٔ کمی شانس.
            </p>
            <button type="button" className="btn btn--primary btn--lg" onClick={resolveOnPaper}>
              نبرد را روی کاغذ حساب کن
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
