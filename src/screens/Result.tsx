import { BonusChips } from '../components/BonusChips'
import { CoinBadge } from '../components/CoinBadge'
import { bestWeaponFor, evaluateTerrainFit } from '../game/battleEngine'
import { faNumber, faSigned, formatCoins } from '../game/format'
import type { BattleSetup } from '../game/progression'
import type { BattleOutcome, Weapon } from '../game/types'

interface ResultProps {
  setup: BattleSetup
  outcome: BattleOutcome
  playerWeapon: Weapon
  ownedWeapons: Weapon[]
  payout: number
  coins: number
  /** True when this win finished the campaign. */
  bossWin: boolean
  onContinue: () => void
  onOpenArmory: () => void
}

export function Result({
  setup,
  outcome,
  playerWeapon,
  ownedWeapons,
  payout,
  coins,
  bossWin,
  onContinue,
  onOpenArmory,
}: ResultProps) {
  const { terrain, enemy } = setup
  const won = outcome.winner === 'player'

  const better = bestWeaponFor(ownedWeapons, terrain)
  const hasBetterOption = !won && better !== undefined && better.id !== playerWeapon.id

  return (
    <div className="screen">
      <div className="shell stack">
        <section className={won ? 'verdict verdict--win' : 'verdict verdict--lose'}>
          <div className="verdict__emoji" aria-hidden="true">
            {won ? '🏆' : '💥'}
          </div>
          <h1 className="verdict__headline">{won ? 'پیروزی!' : 'شکست'}</h1>
          <p className="body" style={{ marginTop: 'var(--s-2)' }}>
            {won
              ? bossWin
                ? 'آخرین پایتخت مال توست.'
                : 'انتخاب هوشمندانه‌ات جواب داد.'
              : 'سپاهت روی این زمین حریف نشد.'}
          </p>
          <div style={{ marginTop: 'var(--s-4)' }}>
            <span className="coins coins--lg coins__delta">
              <span aria-hidden="true">🪙</span>
              {payout > 0 ? `+${formatCoins(payout)}` : `+${formatCoins(0)}`}
            </span>
          </div>
          {!won && payout > 0 ? (
            <p className="small" style={{ marginTop: 'var(--s-2)' }}>
              از میدان جمع کردی — هیچ‌وقت دست خالی برنمی‌گردی.
            </p>
          ) : null}
        </section>

        <p className="why">{outcome.explanation}</p>

        <section className="card stack stack--tight">
          <p className="eyebrow">عددها چطور درآمدند</p>

          <div className="breakdown">
            <div className="breakdown__row">
              <span>
                {playerWeapon.emoji} سپاه پایه + {playerWeapon.name}
              </span>
              <b className="num">{faNumber(outcome.player.base + outcome.player.weapon)}</b>
            </div>
            <div className="breakdown__row">
              <span>
                {terrain.emoji} {terrain.name}
              </span>
              <b
                className="num"
                style={{ color: outcome.player.terrain >= 0 ? 'var(--teal)' : 'var(--rose)' }}
              >
                {faSigned(outcome.player.terrain)}
              </b>
            </div>
            {outcome.player.veterancy > 0 ? (
              <div className="breakdown__row">
                <span>سربازان کارکشته</span>
                <b className="num" style={{ color: 'var(--teal)' }}>
                  {faSigned(outcome.player.veterancy)}
                </b>
              </div>
            ) : null}
            <div className="breakdown__row">
              <span>🎲 شانس</span>
              <b className="num">{faSigned(outcome.player.luck)}</b>
            </div>
            <div className="breakdown__row breakdown__row--total">
              <span style={{ color: 'var(--ink)' }}>قدرت تو</span>
              <b className="num" style={{ color: 'var(--teal)' }}>
                {faNumber(outcome.playerPower)}
              </b>
            </div>
          </div>

          <div className="divider" style={{ margin: 'var(--s-3) 0' }} />

          <div className="breakdown">
            <div className="breakdown__row">
              <span>
                {enemy.emoji} سپاه پایه + {enemy.weapon.name}
              </span>
              <b className="num">{faNumber(outcome.enemy.base + outcome.enemy.weapon)}</b>
            </div>
            <div className="breakdown__row">
              <span>{terrain.emoji} شناخت زمین</span>
              <b className="num">{faSigned(outcome.enemy.terrain)}</b>
            </div>
            <div className="breakdown__row">
              <span>🎲 شانس</span>
              <b className="num">{faSigned(outcome.enemy.luck)}</b>
            </div>
            <div className="breakdown__row breakdown__row--total">
              <span style={{ color: 'var(--ink)' }}>قدرت دشمن</span>
              <b className="num" style={{ color: 'var(--rose)' }}>
                {faNumber(outcome.enemyPower)}
              </b>
            </div>
          </div>
        </section>

        <section className="card stack stack--tight">
          <p className="eyebrow">
            {playerWeapon.name} در {terrain.name}
          </p>
          <BonusChips notes={outcome.fit.notes} />
        </section>

        {hasBetterOption && better ? (
          <p className="odds odds--even">
            <b>
              این بار {better.emoji} {better.name} را امتحان کن.
            </b>{' '}
            همین حالا هم مال توست و در {terrain.name} برایت{' '}
            {faSigned(evaluateTerrainFit(better, terrain).total)} امتیاز می‌آورد.
          </p>
        ) : null}

        {!won && !hasBetterOption ? (
          <p className="odds odds--even">
            <b>هیچ‌کدام از سلاح‌هایت به این زمین نمی‌آید.</b> سری به زرادخانه بزن — {formatCoins(coins)}{' '}
            🪙 برای خرج کردن داری.
          </p>
        ) : null}

        <div className="action-bar">
          {!won ? (
            <button type="button" className="btn" onClick={onOpenArmory}>
              <span aria-hidden="true">🧰</span> زرادخانه
            </button>
          ) : null}
          <button type="button" className="btn btn--primary btn--lg" onClick={onContinue}>
            {won ? (bossWin ? 'دیدن پیروزی' : 'ادامه') : 'دوباره امتحان کن'}
          </button>
        </div>

        <div className="row row--between">
          <span className="small">سکه‌های تو</span>
          <CoinBadge coins={coins} />
        </div>
      </div>
    </div>
  )
}
