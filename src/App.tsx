import { useCallback, useEffect, useState } from 'react'
import { playCue } from './game/audio'
import { reportDuel } from './game/combat'
import type { DuelResult } from './game/duel'
import { payoutFor } from './game/economy'
import type { BattleSetup } from './game/progression'
import {
  currentBattleSetup,
  equippedWeapon,
  ownedWeapons,
  veterancyOf,
} from './game/progression'
import { useGame } from './game/useGame'
import type { BattleOutcome, Weapon } from './game/types'
import { Armory } from './screens/Armory'
import { Battle } from './screens/Battle'
import { BattlePreparation } from './screens/BattlePreparation'
import { Home } from './screens/Home'
import { HowToPlay } from './screens/HowToPlay'
import { Result } from './screens/Result'
import { Settings } from './screens/Settings'
import { Victory } from './screens/Victory'

type ScreenId = 'home' | 'armory' | 'prep' | 'battle' | 'result' | 'howto' | 'victory' | 'settings'

/** Where the armory should return to when it is closed. */
type ArmoryOrigin = 'home' | 'prep' | 'result'

/**
 * A battle that is being fought right now.
 *
 * The kit is frozen at the moment the player commits, so buying or equipping
 * something mid-fight could never change the fight in progress.
 */
interface PendingBattle {
  setup: BattleSetup
  weapon: Weapon
  veterancy: number
}

/**
 * A finished battle, held for the report screen.
 *
 * It carries its own setup and payout because winning advances `currentLevel`
 * before the result screen renders — reading them from live state would report
 * the *next* battle.
 */
interface ResolvedBattle {
  setup: BattleSetup
  outcome: BattleOutcome
  weapon: Weapon
  payout: number
}

export function App() {
  const { state, equip, buy, resolveBattle, toggleMute, resetGame } = useGame()
  const [screen, setScreen] = useState<ScreenId>('home')
  const [armoryOrigin, setArmoryOrigin] = useState<ArmoryOrigin>('home')
  const [pending, setPending] = useState<PendingBattle | null>(null)
  const [resolved, setResolved] = useState<ResolvedBattle | null>(null)
  // Bumped per battle so every fight mounts a fresh, empty duel.
  const [battleKey, setBattleKey] = useState(0)

  // Each screen is a fresh page as far as the player is concerned.
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [screen])

  const go = useCallback((next: ScreenId) => {
    playCue('tap')
    setScreen(next)
  }, [])

  const setup = currentBattleSetup(state)

  const startFight = useCallback(() => {
    if (!setup) return
    setPending({ setup, weapon: equippedWeapon(state), veterancy: veterancyOf(state) })
    setBattleKey((key) => key + 1)
    playCue('tap')
    setScreen('battle')
  }, [setup, state])

  /** The fight decides the outcome; this only writes it down. */
  const finishBattle = useCallback(
    (result: DuelResult) => {
      if (!pending) {
        setScreen('home')
        return
      }
      const outcome = reportDuel(
        pending.weapon,
        pending.setup.terrain,
        pending.veterancy,
        pending.setup.enemy,
        result,
      )
      const won = outcome.winner === 'player'
      setResolved({
        setup: pending.setup,
        outcome,
        weapon: pending.weapon,
        payout: payoutFor(pending.setup.level, won, state.clearedLevelIds.includes(pending.setup.level.id)),
      })
      resolveBattle(pending.setup.level, won)
      setScreen('result')
    },
    [pending, state.clearedLevelIds, resolveBattle],
  )

  const continueFromResult = useCallback(() => {
    playCue('tap')
    const wonTheBoss = resolved?.outcome.winner === 'player' && resolved.setup.level.isBoss
    setScreen(wonTheBoss ? 'victory' : 'home')
  }, [resolved])

  const openArmory = useCallback((origin: ArmoryOrigin) => {
    playCue('tap')
    setArmoryOrigin(origin)
    setScreen('armory')
  }, [])

  const closeArmory = useCallback(() => {
    playCue('tap')
    // Coming back from a defeat means going straight to the rematch, not the report.
    setScreen(armoryOrigin === 'result' ? 'prep' : armoryOrigin)
  }, [armoryOrigin])

  const handleBuy = useCallback(
    (weaponId: string) => {
      playCue('buy')
      buy(weaponId)
    },
    [buy],
  )

  const handleEquip = useCallback(
    (weaponId: string) => {
      playCue('tap')
      equip(weaponId)
    },
    [equip],
  )

  const playAgain = useCallback(() => {
    playCue('tap')
    resetGame()
    setResolved(null)
    setPending(null)
    setScreen('home')
  }, [resetGame])

  // The campaign always has a valid battle; this only guards a corrupted level id.
  if (!setup) {
    return (
      <div className="app">
        <Home
          state={state}
          onStartBattle={() => go('home')}
          onArmory={() => openArmory('home')}
          onHowToPlay={() => go('howto')}
          onSettings={() => go('settings')}
          onViewVictory={() => go('victory')}
        />
      </div>
    )
  }

  return (
    <div className="app">
      {screen === 'home' ? (
        <Home
          state={state}
          onStartBattle={() => go('prep')}
          onArmory={() => openArmory('home')}
          onHowToPlay={() => go('howto')}
          onSettings={() => go('settings')}
          onViewVictory={() => go('victory')}
        />
      ) : null}

      {screen === 'prep' ? (
        <BattlePreparation
          state={state}
          setup={setup}
          onFight={startFight}
          onOpenArmory={() => openArmory('prep')}
          onBack={() => go('home')}
        />
      ) : null}

      {screen === 'battle' && pending ? (
        <Battle
          key={battleKey}
          setup={pending.setup}
          playerWeapon={pending.weapon}
          veterancy={pending.veterancy}
          onFinished={finishBattle}
        />
      ) : null}

      {screen === 'result' && resolved ? (
        <Result
          setup={resolved.setup}
          outcome={resolved.outcome}
          playerWeapon={resolved.weapon}
          ownedWeapons={ownedWeapons(state)}
          payout={resolved.payout}
          coins={state.coins}
          bossWin={resolved.outcome.winner === 'player' && resolved.setup.level.isBoss}
          onContinue={continueFromResult}
          onOpenArmory={() => openArmory('result')}
        />
      ) : null}

      {screen === 'armory' ? (
        <Armory
          state={state}
          terrain={armoryOrigin === 'home' ? undefined : setup.terrain}
          onBuy={handleBuy}
          onEquip={handleEquip}
          onBack={closeArmory}
        />
      ) : null}

      {screen === 'howto' ? <HowToPlay onBack={() => go('home')} /> : null}

      {screen === 'victory' ? (
        <Victory state={state} onPlayAgain={playAgain} onHome={() => go('home')} />
      ) : null}

      {screen === 'settings' ? (
        <Settings
          state={state}
          onToggleMute={toggleMute}
          onReset={() => {
            resetGame()
            setResolved(null)
            setPending(null)
            setScreen('home')
          }}
          onBack={() => go('home')}
        />
      ) : null}
    </div>
  )
}
