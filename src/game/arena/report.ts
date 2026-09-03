import { ARMY_BASE_POWER } from '../balance'
import { evaluateTerrainFit, explainFit, projectEnemyPower, projectPlayerPower } from '../battleEngine'
import type { Odds } from '../battleEngine'
import { faNumber } from '../format'
import type { BattleOutcome, Enemy, Hero, Terrain, Weapon } from '../types'
import type { ArenaResult } from './types'

/**
 * Rebuilds the report screen's `BattleOutcome` from a finished arena fight.
 *
 * This is the seam between the shooter and the campaign that wraps it. The
 * breakdown it carries is still the honest one — those numbers are exactly
 * what set the gun in your hands and the size of the force that came at you,
 * so the terrain lesson the report teaches is still the lesson that decided
 * the fight.
 *
 * What is gone, as it already was for the duel, is `luck`: an arena has no
 * dice to roll, so both sides report zero and the report screen drops those
 * rows. What is new is that the closing line talks about the things a shooter
 * actually gives you — how many you put down, how straight you shot, and how
 * much of the clock you spent doing it.
 */
export function reportArena(
  weapon: Weapon,
  terrain: Terrain,
  veterancy: number,
  enemy: Enemy,
  hero: Hero,
  result: ArenaResult,
): BattleOutcome {
  const fit = evaluateTerrainFit(weapon, terrain)
  const playerPower = projectPlayerPower(weapon, terrain, veterancy)
  const enemyPower = projectEnemyPower(enemy.weapon, enemy.terrainEdge)
  const won = result.winner === 'player'

  const seconds = faNumber(Math.round(result.duration))
  const kills = faNumber(result.kills)
  const total = faNumber(result.totalEnemies)
  const accuracy = faNumber(Math.round(result.accuracy * 100))
  const health = faNumber(Math.round(result.playerHealth))
  const standing = faNumber(Math.max(0, result.totalEnemies - result.kills))

  // Three different fights, three different things worth saying about them.
  // A win on the clock is not the same story as a wipe, and a defeat wants to
  // name what was still standing rather than just report a loss. A battle that
  // was never fought says so instead of inventing any of them.
  const outcomeLine = result.resolvedOnPaper
    ? won
      ? 'دستگاهت میدان سه‌بعدی را نمی‌کشد، پس این نبرد روی کاغذ حساب شد — و روی کاغذ بردی.'
      : 'دستگاهت میدان سه‌بعدی را نمی‌کشد، پس این نبرد روی کاغذ حساب شد — و روی کاغذ باختی.'
    : result.timedOut
    ? won
      ? `وقت میدان تمام شد، اما ${kills} نفر از ${total} نفرشان روی زمین مانده بودند — میدان مالِ تو حساب شد.`
      : `وقت میدان تمام شد و هنوز ${standing} نفرشان سرِ پا بودند.`
    : won
      ? `در ${seconds} ثانیه هر ${total} نفرشان را زمین زدی و با ${health} درصد جان بیرون آمدی.`
      : `در ${seconds} ثانیه افتادی؛ ${standing} نفرشان هنوز سرِ پا بودند.`

  // Accuracy is the one number a shooter owes the player that a duel never
  // could, so it always gets said — winning sloppily is worth knowing about.
  // A paper battle fired no shots, so it is silent here rather than reporting
  // a meaningless zero.
  const aimLine =
    !result.resolvedOnPaper && result.shotsFired > 0 ? ` دقتِ تیرت ${accuracy} درصد بود.` : ''

  return {
    playerPower,
    enemyPower,
    winner: result.winner,
    terrainBonus: fit.total,
    explanation: `${hero.emoji} فرماندهی با ${hero.name} بود. ${explainFit(weapon, terrain, fit)} ${outcomeLine}${aimLine}`,
    margin: playerPower - enemyPower,
    player: {
      base: ARMY_BASE_POWER,
      weapon: weapon.power,
      terrain: fit.total,
      veterancy,
      luck: 0,
    },
    enemy: {
      base: ARMY_BASE_POWER,
      weapon: enemy.weapon.power,
      terrain: enemy.terrainEdge,
      veterancy: 0,
      luck: 0,
    },
    fit,
  }
}

/**
 * How to read the pre-battle gap now that a firefight, not a dice roll, settles it.
 *
 * `readOdds` in `battleEngine.ts` still describes the same power gap correctly,
 * but its wording promises that luck decides the close ones, and there is no
 * luck left to decide them. `readDuelOdds` in `combat.ts` said the true thing
 * for a two-fighter duel; this says the true thing for an arena, where the gap
 * buys you a better gun against a smaller force rather than a heavier swing.
 */
export function readArenaOdds(edge: number): Odds {
  if (edge > 40) {
    return {
      tone: 'good',
      headline: 'برتری سنگین',
      detail: `${faNumber(edge)} امتیاز جلوتری — سلاحت اینجا کار می‌کند و کمترشان به تو می‌رسند.`,
    }
  }
  if (edge >= 6) {
    return {
      tone: 'good',
      headline: 'برتری با توست',
      detail: `${faNumber(edge)} امتیاز جلوتری. اگر پشت سنگر بمانی و هدر ندهی، میدان مالِ توست.`,
    }
  }
  if (edge >= -5) {
    return {
      tone: 'even',
      headline: 'برابر است',
      detail: 'هیچ‌کدام برتری ندارید؛ هر تیری که هدر بدهی، همان تفاوت را می‌سازد.',
    }
  }
  if (edge >= -40) {
    return {
      tone: 'bad',
      headline: 'عقب افتاده‌ای',
      detail: `${faNumber(Math.abs(edge))} امتیاز عقبی — کندتر می‌کُشی، پس باید از سنگر بهتر استفاده کنی.`,
    }
  }
  return {
    tone: 'bad',
    headline: 'خیلی عقبی',
    detail: `${faNumber(Math.abs(edge))} امتیاز عقبی. می‌شود برد، اما تقریباً هیچ ضربه‌ای نباید بخوری — یا سلاحی بردار که به این زمین بیاید.`,
  }
}
