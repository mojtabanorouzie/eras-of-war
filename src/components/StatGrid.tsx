export interface StatItem {
  label: string
  value: string
  emoji?: string
}

interface StatGridProps {
  items: StatItem[]
}

export function StatGrid({ items }: StatGridProps) {
  return (
    <div className="stats">
      {items.map((item) => (
        <div key={item.label} className="stat">
          <div className="stat__value">
            {item.emoji ? (
              <span aria-hidden="true" style={{ marginRight: 4 }}>
                {item.emoji}
              </span>
            ) : null}
            {item.value}
          </div>
          <div className="stat__label">{item.label}</div>
        </div>
      ))}
    </div>
  )
}
