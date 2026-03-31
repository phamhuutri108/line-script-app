import { useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'

interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'primary'
}

interface DialogState extends ConfirmOptions {
  resolve: (value: boolean) => void
}

// ── Singleton state held outside React ───────────────────────────────────────
let _show: ((opts: ConfirmOptions) => Promise<boolean>) | null = null

export function showConfirm(opts: ConfirmOptions): Promise<boolean> {
  if (!_show) return Promise.resolve(false)
  return _show(opts)
}

// ── Provider — mount once at app root ────────────────────────────────────────
export function ConfirmDialogProvider() {
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const resolveRef = useRef<((v: boolean) => void) | null>(null)

  const show = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve
      setDialog({ ...opts, resolve })
    })
  }, [])

  // Register singleton
  _show = show

  if (!dialog) return null

  function answer(value: boolean) {
    dialog!.resolve(value)
    setDialog(null)
  }

  const isDanger = (dialog.variant ?? 'danger') === 'danger'

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
        backdropFilter: 'blur(2px)',
      }}
      onClick={() => answer(false)}
    >
      <div
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '12px',
          padding: '1.5rem',
          width: '100%',
          maxWidth: '400px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)' }}>
          {dialog.title}
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
          {dialog.message}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
          <button
            style={{
              padding: '0.45rem 1rem',
              borderRadius: '7px',
              border: '1px solid var(--color-border)',
              background: 'transparent',
              color: 'var(--color-text-muted)',
              fontSize: '0.85rem',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
            onClick={() => answer(false)}
          >
            {dialog.cancelLabel ?? 'Hủy'}
          </button>
          <button
            style={{
              padding: '0.45rem 1rem',
              borderRadius: '7px',
              border: 'none',
              background: isDanger ? 'var(--color-danger)' : 'var(--color-primary)',
              color: '#fff',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
            onClick={() => answer(true)}
          >
            {dialog.confirmLabel ?? 'Xác nhận'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
