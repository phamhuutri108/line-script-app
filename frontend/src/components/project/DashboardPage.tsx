import { useState, useEffect, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { projectsApi, type Project } from '../../api/projects'
import { ApiError } from '../../api/client'
import { useAuthStore } from '../../stores/authStore'
import '../layout/layout.css'
import './project.css'

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function DashboardPage() {
  const { token, user } = useAuthStore()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)

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

  const canCreateProject = user?.role === 'super_admin' || user?.role === 'owner'

  return (
    <>
      <div className="page-header">
        <h2>Projects</h2>
        {canCreateProject && (
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New project
          </button>
        )}
      </div>

      <div className="page-body">
        {error && <div className="error-msg">{error}</div>}

        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : projects.length === 0 ? (
          <div className="empty-state">
            <p>No projects yet.</p>
            {canCreateProject && (
              <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                Create your first project
              </button>
            )}
          </div>
        ) : (
          <div className="projects-grid">
            {projects.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`} className="project-card">
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
                  <span className="meta-item">
                    {formatDate(p.created_at)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
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
