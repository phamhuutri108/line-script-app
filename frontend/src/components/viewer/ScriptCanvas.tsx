import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react'
import { Canvas, Line, Path, Group, Circle, IText } from 'fabric'
import { useAuthStore } from '../../stores/authStore'
import { api } from '../../api/client'
import { scenesApi, type SceneMarker } from '../../api/scenes'
import { annotationsApi, type AnnotationRecord } from '../../api/annotations'
import { shotsApi, type Shot } from '../../api/shots'
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
  annotationId: string | null
  lineYNorm?: number  // y-position (normalized) of right-click on a line
}

interface ShotLabel {
  lineId: string
  x: number
  yTop: number
  yBottom: number
  color: string
  sceneNum: number
  shotNum: number
  shotSize: string
  shotType: string
  movement: string
}

// ── Undo/Redo ────────────────────────────────────────────────────────────────

type UndoEntry =
  | { op: 'add_line';      line: LineRecord }
  | { op: 'del_line';      line: LineRecord }
  | { op: 'move_line';     id: string; oldX: number; newX: number }
  | { op: 'add_marker';    marker: SceneMarker }
  | { op: 'del_marker';    marker: SceneMarker }
  | { op: 'split_line';    id: string; oldSegs: string; newSegs: string }
  | { op: 'add_annotation'; annotation: AnnotationRecord }
  | { op: 'del_annotation'; annotation: AnnotationRecord }

// ── Handle exposed to parent ──────────────────────────────────────────────────

export interface ScriptCanvasHandle {
  undo: () => void
  redo: () => void
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
  onExtractSceneName?: (yNorm: number) => Promise<string>
  onUndoStateChange?: (canUndo: boolean, canRedo: boolean) => void
  onShotUpdated?: (shot: Shot) => void
  onLabelsChanged?: (map: Record<string, string>) => void
  highlightLineId?: string | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STROKE_WIDTH = 2
const SHOT_TYPE_OPTIONS = ['', 'Single', 'Two', 'Three', 'Group', 'Observe', 'Insert', 'POV', 'OTS']
const MOVEMENT_OPTIONS = ['', 'Static', 'Pan', 'Tilt', 'Dolly', 'Tracking', 'Handheld', 'Crane', 'Drone']
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
    labels.push({ lineId: line.id, x: line.x_position * w, yTop: line.y_start * h, yBottom: line.y_end * h, color: line.color, sceneNum: 0, shotNum: idx + 1, shotSize: s?.shot_size ?? '', shotType: s?.shot_type ?? '', movement: s?.movement ?? '' })
  })
  sceneGroups.forEach((group, sIdx) => {
    group.forEach((line, shotIdx) => {
      const s = shots.find((sh) => sh.line_id === line.id)
      labels.push({ lineId: line.id, x: line.x_position * w, yTop: line.y_start * h, yBottom: line.y_end * h, color: line.color, sceneNum: sIdx + 1, shotNum: shotIdx + 1, shotSize: s?.shot_size ?? '', shotType: s?.shot_type ?? '', movement: s?.movement ?? '' })
    })
  })
  return labels
}

// ── Component ─────────────────────────────────────────────────────────────────

