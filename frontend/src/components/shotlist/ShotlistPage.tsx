import { useState, useEffect, useRef } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { shotsApi, type Shot, type ShotUpdate } from '../../api/shots'
import { scriptsApi, projectsApi, type Script } from '../../api/projects'
import { showConfirm } from '../shared/ConfirmDialog'
import { googleApi } from '../../api/google'
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
  const [searchParams] = useSearchParams()
  const { token } = useAuthStore()
  const [shots, setShots] = useState<Shot[]>([])
  const [script, setScript] = useState<Script | null>(null)
  const [projectName, setProjectName] = useState('')
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [shareUrl, setShareUrl] = useState('')
  const [sharing, setSharing] = useState(false)
  const [googleConnected, setGoogleConnected] = useState(false)
  const [showSheetsModal, setShowSheetsModal] = useState(false)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => { loadData() }, [scriptId])

  // Scroll to and open shot from ?shot= param after data loads
  useEffect(() => {
    const shotId = searchParams.get('shot')
    if (!shotId || loading) return
    setEditingId(shotId)
    setTimeout(() => {
      document.getElementById(`shot-${shotId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 100)
  }, [loading])

  async function loadData() {
    setLoading(true)
    try {
      const [scriptsRes, shotsRes, projectRes, googleRes] = await Promise.all([
        scriptsApi.list(token!, projectId!),
        shotsApi.list(token!, scriptId!),
        projectsApi.get(token!, projectId!),
        googleApi.getStatus(token!),
      ])
      setScript(scriptsRes.scripts.find((s) => s.id === scriptId) ?? null)
      setShots(shotsRes.shots)
      setProjectName(projectRes.project.name)
      setGoogleConnected(googleRes.connected)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }

  async function handleSyncAll() {
    setSyncing(true)
    try {
      await googleApi.syncAll(token!, scriptId!)
    } catch {
      alert('Sync failed')
    } finally {
      setSyncing(false)
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
    const ok = await showConfirm({ title: 'Xóa shot', message: 'Shot này sẽ bị xóa vĩnh viễn.', confirmLabel: 'Xóa' })
    if (!ok) return
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
            Script Lining
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

          {/* ── Sheets ── */}
          {!googleConnected && (
            <Link to="/settings" className="sl-action-btn sl-sheets-btn" title="Connect Google to use Sheets">
              Google Sheets
            </Link>
          )}
          {googleConnected && !script?.sheets_id && (
            <button className="sl-action-btn sl-sheets-btn" onClick={() => setShowSheetsModal(true)}>
              + Google Sheet
            </button>
          )}
          {googleConnected && script?.sheets_id && (
            <>
              <a
                className="sl-action-btn sl-sheets-btn"
                href={script.sheets_url ?? `https://docs.google.com/spreadsheets/d/${script.sheets_id}`}
                target="_blank"
                rel="noreferrer"
              >
                Open Sheet ↗
              </a>
              <button className="sl-action-btn" onClick={handleSyncAll} disabled={syncing}>
                {syncing ? 'Syncing…' : 'Sync'}
              </button>
            </>
          )}
        </div>
      </div>

      {showSheetsModal && (
        <SheetSetupModal
          projectName={projectName}
          scriptId={scriptId!}
          token={token!}
          onClose={() => setShowSheetsModal(false)}
          onCreated={(sheetsId, sheetsUrl) => {
            setScript((prev) => prev ? { ...prev, sheets_id: sheetsId, sheets_url: sheetsUrl } : prev)
            setShowSheetsModal(false)
          }}
        />
      )}

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
            <p>No shots yet. Open Script Lining to draw lines on the PDF and generate shots.</p>
            <Link to={`/projects/${projectId}/scripts/${scriptId}/viewer`} className="sl-action-btn">Open Script Lining</Link>
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
                  projectId={projectId!}
                  scriptId={scriptId!}
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
  projectId: string
  scriptId: string
}

function ShotRow({ shot, isEditing, onEdit, onClose, onUpdate, onDelete, projectId, scriptId }: RowProps) {
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
      <tr ref={rowRef} id={`shot-${shot.id}`} className="sl-row sl-row-editing" onKeyDown={handleKeyDown}>
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
          {shot.line_id && shot.page_number && (
            <Link
              to={`/projects/${projectId}/scripts/${scriptId}/viewer?line=${shot.line_id}&page=${shot.page_number}`}
              className="sl-btn-edit"
              onClick={(e) => e.stopPropagation()}
              title="Xem trong Script Lining"
            >→</Link>
          )}
        </td>
      </tr>
    )
  }

  return (
    <tr id={`shot-${shot.id}`} className="sl-row" onClick={onEdit}>
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
        {shot.line_id && shot.page_number && (
          <Link
            to={`/projects/${projectId}/scripts/${scriptId}/viewer?line=${shot.line_id}&page=${shot.page_number}`}
            className="sl-btn-edit"
            onClick={(e) => e.stopPropagation()}
            title="Xem trong Script Lining"
          >→</Link>
        )}
      </td>
    </tr>
  )
}

// ─── Sheet Setup Modal ────────────────────────────────────────────────────────

function genAbbrev(name: string): string {
  return name
    .split(/\s+/)
    .map((word) => {
      const first = word.charAt(0)
      return first.replace(/[Đđ]/g, 'd').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z]/g, '')
    })
    .filter(Boolean)
    .join('')
    .toUpperCase()
}

