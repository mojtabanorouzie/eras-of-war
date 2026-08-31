import type { ReactNode } from 'react'

interface TopBarProps {
  title: string
  onBack?: (() => void) | undefined
  right?: ReactNode
}

export function TopBar({ title, onBack, right }: TopBarProps) {
  return (
    <header className="topbar">
      {onBack ? (
        <button type="button" className="btn btn--ghost btn--icon" onClick={onBack} aria-label="بازگشت">
          {/* The page is RTL, so "back" points right. */}
          <span aria-hidden="true">→</span>
        </button>
      ) : null}
      <h1 className="topbar__title">{title}</h1>
      {right}
    </header>
  )
}
