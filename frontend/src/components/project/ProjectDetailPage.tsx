import { useState, useEffect, useRef, type FormEvent, type DragEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { projectsApi, scriptsApi, type Project, type ProjectMember, type Script } from '../../api/projects'
import { ApiError } from '../../api/client'
import { useAuthStore } from '../../stores/authStore'
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showUpload, setShowUpload] = useState(false)

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
    if (!confirm('Delete this script? This cannot be undone.')) return
    try {
      await scriptsApi.delete(token!, scriptId)
      setScripts((prev) => prev.filter((s) => s.id !== scriptId))
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to delete script')
    }
  }

  async function handleRemoveMember(memberId: string) {
    if (!confirm('Remove this member from the project?')) return
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
        <button className="btn btn-primary" onClick={() => setShowUpload(true)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Upload script
        </button>
      </div>

      <div className="page-body">
        <div className="project-detail-grid">
          {/* Scripts */}
          <div>
            <div className="section-card">
              <div className="section-card-header">
                <h3>Scripts ({scripts.length})</h3>
              </div>
              <div className="script-list">
                {scripts.length === 0 ? (
                  <div className="empty-state">
                    <p>No scripts yet. Upload a PDF to get started.</p>
                    <button className="btn btn-primary btn-sm" onClick={() => setShowUpload(true)}>
                      Upload script
                    </button>
                  </div>
                ) : (
                  scripts.map((s) => (
                    <div key={s.id} className="script-item">
                      <div className="script-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                      </div>
                      <div className="script-info">
                        <div className="script-name">{s.name}</div>
                        <div className="script-meta">
                          {s.page_count ? `${s.page_count} pages · ` : ''}
                          {formatDate(s.created_at)}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                        <Link
                          to={`/projects/${id}/scripts/${s.id}`}
                          className="btn btn-secondary btn-sm"
                        >
                          Open
                        </Link>
                        {canManage && (
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDeleteScript(s.id)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Members */}
          <div>
            <div className="section-card">
              <div className="section-card-header">
                <h3>Members ({members.length})</h3>
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
