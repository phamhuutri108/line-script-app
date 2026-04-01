import { useState, useEffect, useRef, useCallback } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { Link } from 'react-router-dom'
import ScriptCanvas, { type LineCreatedInfo, type Segment, type ScriptCanvasHandle } from './ScriptCanvas'
import LineToolbar, { type LineToolState } from './LineToolbar'
import ShotlistPanel from './ShotlistPanel'
import { shotsApi, type Shot } from '../../api/shots'
import { useAuthStore } from '../../stores/authStore'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

interface Props {
  pdfData: ArrayBuffer
  scriptId: string
  scriptName: string
  projectId: string
  initialLineId?: string
  initialPage?: number
}

const ZOOM_STEP = 0.25
const ZOOM_MIN = 0.5
const ZOOM_MAX = 3

export default function PDFViewer({ pdfData, scriptId, scriptName, projectId, initialLineId, initialPage }: Props) {
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null)
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null)
  const scriptCanvasRef = useRef<ScriptCanvasHandle>(null)
  const { token } = useAuthStore()

  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageInputVal, setPageInputVal] = useState('1')
  const [zoom, setZoom] = useState(1)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [rendering, setRendering] = useState(false)
  const [toolState, setToolState] = useState<LineToolState>({
    mode: 'select',
    initialSegType: 'straight',
    color: '#e05c5c',
  })
  const [shotRefresh, setShotRefresh] = useState(0)
  const [shots, setShots] = useState<Shot[]>([])
  const [highlightLineId, setHighlightLineId] = useState<string | null>(null)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [shotLabelMap, setShotLabelMap] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!token) return
    shotsApi.list(token, scriptId).then((data) => setShots(data.shots)).catch(() => {})
  }, [shotRefresh, scriptId, token])

  useEffect(() => {
    const loadingTask = pdfjsLib.getDocument({ data: pdfData })
    loadingTask.promise.then((doc) => {
      pdfDocRef.current = doc
      setNumPages(doc.numPages)
      const startPage = initialPage ?? 1
      setCurrentPage(startPage)
      setPageInputVal(String(startPage))
      renderPage(startPage, zoom, doc)
      if (initialLineId) setHighlightLineId(initialLineId)
    }).catch((err) => {
      console.error('PDF load error:', err)
    })
    return () => { loadingTask.destroy() }
  }, [pdfData])

  useEffect(() => {
    if (pdfDocRef.current) renderPage(currentPage, zoom, pdfDocRef.current)
  }, [currentPage, zoom])

  const renderPage = useCallback(async (
    pageNum: number, scale: number, doc: pdfjsLib.PDFDocumentProxy,
  ) => {
    if (!pdfCanvasRef.current) return
    if (renderTaskRef.current) renderTaskRef.current.cancel()
    setRendering(true)
    try {
      const page = await doc.getPage(pageNum)
      const viewport = page.getViewport({ scale })
      const canvas = pdfCanvasRef.current
      const ctx = canvas.getContext('2d')!
      canvas.width = viewport.width
      canvas.height = viewport.height
      setCanvasSize({ width: viewport.width, height: viewport.height })
      const task = page.render({ canvasContext: ctx, viewport })
      renderTaskRef.current = task
      await task.promise
    } catch (err: unknown) {
      if ((err as Error).message !== 'Rendering cancelled') console.error(err)
    } finally {
      setRendering(false)
    }
  }, [])

  // Extract text in y-range from current page, build shot data
  const extractTextForLine = useCallback(async (info: LineCreatedInfo) => {
    const doc = pdfDocRef.current
    if (!doc || !token) return

    try {
      const page = await doc.getPage(currentPage)
      const textContent = await page.getTextContent()
      const viewport = page.getViewport({ scale: 1 })

      type TextItem = { str: string; transform: number[] }
      const items = (textContent.items as TextItem[]).filter(
        (item) => item.transform && item.str.trim()
      )

      // Only include text in STRAIGHT segments — zigzag = off-screen, no description
      const straightRanges: Segment[] = info.segments.filter((s) => s.type === 'straight')

      // Normalize y coords (PDF y is bottom-up, flip to top-down)
      const inRange = items.filter((item) => {
        const yNorm = 1 - item.transform[5] / viewport.height
        return straightRanges.some((seg) => yNorm >= seg.y_start && yNorm <= seg.y_end)
      })

      // Detect scene header: starts with INT. / EXT. / INT/EXT
      const sceneHeader = inRange.find((item) =>
        /^(INT\.|EXT\.|INT\/EXT)/i.test(item.str.trim())
      )

      let sceneNumber: string | undefined
      let location: string | undefined
      let intExt: string | undefined
      let dayNight: string | undefined

      if (sceneHeader) {
        // Format: "INT. LOCATION - DAY" or "EXT. LOCATION - NIGHT"
        const match = sceneHeader.str.match(/^(INT\.|EXT\.|INT\/EXT\.?)\s+(.+?)\s*[-–]\s*(DAY|NIGHT|DAWN|DUSK)/i)
        if (match) {
          intExt = match[1].replace('.', '').toUpperCase()
          location = match[2].trim()
          dayNight = match[3].toUpperCase()
        }
        // Try to find scene number before the header (e.g. "1." or "A1")
        const prevItems = items.filter((item) => {
          const yNorm = 1 - item.transform[5] / viewport.height
          return yNorm >= info.yStart - 0.02 && yNorm < info.yStart + 0.02
        })
        const sceneNumItem = prevItems.find((item) => /^\d+[A-Z]?\.?$/.test(item.str.trim()))
        if (sceneNumItem) sceneNumber = sceneNumItem.str.trim().replace('.', '')
      }

      // Dialogue: text in center column (x between 25%-75% of page)
      const dialogue = inRange
        .filter((item) => {
          const xNorm = item.transform[4] / viewport.width
          return xNorm > 0.25 && xNorm < 0.75
        })
        .map((item) => item.str)
        .join(' ')
        .trim()

      // Description: action lines (left aligned, not scene header)
      const description = inRange
        .filter((item) => {
          const xNorm = item.transform[4] / viewport.width
          return xNorm < 0.25 && item !== sceneHeader
        })
        .map((item) => item.str)
        .join(' ')
        .trim()

      await shotsApi.create(token, {
        scriptId,
        lineId: info.lineId,
        sceneNumber,
        location,
        intExt,
        dayNight,
        description: description || undefined,
        dialogue: dialogue || undefined,
        pageNumber: currentPage,
      })

      setShotRefresh((n) => n + 1)
    } catch {
      // Text extraction failed — shot still created with empty fields
      try {
        await shotsApi.create(token, { scriptId, lineId: info.lineId, pageNumber: currentPage })
        setShotRefresh((n) => n + 1)
      } catch { /* ignore */ }
    }
  }, [currentPage, scriptId, token])

  // Extract scene header text (INT./EXT.) near a given normalized y-position
  const extractSceneNameAt = useCallback(async (yNorm: number): Promise<string> => {
    const doc = pdfDocRef.current
    if (!doc) return ''
    try {
      const page = await doc.getPage(currentPage)
      const textContent = await page.getTextContent()
      const viewport = page.getViewport({ scale: 1 })
      type TextItem = { str: string; transform: number[] }
      const items = (textContent.items as TextItem[]).filter((item) => item.transform && item.str.trim())
      // Find INT./EXT. line within ±5% of yNorm
      const match = items.find((item) => {
        const yItem = 1 - item.transform[5] / viewport.height
        return Math.abs(yItem - yNorm) < 0.05 && /^(INT\.|EXT\.|INT\/EXT)/i.test(item.str.trim())
      })
      return match?.str.trim() ?? ''
    } catch {
      return ''
    }
  }, [currentPage])

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
    const container = pdfCanvasRef.current?.parentElement
    if (!container || !pdfDocRef.current) return
    pdfDocRef.current.getPage(currentPage).then((page) => {
      const vp = page.getViewport({ scale: 1 })
      setZoom(Math.min(ZOOM_MAX, (container.clientWidth - 48) / vp.width))
    })
  }

  function handleJumpToLine(lineId: string, pageNum: number) {
    if (pageNum && pageNum !== currentPage) goToPage(pageNum)
    setHighlightLineId(lineId)
  }

  function handleShotClick(shot: Shot) {
    setHighlightLineId(shot.line_id)
  }

  function handleShotUpdated(shot: Shot) {
    setShots((prev) => prev.map((s) => s.id === shot.id ? shot : s))
  }

  return (
    <div className="viewer-shell">
      {/* Top bar */}
      <div className="viewer-topbar">
        <div className="viewer-topbar-left">
          <Link to={`/projects/${projectId}`} className="btn-icon" title="Back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </Link>
          <span className="viewer-script-name">{scriptName}</span>
        </div>

        <div className="viewer-topbar-center">
          <div className="page-nav">
            <button className="btn-icon" onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <input
              className="page-input" type="number" min={1} max={numPages}
              value={pageInputVal}
              onChange={(e) => setPageInputVal(e.target.value)}
              onKeyDown={handlePageInput}
              onBlur={() => { const p = parseInt(pageInputVal, 10); if (!isNaN(p)) goToPage(p) }}
            />
            <span className="page-indicator">/ {numPages}</span>
            <button className="btn-icon" onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= numPages}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          </div>
        </div>

        <div className="viewer-topbar-right">
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
        <LineToolbar
          state={toolState}
          onChange={setToolState}
          onUndo={() => scriptCanvasRef.current?.undo()}
          onRedo={() => scriptCanvasRef.current?.redo()}
          canUndo={canUndo}
          canRedo={canRedo}
        />

        <div className="canvas-area">
          {rendering && canvasSize.width === 0 && (
            <div className="viewer-loading"><div className="spinner" />Rendering page…</div>
          )}
          <div className="canvas-wrapper" style={{ width: canvasSize.width, height: canvasSize.height }}>
            <canvas ref={pdfCanvasRef} className="pdf-canvas" />
            {canvasSize.width > 0 && (
              <ScriptCanvas
                ref={scriptCanvasRef}
                width={canvasSize.width}
                height={canvasSize.height}
                scriptId={scriptId}
                pageNumber={currentPage}
                toolState={toolState}
                shots={shots}
                onLineCreated={extractTextForLine}
                onLineDeleted={() => setShotRefresh((n) => n + 1)}
                onSceneMarkersChanged={() => {}}
                onExtractSceneName={extractSceneNameAt}
                onUndoStateChange={(u, r) => { setCanUndo(u); setCanRedo(r) }}
                onShotUpdated={handleShotUpdated}
                onLabelsChanged={setShotLabelMap}
                highlightLineId={highlightLineId}
              />
            )}
          </div>
        </div>

        <ShotlistPanel
          scriptId={scriptId}
          projectId={projectId}
          highlightLineId={highlightLineId}
          shotLabelMap={shotLabelMap}
          onShotClick={handleShotClick}
          onJumpToLine={handleJumpToLine}
          onShotUpdated={handleShotUpdated}
          refreshTrigger={shotRefresh}
        />
      </div>
    </div>
  )
}
