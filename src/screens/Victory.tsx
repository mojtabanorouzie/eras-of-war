import { StatGrid } from '../components/StatGrid'
import { WEAPONS } from '../data/weapons'
import { faNumber, formatCoins } from '../game/format'
import { bestOwnedWeapon, finalScore } from '../game/progression'
import type { GameState } from '../game/types'

interface VictoryProps {
  state: GameState
  onPlayAgain: () => void
  onHome: () => void
}

export function Victory({ state, onPlayAgain, onHome }: VictoryProps) {
  const best = bestOwnedWeapon(state)

  return (
    <div className="screen">
      <div className="shell stack">
        <section className="victory__banner">
          <div className="victory__trophy" aria-hidden="true">
            🏆
          </div>
          <h1 className="victory__headline">تو بر همهٔ دوران‌ها پیروز شدی!</h1>
          <p className="body" style={{ marginTop: 'var(--s-3)' }}>
            از یک تبر سنگی لای درخت‌ها تا آخرین پایتخت. فرماندهٔ آینده همهٔ حرکت‌هایت را از قبل حساب
            کرده بود — و اشتباه حساب کرده بود.
          </p>
        </section>

        <section className="score">
          <p className="eyebrow">امتیاز نهایی</p>
          <p className="score__value">{faNumber(finalScore(state))}</p>
        </section>

        <StatGrid
          items={[
            { label: 'نبردهای برده', value: faNumber(state.stats.battlesWon), emoji: '⚔️' },
            { label: 'نبردهای باخته', value: faNumber(state.stats.battlesLost), emoji: '💥' },
            { label: 'سکه‌های به‌دست‌آمده', value: formatCoins(state.stats.coinsEarned), emoji: '🪙' },
            {
              label: 'سلاح‌های باز شده',
              value: `${faNumber(state.ownedWeaponIds.length)}/${faNumber(WEAPONS.length)}`,
              emoji: '🧰',
            },
          ]}
        />

        <section className="card stack stack--tight">
          <p className="eyebrow">بهترین سلاح</p>
          <div className="row">
            <span aria-hidden="true" style={{ fontSize: 34 }}>
              {best.emoji}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="subtitle">{best.name}</p>
            </div>
            <span className="chip chip--good">قدرت {faNumber(best.power)}</span>
          </div>
        </section>

        <div className="action-bar">
          <button type="button" className="btn" onClick={onHome}>
            برگرد به پایگاه
          </button>
          <button type="button" className="btn btn--primary btn--lg" onClick={onPlayAgain}>
            <span aria-hidden="true">🔁</span> از نو بازی کن
          </button>
        </div>
      </div>
    </div>
  )
}
