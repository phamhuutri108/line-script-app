import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { shotsApi, type Shot, type ShotUpdate } from '../../api/shots'
import { scriptsApi, type Script } from '../../api/projects'
import { ApiError } from '../../api/client'
import * as XLSX from 'xlsx'
import './shotlist.css'

const SHOT_SIZE_OPTIONS = ['', 'ELS', 'LS', 'WS', 'MLS', 'MS', 'MCU', 'CU', 'ECU', 'Random']
const ANGLE_OPTIONS = ['', 'Eye Level', 'Low Angle', 'High Angle', "Bird's Eye", 'Dutch']
const MOVEMENT_OPTIONS = ['', 'Static', 'Pan', 'Tilt', 'Dolly', 'Tracking', 'Handheld', 'Crane', 'Drone']
const INT_EXT_OPTIONS = ['', 'I', 'E', 'I/E']
const DAY_NIGHT_OPTIONS = ['', 'D', 'N', 'Dawn', 'Dusk']
const SHOT_TYPE_OPTIONS = ['', 'Single', 'Two', 'Three', 'Group', 'Observe', 'Insert', 'POV', 'OTS']
const SIDE_OPTIONS = ['', 'L', 'R', 'L/R']

export default function ShotlistPage() {
  const { id: projectId, scriptId } = useParams<{ id: string; scriptId: string }>()
  const { token } = useAuthStore()
  const [shots, setShots] = useState<Shot[]>([])
  const [script, setScript] = useState<Script | null>(null)
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [shareUrl, setShareUrl] = useState('')
  const [sharing, setSharing] = useState(false)

  useEffect(() => { loadData() }, [scriptId])

  async function loadData() {
    setLoading(true)
    try {
      const [scriptsRes, shotsRes] = await Promise.all([
        scriptsApi.list(token!, projectId!),
        shotsApi.list(token!, scriptId!),
      ])
      setScript(scriptsRes.scripts.find((s) => s.id === scriptId) ?? null)
      setShots(shotsRes.shots)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }

  async function handleUpdate(shotId: string, data: ShotUpdate) {
    try {
      const res = await shotsApi.update(token!, shotId, data)
      setShots((prev) => prev.map((s) => s.id === shotId ? res.shot : s))
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to update')
    }
  }

  async function handleDelete(shotId: string) {
    if (!confirm('Delete this shot?')) return
    try {
      await shotsApi.delete(token!, shotId)
      setShots((prev) => prev.filter((s) => s.id !== shotId))
    } catch {
      alert('Failed to delete')
    }
  }

  async function handleShare() {
    setSharing(true)
    try {
      const data = await shotsApi.createShareToken(token!, scriptId!)
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
    const headers = ['#', 'Scene', 'Location', 'Shot #', 'INT/EXT', 'D/N', 'Description', 'Dialogue', 'Subjects', 'Script Time', 'Shot Size', 'Shot Type', 'Side', 'Angle', 'Movement', 'Lens', 'Notes']
    const rows = shots.map((s) => [
      s.shot_number, s.scene_number, s.location, '', s.int_ext, s.day_night,
      s.description, s.dialogue, s.subjects, s.script_time,
      s.shot_size, s.shot_type, s.side, s.angle, s.movement, s.lens, s.notes,
    ])
    const csv = [headers, ...rows].map((r) => r.map((v) => {
      const val = String(v ?? '')
      return val.includes(',') || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val
    }).join(',')).join('\r\n')
    download(new Blob([csv], { type: 'text/csv' }), `${script?.name ?? 'shotlist'}.csv`)
  }

  function exportXlsx() {
    const data = shots.map((s) => ({
      '#': s.shot_number,
      'Scene': s.scene_number,
      'Location': s.location,
      'INT/EXT': s.int_ext,
      'D/N': s.day_night,
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
    XLSX.writeFile(wb, `${script?.name ?? 'shotlist'}.xlsx`)
  }

  function download(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="sl-page">
      {/* Top bar */}
      <div className="sl-topbar">
        <div className="sl-topbar-left">
          <Link to={`/projects/${projectId}`} className="sl-back-btn" title="Back to project">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </Link>
          <div>
            <div className="sl-script-name">{script?.name ?? '…'}</div>
            <div className="sl-subtitle">Shotlist — {shots.length} shots</div>
          </div>
        </div>
        <div className="sl-topbar-actions">
          <Link to={`/projects/${projectId}/scripts/${scriptId}/viewer`} className="sl-action-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            Line Script
          </Link>
          <button className="sl-action-btn" onClick={exportCsv}>CSV</button>
          <button className="sl-action-btn" onClick={exportXlsx}>XLSX</button>
          <button className="sl-action-btn" onClick={handleShare} disabled={sharing}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
            Share
          </button>
        </div>
      </div>

      {shareUrl && (
        <div className="sl-share-banner">
          Link copied! <span>{shareUrl}</span>
        </div>
      )}

      {/* Table */}
      <div className="sl-table-wrap">
        {loading ? (
          <div className="sl-empty"><div className="spinner" /></div>
        ) : shots.length === 0 ? (
          <div className="sl-empty">
            <p>No shots yet. Open Line Script to draw lines on the PDF and generate shots.</p>
            <Link to={`/projects/${projectId}/scripts/${scriptId}/viewer`} className="sl-action-btn">Open Line Script</Link>
          </div>
        ) : (
          <table className="sl-table">
            <thead>
              <tr>
                <th className="sl-th sl-th-num">#</th>
                <th className="sl-th">SCENE</th>
                <th className="sl-th sl-th-loc">LOCATION</th>
                <th className="sl-th">INT/EXT</th>
                <th className="sl-th">D/N</th>
                <th className="sl-th sl-th-storyboard">STORYBOARD</th>
                <th className="sl-th sl-th-desc">DESCRIPTION</th>
                <th className="sl-th sl-th-desc">DIALOGUE</th>
                <th className="sl-th">SUBJECTS</th>
                <th className="sl-th">TIME</th>
                <th className="sl-th">SIZE</th>
                <th className="sl-th">TYPE</th>
                <th className="sl-th">SIDE</th>
                <th className="sl-th">ANGLE</th>
                <th className="sl-th">MOVEMENT</th>
                <th className="sl-th">LENS</th>
                <th className="sl-th sl-th-notes">NOTES</th>
                <th className="sl-th sl-th-actions"></th>
              </tr>
            </thead>
            <tbody>
              {shots.map((shot) => (
                <ShotRow
                  key={shot.id}
                  shot={shot}
                  isEditing={editingId === shot.id}
                  onEdit={() => setEditingId(shot.id)}
                  onClose={() => setEditingId(null)}
                  onUpdate={(data) => handleUpdate(shot.id, data)}
                  onDelete={() => handleDelete(shot.id)}
                  onShotChanged={(updated) => setShots((prev) => prev.map((s) => s.id === updated.id ? updated : s))}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

interface RowProps {
  shot: Shot
  isEditing: boolean
  onEdit: () => void
  onClose: () => void
  onUpdate: (data: ShotUpdate) => void
  onDelete: () => void
  onShotChanged: (updated: Shot) => void
}

function ShotRow({ shot, isEditing, onEdit, onClose, onUpdate, onDelete }: RowProps) {
  const [draft, setDraft] = useState<ShotUpdate>({})
  const rowRef = useRef<HTMLTableRowElement>(null)
  const hasChanges = Object.keys(draft).length > 0

  function set(field: keyof ShotUpdate, value: string) {
    setDraft((prev) => ({ ...prev, [field]: value || null }))
  }

  function val(field: keyof ShotUpdate): string {
    return (draft[field] !== undefined ? draft[field] : shot[field]) as string ?? ''
  }

  function handleSave() {
    if (hasChanges) onUpdate(draft)
    setDraft({})
    onClose()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSave() }
    if (e.key === 'Escape') { setDraft({}); onClose() }
  }

  if (isEditing) {
    return (
      <tr ref={rowRef} className="sl-row sl-row-editing" onKeyDown={handleKeyDown}>
        <td className="sl-td sl-td-num">{shot.shot_number}</td>
        <td className="sl-td"><input className="sl-input" value={val('scene_number')} onChange={(e) => set('scene_number', e.target.value)} placeholder="1" /></td>
        <td className="sl-td"><input className="sl-input" value={val('location')} onChange={(e) => set('location', e.target.value)} placeholder="Location" /></td>
        <td className="sl-td">
          <select className="sl-select" value={val('int_ext')} onChange={(e) => set('int_ext', e.target.value)}>
            {INT_EXT_OPTIONS.map((o) => <option key={o} value={o}>{o || '—'}</option>)}
          </select>
        </td>
        <td className="sl-td">
          <select className="sl-select" value={val('day_night')} onChange={(e) => set('day_night', e.target.value)}>
            {DAY_NIGHT_OPTIONS.map((o) => <option key={o} value={o}>{o || '—'}</option>)}
          </select>
        </td>
        <td className="sl-td sl-td-storyboard">
          {shot.storyboard_view_url
            ? <img src={shot.storyboard_view_url} alt="" className="sl-storyboard-thumb" />
            : <span className="sl-empty-cell">—</span>}
        </td>
        <td className="sl-td"><textarea className="sl-textarea" value={val('description')} onChange={(e) => set('description', e.target.value)} rows={3} /></td>
        <td className="sl-td"><textarea className="sl-textarea" value={val('dialogue')} onChange={(e) => set('dialogue', e.target.value)} rows={3} /></td>
        <td className="sl-td"><input className="sl-input" value={val('subjects')} onChange={(e) => set('subjects', e.target.value)} placeholder="Characters" /></td>
        <td className="sl-td"><input className="sl-input" value={val('script_time')} onChange={(e) => set('script_time', e.target.value)} placeholder="00:30" /></td>
        <td className="sl-td">
          <select className="sl-select" value={val('shot_size')} onChange={(e) => set('shot_size', e.target.value)}>
            {SHOT_SIZE_OPTIONS.map((o) => <option key={o} value={o}>{o || '—'}</option>)}
          </select>
        </td>
        <td className="sl-td">
          <select className="sl-select" value={val('shot_type')} onChange={(e) => set('shot_type', e.target.value)}>
            {SHOT_TYPE_OPTIONS.map((o) => <option key={o} value={o}>{o || '—'}</option>)}
          </select>
        </td>
        <td className="sl-td">
          <select className="sl-select" value={val('side')} onChange={(e) => set('side', e.target.value)}>
            {SIDE_OPTIONS.map((o) => <option key={o} value={o}>{o || '—'}</option>)}
          </select>
        </td>
        <td className="sl-td">
          <select className="sl-select" value={val('angle')} onChange={(e) => set('angle', e.target.value)}>
            {ANGLE_OPTIONS.map((o) => <option key={o} value={o}>{o || '—'}</option>)}
          </select>
        </td>
        <td className="sl-td">
          <select className="sl-select" value={val('movement')} onChange={(e) => set('movement', e.target.value)}>
            {MOVEMENT_OPTIONS.map((o) => <option key={o} value={o}>{o || '—'}</option>)}
          </select>
        </td>
        <td className="sl-td"><input className="sl-input" value={val('lens')} onChange={(e) => set('lens', e.target.value)} placeholder="50mm" /></td>
        <td className="sl-td"><textarea className="sl-textarea" value={val('notes')} onChange={(e) => set('notes', e.target.value)} rows={2} /></td>
        <td className="sl-td sl-td-actions">
          <button className="sl-btn-save" onClick={handleSave}>{hasChanges ? 'Save' : 'Close'}</button>
          <button className="sl-btn-del" onClick={onDelete}>Del</button>
        </td>
      </tr>
    )
  }

  return (
    <tr className="sl-row" onClick={onEdit}>
      <td className="sl-td sl-td-num">{shot.shot_number}</td>
      <td className="sl-td sl-td-center">{shot.scene_number ?? '—'}</td>
      <td className="sl-td">{shot.location ?? '—'}</td>
      <td className="sl-td sl-td-center">{shot.int_ext ?? '—'}</td>
      <td className="sl-td sl-td-center">{shot.day_night ?? '—'}</td>
      <td className="sl-td sl-td-storyboard">
        {shot.storyboard_view_url
          ? <img src={shot.storyboard_view_url} alt="storyboard" className="sl-storyboard-thumb" />
          : <span className="sl-empty-cell">—</span>}
      </td>
      <td className="sl-td sl-td-desc">{shot.description ?? '—'}</td>
      <td className="sl-td sl-td-desc">{shot.dialogue ?? '—'}</td>
      <td className="sl-td">{shot.subjects ?? '—'}</td>
      <td className="sl-td sl-td-center">{shot.script_time ?? '—'}</td>
      <td className="sl-td sl-td-center">{shot.shot_size ?? '—'}</td>
      <td className="sl-td sl-td-center">{shot.shot_type ?? '—'}</td>
      <td className="sl-td sl-td-center">{shot.side ?? '—'}</td>
      <td className="sl-td sl-td-center">{shot.angle ?? '—'}</td>
      <td className="sl-td sl-td-center">{shot.movement ?? '—'}</td>
      <td className="sl-td sl-td-center">{shot.lens ?? '—'}</td>
      <td className="sl-td">{shot.notes ?? '—'}</td>
      <td className="sl-td sl-td-actions">
        <button className="sl-btn-edit" onClick={(e) => { e.stopPropagation(); onEdit() }}>Edit</button>
      </td>
    </tr>
  )
}
