import { useEffect, useState } from 'react'
import { PowerBar } from '../components/PowerBar'
import { terrainVars } from '../components/theme'
import { useReducedMotion } from '../components/useReducedMotion'
import { playCue } from '../game/audio'
import type { BattleSetup } from '../game/progression'
import type { BattleOutcome, Weapon } from '../game/types'

type Phase = 'march' | 'clash' | 'reveal'

/** Milliseconds into the sequence at which each phase starts, plus the exit. */
const TIMELINE = { clash: 750, reveal: 1500, done: 2600 }
const TIMELINE_REDUCED = { clash: 60, reveal: 200, done: 900 }

interface BattleProps {
  setup: BattleSetup
  outcome: BattleOutcome
  playerWeapon: Weapon
  onFinished: () => void
}

export function Battle({ setup, outcome, playerWeapon, onFinished }: BattleProps) {
  const { terrain, enemy } = setup
  const reducedMotion = useReducedMotion()
  const [phase, setPhase] = useState<Phase>('march')

  useEffect(() => {
    const timeline = reducedMotion ? TIMELINE_REDUCED : TIMELINE
    const timers = [
      window.setTimeout(() => {
        setPhase('clash')
        playCue('battle')
      }, timeline.clash),
      window.setTimeout(() => {
        setPhase('reveal')
        playCue(outcome.winner === 'player' ? 'victory' : 'defeat')
      }, timeline.reveal),
      window.setTimeout(onFinished, timeline.done),
    ]
    return () => timers.forEach(window.clearTimeout)
  }, [reducedMotion, outcome.winner, onFinished])

  const revealed = phase === 'reveal'
  const scale = Math.max(outcome.playerPower, outcome.enemyPower, 1)

  const status =
    phase === 'march'
      ? 'سپاه‌ها وارد میدان می‌شوند…'
      : phase === 'clash'
        ? '⚔️ برخورد!'
        : outcome.winner === 'player'
          ? 'خط تو مقاومت کرد!'
          : 'خط تو شکست!'

  return (
    <div className="screen">
      <div className="shell battle">
        <div className="battle__field" style={terrainVars(terrain)}>
          <div className="fighter fighter--player">
            <span className="fighter__emoji" aria-hidden="true">
              {playerWeapon.emoji}
            </span>
            <span className="fighter__label">سپاه تو</span>
          </div>

          <span
            className={phase === 'march' ? 'battle__spark' : 'battle__spark battle__spark--on'}
            aria-hidden="true"
          >
            💥
          </span>

          <div className="fighter fighter--enemy">
            <span className="fighter__emoji" aria-hidden="true">
              {enemy.emoji}
            </span>
            <span className="fighter__label">{enemy.name}</span>
          </div>

          <div
            className={phase === 'clash' ? 'battle__flash battle__flash--on' : 'battle__flash'}
            aria-hidden="true"
          />
        </div>

        <p className="battle__status" aria-live="polite">
          {status}
        </p>

        <div className="card stack">
          <PowerBar
            label="سپاه تو"
            emoji={playerWeapon.emoji}
            value={outcome.playerPower}
            max={scale}
            side="player"
            showValue={revealed}
          />
          <PowerBar
            label={enemy.name}
            emoji={enemy.emoji}
            value={outcome.enemyPower}
            max={scale}
            side="enemy"
            showValue={revealed}
          />
        </div>
      </div>
    </div>
  )
}
