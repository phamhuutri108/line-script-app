import { useState, useEffect } from 'react'
import { shotsApi, type Shot, type ShotUpdate } from '../../api/shots'
import { useAuthStore } from '../../stores/authStore'
import { ApiError } from '../../api/client'
import * as XLSX from 'xlsx'

interface Props {
  scriptId: string
  highlightLineId?: string | null
  onShotClick?: (shot: Shot) => void
  onJumpToLine?: (lineId: string, pageNum: number) => void
  refreshTrigger?: number
}

const SHOT_SIZE_OPTIONS = ['', 'ELS', 'LS', 'MLS', 'MS', 'MCU', 'CU', 'ECU']
const ANGLE_OPTIONS = ['', 'Eye level', 'Low angle', 'High angle', 'Bird\'s eye', 'Dutch']
const MOVEMENT_OPTIONS = ['', 'Static', 'Pan', 'Tilt', 'Dolly', 'Tracking', 'Handheld', 'Crane', 'Drone']
const INT_EXT_OPTIONS = ['', 'INT', 'EXT', 'INT/EXT']
const DAY_NIGHT_OPTIONS = ['', 'DAY', 'NIGHT', 'DAWN', 'DUSK']
const SHOT_TYPE_OPTIONS = ['', 'Single', 'Two', 'Three', 'Group', 'Observe', 'Insert', 'POV', 'OTS']
const SIDE_OPTIONS = ['', 'L', 'R', 'L/R']

