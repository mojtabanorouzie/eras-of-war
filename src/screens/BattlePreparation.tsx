import { BonusChips } from '../components/BonusChips'
import { CoinBadge } from '../components/CoinBadge'
import { TerrainBanner } from '../components/TerrainBanner'
import { TopBar } from '../components/TopBar'
import { TOTAL_LEVELS } from '../data/levels'
import { ARMY_BASE_POWER } from '../game/balance'
import {
  evaluateTerrainFit,
  projectEnemyPower,
  projectPlayerPower,
  readOdds,
} from '../game/battleEngine'
import { faNumber, faSigned, formatCoins } from '../game/format'
import type { BattleSetup } from '../game/progression'
import { equippedWeapon, veterancyOf } from '../game/progression'
import type { GameState } from '../game/types'

interface BattlePreparationProps {
  state: GameState
  setup: BattleSetup
  onFight: () => void
  onOpenArmory: () => void
  onBack: () => void
}

export function BattlePreparation({
  state,
  setup,
  onFight,
  onOpenArmory,
  onBack,
}: BattlePreparationProps) {
  const { level, terrain, enemy } = setup
  const weapon = equippedWeapon(state)
  const veterancy = veterancyOf(state)

  const fit = evaluateTerrainFit(weapon, terrain)
  const playerPower = projectPlayerPower(weapon, terrain, veterancy)
  const enemyPower = projectEnemyPower(enemy.weapon, enemy.terrainEdge)
  const odds = readOdds(playerPower - enemyPower)
  const alreadyCleared = state.clearedLevelIds.includes(level.id)

  return (
    <div className="screen">
      <TopBar
        title={level.isBoss ? '👑 نبرد پایانی' : `نبرد ${faNumber(level.id)}`}
        onBack={onBack}
        right={<CoinBadge coins={state.coins} />}
      />

      <div className="shell stack">
        <div className="prep-layout stack">
          <div className="stack">
            <TerrainBanner
              terrain={terrain}
              eyebrow={
                level.isBoss
                  ? 'نبرد پایانی'
                  : `نبرد ${faNumber(level.id)} از ${faNumber(TOTAL_LEVELS)}`
              }
            />

            <div className="versus">
              <div className="versus__side">
                <span className="versus__emoji" aria-hidden="true">
                  {weapon.emoji}
                </span>
                <span className="versus__name">سپاه تو</span>
                <span className="versus__power num" style={{ color: 'var(--teal)' }}>
                  {faNumber(playerPower)}
                </span>
              </div>
              <span className="versus__vs" aria-hidden="true">
                در برابر
              </span>
              <div className="versus__side">
                <span className="versus__emoji" aria-hidden="true">
                  {enemy.emoji}
                </span>
                <span className="versus__name">{enemy.name}</span>
                <span className="versus__power num" style={{ color: 'var(--rose)' }}>
                  {faNumber(enemyPower)}
                </span>
              </div>
            </div>

            <p className={`odds odds--${odds.tone}`} role="status">
              <b>{odds.headline}.</b> {odds.detail}
            </p>
          </div>

          <div className="stack">
            <section className="card stack stack--tight">
              <p className="eyebrow">سلاح تو</p>
              <div className="row">
                <span aria-hidden="true" style={{ fontSize: 30 }}>
                  {weapon.emoji}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p className="subtitle">{weapon.name}</p>
                </div>
                <span className="chip">قدرت {faNumber(weapon.power)}</span>
              </div>

              <div className="divider" style={{ margin: 'var(--s-2) 0' }} />

              <div className="breakdown">
                <div className="breakdown__row">
                  <span>سپاه پایه</span>
                  <b className="num">{faNumber(ARMY_BASE_POWER)}</b>
                </div>
                <div className="breakdown__row">
                  <span>{weapon.name}</span>
                  <b className="num">{faSigned(weapon.power)}</b>
                </div>
                <div className="breakdown__row">
                  <span>
                    {terrain.emoji} {terrain.name}
                  </span>
                  <b
                    className="num"
                    style={{ color: fit.total >= 0 ? 'var(--teal)' : 'var(--rose)' }}
                  >
                    {faSigned(fit.total)}
                  </b>
                </div>
                {veterancy > 0 ? (
                  <div className="breakdown__row">
                    <span>سربازان کارکشته</span>
                    <b className="num" style={{ color: 'var(--teal)' }}>
                      {faSigned(veterancy)}
                    </b>
                  </div>
                ) : null}
                <div className="breakdown__row breakdown__row--total">
                  <span style={{ color: 'var(--ink)' }}>قدرت نبرد</span>
                  <b className="num">{faNumber(playerPower)}</b>
                </div>
              </div>

              <BonusChips notes={fit.notes} />
            </section>

            <section className="card stack stack--tight">
              <p className="eyebrow">دشمن</p>
              <div className="row">
                <span aria-hidden="true" style={{ fontSize: 30 }}>
                  {enemy.emoji}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p className="subtitle">{enemy.name}</p>
                </div>
              </div>
              <p className="small">
                با {enemy.weapon.emoji}{' '}
                <b style={{ color: 'var(--ink)' }}>{enemy.weapon.name}</b> می‌جنگند
                {' · '}
                {enemy.terrainEdge >= 0
                  ? `این زمین را خوب می‌شناسند (${faSigned(enemy.terrainEdge)}).`
                  : `این زمین با آن‌ها هم سرِ ناسازگاری دارد (${faSigned(enemy.terrainEdge)}).`}
              </p>
              <p className="taunt">«{enemy.taunt}»</p>
            </section>

            <p className="small">
              {alreadyCleared
                ? 'این نبرد را قبلاً برده‌ای — تکرارش سکهٔ کمتری می‌دهد.'
                : `پیروزی ${formatCoins(level.reward)} 🪙 می‌دهد.`}
            </p>
          </div>
        </div>

        <div className="action-bar">
          <button type="button" className="btn" onClick={onOpenArmory}>
            <span aria-hidden="true">🧰</span> تعویض سلاح
          </button>
          <button type="button" className="btn btn--primary btn--lg" onClick={onFight}>
            <span aria-hidden="true">⚔️</span> نبرد
          </button>
        </div>
      </div>
    </div>
  )
}
