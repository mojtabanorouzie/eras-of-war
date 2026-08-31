import { useEffect, useRef } from 'react'

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = 'بی‌خیال',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-message"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="dialog-title" className="subtitle">
          {title}
        </h2>
        <p id="dialog-message" className="body" style={{ marginTop: 'var(--s-2)' }}>
          {message}
        </p>
        <div className="row" style={{ marginTop: 'var(--s-5)' }}>
          <button
            ref={cancelRef}
            type="button"
            className="btn btn--ghost"
            style={{ flex: 1 }}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button type="button" className="btn btn--danger" style={{ flex: 1 }} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
