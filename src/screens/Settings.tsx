import { useState } from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { StatGrid } from '../components/StatGrid'
import { TopBar } from '../components/TopBar'
import { WEAPONS } from '../data/weapons'
import { faNumber, formatCoins } from '../game/format'
import type { GameState } from '../game/types'

interface SettingsProps {
  state: GameState
  onToggleMute: () => void
  onReset: () => void
  onBack: () => void
}

export function Settings({ state, onToggleMute, onReset, onBack }: SettingsProps) {
  const [confirming, setConfirming] = useState(false)

  return (
    <div className="screen">
      <TopBar title="⚙️ تنظیمات" onBack={onBack} />

      <div className="shell stack">
        <section className="card stack stack--tight">
          <p className="eyebrow">لشکرکشی تو</p>
          <StatGrid
            items={[
              { label: 'نبردهای برده', value: faNumber(state.stats.battlesWon), emoji: '⚔️' },
              { label: 'نبردهای باخته', value: faNumber(state.stats.battlesLost), emoji: '💥' },
              {
                label: 'سکه‌های به‌دست‌آمده',
                value: formatCoins(state.stats.coinsEarned),
                emoji: '🪙',
              },
              {
                label: 'سلاح‌ها',
                value: `${faNumber(state.ownedWeaponIds.length)}/${faNumber(WEAPONS.length)}`,
                emoji: '🧰',
              },
            ]}
          />
        </section>

        <section className="card stack stack--tight">
          <div className="row row--between">
            <div>
              <p className="subtitle">صدای بازی</p>
              <p className="small">فقط چند بوق کوتاه. تا وقتی دست نزنی، چیزی پخش نمی‌شود.</p>
            </div>
            <button
              type="button"
              className={state.muted ? 'btn btn--ghost' : 'btn btn--go'}
              onClick={onToggleMute}
              aria-pressed={!state.muted}
            >
              <span aria-hidden="true">{state.muted ? '🔇' : '🔊'}</span>
              {state.muted ? 'خاموش' : 'روشن'}
            </button>
          </div>
        </section>

        <section className="card stack stack--tight">
          <p className="subtitle">شروع دوباره</p>
          <p className="small">
            سکه‌ها، سلاح‌ها و پیشرفت نبردهایت را از این دستگاه پاک می‌کند و یک لشکرکشی تازه شروع
            می‌شود. این کار برگشت ندارد.
          </p>
          <button
            type="button"
            className="btn btn--danger btn--block"
            onClick={() => setConfirming(true)}
          >
            <span aria-hidden="true">🗑️</span> پاک کردن بازی
          </button>
        </section>

        <section className="card stack stack--tight">
          <p className="eyebrow">دربارهٔ بازی</p>
          <p className="small">
            جنگ دوران‌ها — یک بازی راهبردی کوچک دربارهٔ انتخاب سلاح مناسب برای زمینی که رویش
            ایستاده‌ای. پیشرفت تو فقط در همین مرورگر ذخیره می‌شود و هیچ‌جا فرستاده نمی‌شود.
          </p>
        </section>

        <div className="action-bar">
          <button type="button" className="btn btn--primary btn--lg" onClick={onBack}>
            تمام
          </button>
        </div>
      </div>

      {confirming ? (
        <ConfirmDialog
          title="همه‌چیز پاک شود؟"
          message="سکه‌ها، سلاح‌ها و هر شش نبرد از این دستگاه پاک می‌شوند."
          confirmLabel="بله، پاک کن"
          onConfirm={() => {
            setConfirming(false)
            onReset()
          }}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </div>
  )
}
