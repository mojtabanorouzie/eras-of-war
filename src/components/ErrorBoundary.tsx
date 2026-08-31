import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { clearState } from '../game/storage'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  crashed: boolean
}

/**
 * Last line of defence. The player never sees a stack trace — they get a
 * button that wipes the save and puts them back on the field.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { crashed: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { crashed: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Eras of War crashed:', error, info.componentStack)
  }

  private readonly restart = () => {
    clearState()
    window.location.reload()
  }

  override render(): ReactNode {
    if (!this.state.crashed) return this.props.children

    return (
      <div className="app">
        <div className="shell stack" style={{ paddingTop: 'var(--s-7)', textAlign: 'center' }}>
          <div style={{ fontSize: 56 }} aria-hidden="true">
            🛠️
          </div>
          <h1 className="title">یک جای کار ایراد داشت</h1>
          <p className="body">
            میدان نبرد قاطی کرد. با شروع یک لشکرکشی تازه درست می‌شود — دستگاه تو هیچ مشکلی ندارد.
          </p>
          <button type="button" className="btn btn--primary btn--lg btn--block" onClick={this.restart}>
            شروع لشکرکشی تازه
          </button>
        </div>
      </div>
    )
  }
}
