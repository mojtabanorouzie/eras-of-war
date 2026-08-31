import type { Terrain } from '../game/types'
import { terrainVars } from './theme'

interface TerrainBannerProps {
  terrain: Terrain
  /** Shown above the terrain name, e.g. "نبرد ۳ از ۶". */
  eyebrow?: string
}

export function TerrainBanner({ terrain, eyebrow }: TerrainBannerProps) {
  return (
    <section className="terrain" style={terrainVars(terrain)}>
      <div className="row">
        <span className="terrain__emoji" aria-hidden="true">
          {terrain.emoji}
        </span>
        <div>
          {eyebrow ? (
            <p className="eyebrow" style={{ color: 'rgba(255,255,255,0.82)' }}>
              {eyebrow}
            </p>
          ) : null}
          <h2 className="terrain__name">{terrain.name}</h2>
        </div>
      </div>
      <p className="terrain__tagline">{terrain.tagline}</p>
    </section>
  )
}
