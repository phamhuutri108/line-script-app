import { useState, useEffect, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { projectsApi, type Project } from '../../api/projects'
import { ApiError } from '../../api/client'
import { useAuthStore } from '../../stores/authStore'
import { showConfirm } from '../shared/ConfirmDialog'
import '../layout/layout.css'
import './project.css'

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function daysUntilPurge(deletedAt: number) {
  const daysLeft = 30 - Math.floor((Date.now() / 1000 - deletedAt) / 86400)
  return Math.max(0, daysLeft)
}

export default function DashboardPage() {
  const { token, user } = useAuthStore()
  const [projects, setProjects] = useState<Project[]>([])
  const [trash, setTrash] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [showTrash, setShowTrash] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    loadProjects()
  }, [])

  async function loadProjects() {
    try {
      const data = await projectsApi.list(token!)
      setProjects(data.projects)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load projects')
    } finally {
      setLoading(false)
    }
  }

  async function loadTrash() {
    try {
      const data = await projectsApi.trash(token!)
      setTrash(data.projects)
    } catch { /* ignore */ }
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.preventDefault()
    e.stopPropagation()
    const ok = await showConfirm({
      title: 'Chuyển vào Trash',
      message: 'Project này sẽ được chuyển vào Trash. Bạn có thể khôi phục lại trong vòng 30 ngày.',
      confirmLabel: 'Chuyển vào Trash',
    })
    if (!ok) return
    setDeletingId(id)
    try {
      await projectsApi.delete(token!, id)
      setProjects((prev) => prev.filter((p) => p.id !== id))
      if (showTrash) loadTrash()
    } catch { /* ignore */ } finally {
      setDeletingId(null)
    }
  }

  async function handleRestore(id: string) {
    try {
      await projectsApi.restore(token!, id)
      setTrash((prev) => prev.filter((p) => p.id !== id))
      loadProjects()
    } catch { /* ignore */ }
  }

  async function handlePermanentDelete(id: string) {
    const ok = await showConfirm({
      title: 'Xóa vĩnh viễn',
      message: 'Tất cả dữ liệu của project này sẽ mất hoàn toàn và không thể khôi phục.',
      confirmLabel: 'Xóa vĩnh viễn',
    })
    if (!ok) return
    try {
      await projectsApi.permanentDelete(token!, id)
      setTrash((prev) => prev.filter((p) => p.id !== id))
    } catch { /* ignore */ }
  }

  function toggleTrash() {
    if (!showTrash) loadTrash()
    setShowTrash((v) => !v)
  }

  const canCreateProject = !!user && user.role !== 'pending'
  const canDelete = (p: Project) => user?.role === 'super_admin' || p.owner_id === user?.id

  return (
    <>
      <div className="page-header">
        <h2>Projects</h2>
      </div>

      <div className="page-body">
        {error && <div className="error-msg">{error}</div>}

        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : (
          <div className="projects-grid">
            {projects.map((p) => (
              <div key={p.id} className="project-card-wrap">
                <Link to={`/projects/${p.id}`} className="project-card">
                  <div className="project-card-name">{p.name}</div>
                  <div className="project-card-desc">{p.description ?? 'No description'}</div>
                  <div className="project-card-meta">
                    <span className="meta-item">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                      </svg>
                      {p.member_count ?? 0}
                    </span>
                    <span className="meta-item">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                      {p.script_count ?? 0} scripts
                    </span>
                    <span className="meta-item">{formatDate(p.created_at)}</span>
                  </div>
                </Link>
                {canDelete(p) && (
                  <button
                    className="project-card-delete"
                    onClick={(e) => handleDelete(e, p.id)}
                    disabled={deletingId === p.id}
                    title="Move to Trash"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14H6L5 6" />
                      <path d="M10 11v6M14 11v6" />
                      <path d="M9 6V4h6v2" />
                    </svg>
                  </button>
                )}
              </div>
            ))}

            {canCreateProject && (
              <button className="project-card-add" onClick={() => setShowCreate(true)}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span>New project</span>
              </button>
            )}
          </div>
        )}

        {/* Trash section */}
        <div className="trash-section">
          <button className="trash-toggle" onClick={toggleTrash}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14H6L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4h6v2" />
            </svg>
            Trash
            <svg
              className={`trash-chevron${showTrash ? ' open' : ''}`}
              width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {showTrash && (
            <div className="trash-list">
              {trash.length === 0 ? (
                <p className="trash-empty">Trash is empty.</p>
              ) : (
                trash.map((p) => (
                  <div key={p.id} className="trash-item">
                    <div className="trash-item-info">
                      <span className="trash-item-name">{p.name}</span>
                      <span className="trash-item-meta">
                        Xóa {formatDate(p.deleted_at!)} · tự xóa sau {daysUntilPurge(p.deleted_at!)} ngày
                      </span>
                    </div>
                    <div className="trash-item-actions">
                      <button className="btn btn-secondary btn-sm" onClick={() => handleRestore(p.id)}>Khôi phục</button>
                      <button className="btn btn-danger btn-sm" onClick={() => handlePermanentDelete(p.id)}>Xóa vĩnh viễn</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <CreateProjectModal
          onClose={() => setShowCreate(false)}
          onCreated={(p) => { setProjects((prev) => [p, ...prev]); setShowCreate(false) }}
        />
      )}
    </>
  )
}

function CreateProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Project) => void }) {
  const { token } = useAuthStore()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError('')
    try {
      const data = await projectsApi.create(token!, { name, description: description || undefined })
      onCreated(data.project)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create project')
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3>New project</h3>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>
        <form className="modal-form" onSubmit={handleSubmit}>
          {error && <div className="error-msg">{error}</div>}
          <div className="form-group">
            <label htmlFor="proj-name">Project name</label>
            <input
              id="proj-name"
              type="text"
              placeholder="e.g. The Last Scene"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label htmlFor="proj-desc">Description (optional)</label>
            <textarea
              id="proj-desc"
              placeholder="Short description of the film..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading || !name.trim()}>
              {loading ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
