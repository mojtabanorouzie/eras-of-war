import { faNumber } from '../game/format'

interface PowerBarProps {
  label: string
  emoji: string
  value: number
  /** Scale reference so both bars in a battle are comparable. */
  max: number
  side: 'player' | 'enemy'
  /** Hide the number until the reveal moment. */
  showValue?: boolean
}

export function PowerBar({ label, emoji, value, max, side, showValue = true }: PowerBarProps) {
  const percent = Math.max(6, Math.min(100, (value / Math.max(1, max)) * 100))

  return (
    <div className={side === 'enemy' ? 'bar bar--enemy' : 'bar'}>
      <div className="bar__head">
        <span className="bar__name">
          <span aria-hidden="true">{emoji}</span>
          {label}
        </span>
        <span className="bar__value num">{showValue ? faNumber(value) : '···'}</span>
      </div>
      <div
        className="bar__track"
        role="progressbar"
        aria-label={`قدرت نبرد ${label}`}
        aria-valuenow={showValue ? value : 0}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        <div className="bar__fill" style={{ width: `${showValue ? percent : 6}%` }} />
        <div className="bar__ticks" aria-hidden="true" />
      </div>
    </div>
  )
}
