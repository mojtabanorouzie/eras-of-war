import type { CSSProperties } from 'react'
import type { EraId, Terrain } from '../game/types'

/** Era accent colours, mirrored from `--era-*` in tokens.css. */
export const ERA_COLOR: Record<EraId, string> = {
  ancient: 'var(--era-ancient)',
  medieval: 'var(--era-medieval)',
  industrial: 'var(--era-industrial)',
  modern: 'var(--era-modern)',
  future: 'var(--era-future)',
}

/** Sets `--era` so a card can tint itself without a class per era. */
export function eraVars(era: EraId): CSSProperties {
  return { '--era': ERA_COLOR[era] } as CSSProperties
}

/** Sets `--t1` / `--t2` for terrain gradients. */
export function terrainVars(terrain: Terrain): CSSProperties {
  return { '--t1': terrain.colors[0], '--t2': terrain.colors[1] } as CSSProperties
}
