import type { Hero, HeroId } from '../game/types'

/**
 * The four commanders.
 *
 * A hero is a second, independent choice sitting on top of weapon-and-terrain.
 * The weapon decides what your army is worth on this ground; the hero decides
 * how that worth is spent — whether you can stand and trade, slip a blow, or
 * keep the enemy at arm's length.
 *
 * Every value here is a MULTIPLIER on the combat stats the weapon already
 * produced. Nothing in this file touches weapon power, terrain fit, coins or
 * rewards: a hero bends how the fight is fought, never what the ground is
 * worth. That keeps the tuned six-level ladder intact underneath.
 *
 * They are balanced sideways, not upward. Effective damage-per-second lands
 * between 0.95x and 1.00x for all four, so nobody is strictly the best pick —
 * they differ in health, footwork, reach and what a counter is worth. Rostam is
 * the forgiving one and Gordafarid the demanding one, and they arrive in that
 * order as the campaign gets harder.
 */
export const HEROES: Hero[] = [
  {
    id: 'surena',
    name: 'سورنا',
    emoji: '🛡️',
    title: 'سردار پارتی',
    blurb:
      'خط را نگه می‌دارد. جانِ بیشتر و چشمی که کمی دیرتر می‌بندد — فرماندهٔ خوبی برای یاد گرفتنِ میدان.',
    unlockAfter: 0,
    health: 1.15,
    damage: 1,
    cycle: 1,
    reach: 1,
    dodgeCooldown: 1,
    dodgeInvulnerable: 1,
    perfectWindow: 0.02,
    counterBonus: 1,
  },
  {
    id: 'gordafarid',
    name: 'گردآفرید',
    emoji: '🏇',
    title: 'سوارِ گریزپا',
    blurb:
      'جاخالی‌اش زودتر آماده می‌شود و ضدحمله‌اش سنگین‌تر می‌افتد. کم‌جان است — با او نباید بخوری.',
    unlockAfter: 2,
    health: 0.9,
    damage: 0.95,
    cycle: 1,
    reach: 1,
    dodgeCooldown: 0.7,
    dodgeInvulnerable: 1.25,
    perfectWindow: 0.04,
    counterBonus: 1.35,
  },
  {
    id: 'arash',
    name: 'آرش',
    emoji: '🦅',
    title: 'کمانگیر',
    blurb:
      'دورتر می‌زند و ضربهٔ دشمن را زودتر می‌بیند. اما اگر بگذاری نزدیک شود، دوام نمی‌آورد.',
    unlockAfter: 3,
    health: 0.85,
    damage: 1,
    cycle: 1,
    reach: 1.25,
    dodgeCooldown: 1,
    dodgeInvulnerable: 1,
    perfectWindow: 0.06,
    counterBonus: 1,
  },
  {
    id: 'rostam',
    name: 'رستم',
    emoji: '🦁',
    title: 'پهلوان',
    blurb:
      'سخت می‌افتد و سنگین می‌زند. اما دیر می‌جهد — با او جاخالی گران تمام می‌شود، پس باید بایستی و بزنی.',
    unlockAfter: 4,
    health: 1.4,
    damage: 1,
    cycle: 1.2,
    reach: 1,
    dodgeCooldown: 1.45,
    dodgeInvulnerable: 0.9,
    perfectWindow: 0,
    counterBonus: 1,
  },
]

/** The commander every campaign starts with. */
export const STARTER_HERO_ID: HeroId = 'surena'

const HEROES_BY_ID = new Map(HEROES.map((hero) => [hero.id, hero]))

export function findHero(id: string): Hero | undefined {
  return HEROES_BY_ID.get(id as HeroId)
}
