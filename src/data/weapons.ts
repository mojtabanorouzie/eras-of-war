import type { EraId, Weapon } from '../game/types'

/**
 * Display metadata for each era. Drives card colours and armory grouping.
 *
 * All display text in this project is Persian; ids and code stay English.
 */
export const ERAS: { id: EraId; name: string; emoji: string }[] = [
  { id: 'ancient', name: 'باستان', emoji: '🗿' },
  { id: 'medieval', name: 'قرون وسطی', emoji: '🏰' },
  { id: 'industrial', name: 'صنعتی', emoji: '⚙️' },
  { id: 'modern', name: 'مدرن', emoji: '🎖️' },
  { id: 'future', name: 'آینده', emoji: '🛸' },
]

/**
 * The armory. Cost `0` means the player owns it from the first second.
 *
 * Adding a weapon is a one-object change — nothing else in the game needs to
 * know it exists.
 */
export const WEAPONS: Weapon[] = [
  {
    id: 'stone-axe', // Stone Axe
    name: 'تبر سنگی',
    emoji: '🪓',
    era: 'ancient',
    cost: 0,
    power: 25,
    range: 10,
    type: 'melee',
    weight: 'light',
    bestTerrain: 'forest',
    blurb: 'سنگ سنگین با دستهٔ کوتاه. لای درخت‌ها مرگبار است.',
  },
  {
    id: 'basic-pistol', // Basic Pistol
    name: 'تپانچهٔ ساده',
    emoji: '🔫',
    era: 'industrial',
    cost: 0,
    power: 40,
    range: 40,
    type: 'firearm',
    weight: 'light',
    bestTerrain: 'city',
    blurb: 'کوچک و سریع؛ برای جنگیدن پشت گوشه‌ها عالی است.',
  },
  {
    id: 'spear', // Spear
    name: 'نیزه',
    emoji: '🔱',
    era: 'ancient',
    cost: 500,
    power: 30,
    range: 20,
    type: 'melee',
    weight: 'light',
    bestTerrain: 'forest',
    blurb: 'برد بیشتر بدون وزن بیشتر. تبر سنگی، اما مؤدب‌تر.',
  },
  {
    id: 'bow', // Bow
    name: 'کمان',
    emoji: '🏹',
    era: 'ancient',
    cost: 800,
    power: 35,
    range: 60,
    type: 'ranged',
    weight: 'light',
    bestTerrain: 'forest',
    blurb: 'تیرهای بی‌صدا از لای شاخه‌ها. آن‌قدر سبک که در برف هم کار می‌کند.',
  },
  {
    id: 'long-sword', // Long Sword
    name: 'شمشیر بلند',
    emoji: '⚔️',
    era: 'medieval',
    cost: 2000,
    power: 50,
    range: 15,
    type: 'melee',
    weight: 'medium',
    bestTerrain: 'city',
    blurb: 'در هر کوچهٔ تنگ و هر درگاه شکسته فرمانرواست.',
  },
  {
    id: 'catapult', // Catapult
    name: 'منجنیق',
    emoji: '🪨',
    era: 'medieval',
    cost: 5000,
    power: 70,
    range: 80,
    type: 'siege',
    weight: 'heavy',
    bestTerrain: 'coast',
    blurb: 'تخته‌سنگ را در زمین باز پرتاب می‌کند. در برف عمیق هیچ‌کاره است.',
  },
  {
    id: 'musket', // Musket
    name: 'تفنگ فتیله‌ای',
    emoji: '🧨',
    era: 'industrial',
    cost: 8000,
    power: 65,
    range: 70,
    type: 'firearm',
    weight: 'medium',
    bestTerrain: 'coast',
    blurb: 'دیر پر می‌شود، اما صدایش تمام ساحل را می‌لرزاند.',
  },
  {
    id: 'rifle', // Rifle
    name: 'تفنگ خان‌دار',
    emoji: '🔩',
    era: 'industrial',
    cost: 15000,
    power: 80,
    range: 90,
    type: 'firearm',
    weight: 'medium',
    bestTerrain: 'desert',
    blurb: 'لولهٔ خان‌دار، شنِ باز را به میدان تیر تبدیل می‌کند.',
  },
  {
    id: 'assault-rifle', // Assault Rifle
    name: 'تفنگ تهاجمی',
    emoji: '🎖️',
    era: 'modern',
    cost: 30000,
    power: 90,
    range: 75,
    type: 'firearm',
    weight: 'medium',
    bestTerrain: 'city',
    blurb: 'سریع و بخشنده؛ ساختهٔ آوار و پشت‌بام.',
  },
  {
    id: 'sniper-rifle', // Sniper Rifle
    name: 'تفنگ تک‌تیرانداز',
    emoji: '🎯',
    era: 'modern',
    cost: 40000,
    power: 100,
    range: 120,
    type: 'sniper',
    weight: 'medium',
    bestTerrain: 'desert',
    blurb: 'یک گلوله در تمام درّه. فقط جایی می‌خواهد که دید داشته باشد.',
  },
  {
    id: 'laser-rifle', // Laser Rifle
    name: 'تفنگ لیزری',
    emoji: '⚡',
    era: 'future',
    cost: 100000,
    power: 120,
    range: 100,
    type: 'energy',
    weight: 'light',
    bestTerrain: 'snow',
    blurb: 'پرتوهای بی‌وزنی که اصلاً برایشان مهم نیست هوا چقدر سرد است.',
  },
]

export const STARTER_WEAPON_IDS: string[] = WEAPONS.filter((w) => w.cost === 0).map((w) => w.id)

const WEAPONS_BY_ID = new Map(WEAPONS.map((w) => [w.id, w]))

export function findWeapon(id: string): Weapon | undefined {
  return WEAPONS_BY_ID.get(id)
}
