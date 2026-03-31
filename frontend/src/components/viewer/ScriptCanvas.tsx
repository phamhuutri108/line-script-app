import { useEffect, useRef, useCallback, useState } from 'react'
import { Canvas, Line, Path, Group } from 'fabric'
import { useAuthStore } from '../../stores/authStore'
import { api } from '../../api/client'
import { scenesApi, type SceneMarker } from '../../api/scenes'
import type { Shot } from '../../api/shots'
import type { LineToolState } from './LineToolbar'

// ── Public types ─────────────────────────────────────────────────────────────

export interface Segment {
  type: 'straight' | 'zigzag'
  y_start: number   // normalized 0-1
  y_end: number     // normalized 0-1
}

export interface LineCreatedInfo {
  lineId: string
  xPosition: number
  yStart: number
  yEnd: number
  segments: Segment[]
}

// ── Internal types ────────────────────────────────────────────────────────────

interface LineRecord {
  id: string
  line_type: 'solid' | 'dashed'
  x_position: number
  y_start: number
  y_end: number
  color: string
  segments_json: string | null
  continues_to_next_page: number   // 0 | 1
  continues_from_prev_page: number // 0 | 1
  setup_number: string | null
}

type DrawState =
  | { phase: 'idle' }
  | {
      phase: 'preview'
      startX: number   // pixels
      startY: number   // pixels (absolute canvas)
      currentY: number // current mouse Y pixels
      completedSegs: Array<{ type: 'straight' | 'zigzag'; yEndPx: number }>
      currentSegType: 'straight' | 'zigzag'
    }

interface ContextMenuState {
  x: number
  y: number
  lineId: string | null
  markerId: string | null
  lineYNorm?: number  // y-position (normalized) of right-click on a line
}

interface ShotLabel {
  lineId: string
  x: number
  yTop: number
  color: string
  sceneNum: number
  shotNum: number
  shotSize: string
}

