import { findTerrain } from '../data/terrains'
import { ERAS } from '../data/weapons'
import { evaluateTerrainFit, projectPlayerPower } from '../game/battleEngine'
import { faNumber, faSigned, formatCoins } from '../game/format'
import type { Terrain, Weapon } from '../game/types'
import { BonusChips } from './BonusChips'
import { eraVars } from './theme'

interface WeaponCardProps {
  weapon: Weapon
  owned: boolean
  equipped: boolean
  coins: number
  /** When set, the card also shows how the weapon performs on that battlefield. */
  terrain?: Terrain | undefined
  veterancy?: number
  onBuy: (weaponId: string) => void
  onEquip: (weaponId: string) => void
}

export function WeaponCard({
  weapon,
  owned,
  equipped,
  coins,
  terrain,
  veterancy = 0,
  onBuy,
  onEquip,
}: WeaponCardProps) {
  const era = ERAS.find((candidate) => candidate.id === weapon.era)
  const bestTerrain = findTerrain(weapon.bestTerrain)
  const affordable = coins >= weapon.cost
  const fit = terrain ? evaluateTerrainFit(weapon, terrain) : null

  const classes = ['weapon']
  if (equipped) classes.push('weapon--equipped')
  if (!owned) classes.push('weapon--locked')

  return (
    <article className={classes.join(' ')} style={eraVars(weapon.era)}>
      <div className="weapon__head">
        <div className="weapon__icon" aria-hidden="true">
          {weapon.emoji}
        </div>
        <div className="weapon__names">
          <h3 className="weapon__name">{weapon.name}</h3>
          <div className="row row--wrap" style={{ gap: 6, marginTop: 6 }}>
            <span className="chip chip--era">
              <span aria-hidden="true">{era?.emoji}</span>
              {era?.name}
            </span>
            {bestTerrain ? (
              <span className="chip">
                <span aria-hidden="true">{bestTerrain.emoji}</span>
                بهترین در {bestTerrain.name}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="weapon__specs">
        <div className="weapon__spec">
          <b className="num">{faNumber(weapon.power)}</b>
          <span>قدرت</span>
        </div>
        <div className="weapon__spec">
          <b className="num">{faNumber(weapon.range)}</b>
          <span>برد</span>
        </div>
        <div className="weapon__spec">
          <b className="num">{weapon.cost === 0 ? 'رایگان' : formatCoins(weapon.cost)}</b>
          <span>{weapon.cost === 0 ? 'شروع' : 'سکه'}</span>
        </div>
      </div>

      <p className="weapon__blurb">{weapon.blurb}</p>

      {terrain && fit ? (
        <div className="stack stack--tight">
          <div className="row row--between">
            <span className="small">
              <span aria-hidden="true">{terrain.emoji}</span> در {terrain.name}
            </span>
            <span className="subtitle num">
              {faNumber(projectPlayerPower(weapon, terrain, veterancy))}
              <span className="small" style={{ marginInlineStart: 6 }}>
                ({faSigned(fit.total)})
              </span>
            </span>
          </div>
          <BonusChips notes={fit.notes} />
        </div>
      ) : null}

      <div className="weapon__foot">
        {!owned ? (
          <button
            type="button"
            className="btn btn--primary"
            disabled={!affordable}
            onClick={() => onBuy(weapon.id)}
          >
            {affordable ? (
              <>
                <span aria-hidden="true">🪙</span> خرید با {formatCoins(weapon.cost)}
              </>
            ) : (
              <>
                <span aria-hidden="true">🔒</span> {formatCoins(weapon.cost - coins)} سکه کم داری
              </>
            )}
          </button>
        ) : equipped ? (
          <span className="owned-tag">
            <span aria-hidden="true">✓</span> در دست
          </span>
        ) : (
          <button type="button" className="btn btn--go" onClick={() => onEquip(weapon.id)}>
            بردار
          </button>
        )}
        {owned && !equipped ? (
          <span className="owned-tag">
            <span aria-hidden="true">✓</span> خریده‌ای
          </span>
        ) : null}
      </div>
    </article>
  )
}
