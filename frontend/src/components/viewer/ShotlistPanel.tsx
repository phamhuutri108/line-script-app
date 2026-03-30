import { useState, useEffect } from 'react'
import { shotsApi, type Shot, type ShotUpdate } from '../../api/shots'
import { useAuthStore } from '../../stores/authStore'
import { ApiError } from '../../api/client'
import * as XLSX from 'xlsx'

interface Props {
  scriptId: string
  highlightLineId?: string | null
  onShotClick?: (shot: Shot) => void
  refreshTrigger?: number
}

const SHOT_SIZE_OPTIONS = ['', 'ELS', 'LS', 'MLS', 'MS', 'MCU', 'CU', 'ECU']
const ANGLE_OPTIONS = ['', 'Eye level', 'Low angle', 'High angle', 'Bird\'s eye', 'Dutch']
const MOVEMENT_OPTIONS = ['', 'Static', 'Pan', 'Tilt', 'Dolly', 'Tracking', 'Handheld', 'Crane', 'Drone']
const INT_EXT_OPTIONS = ['', 'INT', 'EXT', 'INT/EXT']
const DAY_NIGHT_OPTIONS = ['', 'DAY', 'NIGHT', 'DAWN', 'DUSK']

export default function ShotlistPanel({ scriptId, highlightLineId, onShotClick, refreshTrigger }: Props) {
  const { token } = useAuthStore()
  const [shots, setShots] = useState<Shot[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [shareUrl, setShareUrl] = useState('')
  const [sharing, setSharing] = useState(false)

  useEffect(() => {
    loadShots()
  }, [scriptId, refreshTrigger])

  async function loadShots() {
    try {
      const data = await shotsApi.list(token!, scriptId)
      setShots(data.shots)
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }

  async function handleUpdate(shotId: string, data: ShotUpdate) {
    try {
      const res = await shotsApi.update(token!, shotId, data)
      setShots((prev) => prev.map((s) => s.id === shotId ? res.shot : s))
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to update shot')
    }
  }

  async function handleDelete(shotId: string) {
    if (!confirm('Delete this shot?')) return
    try {
      await shotsApi.delete(token!, shotId)
      setShots((prev) => prev.filter((s) => s.id !== shotId))
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to delete')
    }
  }

  async function handleShare() {
    setSharing(true)
    try {
      const data = await shotsApi.createShareToken(token!, scriptId)
      const url = `${window.location.origin}/share/${data.token}`
      setShareUrl(url)
      await navigator.clipboard.writeText(url)
    } catch {
      alert('Failed to create share link')
    } finally {
      setSharing(false)
    }
  }

  function exportCsv() {
    const headers = ['#', 'Scene', 'Location', 'INT/EXT', 'Day/Night', 'Description', 'Dialogue', 'Size', 'Angle', 'Movement', 'Lens', 'Notes']
    const rows = shots.map((s) => [
      s.shot_number, s.scene_number, s.location, s.int_ext, s.day_night,
      s.description, s.dialogue, s.shot_size, s.angle, s.movement, s.lens, s.notes,
    ])
    const csv = [headers, ...rows].map((r) => r.map((v) => {
      const val = String(v ?? '')
      return val.includes(',') || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val
    }).join(',')).join('\r\n')
    download(new Blob([csv], { type: 'text/csv' }), 'shotlist.csv')
  }

  function exportXlsx() {
    const data = shots.map((s) => ({
      '#': s.shot_number,
      'Scene': s.scene_number,
      'Location': s.location,
      'INT/EXT': s.int_ext,
      'Day/Night': s.day_night,
      'Description': s.description,
      'Dialogue': s.dialogue,
      'Size': s.shot_size,
      'Angle': s.angle,
      'Movement': s.movement,
      'Lens': s.lens,
      'Notes': s.notes,
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Shotlist')
    XLSX.writeFile(wb, 'shotlist.xlsx')
  }

  function download(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="shotlist-panel">
      <div className="shotlist-panel-header">
        <span>Shotlist ({shots.length})</span>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button className="btn-icon" onClick={exportCsv} title="Export CSV" style={{ width: 26, height: 26, fontSize: '0.65rem' }}>CSV</button>
          <button className="btn-icon" onClick={exportXlsx} title="Export XLSX" style={{ width: 26, height: 26, fontSize: '0.65rem' }}>XLS</button>
          <button className="btn-icon" onClick={handleShare} disabled={sharing} title="Copy share link" style={{ width: 26, height: 26 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
          </button>
        </div>
      </div>

      {shareUrl && (
        <div style={{ padding: '0.5rem 0.75rem', background: 'rgba(92,224,138,0.1)', borderBottom: '1px solid var(--color-border)', fontSize: '0.72rem', color: 'var(--color-success)' }}>
          Link copied! <span style={{ opacity: 0.7, wordBreak: 'break-all' }}>{shareUrl}</span>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
            <div className="spinner" />
          </div>
        ) : shots.length === 0 ? (
          <div style={{ padding: '1.5rem 1rem', color: 'var(--color-text-muted)', fontSize: '0.8rem', textAlign: 'center' }}>
            Draw lines on the PDF to generate shots
          </div>
        ) : (
          shots.map((shot) => (
            <ShotRow
              key={shot.id}
              shot={shot}
              isHighlighted={highlightLineId === shot.line_id}
              isEditing={editingId === shot.id}
              onEdit={() => setEditingId(shot.id)}
              onClose={() => setEditingId(null)}
              onUpdate={(data) => handleUpdate(shot.id, data)}
              onDelete={() => handleDelete(shot.id)}
              onClick={() => onShotClick?.(shot)}
            />
          ))
        )}
      </div>
    </div>
  )
}

interface RowProps {
  shot: Shot
  isHighlighted: boolean
  isEditing: boolean
  onEdit: () => void
  onClose: () => void
  onUpdate: (data: ShotUpdate) => void
  onDelete: () => void
  onClick: () => void
}

function ShotRow({ shot, isHighlighted, isEditing, onEdit, onClose, onUpdate, onDelete, onClick }: RowProps) {
  const [draft, setDraft] = useState<ShotUpdate>({})
  const hasChanges = Object.keys(draft).length > 0

  function set(field: keyof ShotUpdate, value: string) {
    setDraft((prev) => ({ ...prev, [field]: value || null }))
  }

  function handleSave() {
    if (hasChanges) onUpdate(draft)
    setDraft({})
    onClose()
  }

  function val(field: keyof ShotUpdate): string {
    return (draft[field] !== undefined ? draft[field] : shot[field]) as string ?? ''
  }

  return (
    <div
      className={`shot-row${isHighlighted ? ' highlighted' : ''}`}
      style={{
        borderBottom: '1px solid var(--color-border)',
        background: isHighlighted ? 'rgba(108,99,255,0.08)' : undefined,
      }}
    >
      {/* Collapsed header */}
      <div
        className="shot-row-header"
        onClick={() => { onClick(); isEditing ? onClose() : onEdit() }}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          padding: '0.6rem 0.75rem', cursor: 'pointer',
        }}
      >
        <span style={{
          background: 'var(--color-primary)', color: '#fff',
          borderRadius: '4px', padding: '1px 6px',
          fontSize: '0.72rem', fontWeight: 700, flexShrink: 0,
        }}>
          {shot.shot_number}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {shot.scene_number ? `Scene ${shot.scene_number}` : 'Untitled'}
            {shot.location ? ` — ${shot.location}` : ''}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
            {[shot.int_ext, shot.day_night, shot.shot_size].filter(Boolean).join(' · ') || 'No details yet'}
          </div>
        </div>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth={2}
          style={{ transform: isEditing ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s', flexShrink: 0 }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {/* Expanded editor */}
      {isEditing && (
        <div style={{ padding: '0 0.75rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <ShotField label="Scene #" value={val('scene_number')} onChange={(v) => set('scene_number', v)} />
          <ShotField label="Location" value={val('location')} onChange={(v) => set('location', v)} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            <ShotSelect label="INT/EXT" options={INT_EXT_OPTIONS} value={val('int_ext')} onChange={(v) => set('int_ext', v)} />
            <ShotSelect label="Day/Night" options={DAY_NIGHT_OPTIONS} value={val('day_night')} onChange={(v) => set('day_night', v)} />
          </div>
          <ShotField label="Description" value={val('description')} onChange={(v) => set('description', v)} multiline />
          <ShotField label="Dialogue" value={val('dialogue')} onChange={(v) => set('dialogue', v)} multiline />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            <ShotSelect label="Size" options={SHOT_SIZE_OPTIONS} value={val('shot_size')} onChange={(v) => set('shot_size', v)} />
            <ShotSelect label="Angle" options={ANGLE_OPTIONS} value={val('angle')} onChange={(v) => set('angle', v)} />
          </div>
          <ShotSelect label="Movement" options={MOVEMENT_OPTIONS} value={val('movement')} onChange={(v) => set('movement', v)} />
          <ShotField label="Lens" value={val('lens')} onChange={(v) => set('lens', v)} placeholder="e.g. 50mm" />
          <ShotField label="Notes" value={val('notes')} onChange={(v) => set('notes', v)} multiline />

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
            <button className="btn btn-primary btn-sm" onClick={handleSave} style={{ flex: 1 }}>
              {hasChanges ? 'Save' : 'Close'}
            </button>
            <button className="btn btn-danger btn-sm" onClick={onDelete}>Delete</button>
          </div>
        </div>
      )}
    </div>
  )
}

function ShotField({ label, value, onChange, multiline, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; multiline?: boolean; placeholder?: string
}) {
  return (
    <div>
      <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', marginBottom: '2px' }}>{label}</div>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{
            width: '100%', background: 'var(--color-bg)', border: '1px solid var(--color-border)',
            borderRadius: '6px', padding: '0.4rem 0.5rem', color: 'var(--color-text)',
            fontSize: '0.78rem', outline: 'none', resize: 'vertical', minHeight: '54px',
            fontFamily: 'inherit',
          }}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{
            width: '100%', background: 'var(--color-bg)', border: '1px solid var(--color-border)',
            borderRadius: '6px', padding: '0.4rem 0.5rem', color: 'var(--color-text)',
            fontSize: '0.78rem', outline: 'none',
          }}
        />
      )}
    </div>
  )
}

function ShotSelect({ label, options, value, onChange }: {
  label: string; options: string[]; value: string; onChange: (v: string) => void
}) {
  return (
    <div>
      <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', marginBottom: '2px' }}>{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%', background: 'var(--color-bg)', border: '1px solid var(--color-border)',
          borderRadius: '6px', padding: '0.4rem 0.5rem', color: value ? 'var(--color-text)' : 'var(--color-text-muted)',
          fontSize: '0.78rem', outline: 'none',
        }}
      >
        {options.map((o) => <option key={o} value={o}>{o || `— ${label} —`}</option>)}
      </select>
    </div>
  )
}
