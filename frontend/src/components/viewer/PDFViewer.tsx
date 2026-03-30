import { useState, useEffect, useRef, useCallback } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { Link } from 'react-router-dom'
import ScriptCanvas from './ScriptCanvas'
import LineToolbar, { type LineToolState } from './LineToolbar'

// Use CDN worker to avoid bundler complexity
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`

interface Props {
  pdfData: ArrayBuffer
  scriptId: string
  scriptName: string
  projectId: string
}

const ZOOM_STEP = 0.25
const ZOOM_MIN = 0.5
const ZOOM_MAX = 3

export default function PDFViewer({ pdfData, scriptId, scriptName, projectId }: Props) {
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null)
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null)

  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageInputVal, setPageInputVal] = useState('1')
  const [zoom, setZoom] = useState(1)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [rendering, setRendering] = useState(false)
  const [toolState, setToolState] = useState<LineToolState>({
    mode: 'select',
    lineType: 'solid',
    color: '#e05c5c',
  })

  // Load PDF document once
  useEffect(() => {
    const loadingTask = pdfjsLib.getDocument({ data: pdfData })
    loadingTask.promise.then((doc) => {
      pdfDocRef.current = doc
      setNumPages(doc.numPages)
      renderPage(1, zoom, doc)
    })
    return () => { loadingTask.destroy() }
  }, [pdfData])

  // Re-render when page or zoom changes
  useEffect(() => {
    if (pdfDocRef.current) {
      renderPage(currentPage, zoom, pdfDocRef.current)
    }
  }, [currentPage, zoom])

  const renderPage = useCallback(async (
    pageNum: number,
    scale: number,
    doc: pdfjsLib.PDFDocumentProxy,
  ) => {
    if (!pdfCanvasRef.current) return

    // Cancel any ongoing render
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel()
    }

    setRendering(true)
    try {
      const page = await doc.getPage(pageNum)
      const viewport = page.getViewport({ scale })

      const canvas = pdfCanvasRef.current
      const ctx = canvas.getContext('2d')!

      canvas.width = viewport.width
      canvas.height = viewport.height
      setCanvasSize({ width: viewport.width, height: viewport.height })

      const renderTask = page.render({ canvasContext: ctx, viewport })
      renderTaskRef.current = renderTask
      await renderTask.promise
    } catch (err: unknown) {
      if ((err as Error).message !== 'Rendering cancelled') {
        console.error('PDF render error', err)
      }
    } finally {
      setRendering(false)
    }
  }, [])

  function goToPage(p: number) {
    const clamped = Math.max(1, Math.min(numPages, p))
    setCurrentPage(clamped)
    setPageInputVal(String(clamped))
  }

  function handlePageInput(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      const p = parseInt(pageInputVal, 10)
      if (!isNaN(p)) goToPage(p)
    }
  }

  function zoomIn() { setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 4) / 4)) }
  function zoomOut() { setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 4) / 4)) }
  function fitWidth() {
    if (!pdfCanvasRef.current?.parentElement) return
    const containerWidth = pdfCanvasRef.current.parentElement.clientWidth - 48
    if (pdfDocRef.current) {
      pdfDocRef.current.getPage(currentPage).then((page) => {
        const vp = page.getViewport({ scale: 1 })
        setZoom(Math.min(ZOOM_MAX, containerWidth / vp.width))
      })
    }
  }

  return (
    <div className="viewer-shell">
      {/* Top bar */}
      <div className="viewer-topbar">
        <div className="viewer-topbar-left">
          <Link
            to={`/projects/${projectId}`}
            className="btn-icon"
            title="Back to project"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </Link>
          <span className="viewer-script-name">{scriptName}</span>
        </div>

        <div className="viewer-topbar-center">
          {/* Page navigation */}
          <div className="page-nav">
            <button className="btn-icon" onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <input
              className="page-input"
              type="number"
              min={1}
              max={numPages}
              value={pageInputVal}
              onChange={(e) => setPageInputVal(e.target.value)}
              onKeyDown={handlePageInput}
              onBlur={() => { const p = parseInt(pageInputVal, 10); if (!isNaN(p)) goToPage(p) }}
            />
            <span className="page-indicator">/ {numPages}</span>
            <button className="btn-icon" onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= numPages}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </div>

        <div className="viewer-topbar-right">
          {/* Zoom controls */}
          <div className="zoom-controls">
            <button className="btn-icon" onClick={zoomOut} disabled={zoom <= ZOOM_MIN} title="Zoom out">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            </button>
            <span className="zoom-value">{Math.round(zoom * 100)}%</span>
            <button className="btn-icon" onClick={zoomIn} disabled={zoom >= ZOOM_MAX} title="Zoom in">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            </button>
            <button className="btn-icon" onClick={fitWidth} title="Fit to width">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="viewer-body">
        {/* Drawing toolbar */}
        <LineToolbar state={toolState} onChange={setToolState} />

        {/* Canvas area */}
        <div className="canvas-area">
          {rendering && canvasSize.width === 0 && (
            <div className="viewer-loading">
              <div className="spinner" />
              Rendering page…
            </div>
          )}

          <div className="canvas-wrapper" style={{ width: canvasSize.width, height: canvasSize.height }}>
            <canvas ref={pdfCanvasRef} className="pdf-canvas" />

            {canvasSize.width > 0 && (
              <ScriptCanvas
                width={canvasSize.width}
                height={canvasSize.height}
                scriptId={scriptId}
                pageNumber={currentPage}
                toolState={toolState}
              />
            )}
          </div>
        </div>

        {/* Shotlist panel placeholder */}
        <div className="shotlist-panel">
          <div className="shotlist-panel-header">
            <span>Shotlist</span>
          </div>
          <div style={{ padding: '1rem', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
            Shotlist panel — coming in Step 9
          </div>
        </div>
      </div>
    </div>
  )
}
