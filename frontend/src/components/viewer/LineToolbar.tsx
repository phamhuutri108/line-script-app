import { useRef } from 'react'

export interface LineToolState {
  mode: 'select' | 'draw'
  lineType: 'solid' | 'dashed'
  color: string
}

interface Props {
  state: LineToolState
  onChange: (s: LineToolState) => void
}

const PRESET_COLORS = ['#e05c5c', '#5c8ae0', '#5ce08a', '#e0c45c', '#c45ce0', '#000000']

export default function LineToolbar({ state, onChange }: Props) {
  const colorInputRef = useRef<HTMLInputElement>(null)

  function set(partial: Partial<LineToolState>) {
    onChange({ ...state, ...partial })
  }

  return (
    <div className="line-toolbar">
      {/* Select tool */}
      <button
        className={`tool-btn${state.mode === 'select' ? ' active' : ''}`}
        onClick={() => set({ mode: 'select' })}
        title="Select (V)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M5 3l14 9-7 1-4 7z" />
        </svg>
      </button>

      {/* Draw tool */}
      <button
        className={`tool-btn${state.mode === 'draw' ? ' active' : ''}`}
        onClick={() => set({ mode: 'draw' })}
        title="Draw line (L)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <line x1="12" y1="3" x2="12" y2="21" />
        </svg>
      </button>

      <div className="tool-divider" />

      {/* Solid line */}
      <button
        className={`tool-btn${state.lineType === 'solid' ? ' active' : ''}`}
        onClick={() => set({ lineType: 'solid', mode: 'draw' })}
        title="Solid line (single coverage)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <line x1="12" y1="3" x2="12" y2="21" />
        </svg>
      </button>

      {/* Dashed line */}
      <button
        className={`tool-btn${state.lineType === 'dashed' ? ' active' : ''}`}
        onClick={() => set({ lineType: 'dashed', mode: 'draw' })}
        title="Dashed line (multi coverage)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeDasharray="4 3">
          <line x1="12" y1="3" x2="12" y2="21" />
        </svg>
      </button>

      <div className="tool-divider" />

      {/* Preset colors */}
      {PRESET_COLORS.map((c) => (
        <button
          key={c}
          className="tool-btn"
          style={{ padding: 0 }}
          onClick={() => set({ color: c })}
          title={c}
        >
          <div
            className="color-swatch"
            style={{
              background: c,
              borderColor: state.color === c ? 'var(--color-primary)' : 'var(--color-border)',
              borderWidth: state.color === c ? 2 : 1.5,
            }}
          />
        </button>
      ))}

      {/* Custom color */}
      <button
        className="tool-btn"
        style={{ padding: 0, position: 'relative' }}
        onClick={() => colorInputRef.current?.click()}
        title="Custom color"
      >
        <div
          className="color-swatch"
          style={{
            background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)',
            borderColor: 'var(--color-border)',
          }}
        />
        <input
          ref={colorInputRef}
          type="color"
          className="hidden-color"
          value={state.color}
          onChange={(e) => set({ color: e.target.value })}
        />
      </button>
    </div>
  )
}
