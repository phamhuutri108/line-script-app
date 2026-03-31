import { useState, useEffect, useRef, type FormEvent, type DragEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { projectsApi, scriptsApi, inviteApi, type Project, type ProjectMember, type Script } from '../../api/projects'
import { ApiError } from '../../api/client'
import { useAuthStore } from '../../stores/authStore'
import { showConfirm } from '../shared/ConfirmDialog'
import '../layout/layout.css'
import './project.css'

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function getInitials(name: string) {
  return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { token, user } = useAuthStore()

  const [project, setProject] = useState<Project | null>(null)
  const [members, setMembers] = useState<ProjectMember[]>([])
  const [scripts, setScripts] = useState<Script[]>([])
  const [trash, setTrash] = useState<Script[]>([])
  const [showTrash, setShowTrash] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showUpload, setShowUpload] = useState(false)
  const [showInvite, setShowInvite] = useState(false)

  useEffect(() => {
    loadProject()
  }, [id])

  async function loadProject() {
    try {
      const data = await projectsApi.get(token!, id!)
      setProject(data.project)
      setMembers(data.members)
      setScripts(data.scripts)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load project')
    } finally {
      setLoading(false)
    }
  }

  const isOwner = project?.owner_id === user?.id
  const isSuperAdmin = user?.role === 'super_admin'
  const canManage = isOwner || isSuperAdmin

  async function handleDeleteScript(scriptId: string) {
    const ok = await showConfirm({
      title: 'Chuyển vào Trash',
      message: 'Script sẽ được chuyển vào Trash. Bạn có thể khôi phục lại trong vòng 30 ngày.',
      confirmLabel: 'Chuyển vào Trash',
    })
    if (!ok) return
    try {
      await scriptsApi.delete(token!, scriptId)
      setScripts((prev) => prev.filter((s) => s.id !== scriptId))
      if (showTrash) loadTrash()
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to delete script')
    }
  }

  async function loadTrash() {
    try {
      const data = await scriptsApi.trash(token!, id!)
      setTrash(data.scripts)
    } catch { /* ignore */ }
  }

  function toggleTrash() {
    if (!showTrash) loadTrash()
    setShowTrash((v) => !v)
  }

  async function handleRestoreScript(scriptId: string) {
    try {
      await scriptsApi.restore(token!, scriptId)
      setTrash((prev) => prev.filter((s) => s.id !== scriptId))
      loadProject()
    } catch { /* ignore */ }
  }

  async function handlePermanentDeleteScript(scriptId: string) {
    const ok = await showConfirm({
      title: 'Xóa vĩnh viễn',
      message: 'Script này sẽ bị xóa hoàn toàn và không thể khôi phục.',
      confirmLabel: 'Xóa vĩnh viễn',
    })
    if (!ok) return
    try {
      await scriptsApi.permanentDelete(token!, scriptId)
      setTrash((prev) => prev.filter((s) => s.id !== scriptId))
    } catch { /* ignore */ }
  }

  async function handleRemoveMember(memberId: string) {
    const ok = await showConfirm({
      title: 'Xóa thành viên',
      message: 'Thành viên này sẽ bị xóa khỏi project.',
      confirmLabel: 'Xóa',
    })
    if (!ok) return
    try {
      await projectsApi.removeMember(token!, id!, memberId)
      setMembers((prev) => prev.filter((m) => m.id !== memberId))
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to remove member')
    }
  }

  if (loading) return (
    <div className="page-body">
      <div className="loading-center"><div className="spinner" /></div>
    </div>
  )

  if (error) return (
    <div className="page-body">
      <div className="error-msg">{error}</div>
    </div>
  )

  return (
    <>
      <div className="page-header">
        <div>
          <Link to="/dashboard" className="back-link" style={{ marginBottom: 0 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Projects
          </Link>
          <h2 style={{ marginTop: '0.25rem' }}>{project?.name}</h2>
        </div>
      </div>

      <div className="page-body">
        <div className="project-detail-grid">
          {/* Scripts */}
          <div>
            <div className="section-card">
              <div className="section-card-header">
                <h3>Scripts ({scripts.length})</h3>
              </div>
              <div className="scripts-grid">
                {scripts.map((s) => (
                  <div key={s.id} className="script-card-wrap">
                    <div className="script-card">
                      <div className="script-card-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                      </div>
                      <div className="script-card-name">{s.name}</div>
                      <div className="script-card-meta">
                        {s.page_count ? `${s.page_count} trang · ` : ''}{formatDate(s.created_at)}
                      </div>
                      <div className="script-card-actions">
                        <Link to={`/projects/${id}/scripts/${s.id}/viewer`} className="btn btn-secondary btn-sm">Script Lining</Link>
                        <Link to={`/projects/${id}/scripts/${s.id}/shotlist`} className="btn btn-secondary btn-sm">Shotlist</Link>
                      </div>
                    </div>
                    {canManage && (
                      <button className="script-card-delete" onClick={() => handleDeleteScript(s.id)} title="Chuyển vào Trash">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14H6L5 6" />
                          <path d="M10 11v6M14 11v6" />
                          <path d="M9 6V4h6v2" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
                <button className="script-card-add" onClick={() => setShowUpload(true)}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <span>Upload script</span>
                </button>
              </div>

              {/* Trash toggle */}
              {canManage && (
                <div style={{ borderTop: '1px solid var(--color-border)', marginTop: '0.75rem' }}>
                  <button
                    onClick={toggleTrash}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.4rem',
                      background: 'none', border: 'none', color: 'var(--color-text-muted)',
                      fontSize: '0.8rem', cursor: 'pointer', padding: '0.6rem 0.75rem',
                      width: '100%', textAlign: 'left',
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14H6L5 6" />
                      <path d="M10 11v6M14 11v6" />
                      <path d="M9 6V4h6v2" />
                    </svg>
                    Trash {trash.length > 0 && `(${trash.length})`}
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
                      style={{ marginLeft: 'auto', transform: showTrash ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }}>
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>

                  {showTrash && (
                    <div style={{ padding: '0 0.75rem 0.75rem' }}>
                      {trash.length === 0 ? (
                        <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', padding: '0.5rem 0' }}>
                          Trash trống
                        </div>
                      ) : (
                        trash.map((s) => {
                          const daysLeft = Math.max(0, 30 - Math.floor((Date.now() / 1000 - (s.deleted_at ?? 0)) / 86400))
                          return (
                            <div key={s.id} style={{
                              display: 'flex', alignItems: 'center', gap: '0.5rem',
                              padding: '0.45rem 0', borderBottom: '1px solid var(--color-border)',
                            }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: '0.82rem', color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {s.name}
                                </div>
                                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                                  Tự xóa sau {daysLeft} ngày
                                </div>
                              </div>
                              <button className="btn btn-secondary btn-sm" onClick={() => handleRestoreScript(s.id)}>
                                Khôi phục
                              </button>
                              <button className="btn btn-danger btn-sm" onClick={() => handlePermanentDeleteScript(s.id)}>
                                Xóa
                              </button>
                            </div>
                          )
                        })
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Members */}
          <div>
            <div className="section-card">
              <div className="section-card-header">
                <h3>Members ({members.length})</h3>
                {canManage && (
                  <button className="btn btn-secondary btn-sm" onClick={() => setShowInvite(true)}>
                    + Mời
                  </button>
                )}
              </div>
              <div className="member-list">
                {members.map((m) => (
                  <div key={m.id} className="member-item">
                    <div className="member-avatar">{getInitials(m.name)}</div>
                    <div className="member-info">
                      <div className="member-name">{m.name}</div>
                      <div className="member-email">{m.email}</div>
                    </div>
                    <span className={`role-badge ${m.role}`}>
                      {m.role.replace('_', ' ')}
                    </span>
                    {canManage && m.id !== project?.owner_id && m.id !== user?.id && (
                      <button
                        className="btn btn-danger btn-sm"
                        style={{ marginLeft: '0.5rem' }}
                        onClick={() => handleRemoveMember(m.id)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showUpload && (
        <UploadScriptModal
          projectId={id!}
          onClose={() => setShowUpload(false)}
          onUploaded={(s) => { setScripts((prev) => [s, ...prev]); setShowUpload(false) }}
        />
      )}
      {showInvite && (
        <InviteModal
          projectId={id!}
          onClose={() => setShowInvite(false)}
        />
      )}
    </>
  )
}

function UploadScriptModal({
  projectId,
  onClose,
  onUploaded,
}: {
  projectId: string
  onClose: () => void
  onUploaded: (s: Script) => void
}) {
  const { token } = useAuthStore()
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFile(f: File) {
    if (f.type !== 'application/pdf') { setError('Only PDF files are accepted.'); return }
    if (f.size > 50 * 1024 * 1024) { setError('File size exceeds 50MB.'); return }
    setFile(f)
    setError('')
    if (!name) setName(f.name.replace(/\.pdf$/i, ''))
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!file || !name.trim()) return
    setUploading(true)
    setError('')

    // Fake progress animation while uploading
    const timer = setInterval(() => setProgress((p) => Math.min(p + 8, 90)), 300)
    try {
      const data = await scriptsApi.upload(token!, projectId, name.trim(), file)
      clearInterval(timer)
      setProgress(100)
      setTimeout(() => onUploaded(data.script), 300)
    } catch (err) {
      clearInterval(timer)
      setProgress(0)
      setError(err instanceof Error ? err.message : 'Upload failed')
      setUploading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && !uploading && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3>Upload script</h3>
          {!uploading && <button className="btn-close" onClick={onClose}>×</button>}
        </div>
        <form className="modal-form" onSubmit={handleSubmit}>
          {error && <div className="error-msg">{error}</div>}

          {/* Drop zone */}
          <div
            className={`drop-zone${dragging ? ' drag-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth={1.5} style={{ margin: '0 auto' }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            {file ? (
              <p><span>{file.name}</span> ({(file.size / 1024 / 1024).toFixed(1)} MB)</p>
            ) : (
              <p><span>Click to browse</span> or drag a PDF here</p>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            />
          </div>

          <div className="form-group">
            <label htmlFor="script-name">Script name</label>
            <input
              id="script-name"
              type="text"
              placeholder="e.g. Final Draft v3"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          {uploading && (
            <div className="upload-progress">
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={uploading}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={uploading || !file || !name.trim()}>
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function InviteModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { token } = useAuthStore()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ link: string; expiresAt: number } | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const BASE = window.location.origin

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await inviteApi.create(token!, projectId, email.trim() || undefined)
      setResult({ link: `${BASE}/invite/${data.token}`, expiresAt: data.expiresAt })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Lỗi tạo link mời')
    } finally {
      setLoading(false)
    }
  }

  async function handleCopy() {
    if (!result) return
    await navigator.clipboard.writeText(result.link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3>Mời thành viên</h3>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>

        {result ? (
          <div style={{ padding: '0 0 0.5rem' }}>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
              Link mời (hết hạn sau 7 ngày — dùng 1 lần):
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'stretch' }}>
              <input
                readOnly
                value={result.link}
                style={{
                  flex: 1, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
                  borderRadius: '8px', padding: '0.5rem 0.75rem', fontSize: '0.8rem',
                  color: 'var(--color-text)', outline: 'none',
                }}
                onFocus={(e) => e.target.select()}
              />
              <button className="btn btn-primary btn-sm" onClick={handleCopy} style={{ whiteSpace: 'nowrap' }}>
                {copied ? '✓ Đã copy' : 'Copy'}
              </button>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.75rem' }}>
              Gửi link này cho thành viên qua email hoặc tin nhắn. Họ click vào và tạo tài khoản là xong, không cần duyệt.
            </p>
            <div className="modal-actions" style={{ marginTop: '1rem' }}>
              <button className="btn btn-secondary" onClick={() => { setResult(null); setEmail('') }}>
                Tạo link mới
              </button>
              <button className="btn btn-primary" onClick={onClose}>Xong</button>
            </div>
          </div>
        ) : (
          <form className="modal-form" onSubmit={handleSubmit}>
            {error && <div className="error-msg">{error}</div>}
            <div className="form-group">
              <label htmlFor="invite-email">Email (tùy chọn)</label>
              <input
                id="invite-email"
                type="email"
                placeholder="member@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
              <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.35rem' }}>
                Để trống để tạo link dùng chung. Nhập email để link chỉ dùng được cho người đó.
              </p>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Huỷ</button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Đang tạo…' : 'Tạo link mời'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
