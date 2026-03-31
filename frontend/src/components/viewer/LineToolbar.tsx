import { useRef } from 'react'

export interface LineToolState {
  mode: 'select' | 'draw' | 'scene'
  initialSegType: 'straight' | 'zigzag'  // initial segment type when starting to draw
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
        title="Select / Move (V)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M5 3l14 9-7 1-4 7z" />
        </svg>
      </button>

      {/* Draw shot line tool */}
      <button
        className={`tool-btn${state.mode === 'draw' ? ' active' : ''}`}
        onClick={() => set({ mode: 'draw' })}
        title="Draw shot line (L) — click start, click end"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <line x1="12" y1="3" x2="12" y2="21" />
          <line x1="8" y1="3" x2="16" y2="3" />
          <line x1="8" y1="21" x2="16" y2="21" />
        </svg>
      </button>

      {/* Scene marker tool */}
      <button
        className={`tool-btn${state.mode === 'scene' ? ' active' : ''}`}
        onClick={() => set({ mode: 'scene' })}
        title="Add scene marker (S)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="8" x2="3" y2="12" />
          <line x1="8" y1="15" x2="8" y2="12" />
        </svg>
      </button>

      <div className="tool-divider" />

      {/* Straight segment (initial) */}
      <button
        className={`tool-btn${state.initialSegType === 'straight' ? ' active' : ''}`}
        onClick={() => set({ initialSegType: 'straight', mode: 'draw' })}
        title="Start with straight segment (on-screen)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <line x1="12" y1="3" x2="12" y2="21" />
        </svg>
      </button>

      {/* Zigzag segment (initial) */}
      <button
        className={`tool-btn${state.initialSegType === 'zigzag' ? ' active' : ''}`}
        onClick={() => set({ initialSegType: 'zigzag', mode: 'draw' })}
        title="Start with zigzag segment (off-screen / VO)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <polyline points="12,3 16,7 8,11 16,15 8,19 12,21" />
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

      {/* Tab hint during draw */}
      {state.mode === 'draw' && (
        <div className="tool-tab-hint" title="Press Tab while drawing to toggle straight/zigzag segment">
          Tab
        </div>
      )}
    </div>
  )
}
