import { CoinBadge } from '../components/CoinBadge'
import { TopBar } from '../components/TopBar'
import { WeaponCard } from '../components/WeaponCard'
import { eraVars } from '../components/theme'
import { ERAS, WEAPONS } from '../data/weapons'
import { faNumber } from '../game/format'
import { equippedWeapon, veterancyOf } from '../game/progression'
import type { GameState, Terrain } from '../game/types'

interface ArmoryProps {
  state: GameState
  /** Set when the armory was opened from battle prep, so cards can rank themselves. */
  terrain?: Terrain | undefined
  onBuy: (weaponId: string) => void
  onEquip: (weaponId: string) => void
  onBack: () => void
}

export function Armory({ state, terrain, onBuy, onEquip, onBack }: ArmoryProps) {
  const equipped = equippedWeapon(state)
  const veterancy = veterancyOf(state)

  return (
    <div className="screen">
      <TopBar title="🧰 زرادخانه" onBack={onBack} right={<CoinBadge coins={state.coins} />} />

      <div className="shell shell--wide stack">
        <div className="equipped-strip">
          <span aria-hidden="true" style={{ fontSize: 26 }}>
            {equipped.emoji}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="eyebrow" style={{ color: 'var(--gold)' }}>
              در دست
            </p>
            <p className="subtitle">{equipped.name}</p>
          </div>
          <span className="chip">قدرت {faNumber(equipped.power)}</span>
        </div>

        {terrain ? (
          <p className="small">
            بر اساس نبرد بعدی‌ات در{' '}
            <b style={{ color: 'var(--ink)' }}>
              {terrain.emoji} {terrain.name}
            </b>{' '}
            مرتب شده است. روی هر کارت، قدرتی که واقعاً به میدان می‌آورد نوشته شده.
          </p>
        ) : (
          <p className="small">
            سلاح‌ها یک بار خریده می‌شوند و برای همیشه مال تو هستند — استفاده از آن‌ها هیچ‌وقت تمامشان
            نمی‌کند. سلاح مناسبِ زمین، تقریباً همیشه از سلاح گران‌تر بهتر است.
          </p>
        )}

        {ERAS.map((era) => {
          const weapons = WEAPONS.filter((weapon) => weapon.era === era.id).sort(
            (a, b) => a.cost - b.cost,
          )
          if (weapons.length === 0) return null

          return (
            <section key={era.id} className="armory__group" style={eraVars(era.id)}>
              <h2 className="armory__heading">
                <span aria-hidden="true">{era.emoji}</span>
                {era.name}
              </h2>
              <div className="armory__grid">
                {weapons.map((weapon) => (
                  <WeaponCard
                    key={weapon.id}
                    weapon={weapon}
                    owned={state.ownedWeaponIds.includes(weapon.id)}
                    equipped={state.equippedWeaponId === weapon.id}
                    coins={state.coins}
                    terrain={terrain}
                    veterancy={veterancy}
                    onBuy={onBuy}
                    onEquip={onEquip}
                  />
                ))}
              </div>
            </section>
          )
        })}

        <div className="action-bar">
          <button type="button" className="btn btn--primary btn--lg" onClick={onBack}>
            {terrain ? 'برگرد به نبرد' : 'تمام'}
          </button>
        </div>
      </div>
    </div>
  )
}
