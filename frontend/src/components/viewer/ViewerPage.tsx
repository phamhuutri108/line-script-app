import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { scriptsApi, type Script } from '../../api/projects'
import { ApiError } from '../../api/client'
import PDFViewer from './PDFViewer'
import './viewer.css'

export default function ViewerPage() {
  const { id: projectId, scriptId } = useParams<{ id: string; scriptId: string }>()
  const { token } = useAuthStore()

  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null)
  const [script, setScript] = useState<Script | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadPdf()
  }, [scriptId])

  async function loadPdf() {
    setLoading(true)
    setError('')
    try {
      // Fetch script metadata
      const scripts = await scriptsApi.list(token!, projectId!)
      const found = scripts.scripts.find((s) => s.id === scriptId)
      if (found) setScript(found)

      // Fetch PDF as ArrayBuffer (needs auth header)
      const BASE_URL = import.meta.env.VITE_API_URL
      const res = await fetch(`${BASE_URL}/scripts/${scriptId}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to load PDF')
      const buffer = await res.arrayBuffer()
      setPdfData(buffer)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load script')
    } finally {
      setLoading(false)
    }
  }

  if (loading) return (
    <div className="viewer-shell">
      <div className="viewer-loading">
        <div className="spinner" />
        Loading script…
      </div>
    </div>
  )

  if (error) return (
    <div className="viewer-shell">
      <div className="viewer-loading">
        <p style={{ color: 'var(--color-danger)' }}>{error}</p>
        <Link to={`/projects/${projectId}`} className="btn btn-secondary btn-sm">
          ← Back to project
        </Link>
      </div>
    </div>
  )

  return (
    <PDFViewer
      pdfData={pdfData!}
      scriptId={scriptId!}
      scriptName={script?.name ?? 'Script'}
      projectId={projectId!}
    />
  )
}