interface Props {
  width: number
  height: number
  scriptId: string
  pageNumber: number
  toolState: LineToolState
  shots: Shot[]
  onLineCreated?: (info: LineCreatedInfo) => void
  onLineDeleted?: (lineId: string) => void
  onSceneMarkersChanged?: () => void
  highlightLineId?: string | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STROKE_WIDTH = 4.5
const BRACKET_HALF = 12   // px, half-width of bracket marks
const ZIGZAG_AMP   = 7    // px, horizontal amplitude of zigzag
const ZIGZAG_STEP  = 12   // px, pixels per half-wave

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** Build zigzag SVG path string at absolute canvas coords. */
function zigzagPath(x: number, y1: number, y2: number): string {
  if (y1 >= y2) return `M ${x} ${y1} L ${x} ${y2}`
  let d = `M ${x} ${y1}`
  let y = y1
  let side = 1
  while (y + ZIGZAG_STEP < y2) {
    y += ZIGZAG_STEP
    d += ` L ${x + side * ZIGZAG_AMP} ${y}`
    side = -side
  }
  d += ` L ${x} ${y2}`
  return d
}

/** Parse segments_json or fall back to a single straight segment. */
function parseSegments(record: LineRecord): Segment[] {
  if (record.segments_json) {
    try { return JSON.parse(record.segments_json) as Segment[] } catch { /* fall through */ }
  }
  return [{ type: 'straight', y_start: record.y_start, y_end: record.y_end }]
}

function computeLabels(
  lines: LineRecord[], markers: SceneMarker[], shots: Shot[], w: number, h: number,
): ShotLabel[] {
  const sorted = [...markers].sort((a, b) => a.y_position - b.y_position)
  const shotLines = [...lines].sort((a, b) => a.x_position - b.x_position)
  const sceneGroups: LineRecord[][] = sorted.map(() => [])
  const noScene: LineRecord[] = []
  for (const line of shotLines) {
    let sceneIdx = -1
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].y_position <= line.y_start + 0.005) sceneIdx = i
    }
    if (sceneIdx === -1) noScene.push(line)
    else sceneGroups[sceneIdx].push(line)
  }
  const labels: ShotLabel[] = []
  noScene.forEach((line, idx) => {
    const s = shots.find((sh) => sh.line_id === line.id)
    labels.push({ lineId: line.id, x: line.x_position * w, yTop: line.y_start * h, color: line.color, sceneNum: 0, shotNum: idx + 1, shotSize: s?.shot_size ?? '' })
  })
  sceneGroups.forEach((group, sIdx) => {
    group.forEach((line, shotIdx) => {
      const s = shots.find((sh) => sh.line_id === line.id)
      labels.push({ lineId: line.id, x: line.x_position * w, yTop: line.y_start * h, color: line.color, sceneNum: sIdx + 1, shotNum: shotIdx + 1, shotSize: s?.shot_size ?? '' })
    })
  })
  return labels
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ScriptCanvas({
  width, height, scriptId, pageNumber, toolState, shots,
  onLineCreated, onLineDeleted, onSceneMarkersChanged, highlightLineId,
}: Props) {
  const canvasRef      = useRef<HTMLCanvasElement>(null)
  const fabricRef      = useRef<Canvas | null>(null)
  const drawStateRef   = useRef<DrawState>({ phase: 'idle' })
  const previewObjsRef = useRef<(Line | Path)[]>([])
  const { token } = useAuthStore()

  const [lines, setLines] = useState<LineRecord[]>([])
  const [markers, setMarkers] = useState<SceneMarker[]>([])
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  const labels = computeLabels(lines, markers, shots, width, height)

  // ── Helpers ──────────────────────────────────────────────────────────────

  function getCanvasPoint(e: PointerEvent | MouseEvent) {
    const canvas = fabricRef.current!
    const rect = canvas.upperCanvasEl.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function clearPreview(canvas: Canvas) {
    for (const obj of previewObjsRef.current) canvas.remove(obj)
    previewObjsRef.current = []
  }

  function renderPreview(canvas: Canvas, state: Extract<DrawState, { phase: 'preview' }>, color: string) {
    clearPreview(canvas)
    const { startX, startY, currentY, completedSegs, currentSegType } = state
    const objects: (Line | Path)[] = []

    // Start bracket
    objects.push(new Line([startX - BRACKET_HALF, startY, startX + BRACKET_HALF, startY], {
      stroke: color, strokeWidth: 2.5, selectable: false, evented: false, opacity: 0.65,
    }))

    // Completed segments + their transition brackets
    let lastY = startY
    for (const seg of completedSegs) {
      if (seg.type === 'zigzag') {
        objects.push(new Path(zigzagPath(startX, lastY, seg.yEndPx), {
          stroke: color, strokeWidth: STROKE_WIDTH, fill: '', selectable: false, evented: false, opacity: 0.65,
        }))
      } else {
        objects.push(new Line([startX, lastY, startX, seg.yEndPx], {
          stroke: color, strokeWidth: STROKE_WIDTH, selectable: false, evented: false, opacity: 0.65,
        }))
      }
      // Transition bracket
      objects.push(new Line([startX - BRACKET_HALF, seg.yEndPx, startX + BRACKET_HALF, seg.yEndPx], {
        stroke: color, strokeWidth: 2.5, selectable: false, evented: false, opacity: 0.65,
      }))
      lastY = seg.yEndPx
    }

    // Current (incomplete) segment
    if (Math.abs(currentY - lastY) > 2) {
      if (currentSegType === 'zigzag') {
        objects.push(new Path(zigzagPath(startX, lastY, currentY), {
          stroke: color, strokeWidth: STROKE_WIDTH, fill: '', selectable: false, evented: false, opacity: 0.65,
        }))
      } else {
        objects.push(new Line([startX, lastY, startX, currentY], {
          stroke: color, strokeWidth: STROKE_WIDTH, selectable: false, evented: false, opacity: 0.65,
        }))
      }
    }

    for (const obj of objects) canvas.add(obj)
    previewObjsRef.current = objects
    canvas.requestRenderAll()
  }

  // ── Load data ─────────────────────────────────────────────────────────────

  const loadAll = useCallback(async (canvas: Canvas) => {
    try {
      const [lineData, markerData] = await Promise.all([
        api.get<{ lines: LineRecord[] }>(`/lines?scriptId=${scriptId}&page=${pageNumber}`, token ?? undefined),
        token ? scenesApi.list(token, scriptId, pageNumber) : Promise.resolve({ markers: [] as SceneMarker[] }),
      ])
      canvas.getObjects().forEach((o) => canvas.remove(o))
      lineData.lines.forEach((l) => addLineGroupToCanvas(canvas, l, width, height))
      markerData.markers.forEach((m) => addSceneMarkerToCanvas(canvas, m, width, height))
      canvas.requestRenderAll()
      setLines(lineData.lines)
      setMarkers(markerData.markers)
    } catch { /* silently ignore */ }
  }, [scriptId, pageNumber, token, width, height])

  // ── Init canvas ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!canvasRef.current) return
    const canvas = new Canvas(canvasRef.current, {
      width, height, selection: toolState.mode === 'select', renderOnAddRemove: true,
    })
    fabricRef.current = canvas
    loadAll(canvas)
    return () => { canvas.dispose(); fabricRef.current = null }
  }, [width, height, scriptId, pageNumber])

  // ── Sync select/draw mode ─────────────────────────────────────────────────

  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return
    const isSelect = toolState.mode === 'select'
    canvas.selection = isSelect
    canvas.getObjects().forEach((obj) => {
      obj.selectable = isSelect && !!(obj as unknown as { data?: { type?: string } }).data?.type
      obj.evented = isSelect && !!(obj as unknown as { data?: { type?: string } }).data?.type
    })
    canvas.requestRenderAll()
  }, [toolState.mode])

  // ── Highlight line when jumping from shotlist ─────────────────────────────

  useEffect(() => {
    if (!highlightLineId) return
    const canvas = fabricRef.current
    if (!canvas) return
    const target = canvas.getObjects().find(
      (o) => (o as unknown as { data?: { id?: string } }).data?.id === highlightLineId
    )
    if (!target) return
    let count = 0
    const flash = setInterval(() => {
      target.opacity = count % 2 === 0 ? 0.3 : 1
      canvas.requestRenderAll()
      if (++count >= 6) { clearInterval(flash); target.opacity = 1; canvas.requestRenderAll() }
    }, 140)
  }, [highlightLineId])

  // ── Right-click context menu ──────────────────────────────────────────────

  useEffect(() => {
    const upperEl = fabricRef.current?.upperCanvasEl
    if (!upperEl) return
    function onContextMenu(e: MouseEvent) {
      e.preventDefault()
      const canvas = fabricRef.current
      if (!canvas) return
      const { y: canvasY } = getCanvasPoint(e)
      const hit = canvas.findTarget(e as unknown as MouseEvent)
      if (!hit) { setContextMenu(null); return }
      const data = (hit as unknown as { data?: { id?: string; type?: string } }).data
      if (!data?.id) { setContextMenu(null); return }
      if (data.type === 'scene') {
        setContextMenu({ x: e.clientX, y: e.clientY, lineId: null, markerId: data.id })
      } else {
        setContextMenu({ x: e.clientX, y: e.clientY, lineId: data.id, markerId: null, lineYNorm: canvasY / height })
      }
    }
    upperEl.addEventListener('contextmenu', onContextMenu)
    return () => upperEl.removeEventListener('contextmenu', onContextMenu)
  })

  // ── Pointer events: click-click drawing ──────────────────────────────────

  useEffect(() => {
    const upperEl = fabricRef.current?.upperCanvasEl ?? canvasRef.current
    if (!upperEl) return

    function onPointerDown(e: PointerEvent) {
      const canvas = fabricRef.current
      if (!canvas) return
      e.preventDefault()

      // Scene marker tool
      if (toolState.mode === 'scene') {
        const { y } = getCanvasPoint(e)
        if (token) {
          scenesApi.create(token, { scriptId, pageNumber, yPosition: y / height, xOffset: 0 })
            .then((res) => {
              addSceneMarkerToCanvas(canvas, res.marker, width, height)
              canvas.requestRenderAll()
              setMarkers((prev) => [...prev, res.marker])
              onSceneMarkersChanged?.()
            }).catch(() => {})
        }
        return
      }

      if (toolState.mode !== 'draw') return

      const { x, y } = getCanvasPoint(e)
      const state = drawStateRef.current

      if (state.phase === 'idle') {
        // Click 1: start preview
        drawStateRef.current = {
          phase: 'preview',
          startX: x, startY: y, currentY: y,
          completedSegs: [],
          currentSegType: toolState.initialSegType,
        }
        renderPreview(canvas, drawStateRef.current as Extract<DrawState, { phase: 'preview' }>, toolState.color)
      } else if (state.phase === 'preview') {
        // Click 2: finalize
        const { startX, startY, completedSegs, currentSegType } = state
        const endY = y
        if (Math.abs(endY - startY) < 10) {
          clearPreview(canvas)
          drawStateRef.current = { phase: 'idle' }
          return
        }

        clearPreview(canvas)
        drawStateRef.current = { phase: 'idle' }

        // Build normalized segments
        const yTop = Math.min(startY, endY)
        const yBot = Math.max(startY, endY)
        const allSegsRaw = [...completedSegs, { type: currentSegType, yEndPx: yBot }]
        let lastNorm = yTop / height
        const finalSegments: Segment[] = allSegsRaw.map((seg) => {
          const endNorm = seg.yEndPx / height
          const s: Segment = { type: seg.type, y_start: lastNorm, y_end: endNorm }
          lastNorm = endNorm
          return s
        })

        const xNorm = startX / width
        const yStartNorm = yTop / height
        const yEndNorm = yBot / height
        const continuesNext = yEndNorm > 0.95

        if (!token) return
        api.post<{ line: LineRecord }>('/lines', {
          scriptId, pageNumber,
          lineType: 'solid',
          xPosition: xNorm, yStart: yStartNorm, yEnd: yEndNorm,
          color: toolState.color,
          segmentsJson: JSON.stringify(finalSegments),
          continuesNextPage: continuesNext,
        }, token).then((res) => {
          addLineGroupToCanvas(canvas, res.line, width, height)
          canvas.requestRenderAll()
          setLines((prev) => [...prev, res.line])
          onLineCreated?.({ lineId: res.line.id, xPosition: xNorm, yStart: yStartNorm, yEnd: yEndNorm, segments: finalSegments })
        }).catch(() => {})
      }
    }

    function onPointerMove(e: PointerEvent) {
      const canvas = fabricRef.current
      const state = drawStateRef.current
      if (!canvas || state.phase !== 'preview') return
      const { y } = getCanvasPoint(e)
      drawStateRef.current = { ...state, currentY: y }
      renderPreview(canvas, drawStateRef.current as Extract<DrawState, { phase: 'preview' }>, toolState.color)
    }

    upperEl.addEventListener('pointerdown', onPointerDown)
    upperEl.addEventListener('pointermove', onPointerMove)
    return () => {
      upperEl.removeEventListener('pointerdown', onPointerDown)
      upperEl.removeEventListener('pointermove', onPointerMove)
    }
  }, [toolState, scriptId, pageNumber, token, width, height])

  // ── Keyboard: Tab toggle, Escape cancel, Delete ───────────────────────────

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const canvas = fabricRef.current
      const state = drawStateRef.current

      // Tab: add segment break mid-draw
      if (e.key === 'Tab' && state.phase === 'preview') {
        e.preventDefault()
        const newCompleted = [...state.completedSegs, { type: state.currentSegType, yEndPx: state.currentY }]
        const newSegType: 'straight' | 'zigzag' = state.currentSegType === 'straight' ? 'zigzag' : 'straight'
        drawStateRef.current = { ...state, completedSegs: newCompleted, currentSegType: newSegType }
        if (canvas) renderPreview(canvas, drawStateRef.current as Extract<DrawState, { phase: 'preview' }>, toolState.color)
        return
      }

      // Escape: cancel drawing
      if (e.key === 'Escape' && state.phase === 'preview') {
        if (canvas) { clearPreview(canvas); canvas.requestRenderAll() }
        drawStateRef.current = { phase: 'idle' }
        return
      }

      // Delete / Backspace: delete selected object in select mode
      if ((e.key === 'Delete' || e.key === 'Backspace') && toolState.mode === 'select') {
        if (!canvas) return
        const active = canvas.getActiveObject()
        if (!active) return
        const data = (active as unknown as { data?: { id?: string; type?: string } }).data
        canvas.remove(active)
        canvas.requestRenderAll()
        if (data?.id) {
          if (data.type === 'scene') deleteMarkerById(data.id)
          else deleteLineById(data.id)
        }
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [toolState.mode, toolState.color])

  // ── Object modified: save position after drag ─────────────────────────────

  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return
    function onModified(e: { target?: unknown }) {
      const obj = e.target as {
        data?: { id?: string; type?: string }
        left?: number
        top?: number
        getCenterPoint?: () => { x: number; y: number }
      } | null
      if (!obj?.data?.id) return

      if (obj.data.type === 'line') {
        // Horizontal drag — update x_position
        const newXNorm = (obj.getCenterPoint?.()?.x ?? 0) / width
        if (token) {
          api.patch(`/lines/${obj.data.id}`, { xPosition: newXNorm }, token).catch(() => {})
        }
        setLines((prev) => prev.map((l) => l.id === obj.data!.id ? { ...l, x_position: newXNorm } : l))
      } else if (obj.data.type === 'scene') {
        const xOff = (obj.left ?? 0) / width
        const yPos = (obj.top ?? 0) / height
        const id = obj.data.id
        if (token) {
          scenesApi.update(token, id, { yPosition: yPos, xOffset: xOff })
            .then(() => {
              setMarkers((prev) => prev.map((m) => m.id === id ? { ...m, y_position: yPos, x_offset: xOff } : m))
              onSceneMarkersChanged?.()
            }).catch(() => {})
        }
      }
    }
    canvas.on('object:modified', onModified)
    return () => { canvas.off('object:modified', onModified) }
  })

  // ── Delete helpers ────────────────────────────────────────────────────────

  function deleteLineById(id: string) {
    const canvas = fabricRef.current
    const obj = canvas?.getObjects().find((o) => (o as unknown as { data?: { id?: string } }).data?.id === id)
    if (obj) { canvas?.remove(obj); canvas?.requestRenderAll() }
    if (token) {
      api.delete(`/lines/${id}`, token).catch(() => {})
      api.delete(`/shots?lineId=${id}`, token).catch(() => {})
    }
    setLines((prev) => prev.filter((l) => l.id !== id))
    onLineDeleted?.(id)
  }

  function deleteMarkerById(id: string) {
    const canvas = fabricRef.current
    const obj = canvas?.getObjects().find((o) => (o as unknown as { data?: { id?: string } }).data?.id === id)
    if (obj) { canvas?.remove(obj); canvas?.requestRenderAll() }
    if (token) scenesApi.delete(token, id).catch(() => {})
    setMarkers((prev) => prev.filter((m) => m.id !== id))
    onSceneMarkersChanged?.()
  }

  // ── Context menu actions ──────────────────────────────────────────────────

  function handleContextDelete() {
    if (!contextMenu) return
    if (contextMenu.lineId) deleteLineById(contextMenu.lineId)
    else if (contextMenu.markerId) deleteMarkerById(contextMenu.markerId)
    setContextMenu(null)
  }

  function handleAddSegmentBreak() {
    if (!contextMenu?.lineId || contextMenu.lineYNorm === undefined) return
    const canvas = fabricRef.current
    const line = lines.find((l) => l.id === contextMenu.lineId)
    if (!line) { setContextMenu(null); return }

    const segs = parseSegments(line)
    const yNorm = contextMenu.lineYNorm

    // Find which segment contains this y-position
    const idx = segs.findIndex((s) => s.y_start <= yNorm && yNorm <= s.y_end)
    if (idx === -1) { setContextMenu(null); return }

    const seg = segs[idx]
    const newType: 'straight' | 'zigzag' = seg.type === 'straight' ? 'zigzag' : 'straight'
    const newSegs: Segment[] = [
      ...segs.slice(0, idx),
      { type: seg.type, y_start: seg.y_start, y_end: yNorm },
      { type: newType, y_start: yNorm, y_end: seg.y_end },
      ...segs.slice(idx + 1),
    ]

    const updatedLine = { ...line, segments_json: JSON.stringify(newSegs) }

    if (canvas) {
      const obj = canvas.getObjects().find((o) => (o as unknown as { data?: { id?: string } }).data?.id === line.id)
      if (obj) canvas.remove(obj)
      addLineGroupToCanvas(canvas, updatedLine, width, height)
      canvas.requestRenderAll()
    }
    setLines((prev) => prev.map((l) => l.id === line.id ? updatedLine : l))
    if (token) api.patch(`/lines/${line.id}`, { segmentsJson: JSON.stringify(newSegs) }, token).catch(() => {})
    setContextMenu(null)
  }

  // ── Cursor ────────────────────────────────────────────────────────────────

  const cursor = toolState.mode === 'draw'
    ? (drawStateRef.current.phase === 'preview' ? 'crosshair' : 'crosshair')
    : toolState.mode === 'scene' ? 'cell' : 'default'

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="script-canvas-wrapper"
      style={{ position: 'absolute', top: 0, left: 0, width, height }}
      onClick={() => contextMenu && setContextMenu(null)}
    >
      <canvas ref={canvasRef} className="fabric-canvas-el" style={{ cursor, touchAction: 'none' }} />

      {/* Shot labels overlay */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        {labels.map((label) => (
          <div
            key={label.lineId}
            className="shot-label"
            style={{ left: label.x + BRACKET_HALF + 4, top: label.yTop, color: label.color, borderColor: label.color }}
          >
            <span className="shot-label-num">
              {label.sceneNum > 0 ? `${label.sceneNum}/` : ''}{label.shotNum}
            </span>
            {label.shotSize && <span className="shot-label-size">{label.shotSize}</span>}
          </div>
        ))}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="canvas-context-menu"
          style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 1000 }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.lineId && (
            <button className="ctx-menu-item" onClick={handleAddSegmentBreak}>
              Thêm break tại đây
            </button>
          )}
          <button className="ctx-menu-item ctx-menu-danger" onClick={handleContextDelete}>
            {contextMenu.lineId ? 'Xóa line + shot' : 'Xóa scene marker'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Canvas rendering functions ────────────────────────────────────────────────

function addLineGroupToCanvas(canvas: Canvas, record: LineRecord, w: number, h: number) {
  const xPx = record.x_position * w
  const y1Px = record.y_start * h
  const y2Px = record.y_end * h
  const { color } = record
  const segments = parseSegments(record)
  const continuesNext = record.continues_to_next_page === 1

  const strokeOpts = { selectable: false, evented: false } as const
  const objects: (Line | Path)[] = []

  // Start bracket (skip if continues from prev page — continuation has no start bracket)
  if (!record.continues_from_prev_page) {
    objects.push(new Line([xPx - BRACKET_HALF, y1Px, xPx + BRACKET_HALF, y1Px], {
      stroke: color, strokeWidth: 2.5, ...strokeOpts,
    }))
  }

  // Render each segment + transition brackets
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const segY1 = seg.y_start * h
    const segY2 = seg.y_end * h

    if (seg.type === 'zigzag') {
      objects.push(new Path(zigzagPath(xPx, segY1, segY2), {
        stroke: color, strokeWidth: STROKE_WIDTH, fill: '', ...strokeOpts,
      }))
    } else {
      objects.push(new Line([xPx, segY1, xPx, segY2], {
        stroke: color, strokeWidth: STROKE_WIDTH, ...strokeOpts,
      }))
    }

    // Transition bracket between segments (not after last)
    if (i < segments.length - 1) {
      objects.push(new Line([xPx - BRACKET_HALF, segY2, xPx + BRACKET_HALF, segY2], {
        stroke: color, strokeWidth: 2.5, ...strokeOpts,
      }))
    }
  }

  // End: ↓ arrow (continues) or end bracket
  if (continuesNext) {
    const aY = y2Px
    const aSize = 10
    objects.push(new Path(
      `M ${xPx} ${aY - aSize} L ${xPx} ${aY + aSize} M ${xPx - 6} ${aY + 3} L ${xPx} ${aY + aSize} L ${xPx + 6} ${aY + 3}`,
      { stroke: color, strokeWidth: 2.5, fill: '', ...strokeOpts }
    ))
  } else {
    objects.push(new Line([xPx - BRACKET_HALF, y2Px, xPx + BRACKET_HALF, y2Px], {
      stroke: color, strokeWidth: 2.5, ...strokeOpts,
    }))
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const group = new Group(objects as any[], {
    selectable: true,
    evented: true,
    lockMovementY: true,
    hasControls: false,
    hasBorders: false,
  })
  ;(group as unknown as { data: object }).data = { id: record.id, type: 'line' }
  canvas.add(group)
}

function addSceneMarkerToCanvas(canvas: Canvas, marker: SceneMarker, w: number, h: number) {
  const x = marker.x_offset * w
  const y = marker.y_position * h
  const arm   = new Line([0, 0, 100, 0], { stroke: '#6b7280', strokeWidth: 1.5, strokeDashArray: [6, 4], selectable: false, evented: false })
  const tick  = new Line([0, -6, 0, 6], { stroke: '#6b7280', strokeWidth: 2, selectable: false, evented: false })
  const tStem = new Line([0, 6, 0, 16], { stroke: '#6b7280', strokeWidth: 1.5, selectable: false, evented: false })
  const tBar  = new Line([-7, 16, 7, 16], { stroke: '#6b7280', strokeWidth: 2, selectable: false, evented: false })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const group = new Group([arm, tick, tStem, tBar] as any[], {
    left: x, top: y,
    originX: 'left', originY: 'center',
    selectable: true, evented: true,
    lockMovementY: true,
    hasControls: false, hasBorders: false,
  })
  ;(group as unknown as { data: object }).data = { id: marker.id, type: 'scene' }
  canvas.add(group)
}