export default function ShotlistPanel({ scriptId, highlightLineId, onShotClick, onJumpToLine, refreshTrigger }: Props) {
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
    const headers = ['#', 'Scene', 'Location', 'INT/EXT', 'Day/Night', 'Description', 'Dialogue', 'Subjects', 'Script Time', 'Shot Size', 'Shot Type', 'Side', 'Angle', 'Movement', 'Lens', 'Notes']
    const rows = shots.map((s) => [
      s.shot_number, s.scene_number, s.location, s.int_ext, s.day_night,
      s.description, s.dialogue, s.subjects, s.script_time,
      s.shot_size, s.shot_type, s.side, s.angle, s.movement, s.lens, s.notes,
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
      'Subjects': s.subjects,
      'Script Time': s.script_time,
      'Shot Size': s.shot_size,
      'Shot Type': s.shot_type,
      'Side': s.side,
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
              onJumpToLine={shot.line_id && shot.page_number ? () => onJumpToLine?.(shot.line_id!, shot.page_number!) : undefined}
              onShotChanged={(updated) => setShots((prev) => prev.map((s) => s.id === updated.id ? updated : s))}
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
  onJumpToLine?: () => void
  onShotChanged: (updated: Shot) => void
}

function ShotRow({ shot, isHighlighted, isEditing, onEdit, onClose, onUpdate, onDelete, onClick, onJumpToLine, onShotChanged }: RowProps) {
  const { token } = useAuthStore()
  const [draft, setDraft] = useState<ShotUpdate>({})
  const [uploading, setUploading] = useState(false)
  const [driveError, setDriveError] = useState<string | null>(null)

  async function handleStoryboardUpload(file: File) {
    setUploading(true)
    setDriveError(null)
    try {
      const res = await shotsApi.uploadStoryboard(token!, shot.id, file)
      onShotChanged({ ...shot, storyboard_drive_id: res.driveFileId, storyboard_view_url: res.viewUrl })
    } catch (err: unknown) {
      const e = err as { message?: string; code?: string }
      if (e.code === 'GOOGLE_NOT_CONNECTED') {
        setDriveError('GOOGLE_NOT_CONNECTED')
      } else {
        setDriveError(e.message ?? 'Upload failed')
      }
    } finally {
      setUploading(false)
    }
  }

  async function handleStoryboardDelete() {
    if (!confirm('Remove storyboard image?')) return
    await shotsApi.deleteStoryboard(token!, shot.id)
    onShotChanged({ ...shot, storyboard_drive_id: null, storyboard_view_url: null })
  }
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
        {shot.storyboard_view_url && (
          <img
            src={shot.storyboard_view_url}
            alt="storyboard"
            style={{ width: 36, height: 27, objectFit: 'cover', borderRadius: '3px', flexShrink: 0, border: '1px solid var(--color-border)' }}
          />
        )}
        {onJumpToLine && (
          <button
            className="jump-to-line-btn"
            title="Đến kịch bản"
            onClick={(e) => { e.stopPropagation(); onJumpToLine() }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        )}
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
          {/* Two-part description */}
          <div>
            <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', marginBottom: '2px' }}>Ghi chú</div>
            <textarea
              value={(draft['user_notes'] !== undefined ? draft['user_notes'] : shot.user_notes) ?? ''}
              onChange={(e) => set('user_notes', e.target.value)}
              placeholder="Ghi chú của bạn về shot này…"
              style={{
                width: '100%', background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                borderRadius: '6px', padding: '0.4rem 0.5rem', color: 'var(--color-text)',
                fontSize: '0.78rem', outline: 'none', resize: 'vertical', minHeight: '54px', fontFamily: 'inherit',
              }}
            />
          </div>
          {shot.description && (
            <div className="auto-description-block">
              <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', marginBottom: '2px' }}>
                Trích từ kịch bản
              </div>
              <div className="auto-description-text">{shot.description}</div>
            </div>
          )}
          <ShotField label="Dialogue" value={val('dialogue')} onChange={(v) => set('dialogue', v)} multiline />
          <ShotField label="Subjects" value={val('subjects')} onChange={(v) => set('subjects', v)} placeholder="Characters in frame" />
          <ShotField label="Script Time" value={val('script_time')} onChange={(v) => set('script_time', v)} placeholder="00:30" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            <ShotSelect label="Size" options={SHOT_SIZE_OPTIONS} value={val('shot_size')} onChange={(v) => set('shot_size', v)} />
            <ShotSelect label="Type" options={SHOT_TYPE_OPTIONS} value={val('shot_type')} onChange={(v) => set('shot_type', v)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            <ShotSelect label="Side" options={SIDE_OPTIONS} value={val('side')} onChange={(v) => set('side', v)} />
            <ShotSelect label="Angle" options={ANGLE_OPTIONS} value={val('angle')} onChange={(v) => set('angle', v)} />
          </div>
          <ShotSelect label="Movement" options={MOVEMENT_OPTIONS} value={val('movement')} onChange={(v) => set('movement', v)} />
          <ShotField label="Lens" value={val('lens')} onChange={(v) => set('lens', v)} placeholder="e.g. 50mm" />
          <ShotField label="Notes" value={val('notes')} onChange={(v) => set('notes', v)} multiline />

          {/* Storyboard */}
          <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '0.5rem', marginTop: '0.25rem' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', marginBottom: '0.4rem' }}>Storyboard</div>
            {driveError === 'GOOGLE_NOT_CONNECTED' ? (
              <div style={{ fontSize: '0.75rem', color: 'var(--color-warning, #f59e0b)', background: 'rgba(245,158,11,0.08)', borderRadius: '6px', padding: '0.5rem 0.6rem' }}>
                Google Drive not connected.{' '}
                <a href="/settings" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>Connect in Settings</a>
                {' '}to use storyboard upload.
              </div>
            ) : driveError ? (
              <div style={{ fontSize: '0.75rem', color: 'var(--color-danger, #ef4444)' }}>{driveError}</div>
            ) : null}
            {shot.storyboard_view_url ? (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <img src={shot.storyboard_view_url} alt="storyboard" style={{ height: 54, borderRadius: '4px', border: '1px solid var(--color-border)', objectFit: 'cover' }} />
                <button className="btn btn-danger btn-sm" onClick={handleStoryboardDelete} style={{ fontSize: '0.7rem' }}>Remove</button>
              </div>
            ) : (
              <label style={{ display: 'inline-block', cursor: 'pointer' }}>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleStoryboardUpload(f) }}
                />
                <span className="btn btn-sm" style={{ fontSize: '0.75rem', opacity: uploading ? 0.6 : 1, pointerEvents: uploading ? 'none' : 'auto' }}>
                  {uploading ? 'Uploading…' : '+ Upload image'}
                </span>
              </label>
            )}
          </div>

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
