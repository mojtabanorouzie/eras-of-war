import { faSigned } from '../game/format'
import type { BonusNote } from '../game/types'

interface BonusChipsProps {
  notes: BonusNote[]
  /** Message when the terrain is completely neutral for this weapon. */
  emptyLabel?: string
}

/**
 * The "why is my power that number" row. Shown before the battle so the choice
 * is informed, and again afterwards so the lesson lands.
 */
export function BonusChips({ notes, emptyLabel = 'این زمین اثری ندارد' }: BonusChipsProps) {
  if (notes.length === 0) {
    return (
      <div className="notes">
        <span className="chip">{emptyLabel}</span>
      </div>
    )
  }

  return (
    <div className="notes">
      {notes.map((note) => (
        <span key={note.label} className={note.value >= 0 ? 'chip chip--good' : 'chip chip--bad'}>
          <span aria-hidden="true">{note.value >= 0 ? '▲' : '▼'}</span>
          {note.label} {faSigned(note.value)}
        </span>
      ))}
    </div>
  )
}
