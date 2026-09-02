import { CoinBadge } from '../components/CoinBadge'
import { TopBar } from '../components/TopBar'
import { HEROES } from '../data/heroes'
import { faNumber } from '../game/format'
import { isHeroUnlocked } from '../game/progression'
import type { GameState, Hero, HeroId } from '../game/types'

/**
 * Choosing a commander.
 *
 * The weapon screen answers "what am I worth on this ground". This one answers
 * "how do I want to spend it" — and the two are deliberately independent, so a
 * player can carry the same axe into the forest behind four very different
 * fighters.
 */

interface HeroesProps {
  state: GameState
  onChoose: (heroId: HeroId) => void
  onBack: () => void
}

/** Where 1.0 sits on a trait bar, and how far either side of it we plot. */
const TRAIT_FLOOR = 0.6
const TRAIT_SPAN = 0.9

interface Trait {
  label: string
  /** 1 is the baseline; above is better, below is worse. */
  value: number
}

function traitsOf(hero: Hero): Trait[] {
  return [
    { label: 'جان', value: hero.health },
    // Cycle cancels out of damage-per-second, so this is the honest figure.
    { label: 'آسیب', value: hero.damage },
    { label: 'شتاب', value: 1 / hero.cycle },
    { label: 'چابکی', value: hero.dodgeInvulnerable / hero.dodgeCooldown },
  ]
}

/** The short, readable version of what makes this commander different. */
function perksOf(hero: Hero): string[] {
  const perks: string[] = []
  if (hero.reach !== 1) {
    perks.push(hero.reach > 1 ? 'بردِ بلندتر' : 'بردِ کوتاه‌تر')
  }
  if (hero.perfectWindow > 0) perks.push('فرصتِ جاخالی بازتر')
  if (hero.counterBonus > 1) perks.push('ضدحملهٔ سنگین‌تر')
  if (hero.dodgeCooldown < 1) perks.push('جاخالیِ زودآماده')
  if (hero.dodgeCooldown > 1) perks.push('جاخالیِ دیرآماده')
  return perks
}

function HeroCard({
  hero,
  unlocked,
  chosen,
  onChoose,
}: {
  hero: Hero
  unlocked: boolean
  chosen: boolean
  onChoose: () => void
}) {
  const className = `hero-card${chosen ? ' hero-card--chosen' : ''}${unlocked ? '' : ' hero-card--locked'}`

  return (
    <section className={className}>
      <div className="row">
        <span className="hero-card__emoji" aria-hidden="true">
          {unlocked ? hero.emoji : '🔒'}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="subtitle">{hero.name}</p>
          <p className="hero-card__title">{hero.title}</p>
        </div>
        {chosen ? <span className="chip chip--good">در فرماندهی</span> : null}
      </div>

      <p className="small">{hero.blurb}</p>

      <div className="traits">
        {traitsOf(hero).map((trait) => {
          const fill = Math.min(1, Math.max(0, (trait.value - TRAIT_FLOOR) / TRAIT_SPAN))
          return (
            <div key={trait.label} className="trait">
              <span className="trait__label">{trait.label}</span>
              <span className="trait__track">
                <i
                  className={`trait__fill${trait.value < 1 ? ' trait__fill--low' : ''}`}
                  style={{ transform: `scaleX(${fill.toFixed(3)})` }}
                />
              </span>
            </div>
          )
        })}
      </div>

      {perksOf(hero).length > 0 ? (
        <div className="chips">
          {perksOf(hero).map((perk) => (
            <span key={perk} className="chip">
              {perk}
            </span>
          ))}
        </div>
      ) : null}

      {unlocked ? (
        <button
          type="button"
          className={chosen ? 'btn btn--block' : 'btn btn--primary btn--block'}
          onClick={onChoose}
          disabled={chosen}
        >
          {chosen ? 'همین فرمانده' : 'انتخاب'}
        </button>
      ) : (
        <p className="small hero-card__lock">
          🔒 پس از بردن {faNumber(hero.unlockAfter)} نبرد به تو می‌پیوندد.
        </p>
      )}
    </section>
  )
}

export function Heroes({ state, onChoose, onBack }: HeroesProps) {
  return (
    <div className="screen">
      <TopBar title="فرماندهان" onBack={onBack} right={<CoinBadge coins={state.coins} />} />

      <div className="shell stack">
        <p className="body">
          فرمانده جدا از سلاح انتخاب می‌شود. سلاح تعیین می‌کند روی این زمین چقدر می‌ارزی؛ فرمانده
          تعیین می‌کند آن را چطور خرج کنی.
        </p>

        <div className="hero-grid">
          {HEROES.map((hero) => (
            <HeroCard
              key={hero.id}
              hero={hero}
              unlocked={isHeroUnlocked(state, hero)}
              chosen={state.heroId === hero.id}
              onChoose={() => onChoose(hero.id)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
