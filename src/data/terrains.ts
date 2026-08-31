import type { Terrain, TerrainId } from '../game/types'

/**
 * The five battlefields.
 *
 * Each terrain pushes on a weapon from three directions:
 *   typeModifiers   - does this *kind* of weapon belong here?
 *   weightModifiers - can you actually carry it across this ground?
 *   rangeSlope      - is there anything to see, or is everything close?
 *
 * A weapon fighting on its `bestTerrain` also earns MATCH_BONUS on top.
 */
export const TERRAINS: Terrain[] = [
  {
    id: 'forest', // Deep Forest
    name: 'جنگل انبوه',
    emoji: '🌲',
    tagline: 'تنگ، سبز و نزدیک. اینجا هیچ چیزی دور شلیک نمی‌کند.',
    description:
      'درخت‌ها جلوی هر شلیک دوری را می‌گیرند. سلاح‌های نزدیک‌زن راحت می‌چرخند، اما تک‌تیرانداز و منجنیق هرگز خط دید تمیز پیدا نمی‌کنند.',
    typeModifiers: { melee: 22, ranged: 16, firearm: 3, sniper: -22, siege: -18, energy: -3 },
    weightModifiers: { light: 6, medium: 0, heavy: -12 },
    rangeSlope: -2,
    colors: ['#1f6f4a', '#0d3b28'],
  },
  {
    id: 'desert', // Open Desert
    name: 'بیابان باز',
    emoji: '🏜️',
    tagline: 'شنِ صاف تا افق. اینجا برد است که برنده می‌شود.',
    description:
      'تا کیلومترها را می‌بینی، پس سلاح‌های دوربرد فرمانروا هستند. تک‌تیرانداز ویرانگر است و هر سلاحی که باید تا نزدیک بدوی، تمام راه بی‌پناه است.',
    typeModifiers: { melee: -22, ranged: -4, firearm: 9, sniper: 24, siege: 12, energy: 6 },
    weightModifiers: { light: 0, medium: 3, heavy: 0 },
    rangeSlope: 2.6,
    colors: ['#d99a35', '#8a4f16'],
  },
  {
    id: 'city', // Ruined City
    name: 'شهر ویران',
    emoji: '🏚️',
    tagline: 'آوار، گوشه و درگاه. برد کوتاه و متوسط.',
    description:
      'هر درگیری پشت یک گوشه اتفاق می‌افتد. تپانچه، شمشیر و تفنگ تهاجمی می‌درخشند و سلاح‌های انرژی از میان سنگر می‌سوزانند؛ تک‌تیرانداز خط دیدش را از دست می‌دهد و منجنیق اصلاً جابه‌جا نمی‌شود.',
    typeModifiers: { melee: 12, ranged: 3, firearm: 22, sniper: -10, siege: -14, energy: 10 },
    weightModifiers: { light: 6, medium: 3, heavy: -16 },
    rangeSlope: -1.2,
    colors: ['#7d7f96', '#33364d'],
  },
  {
    id: 'snow', // Snow Mountains
    name: 'کوهستان برفی',
    emoji: '❄️',
    tagline: 'برفِ عمیق. هر چیز سنگینی فرو می‌رود.',
    description:
      'حرکت کند است و سلاح‌های سنگین بدجور در برف گیر می‌کنند. تجهیزات سبک و هوای سرد و شفاف، چیزی است که تو را از کوه پایین می‌آورد.',
    typeModifiers: { melee: -4, ranged: 6, firearm: -4, sniper: 14, siege: -20, energy: 18 },
    weightModifiers: { light: 16, medium: 0, heavy: -30 },
    rangeSlope: 0.6,
    colors: ['#7fb6e8', '#2b4a72'],
  },
  {
    id: 'coast', // Windy Coast
    name: 'ساحل بادخیز',
    emoji: '🌊',
    tagline: 'زمینی متعادل با آب باز در یک جناح.',
    description:
      'منصف‌ترین میدان بازی. سلاح‌های دوربرد کمی بهتر می‌شوند، منجنیق جای کافی برای شلیک دارد و فناوری آینده اینجا عالی عمل می‌کند.',
    typeModifiers: { melee: -6, ranged: 10, firearm: 6, sniper: 9, siege: 16, energy: 12 },
    weightModifiers: { light: 3, medium: 3, heavy: 0 },
    rangeSlope: 1.4,
    colors: ['#2f9fb5', '#134a63'],
  },
]

const TERRAINS_BY_ID = new Map(TERRAINS.map((t) => [t.id, t]))

export function findTerrain(id: TerrainId): Terrain | undefined {
  return TERRAINS_BY_ID.get(id)
}
