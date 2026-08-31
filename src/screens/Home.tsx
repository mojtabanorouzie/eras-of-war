import { CoinBadge } from '../components/CoinBadge'
import { terrainVars } from '../components/theme'
import { TOTAL_LEVELS } from '../data/levels'
import { findTerrain } from '../data/terrains'
import { faNumber } from '../game/format'
import { currentBattleSetup, levelsWithStatus } from '../game/progression'
import type { GameState } from '../game/types'

interface HomeProps {
  state: GameState
  onStartBattle: () => void
  onArmory: () => void
  onHowToPlay: () => void
  onSettings: () => void
  onViewVictory: () => void
}

export function Home({
  state,
  onStartBattle,
  onArmory,
  onHowToPlay,
  onSettings,
  onViewVictory,
}: HomeProps) {
  const setup = currentBattleSetup(state)
  const terrain = setup ? findTerrain(setup.level.terrainId) : undefined
  const levels = levelsWithStatus(state)

  return (
    <div className="screen">
      <header className="topbar">
        <CoinBadge coins={state.coins} />
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          onClick={onSettings}
          aria-label="تنظیمات"
        >
          <span aria-hidden="true">⚙️</span>
        </button>
      </header>

      <div className="shell stack">
        <section className="home__hero">
          <div className="home__crest" aria-hidden="true">
            ⚔️
          </div>
          <h1 className="home__title">جنگ دوران‌ها</h1>
          <p className="home__pitch">
            سلاحت را انتخاب کن.
            <br />
            میدان نبردت را انتخاب کن.
            <br />
            <b>تاریخ را عوض کن.</b>
          </p>
        </section>

        <div
          className="level-dots"
          role="img"
          aria-label={`${faNumber(state.clearedLevelIds.length)} نبرد از ${faNumber(TOTAL_LEVELS)} نبرد برده شده`}
        >
          {levels.map(({ level, cleared, current }) => {
            const classes = ['level-dots__dot']
            if (cleared) classes.push('level-dots__dot--done')
            else if (current) classes.push('level-dots__dot--current')
            return <span key={level.id} className={classes.join(' ')} />
          })}
        </div>

        {setup && terrain ? (
          <button
            type="button"
            className="next-battle"
            style={terrainVars(terrain)}
            onClick={onStartBattle}
          >
            <span className="next-battle__emoji" aria-hidden="true">
              {terrain.emoji}
            </span>
            <span className="next-battle__body">
              <span className="next-battle__label">
                {setup.level.isBoss
                  ? 'نبرد پایانی'
                  : `نبرد ${faNumber(setup.level.id)} از ${faNumber(TOTAL_LEVELS)}`}
              </span>
              <span className="next-battle__name">{setup.level.name}</span>
              <span className="next-battle__label">{terrain.name}</span>
            </span>
            {/* RTL page: the "forward" chevron points left. */}
            <span aria-hidden="true" style={{ fontSize: 22 }}>
              ‹
            </span>
          </button>
        ) : null}

        <div className="stack stack--tight">
          <button
            type="button"
            className="btn btn--primary btn--lg btn--block"
            onClick={onStartBattle}
          >
            <span aria-hidden="true">⚔️</span> شروع نبرد
          </button>
          <button type="button" className="btn btn--block" onClick={onArmory}>
            <span aria-hidden="true">🧰</span> زرادخانه
          </button>
          <button type="button" className="btn btn--ghost btn--block" onClick={onHowToPlay}>
            <span aria-hidden="true">📖</span> راهنمای بازی
          </button>
          {state.campaignComplete ? (
            <button type="button" className="btn btn--go btn--block" onClick={onViewVictory}>
              <span aria-hidden="true">🏆</span> دیدن پیروزی‌ات
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
