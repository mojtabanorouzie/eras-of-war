import type { Enemy } from '../game/types'

/**
 * Difficulty lives here and nowhere else.
 *
 * `weapon.power` is the enemy threat ladder from the design brief
 * (70 / 85 / 100 / 115 / 130, boss 150). `terrainEdge` is the tuning knob —
 * it is negative for the Frost Company, whose guns are simply too heavy for
 * the mountain they chose to defend.
 */
export const ENEMIES: Enemy[] = [
  {
    id: 'wolf-clan', // Wolf Clan Raiders
    name: 'مهاجمان قبیلهٔ گرگ',
    emoji: '🐺',
    era: 'ancient',
    weapon: { name: 'نیزهٔ چوبی', emoji: '🔱', power: 70 },
    terrainEdge: 6,
    taunt: 'این جنگل صد زمستان است که مال ماست.',
  },
  {
    id: 'sand-legion', // Sand Legion
    name: 'لژیون شن',
    emoji: '☀️',
    era: 'ancient',
    weapon: { name: 'کمان برنزی', emoji: '🏹', power: 85 },
    terrainEdge: 4,
    taunt: 'اینجا هیچ جایی برای پنهان شدن نیست. اصلاً هیچ جا.',
  },
  {
    id: 'rust-syndicate', // Rust Syndicate
    name: 'اتحادیهٔ زنگار',
    emoji: '🔧',
    era: 'medieval',
    weapon: { name: 'تبرزین آهنی', emoji: '⚔️', power: 100 },
    terrainEdge: 6,
    taunt: 'هر خیابان این شهر تله‌ای است که خودمان ساخته‌ایم.',
  },
  {
    id: 'frost-company', // Frost Company
    name: 'گروهان یخبندان',
    emoji: '🧊',
    era: 'industrial',
    weapon: { name: 'توپ یخی', emoji: '🧊', power: 115 },
    terrainEdge: -12,
    taunt: 'توپ‌های ما غول‌پیکرند. نپرس چطور آوردیمشان بالای کوه.',
  },
  {
    id: 'steel-vanguard', // Steel Vanguard
    name: 'پیشتاز فولادی',
    emoji: '⚓',
    era: 'modern',
    weapon: { name: 'تفنگ فولادی', emoji: '🔩', power: 130 },
    terrainEdge: 6,
    taunt: 'ساحل دست ماست. از موج رد نمی‌شوی.',
  },
  {
    id: 'future-commander', // Future Commander
    name: 'فرماندهٔ آینده',
    emoji: '🤖',
    era: 'future',
    weapon: { name: 'توپ پلاسما', emoji: '🔆', power: 150 },
    terrainEdge: 14,
    taunt: 'همهٔ حرکت‌هایی را که می‌خواهی بزنی، از قبل حساب کرده‌ام.',
  },
]

const ENEMIES_BY_ID = new Map(ENEMIES.map((e) => [e.id, e]))

export function findEnemy(id: string): Enemy | undefined {
  return ENEMIES_BY_ID.get(id)
}