function SheetSetupModal({
  projectName,
  scriptId,
  token,
  onClose,
  onCreated,
}: {
  projectName: string
  scriptId: string
  token: string
  onClose: () => void
  onCreated: (sheetsId: string, sheetsUrl: string) => void
}) {
  const [folderId, setFolderId] = useState<string | null>(null)
  const [folderName, setFolderName] = useState<string>('')
  const [abbrev, setAbbrev] = useState(() => genAbbrev(projectName))
  const [versionType, setVersionType] = useState<'draft' | 'final'>('draft')
  const [versionNum, setVersionNum] = useState('01')
  const [creating, setCreating] = useState(false)
  const [loadingPicker, setLoadingPicker] = useState(false)
  const [error, setError] = useState('')

  async function openPicker() {
    setLoadingPicker(true)
    try {
      const { accessToken } = await googleApi.getAccessToken(token)
      await new Promise<void>((resolve, reject) => {
        if ((window as any).gapi?.picker) { resolve(); return }
        const existing = document.getElementById('gapi-script')
        if (existing) { setTimeout(resolve, 500); return }
        const script = document.createElement('script')
        script.id = 'gapi-script'
        script.src = 'https://apis.google.com/js/api.js'
        script.onload = () => {
          (window as any).gapi.load('picker', { callback: resolve })
        }
        script.onerror = reject
        document.head.appendChild(script)
      })
      const pickerApi = (window as any).google?.picker
      if (!pickerApi) throw new Error('Picker không tải được')
      const picker = new pickerApi.PickerBuilder()
        .addView(new pickerApi.DocsView(pickerApi.ViewId.FOLDERS)
          .setSelectFolderEnabled(true)
          .setIncludeFolders(true)
          .setMimeTypes('application/vnd.google-apps.folder'))
        .setOAuthToken(accessToken)
        .setDeveloperKey(import.meta.env.VITE_GOOGLE_PICKER_API_KEY)
        .setCallback((data: any) => {
          if (data.action === pickerApi.Action.PICKED) {
            const doc = data.docs[0]
            setFolderId(doc.id)
            setFolderName(doc.name)
          }
        })
        .build()
      picker.setVisible(true)
    } catch (e) {
      setError('Không mở được Drive Picker')
    } finally {
      setLoadingPicker(false)
    }
  }

  const now = new Date()
  const dateStr = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  const versionSuffix = versionType === 'final' ? '[FINAL]' : `[Draft_${versionNum.padStart(2, '0')}]`
  const previewName = `${dateStr}_${abbrev || 'ABBREV'}_Shotlist_${versionSuffix}`

  async function handleCreate() {
    if (!abbrev.trim()) { setError('Tên tắt không được để trống'); return }
    setCreating(true)
    setError('')
    try {
      const res = await googleApi.sheetsSetup(token, {
        scriptId,
        folderId: folderId ?? undefined,
        abbrev: abbrev.trim(),
        projectName,
        versionType,
        versionNum: versionType === 'draft' ? versionNum.padStart(2, '0') : undefined,
      })
      onCreated(res.sheetsId, res.sheetsUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tạo sheet thất bại')
      setCreating(false)
    }
  }

  return (
    <div className="sl-modal-overlay" onClick={onClose}>
      <div className="sl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sl-modal-header">
          <h3>Tạo Google Sheet</h3>
          <button className="sl-modal-close" onClick={onClose}>×</button>
        </div>

        <div className="sl-modal-body">
          <div className="sl-modal-label">
            <span>Lưu vào folder</span>
            <div className="sl-folder-picker">
              <button
                type="button"
                className="sl-folder-picker-btn"
                onClick={openPicker}
                disabled={loadingPicker || creating}
              >
                {loadingPicker ? 'Đang mở…' : '📁 Chọn folder trên Drive'}
              </button>
              {folderName && (
                <span className="sl-folder-selected">{folderName}</span>
              )}
              {!folderName && (
                <span className="sl-folder-none">My Drive (root)</span>
              )}
            </div>
          </div>

          <label className="sl-modal-label">
            Tên tắt dự án
            <input
              className="sl-input sl-modal-input"
              value={abbrev}
              onChange={(e) => setAbbrev(e.target.value.toUpperCase())}
              placeholder="BODND"
              maxLength={10}
            />
          </label>

          <fieldset className="sl-modal-fieldset">
            <legend>Phiên bản</legend>
            <label className="sl-modal-radio">
              <input type="radio" value="draft" checked={versionType === 'draft'} onChange={() => setVersionType('draft')} />
              Draft
            </label>
            <label className="sl-modal-radio">
              <input type="radio" value="final" checked={versionType === 'final'} onChange={() => setVersionType('final')} />
              Final
            </label>
            {versionType === 'draft' && (
              <label className="sl-modal-label sl-modal-label-inline">
                Số
                <input
                  className="sl-input sl-modal-input-sm"
                  value={versionNum}
                  onChange={(e) => setVersionNum(e.target.value)}
                  placeholder="01"
                  maxLength={2}
                />
              </label>
            )}
          </fieldset>

          <div className="sl-modal-preview">
            <span className="sl-modal-preview-label">Tên file:</span>
            <code>{previewName}</code>
          </div>

          {error && <div className="sl-modal-error">{error}</div>}
        </div>

        <div className="sl-modal-footer">
          <button className="sl-action-btn" onClick={onClose} disabled={creating}>Hủy</button>
          <button className="sl-action-btn sl-btn-primary" onClick={handleCreate} disabled={creating}>
            {creating ? 'Đang tạo…' : 'Tạo Sheet'}
          </button>
        </div>
      </div>
    </div>
  )
}