export default forwardRef<ScriptCanvasHandle, Props>(function ScriptCanvas({
  width, height, scriptId, pageNumber, toolState, shots,
  onLineCreated, onLineDeleted, onSceneMarkersChanged, onExtractSceneName, onUndoStateChange, onShotUpdated, onLabelsChanged, highlightLineId,
}, ref) {
  const canvasRef         = useRef<HTMLCanvasElement>(null)
  const fabricRef         = useRef<Canvas | null>(null)
  const drawStateRef      = useRef<DrawState>({ phase: 'idle' })
  const previewObjsRef    = useRef<(Line | Path)[]>([])
  const handleCirclesRef  = useRef<Circle[]>([])
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const undoStackRef      = useRef<UndoEntry[]>([])
  const redoStackRef      = useRef<UndoEntry[]>([])
  const dragStartXRef     = useRef<number>(0)
  const draggingXRef      = useRef<Record<string, number>>({})
  const draggingMarkerRef = useRef<Record<string, number>>({})
  const linesRef          = useRef<LineRecord[]>([])
  const yDragRef          = useRef<{ lineId: string; handle: 'start' | 'end'; startClientY: number; origYNorm: number; latestYNorm: number } | null>(null)
  const breakDragRef      = useRef<{ lineId: string; segIdx: number; startClientY: number; origYNorm: number; latestYNorm: number } | null>(null)
  const { token } = useAuthStore()

  const [lines, setLines] = useState<LineRecord[]>([])
  const [markers, setMarkers] = useState<SceneMarker[]>([])
  const [annotations, setAnnotations] = useState<AnnotationRecord[]>([])
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [draggingX, setDraggingX] = useState<Record<string, number>>({})
  const [draggingMarker, setDraggingMarker] = useState<Record<string, number>>({})
  const [draggingY, setDraggingY] = useState<Record<string, { yTop: number; yBottom: number }>>({})
  const [draggingBreak, setDraggingBreak] = useState<Record<string, number[]>>({})
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null)
  const [activeBadge, setActiveBadge] = useState<{ lineId: string; field: 'shot_type' | 'movement' } | null>(null)
  const [editingMarkerId, setEditingMarkerId] = useState<string | null>(null)
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null)

  linesRef.current = lines
  const labels = computeLabels(lines, markers, shots, width, height)

  // Emit label map to parent whenever labels change
  useEffect(() => {
    const map: Record<string, string> = {}
    labels.forEach((l) => {
      map[l.lineId] = l.sceneNum > 0 ? `${l.sceneNum}/${l.shotNum}` : `${l.shotNum}`
    })
    onLabelsChanged?.(map)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, markers, shots])

  // ── Undo/Redo helpers ─────────────────────────────────────────────────────

  function pushUndo(entry: UndoEntry) {
    undoStackRef.current.push(entry)
    redoStackRef.current = []
    onUndoStateChange?.(true, false)
  }

  function syncUndoRedoState() {
    const u = undoStackRef.current.length > 0
    const r = redoStackRef.current.length > 0
    onUndoStateChange?.(u, r)
  }

  function applyUndoEntry(entry: UndoEntry, canvas: Canvas) {
    if (entry.op === 'add_line') {
      // Undo add → delete the line
      const obj = canvas.getObjects().find((o) => (o as { data?: { id?: string } }).data?.id === entry.line.id)
      if (obj) { canvas.remove(obj); canvas.requestRenderAll() }
      if (token) {
        api.delete(`/lines/${entry.line.id}`, token).catch(() => {})
        api.delete(`/shots?lineId=${entry.line.id}`, token).catch(() => {})
      }
      setLines((prev) => prev.filter((l) => l.id !== entry.line.id))
      onLineDeleted?.(entry.line.id)
    } else if (entry.op === 'del_line') {
      // Undo delete → restore line
      if (token) {
        api.post<{ line: LineRecord }>('/lines', {
          scriptId, pageNumber,
          lineType: 'solid',
          xPosition: entry.line.x_position, yStart: entry.line.y_start, yEnd: entry.line.y_end,
          color: entry.line.color, segmentsJson: entry.line.segments_json,
          continuesNextPage: entry.line.continues_to_next_page === 1,
          continuesPrevPage: entry.line.continues_from_prev_page === 1,
        }, token).then((res) => {
          addLineGroupToCanvas(canvas, res.line, width, height)
          canvas.requestRenderAll()
          setLines((prev) => [...prev, res.line])
        }).catch(() => {})
      }
    } else if (entry.op === 'move_line') {
      // Undo move → restore old X
      const obj = canvas.getObjects().find((o) => (o as { data?: { id?: string } }).data?.id === entry.id)
      if (obj) { obj.set({ left: entry.oldX * width }); obj.setCoords(); canvas.requestRenderAll() }
      if (token) api.patch(`/lines/${entry.id}`, { xPosition: entry.oldX }, token).catch(() => {})
      setLines((prev) => prev.map((l) => l.id === entry.id ? { ...l, x_position: entry.oldX } : l))
    } else if (entry.op === 'add_marker') {
      // Undo add marker → delete it
      const obj = canvas.getObjects().find((o) => (o as { data?: { id?: string } }).data?.id === entry.marker.id)
      if (obj) { canvas.remove(obj); canvas.requestRenderAll() }
      if (token) scenesApi.delete(token, entry.marker.id).catch(() => {})
      setMarkers((prev) => prev.filter((m) => m.id !== entry.marker.id))
      onSceneMarkersChanged?.()
    } else if (entry.op === 'del_marker') {
      // Undo delete marker → restore it
      if (token) {
        scenesApi.create(token, {
          scriptId, pageNumber: entry.marker.page_number,
          yPosition: entry.marker.y_position, xOffset: entry.marker.x_offset,
          name: entry.marker.name ?? undefined,
        }).then((res) => {
          addSceneMarkerToCanvas(canvas, res.marker, width, height)
          canvas.requestRenderAll()
          setMarkers((prev) => [...prev, res.marker])
          onSceneMarkersChanged?.()
        }).catch(() => {})
      }
    } else if (entry.op === 'split_line') {
      // Undo split → restore old segments
      const line = lines.find((l) => l.id === entry.id)
      if (!line) return
      const restored = { ...line, segments_json: entry.oldSegs }
      const obj = canvas.getObjects().find((o) => (o as { data?: { id?: string } }).data?.id === entry.id)
      if (obj) { canvas.remove(obj) }
      addLineGroupToCanvas(canvas, restored, width, height)
      canvas.requestRenderAll()
      setLines((prev) => prev.map((l) => l.id === entry.id ? restored : l))
      if (token) api.patch(`/lines/${entry.id}`, { segmentsJson: entry.oldSegs }, token).catch(() => {})
    } else if (entry.op === 'add_annotation') {
      // Undo add annotation → delete it
      const obj = canvas.getObjects().find((o) => (o as { data?: { id?: string } }).data?.id === entry.annotation.id)
      if (obj) { canvas.remove(obj); canvas.requestRenderAll() }
      if (token) annotationsApi.delete(token, entry.annotation.id).catch(() => {})
      setAnnotations((prev) => prev.filter((a) => a.id !== entry.annotation.id))
    } else if (entry.op === 'del_annotation') {
      // Undo delete annotation → restore it
      if (token) {
        annotationsApi.create(token, {
          scriptId, pageNumber, type: 'drawing', fabricJson: entry.annotation.fabric_json,
        }).then((res) => {
          const parsed = JSON.parse(res.annotation.fabric_json)
          const obj = new IText(parsed.text ?? '', {
            left: parsed.left, top: parsed.top,
            fill: parsed.fill, fontSize: parsed.fontSize ?? 14,
            selectable: true, evented: true,
          })
          ;(obj as unknown as { data: object }).data = { id: res.annotation.id, type: 'annotation' }
          canvas.add(obj)
          canvas.requestRenderAll()
          setAnnotations((prev) => [...prev, res.annotation])
        }).catch(() => {})
      }
    }
  }

  function applyRedoEntry(entry: UndoEntry, canvas: Canvas) {
    if (entry.op === 'add_line') {
      // Redo add → restore the line (we have the id, but re-create via API)
      addLineGroupToCanvas(canvas, entry.line, width, height)
      canvas.requestRenderAll()
      setLines((prev) => [...prev, entry.line])
      if (token) {
        api.post<{ line: LineRecord }>('/lines', {
          scriptId, pageNumber,
          lineType: 'solid',
          xPosition: entry.line.x_position, yStart: entry.line.y_start, yEnd: entry.line.y_end,
          color: entry.line.color, segmentsJson: entry.line.segments_json,
          continuesNextPage: entry.line.continues_to_next_page === 1,
        }, token).catch(() => {})
      }
    } else if (entry.op === 'del_line') {
      // Redo delete → delete again
      const obj = canvas.getObjects().find((o) => (o as { data?: { id?: string } }).data?.id === entry.line.id)
      if (obj) { canvas.remove(obj); canvas.requestRenderAll() }
      if (token) {
        api.delete(`/lines/${entry.line.id}`, token).catch(() => {})
        api.delete(`/shots?lineId=${entry.line.id}`, token).catch(() => {})
      }
      setLines((prev) => prev.filter((l) => l.id !== entry.line.id))
      onLineDeleted?.(entry.line.id)
    } else if (entry.op === 'move_line') {
      // Redo move → apply new X
      const obj = canvas.getObjects().find((o) => (o as { data?: { id?: string } }).data?.id === entry.id)
      if (obj) { obj.set({ left: entry.newX * width }); obj.setCoords(); canvas.requestRenderAll() }
      if (token) api.patch(`/lines/${entry.id}`, { xPosition: entry.newX }, token).catch(() => {})
      setLines((prev) => prev.map((l) => l.id === entry.id ? { ...l, x_position: entry.newX } : l))
    } else if (entry.op === 'add_marker') {
      if (token) {
        scenesApi.create(token, {
          scriptId, pageNumber: entry.marker.page_number,
          yPosition: entry.marker.y_position, xOffset: entry.marker.x_offset,
          name: entry.marker.name ?? undefined,
        }).then((res) => {
          addSceneMarkerToCanvas(canvas, res.marker, width, height)
          canvas.requestRenderAll()
          setMarkers((prev) => [...prev, res.marker])
          onSceneMarkersChanged?.()
        }).catch(() => {})
      }
    } else if (entry.op === 'del_marker') {
      const obj = canvas.getObjects().find((o) => (o as { data?: { id?: string } }).data?.id === entry.marker.id)
      if (obj) { canvas.remove(obj); canvas.requestRenderAll() }
      if (token) scenesApi.delete(token, entry.marker.id).catch(() => {})
      setMarkers((prev) => prev.filter((m) => m.id !== entry.marker.id))
      onSceneMarkersChanged?.()
    } else if (entry.op === 'split_line') {
      // Redo split → apply new segments
      const line = lines.find((l) => l.id === entry.id)
      if (!line) return
      const updated = { ...line, segments_json: entry.newSegs }
      const obj = canvas.getObjects().find((o) => (o as { data?: { id?: string } }).data?.id === entry.id)
      if (obj) canvas.remove(obj)
      addLineGroupToCanvas(canvas, updated, width, height)
      canvas.requestRenderAll()
      setLines((prev) => prev.map((l) => l.id === entry.id ? updated : l))
      if (token) api.patch(`/lines/${entry.id}`, { segmentsJson: entry.newSegs }, token).catch(() => {})
    } else if (entry.op === 'add_annotation') {
      if (token) {
        annotationsApi.create(token, {
          scriptId, pageNumber, type: 'drawing', fabricJson: entry.annotation.fabric_json,
        }).then((res) => {
          const parsed = JSON.parse(res.annotation.fabric_json)
          const obj = new IText(parsed.text ?? '', {
            left: parsed.left, top: parsed.top,
            fill: parsed.fill, fontSize: parsed.fontSize ?? 14,
            selectable: true, evented: true,
          })
          ;(obj as unknown as { data: object }).data = { id: res.annotation.id, type: 'annotation' }
          canvas.add(obj)
          canvas.requestRenderAll()
          setAnnotations((prev) => [...prev, res.annotation])
        }).catch(() => {})
      }
    } else if (entry.op === 'del_annotation') {
      const obj = canvas.getObjects().find((o) => (o as { data?: { id?: string } }).data?.id === entry.annotation.id)
      if (obj) { canvas.remove(obj); canvas.requestRenderAll() }
      if (token) annotationsApi.delete(token, entry.annotation.id).catch(() => {})
      setAnnotations((prev) => prev.filter((a) => a.id !== entry.annotation.id))
    }
  }

  function undo() {
    const entry = undoStackRef.current.pop()
    if (!entry || !fabricRef.current) return
    redoStackRef.current.push(entry)
    applyUndoEntry(entry, fabricRef.current)
    syncUndoRedoState()
  }

  function redo() {
    const entry = redoStackRef.current.pop()
    if (!entry || !fabricRef.current) return
    undoStackRef.current.push(entry)
    applyRedoEntry(entry, fabricRef.current)
    syncUndoRedoState()
  }

  useImperativeHandle(ref, () => ({ undo, redo }))


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
      const [lineData, markerData, annotationData] = await Promise.all([
        api.get<{ lines: LineRecord[] }>(`/lines?scriptId=${scriptId}&page=${pageNumber}`, token ?? undefined),
        token ? scenesApi.list(token, scriptId, pageNumber) : Promise.resolve({ markers: [] as SceneMarker[] }),
        token ? annotationsApi.list(token, scriptId, pageNumber) : Promise.resolve({ annotations: [] as AnnotationRecord[] }),
      ])
      canvas.getObjects().forEach((o) => canvas.remove(o))
      lineData.lines.forEach((l) => addLineGroupToCanvas(canvas, l, width, height))
      const sortedMarkers = [...markerData.markers].sort((a, b) => a.y_position - b.y_position)
      sortedMarkers.forEach((m) => addSceneMarkerToCanvas(canvas, m, width, height))
      annotationData.annotations.forEach((a) => {
        try {
          const parsed = JSON.parse(a.fabric_json)
          const obj = new IText(parsed.text ?? '', {
            left: parsed.left ?? 50, top: parsed.top ?? 50,
            fill: parsed.fill ?? '#000000', fontSize: parsed.fontSize ?? 14,
            selectable: true, evented: true,
          })
          ;(obj as unknown as { data: object }).data = { id: a.id, type: 'annotation' }
          canvas.add(obj)
        } catch { /* ignore malformed annotation */ }
      })
      canvas.requestRenderAll()
      setLines(lineData.lines)
      setMarkers(sortedMarkers)
      setAnnotations(annotationData.annotations)
      // Clear undo/redo on page load
      undoStackRef.current = []
      redoStackRef.current = []
      onUndoStateChange?.(false, false)
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
      const data = (obj as unknown as { data?: { type?: string } }).data
      // Annotations are always selectable/evented regardless of mode
      if (data?.type === 'annotation') {
        obj.selectable = true
        obj.evented = true
      } else {
        obj.selectable = isSelect && !!data?.type
        obj.evented = isSelect && !!data?.type
      }
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
        setContextMenu({ x: e.clientX, y: e.clientY, lineId: null, markerId: data.id, annotationId: null })
      } else if (data.type === 'annotation') {
        setContextMenu({ x: e.clientX, y: e.clientY, lineId: null, markerId: null, annotationId: data.id })
      } else {
        setContextMenu({ x: e.clientX, y: e.clientY, lineId: data.id, markerId: null, annotationId: null, lineYNorm: canvasY / height })
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

      // Select mode: long-press detection for iPad context menu; don't preventDefault so Fabric drag works
      if (toolState.mode === 'select') {
        longPressTimerRef.current = setTimeout(() => {
          const hit = canvas.findTarget(e as unknown as MouseEvent)
          if (!hit) return
          const data = (hit as unknown as { data?: { id?: string; type?: string } }).data
          if (!data?.id) return
          const { y: canvasY } = getCanvasPoint(e)
          if (data.type === 'scene') {
            setContextMenu({ x: e.clientX, y: e.clientY, lineId: null, markerId: data.id, annotationId: null })
          } else if (data.type === 'annotation') {
            setContextMenu({ x: e.clientX, y: e.clientY, lineId: null, markerId: null, annotationId: data.id })
          } else {
            setContextMenu({ x: e.clientX, y: e.clientY, lineId: data.id, markerId: null, annotationId: null, lineYNorm: canvasY / height })
          }
        }, 500)
        return // let Fabric handle selection and drag
      }

      e.preventDefault()

      // Scene marker tool
      if (toolState.mode === 'scene') {
        const { y } = getCanvasPoint(e)
        if (token) {
          const yNorm = y / height
          const namePromise = onExtractSceneName ? onExtractSceneName(yNorm) : Promise.resolve('')
          namePromise.then((name) => {
            return scenesApi.create(token, { scriptId, pageNumber, yPosition: yNorm, xOffset: 0, name: name || undefined })
          }).then((res) => {
            addSceneMarkerToCanvas(canvas, res.marker, width, height)
            canvas.requestRenderAll()
            setMarkers((prev) => [...prev, res.marker])
            onSceneMarkersChanged?.()
            pushUndo({ op: 'add_marker', marker: res.marker })
          }).catch(() => {})
        }
        return
      }

      // Split mode: click on a line to split it at that point
      if (toolState.mode === 'split') {
        const { y } = getCanvasPoint(e)
        const hit = canvas.findTarget(e as unknown as MouseEvent)
        if (hit) {
          const data = (hit as unknown as { data?: { id?: string; type?: string } }).data
          if (data?.type === 'line' && data.id) splitLineAt(data.id, y / height)
        }
        return
      }

      // Text annotation mode
      if (toolState.mode === 'text') {
        const { x, y } = getCanvasPoint(e)
        const textObj = new IText('', {
          left: x, top: y,
          fill: toolState.color, fontSize: 14,
          selectable: true, evented: true, padding: 4,
        })
        ;(textObj as unknown as { data: object }).data = { id: '__pending__', type: 'annotation' }
        canvas.add(textObj)
        canvas.setActiveObject(textObj)
        textObj.enterEditing()
        textObj.on('editing:exited', () => {
          const text = textObj.text?.trim() ?? ''
          if (!text || !token) { canvas.remove(textObj); canvas.requestRenderAll(); return }
          const fabricJson = JSON.stringify({ text, left: textObj.left, top: textObj.top, fill: textObj.fill, fontSize: textObj.fontSize })
          annotationsApi.create(token, { scriptId, pageNumber, type: 'drawing', fabricJson })
            .then((res) => {
              ;(textObj as unknown as { data: object }).data = { id: res.annotation.id, type: 'annotation' }
              setAnnotations((prev) => [...prev, res.annotation])
              pushUndo({ op: 'add_annotation', annotation: res.annotation })
            }).catch(() => { canvas.remove(textObj); canvas.requestRenderAll() })
        })
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

        // Block if too close to an existing line (within 12px)
        const MIN_X_GAP_PX = 12
        const tooClose = linesRef.current.some((l) => Math.abs(l.x_position * width - startX) < MIN_X_GAP_PX)
        if (tooClose) { clearPreview(canvas); drawStateRef.current = { phase: 'idle' }; return }

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
          pushUndo({ op: 'add_line', line: res.line })
          onLineCreated?.({ lineId: res.line.id, xPosition: xNorm, yStart: yStartNorm, yEnd: yEndNorm, segments: finalSegments })
        }).catch(() => {})
      }
    }

    function onPointerMove(e: PointerEvent) {
      // Cancel long-press if pointer moves
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
      }
      const canvas = fabricRef.current
      const state = drawStateRef.current
      if (!canvas || state.phase !== 'preview') return
      const { y } = getCanvasPoint(e)
      drawStateRef.current = { ...state, currentY: y }
      renderPreview(canvas, drawStateRef.current as Extract<DrawState, { phase: 'preview' }>, toolState.color)
    }

    function onPointerUp() {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
      }
    }

    upperEl.addEventListener('pointerdown', onPointerDown)
    upperEl.addEventListener('pointermove', onPointerMove)
    upperEl.addEventListener('pointerup', onPointerUp)
    return () => {
      upperEl.removeEventListener('pointerdown', onPointerDown)
      upperEl.removeEventListener('pointermove', onPointerMove)
      upperEl.removeEventListener('pointerup', onPointerUp)
    }
  }, [toolState, scriptId, pageNumber, token, width, height])

  // ── Keyboard: Tab toggle, Escape cancel, Delete ───────────────────────────

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const canvas = fabricRef.current
      const state = drawStateRef.current

      // Undo: Cmd+Z (Mac) or Ctrl+Z (Win)
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
        return
      }

      // Redo: Cmd+Shift+Z or Ctrl+Shift+Z
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'z') {
        e.preventDefault()
        redo()
        return
      }

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
        pushUndo({ op: 'move_line', id: obj.data.id, oldX: dragStartXRef.current, newX: newXNorm })
        if (token) {
          api.patch(`/lines/${obj.data.id}`, { xPosition: newXNorm }, token).catch(() => {})
        }
        setLines((prev) => prev.map((l) => l.id === obj.data!.id ? { ...l, x_position: newXNorm } : l))
      } else if (obj.data.type === 'scene') {
        const yPos = (obj.top ?? 0) / height
        const id = obj.data.id
        // Optimistic state update + clear dragging state
        setMarkers((prev) => prev.map((m) => m.id === id ? { ...m, y_position: yPos } : m))
        draggingMarkerRef.current = {}
        setDraggingMarker({})
        onSceneMarkersChanged?.()
        if (token) {
          scenesApi.update(token, id, { yPosition: yPos }).catch(() => {})
        }
      }
    }
    canvas.on('object:modified', onModified)
    return () => { canvas.off('object:modified', onModified) }
  })

  // ── Selection handles ─────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return

    function clearHandles() {
      handleCirclesRef.current.forEach((o) => canvas!.remove(o))
      handleCirclesRef.current = []
    }

    function makeHandle(cx: number, cy: number, color: string) {
      return new Circle({
        left: cx, top: cy,
        originX: 'center', originY: 'center',
        radius: 5,
        stroke: color, strokeWidth: 1.5, strokeDashArray: [3, 2],
        fill: 'rgba(255,255,255,0.8)',
        selectable: false, evented: false,
      })
    }

    function showHandles(obj: unknown) {
      const o = obj as {
        data?: { type?: string; color?: string; yStartPx?: number; yEndPx?: number }
        getCenterPoint: () => { x: number }
      }
      if (o?.data?.type !== 'line') return
      clearHandles()
      const cx = o.getCenterPoint().x
      const color = o.data?.color ?? '#e05c5c'
      const y1 = o.data?.yStartPx ?? 0
      const y2 = o.data?.yEndPx ?? height
      const h1 = makeHandle(cx, y1, color)
      const h2 = makeHandle(cx, y2, color)
      canvas!.add(h1, h2)
      handleCirclesRef.current = [h1, h2]
      canvas!.requestRenderAll()
    }

    function onSelCreated(e: { selected?: unknown[] }) {
      if (e.selected?.[0]) {
        showHandles(e.selected[0])
        const o = e.selected[0] as { data?: { type?: string; id?: string }; getCenterPoint?: () => { x: number } }
        if (o?.data?.type === 'line') dragStartXRef.current = (o.getCenterPoint?.()?.x ?? 0) / width
        if (o?.data?.type === 'scene') setSelectedMarkerId(o.data.id ?? null)
      }
    }
    function onSelUpdated(e: { selected?: unknown[] }) {
      if (e.selected?.[0]) {
        showHandles(e.selected[0])
        const o = e.selected[0] as { data?: { type?: string; id?: string } }
        if (o?.data?.type === 'scene') setSelectedMarkerId(o.data.id ?? null)
      }
    }
    function onSelCleared() {
      clearHandles()
      draggingXRef.current = {}
      setDraggingX({})
      draggingMarkerRef.current = {}
      setDraggingMarker({})
      setSelectedMarkerId(null)
      canvas!.requestRenderAll()
    }
    function onObjMoving(e: { target?: unknown }) {
      const obj = e.target as {
        data?: { id?: string; type?: string; color?: string; yStartPx?: number; yEndPx?: number }
        getCenterPoint: () => { x: number }
        top?: number
      }
      if (obj?.data?.type === 'line') {
        const cx = obj.getCenterPoint().x
        if (handleCirclesRef.current.length === 2) {
          handleCirclesRef.current[0].set({ left: cx })
          handleCirclesRef.current[1].set({ left: cx })
        }
        if (obj.data?.id) {
          draggingXRef.current[obj.data.id] = cx
          setDraggingX({ ...draggingXRef.current })
        }
      } else if (obj?.data?.type === 'scene') {
        if (obj.data?.id) {
          draggingMarkerRef.current[obj.data.id] = obj.top ?? 0
          setDraggingMarker({ ...draggingMarkerRef.current })
        }
      }
      canvas!.requestRenderAll()
    }

    canvas.on('selection:created', onSelCreated as (e: object) => void)
    canvas.on('selection:updated', onSelUpdated as (e: object) => void)
    canvas.on('selection:cleared', onSelCleared)
    canvas.on('object:moving', onObjMoving as (e: object) => void)
    return () => {
      canvas.off('selection:created', onSelCreated as (e: object) => void)
      canvas.off('selection:updated', onSelUpdated as (e: object) => void)
      canvas.off('selection:cleared', onSelCleared)
      canvas.off('object:moving', onObjMoving as (e: object) => void)
    }
  })

  // ── Delete helpers ────────────────────────────────────────────────────────

  function deleteLineById(id: string) {
    const canvas = fabricRef.current
    const lineRecord = lines.find((l) => l.id === id)
    if (lineRecord) pushUndo({ op: 'del_line', line: lineRecord })
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
    const markerRecord = markers.find((m) => m.id === id)
    if (markerRecord) pushUndo({ op: 'del_marker', marker: markerRecord })
    const obj = canvas?.getObjects().find((o) => (o as unknown as { data?: { id?: string } }).data?.id === id)
    if (obj) { canvas?.remove(obj); canvas?.requestRenderAll() }
    if (token) scenesApi.delete(token, id).catch(() => {})
    setMarkers((prev) => prev.filter((m) => m.id !== id))
    onSceneMarkersChanged?.()
  }

  function deleteAnnotationById(id: string) {
    const canvas = fabricRef.current
    const annotationRecord = annotations.find((a) => a.id === id)
    if (annotationRecord) pushUndo({ op: 'del_annotation', annotation: annotationRecord })
    const obj = canvas?.getObjects().find((o) => (o as unknown as { data?: { id?: string } }).data?.id === id)
    if (obj) { canvas?.remove(obj); canvas?.requestRenderAll() }
    if (token) annotationsApi.delete(token, id).catch(() => {})
    setAnnotations((prev) => prev.filter((a) => a.id !== id))
  }

  // ── Context menu actions ──────────────────────────────────────────────────

  function handleContextDelete() {
    if (!contextMenu) return
    if (contextMenu.lineId) deleteLineById(contextMenu.lineId)
    else if (contextMenu.markerId) deleteMarkerById(contextMenu.markerId)
    else if (contextMenu.annotationId) deleteAnnotationById(contextMenu.annotationId)
    setContextMenu(null)
  }

  function splitLineAt(lineId: string, yNorm: number) {
    const canvas = fabricRef.current
    const line = lines.find((l) => l.id === lineId)
    if (!line) return

    const segs = parseSegments(line)

    // Find which segment contains this y-position
    const idx = segs.findIndex((s) => s.y_start <= yNorm && yNorm <= s.y_end)
    if (idx === -1) return

    const seg = segs[idx]
    const newType: 'straight' | 'zigzag' = seg.type === 'straight' ? 'zigzag' : 'straight'
    const newSegs: Segment[] = [
      ...segs.slice(0, idx),
      { type: seg.type, y_start: seg.y_start, y_end: yNorm },
      { type: newType, y_start: yNorm, y_end: seg.y_end },
      ...segs.slice(idx + 1),
    ]

    const oldSegsStr = line.segments_json ?? JSON.stringify(segs)
    const newSegsStr = JSON.stringify(newSegs)
    const updatedLine = { ...line, segments_json: newSegsStr }

    if (canvas) {
      const obj = canvas.getObjects().find((o) => (o as unknown as { data?: { id?: string } }).data?.id === line.id)
      if (obj) canvas.remove(obj)
      addLineGroupToCanvas(canvas, updatedLine, width, height)
      canvas.requestRenderAll()
    }
    setLines((prev) => prev.map((l) => l.id === line.id ? updatedLine : l))
    if (token) api.patch(`/lines/${line.id}`, { segmentsJson: newSegsStr }, token).catch(() => {})
    pushUndo({ op: 'split_line', id: line.id, oldSegs: oldSegsStr, newSegs: newSegsStr })
  }

  function handleAddSegmentBreak() {
    if (!contextMenu?.lineId || contextMenu.lineYNorm === undefined) return
    splitLineAt(contextMenu.lineId, contextMenu.lineYNorm)
    setContextMenu(null)
  }

  // ── Y-drag: label→y_start, end bracket→y_end ─────────────────────────────

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const drag = yDragRef.current
      if (!drag) return
      const dy = e.clientY - drag.startClientY
      const newYNorm = Math.max(0.01, Math.min(0.99, drag.origYNorm + dy / height))
      drag.latestYNorm = newYNorm
      setDraggingY((prev) => {
        const line = linesRef.current.find((l) => l.id === drag.lineId)
        if (!line) return prev
        const prevEntry = prev[drag.lineId]
        const yTop = drag.handle === 'start' ? newYNorm * height : (prevEntry?.yTop ?? line.y_start * height)
        const yBottom = drag.handle === 'end' ? newYNorm * height : (prevEntry?.yBottom ?? line.y_end * height)
        return { ...prev, [drag.lineId]: { yTop, yBottom } }
      })
    }
    function onUp() {
      const drag = yDragRef.current
      if (!drag || !token) { yDragRef.current = null; return }
      const { lineId, handle, latestYNorm } = drag
      yDragRef.current = null
      const line = linesRef.current.find((l) => l.id === lineId)
      if (!line) return
      // Update segments_json to reflect new y boundary
      let newSegmentsJson = line.segments_json
      if (newSegmentsJson) {
        const segs: Array<{ type: string; y_start: number; y_end: number }> = JSON.parse(newSegmentsJson)
        if (handle === 'start' && segs.length > 0) segs[0] = { ...segs[0], y_start: latestYNorm }
        if (handle === 'end' && segs.length > 0) segs[segs.length - 1] = { ...segs[segs.length - 1], y_end: latestYNorm }
        newSegmentsJson = JSON.stringify(segs)
      }
      const newYStart = handle === 'start' ? latestYNorm : line.y_start
      const newYEnd = handle === 'end' ? latestYNorm : line.y_end
      api.patch<{ line: LineRecord }>(`/lines/${lineId}`, {
        yStart: newYStart, yEnd: newYEnd, segmentsJson: newSegmentsJson ?? undefined,
      }, token)
        .then((res) => {
          setLines((prev) => prev.map((l) => l.id === lineId ? res.line : l))
          setDraggingY((prev) => { const n = { ...prev }; delete n[lineId]; return n })
          const canvas = fabricRef.current
          if (canvas) {
            const obj = canvas.getObjects().find((o) => (o as { data?: { id?: string } }).data?.id === lineId)
            if (obj) canvas.remove(obj)
            addLineGroupToCanvas(canvas, res.line, width, height)
            canvas.requestRenderAll()
          }
        })
        .catch(() => {
          setDraggingY((prev) => { const n = { ...prev }; delete n[lineId]; return n })
        })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [height, width, token])

  // ── Track selected line via Fabric events ────────────────────────────────

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return
    function onSelected(e: { selected?: unknown[] }) {
      const obj = (e.selected?.[0]) as { data?: { type?: string; id?: string } } | undefined
      if (obj?.data?.type === 'line' && obj.data.id) setSelectedLineId(obj.data.id)
      else setSelectedLineId(null)
    }
    function onCleared() { setSelectedLineId(null) }
    canvas.on('selection:created', onSelected as (e: object) => void)
    canvas.on('selection:updated', onSelected as (e: object) => void)
    canvas.on('selection:cleared', onCleared)
    return () => {
      canvas.off('selection:created', onSelected as (e: object) => void)
      canvas.off('selection:updated', onSelected as (e: object) => void)
      canvas.off('selection:cleared', onCleared)
    }
  })

  // ── Break point drag ──────────────────────────────────────────────────────

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const drag = breakDragRef.current
      if (!drag) return
      const dy = e.clientY - drag.startClientY
      const newYNorm = Math.max(0.01, Math.min(0.99, drag.origYNorm + dy / height))
      drag.latestYNorm = newYNorm
      setDraggingBreak((prev) => {
        const line = linesRef.current.find((l) => l.id === drag.lineId)
        if (!line) return prev
        const segs = parseSegments(line)
        const breaks = segs.slice(0, -1).map((s) => s.y_end)
        breaks[drag.segIdx] = newYNorm
        return { ...prev, [drag.lineId]: breaks }
      })
    }
    function onUp() {
      const drag = breakDragRef.current
      if (!drag || !token) { breakDragRef.current = null; return }
      const { lineId, segIdx, latestYNorm } = drag
      breakDragRef.current = null
      const line = linesRef.current.find((l) => l.id === lineId)
      if (!line) return
      const segs = parseSegments(line)
      // Clamp to neighbours
      const minY = segIdx === 0 ? line.y_start + 0.01 : segs[segIdx - 1].y_end + 0.01
      const maxY = segIdx >= segs.length - 2 ? line.y_end - 0.01 : segs[segIdx + 2].y_start - 0.01
      const clamped = Math.max(minY, Math.min(maxY, latestYNorm))
      segs[segIdx] = { ...segs[segIdx], y_end: clamped }
      segs[segIdx + 1] = { ...segs[segIdx + 1], y_start: clamped }
      const newSegmentsJson = JSON.stringify(segs)
      api.patch<{ line: LineRecord }>(`/lines/${lineId}`, { segmentsJson: newSegmentsJson }, token)
        .then((res) => {
          setLines((prev) => prev.map((l) => l.id === lineId ? res.line : l))
          setDraggingBreak((prev) => { const n = { ...prev }; delete n[lineId]; return n })
          const canvas = fabricRef.current
          if (canvas) {
            const obj = canvas.getObjects().find((o) => (o as { data?: { id?: string } }).data?.id === lineId)
            if (obj) canvas.remove(obj)
            addLineGroupToCanvas(canvas, res.line, width, height)
            canvas.requestRenderAll()
          }
        })
        .catch(() => { setDraggingBreak((prev) => { const n = { ...prev }; delete n[lineId]; return n }) })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [height, width, token])

  // ── Scene marker rename ───────────────────────────────────────────────────

  function handleMarkerRename(id: string, name: string) {
    setEditingMarkerId(null)
    const trimmed = name.trim()
    if (!token) return
    scenesApi.update(token, id, { name: trimmed || undefined })
      .then((res) => {
        setMarkers((prev) => prev.map((m) => m.id === id ? res.marker : m))
        onSceneMarkersChanged?.()
      }).catch(() => {})
  }

  // ── Double-click: inline marker edit ─────────────────────────────────────

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return
    function onDblClick(e: { target?: unknown }) {
      const obj = e.target as { data?: { type?: string; id?: string } } | null
      if (obj?.data?.type === 'scene' && obj.data.id) {
        setEditingMarkerId(obj.data.id)
      }
    }
    canvas.on('mouse:dblclick', onDblClick as (e: object) => void)
    return () => { canvas.off('mouse:dblclick', onDblClick as (e: object) => void) }
  })

  // ── Badge update ──────────────────────────────────────────────────────────

  async function handleBadgeUpdate(lineId: string, field: 'shot_type' | 'movement', value: string) {
    const shot = shots.find((s) => s.line_id === lineId)
    if (!shot || !token) return
    try {
      const res = await shotsApi.update(token, shot.id, { [field]: value || null })
      onShotUpdated?.(res.shot)
    } catch { /* ignore */ }
    setActiveBadge(null)
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
      onClick={() => { contextMenu && setContextMenu(null); activeBadge && setActiveBadge(null); editingMarkerId && setEditingMarkerId(null) }}
    >
      <canvas ref={canvasRef} className="fabric-canvas-el" style={{ cursor, touchAction: 'none' }} />

      {/* Scene markers overlay: dashed line + numbered circle badge */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        {[...markers].sort((a, b) => a.y_position - b.y_position).map((m, idx) => {
          const yPx = draggingMarker[m.id] ?? (m.y_position * height)
          const isEditing = editingMarkerId === m.id
          const isSelected = selectedMarkerId === m.id
          return (
            <div key={m.id} style={{ position: 'absolute', top: yPx, left: 0, right: 0 }}>
              <div style={{ position: 'absolute', left: 0, right: 0, borderTop: '1.5px dashed #6b7280' }} />
              <div className={`scene-marker-badge${isSelected ? ' selected' : ''}`}>{idx + 1}</div>
              {isEditing && (
                <input
                  autoFocus
                  className="scene-marker-name-input"
                  defaultValue={m.name ?? ''}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => handleMarkerRename(m.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setEditingMarkerId(null)
                  }}
                  style={{ pointerEvents: 'auto' }}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* Shot labels overlay */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        {labels.map((label) => {
          const x = draggingX[label.lineId] ?? label.x
          const yTop = draggingY[label.lineId]?.yTop ?? label.yTop
          return (
            <div
              key={label.lineId}
              className="shot-label"
              style={{ left: x, top: yTop, transform: 'translateX(-50%) translateY(-100%)', color: label.color, borderColor: label.color, pointerEvents: 'auto', cursor: 'ns-resize' }}
              onPointerDown={(e) => {
                e.stopPropagation()
                e.preventDefault()
                const line = linesRef.current.find((l) => l.id === label.lineId)
                if (!line) return
                yDragRef.current = { lineId: label.lineId, handle: 'start', startClientY: e.clientY, origYNorm: line.y_start, latestYNorm: line.y_start }
              }}
            >
              <span className="shot-label-num">
                {label.sceneNum > 0 ? `${label.sceneNum}/` : ''}{label.shotNum}
              </span>
              {label.shotSize && <span className="shot-label-size">{label.shotSize}</span>}
            </div>
          )
        })}
      </div>

      {/* T/M badges (rotated 45°, next to label box) + end grip */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        {labels.map((label) => {
          const x = draggingX[label.lineId] ?? label.x
          const yTop = draggingY[label.lineId]?.yTop ?? label.yTop
          const yBottom = draggingY[label.lineId]?.yBottom ?? label.yBottom
          const typeActive = activeBadge?.lineId === label.lineId && activeBadge.field === 'shot_type'
          const movActive = activeBadge?.lineId === label.lineId && activeBadge.field === 'movement'
          return (
            <div key={label.lineId}>
              {/* T/M rotated -45° to the right of label box */}
              <div style={{ position: 'absolute', left: x + 6, top: yTop - 4, pointerEvents: 'auto' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, transform: 'rotate(-45deg)', transformOrigin: '0 0' }}>
                  <button
                    className="shot-badge-rotated"
                    style={{ borderColor: label.color, color: typeActive ? '#fff' : label.color, background: typeActive ? label.color : '#fff' }}
                    onClick={(e) => { e.stopPropagation(); setActiveBadge(typeActive ? null : { lineId: label.lineId, field: 'shot_type' }) }}
                  >{label.shotType || 'T'}</button>
                  <button
                    className="shot-badge-rotated"
                    style={{ borderColor: label.color, color: movActive ? '#fff' : label.color, background: movActive ? label.color : '#fff' }}
                    onClick={(e) => { e.stopPropagation(); setActiveBadge(movActive ? null : { lineId: label.lineId, field: 'movement' }) }}
                  >{label.movement ? label.movement.slice(0, 3) : 'M'}</button>
                </div>
                {typeActive && (
                  <div className="badge-popup" style={{ position: 'absolute', top: 0, left: 28, transform: 'none' }}>
                    {SHOT_TYPE_OPTIONS.map((opt) => (
                      <button key={opt || '__empty__'} className={`badge-popup-item${opt === label.shotType ? ' active' : ''}`}
                        onClick={(e) => { e.stopPropagation(); handleBadgeUpdate(label.lineId, 'shot_type', opt) }}
                      >{opt || '—'}</button>
                    ))}
                  </div>
                )}
                {movActive && (
                  <div className="badge-popup" style={{ position: 'absolute', top: 22, left: 28, transform: 'none' }}>
                    {MOVEMENT_OPTIONS.map((opt) => (
                      <button key={opt || '__empty__'} className={`badge-popup-item${opt === label.movement ? ' active' : ''}`}
                        onClick={(e) => { e.stopPropagation(); handleBadgeUpdate(label.lineId, 'movement', opt) }}
                      >{opt || '—'}</button>
                    ))}
                  </div>
                )}
              </div>
              {/* End-bracket drag grip */}
              <div
                style={{ position: 'absolute', left: x, top: yBottom, transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center', padding: '3px 6px', cursor: 'ns-resize', pointerEvents: 'auto' }}
                onPointerDown={(e) => {
                  e.stopPropagation(); e.preventDefault()
                  const line = linesRef.current.find((l) => l.id === label.lineId)
                  if (!line) return
                  yDragRef.current = { lineId: label.lineId, handle: 'end', startClientY: e.clientY, origYNorm: line.y_end, latestYNorm: line.y_end }
                }}
              >
                <div style={{ width: 14, height: 1.5, background: label.color, borderRadius: 1 }} />
                <div style={{ width: 14, height: 1.5, background: label.color, borderRadius: 1 }} />
              </div>
            </div>
          )
        })}
      </div>

      {/* Control nodes overlay — active line (y_start, y_end, break points) */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        {selectedLineId && labels.filter((l) => l.lineId === selectedLineId).map((label) => {
          const line = linesRef.current.find((l) => l.id === selectedLineId)
          if (!line) return null
          const x = draggingX[selectedLineId] ?? label.x
          const yTop = draggingY[selectedLineId]?.yTop ?? label.yTop
          const yBottom = draggingY[selectedLineId]?.yBottom ?? label.yBottom
          const segs = parseSegments(line)
          const breakYs = (draggingBreak[selectedLineId] ?? segs.slice(0, -1).map((s) => s.y_end)).map((yn) => yn * height)
          const node = { width: 10, height: 10, borderRadius: '50%', background: '#fff', border: '2px solid #007AFF', transform: 'translate(-50%, -50%)' }
          const hitbox = (yPx: number) => ({ position: 'absolute' as const, left: x, top: yPx, width: 32, height: 32, borderRadius: '50%', transform: 'translate(-50%, -50%)', cursor: 'ns-resize', pointerEvents: 'auto' as const, background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' })
          return (
            <div key={label.lineId}>
              <div style={hitbox(yTop)} onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); yDragRef.current = { lineId: selectedLineId, handle: 'start', startClientY: e.clientY, origYNorm: line.y_start, latestYNorm: line.y_start } }}>
                <div style={node} />
              </div>
              <div style={hitbox(yBottom)} onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); yDragRef.current = { lineId: selectedLineId, handle: 'end', startClientY: e.clientY, origYNorm: line.y_end, latestYNorm: line.y_end } }}>
                <div style={node} />
              </div>
              {breakYs.map((yPx, idx) => (
                <div key={idx} style={hitbox(yPx)} onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); breakDragRef.current = { lineId: selectedLineId, segIdx: idx, startClientY: e.clientY, origYNorm: segs[idx].y_end, latestYNorm: segs[idx].y_end } }}>
                  <div style={{ ...node, border: '2px solid #007AFF', background: '#e8f0fe' }} />
                </div>
              ))}
            </div>
          )
        })}
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
              Split tại đây
            </button>
          )}
          <button className="ctx-menu-item ctx-menu-danger" onClick={handleContextDelete}>
            {contextMenu.lineId
              ? 'Xóa line + shot'
              : contextMenu.annotationId
              ? 'Xóa annotation'
              : 'Xóa scene marker'}
          </button>
        </div>
      )}
    </div>
  )
})

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
    hoverCursor: 'pointer',
  })
  ;(group as unknown as { data: object }).data = { id: record.id, type: 'line', color: record.color, yStartPx: y1Px, yEndPx: y2Px }
  canvas.add(group)
}

function addSceneMarkerToCanvas(canvas: Canvas, marker: SceneMarker, _w: number, h: number) {
  const y = marker.y_position * h

  // Invisible hit-area circle — visual badge is in the HTML overlay
  const hitArea = new Circle({
    radius: 11,
    fill: 'rgba(0,0,0,0)',
    stroke: 'transparent',
    strokeWidth: 0,
    selectable: false, evented: false,
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const group = new Group([hitArea] as any[], {
    left: 15, top: y,
    originX: 'center', originY: 'center',
    selectable: true, evented: true,
    lockMovementX: true, lockMovementY: false,
    hasControls: false, hasBorders: false,
    hoverCursor: 'ns-resize',
  })
  ;(group as unknown as { data: object }).data = { id: marker.id, type: 'scene' }
  canvas.add(group)
}
