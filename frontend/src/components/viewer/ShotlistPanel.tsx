import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { shotsApi, type Shot, type ShotUpdate } from '../../api/shots'
import { useAuthStore } from '../../stores/authStore'
import { ApiError } from '../../api/client'
import { showConfirm } from '../shared/ConfirmDialog'

interface Props {
  scriptId: string
  projectId: string
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

function extractIntExt(shot: Shot): string {
  if (shot.int_ext) return shot.int_ext
  const m = (shot.description ?? '').match(/^(INT|EXT|INT\/EXT)/i)
  return m ? m[1].toUpperCase() : ''
}

function extractDayNight(shot: Shot): string {
  if (shot.day_night) return shot.day_night
  const m = (shot.description ?? '').match(/[-–]\s*(DAY|NIGHT|DAWN|DUSK)\b/i)
  return m ? m[1].toUpperCase() : ''
}

export default function ShotlistPanel({ scriptId, projectId, highlightLineId, onShotClick, onJumpToLine, refreshTrigger }: Props) {
  const { token } = useAuthStore()
  const [shots, setShots] = useState<Shot[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)

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
    const ok = await showConfirm({ title: 'Xóa shot', message: 'Shot này sẽ bị xóa vĩnh viễn.', confirmLabel: 'Xóa' })
    if (!ok) return
    try {
      await shotsApi.delete(token!, shotId)
      setShots((prev) => prev.filter((s) => s.id !== shotId))
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to delete')
    }
  }

  const highlightedIdx = highlightLineId
    ? shots.findIndex((s) => s.line_id === highlightLineId)
    : -1

  const headerLabel = highlightedIdx >= 0
    ? `${highlightedIdx + 1}/${shots.length}`
    : `${shots.length} shots`

  return (
    <div className="shotlist-panel">
      <div className="shotlist-panel-header">
        <span style={{ fontWeight: 700, fontSize: '0.82rem' }}>{headerLabel}</span>
        <Link
          to={`/projects/${projectId}/scripts/${scriptId}/shotlist`}
          className="btn-icon"
          title="Mở Shotlist đầy đủ"
          style={{ display: 'flex', alignItems: 'center', gap: '3px', padding: '0 8px', width: 'auto', fontSize: '0.72rem', fontWeight: 600, textDecoration: 'none' }}
        >
          Shotlist
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </Link>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
            <div className="spinner" />
          </div>
        ) : shots.length === 0 ? (
          <div style={{ padding: '1.5rem 1rem', color: 'var(--color-text-muted)', fontSize: '0.8rem', textAlign: 'center' }}>
            Vẽ line trên kịch bản để tạo shot
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
              projectId={projectId}
              scriptId={scriptId}
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
  projectId: string
  scriptId: string
}

function ShotRow({ shot, isHighlighted, isEditing, onEdit, onClose, onUpdate, onDelete, onClick, onJumpToLine, onShotChanged, projectId, scriptId }: RowProps) {
  const { token } = useAuthStore()
  const navigate = useNavigate()
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
    const ok = await showConfirm({ title: 'Xóa storyboard', message: 'Ảnh storyboard này sẽ bị xóa.', confirmLabel: 'Xóa' })
    if (!ok) return
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

  const intExt = extractIntExt(shot)
  const dayNight = extractDayNight(shot)

  return (
    <div
      className={`shot-row${isHighlighted ? ' highlighted' : ''}`}
      id={`panel-shot-${shot.id}`}
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
            {shot.scene_number ? `Cảnh ${shot.scene_number}` : `Shot ${shot.shot_number}`}
            {shot.location ? ` — ${shot.location}` : ''}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
            {[intExt, dayNight, shot.shot_size].filter(Boolean).join(' · ') || 'Chưa có thông tin'}
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            <ShotSelect label="INT/EXT" options={INT_EXT_OPTIONS} value={val('int_ext')} onChange={(v) => set('int_ext', v)} />
            <ShotSelect label="Day/Night" options={DAY_NIGHT_OPTIONS} value={val('day_night')} onChange={(v) => set('day_night', v)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            <ShotSelect label="Size" options={SHOT_SIZE_OPTIONS} value={val('shot_size')} onChange={(v) => set('shot_size', v)} />
            <ShotSelect label="Type" options={SHOT_TYPE_OPTIONS} value={val('shot_type')} onChange={(v) => set('shot_type', v)} />
          </div>
          <ShotSelect label="Angle" options={ANGLE_OPTIONS} value={val('angle')} onChange={(v) => set('angle', v)} />
          <ShotSelect label="Movement" options={MOVEMENT_OPTIONS} value={val('movement')} onChange={(v) => set('movement', v)} />
          <ShotField label="Lens" value={val('lens')} onChange={(v) => set('lens', v)} placeholder="e.g. 50mm" />
          <div>
            <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', marginBottom: '2px' }}>Ghi chú</div>
            <textarea
              value={(draft['user_notes'] !== undefined ? draft['user_notes'] : shot.user_notes) ?? ''}
              onChange={(e) => set('user_notes', e.target.value)}
              placeholder="Ghi chú về shot này…"
              style={{
                width: '100%', background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                borderRadius: '6px', padding: '0.4rem 0.5rem', color: 'var(--color-text)',
                fontSize: '0.78rem', outline: 'none', resize: 'vertical', minHeight: '54px', fontFamily: 'inherit',
              }}
            />
          </div>
          {shot.description && (
            <div className="auto-description-block">
              <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', marginBottom: '2px' }}>Trích từ kịch bản</div>
              <div className="auto-description-text">{shot.description}</div>
            </div>
          )}

          {/* Storyboard */}
          <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '0.5rem', marginTop: '0.25rem' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', marginBottom: '0.4rem' }}>Storyboard</div>
            {driveError === 'GOOGLE_NOT_CONNECTED' ? (
              <div style={{ fontSize: '0.75rem', color: 'var(--color-warning, #f59e0b)', background: 'rgba(245,158,11,0.08)', borderRadius: '6px', padding: '0.5rem 0.6rem' }}>
                Google Drive chưa kết nối.{' '}
                <a href="/settings" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>Kết nối trong Settings</a>
              </div>
            ) : driveError ? (
              <div style={{ fontSize: '0.75rem', color: 'var(--color-danger, #ef4444)' }}>{driveError}</div>
            ) : null}
            {shot.storyboard_view_url ? (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <img src={shot.storyboard_view_url} alt="storyboard" style={{ height: 54, borderRadius: '4px', border: '1px solid var(--color-border)', objectFit: 'cover' }} />
                <button className="btn btn-danger btn-sm" onClick={handleStoryboardDelete} style={{ fontSize: '0.7rem' }}>Xóa</button>
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
                  {uploading ? 'Đang upload…' : '+ Thêm ảnh'}
                </span>
              </label>
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" onClick={handleSave} style={{ flex: 1 }}>
              {hasChanges ? 'Lưu' : 'Đóng'}
            </button>
            <button
              className="btn btn-sm"
              style={{ fontSize: '0.72rem' }}
              onClick={() => navigate(`/projects/${projectId}/scripts/${scriptId}/shotlist?shot=${shot.id}`)}
            >
              → Shotlist
            </button>
            <button className="btn btn-danger btn-sm" onClick={onDelete}>Xóa</button>
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
