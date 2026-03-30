import { useEffect, useRef, useCallback, useState } from 'react'
import { Canvas, Line, Group } from 'fabric'
import { useAuthStore } from '../../stores/authStore'
import { api } from '../../api/client'
import { scenesApi, type SceneMarker } from '../../api/scenes'
import type { Shot } from '../../api/shots'
import type { LineToolState } from './LineToolbar'

export interface LineCreatedInfo {
  lineId: string
  xPosition: number
  yStart: number
  yEnd: number
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
}

interface LineRecord {
  id: string
  line_type: 'solid' | 'dashed'
  x_position: number
  y_start: number
  y_end: number
  color: string
  setup_number: number | null
}

interface ContextMenuState {
  x: number
  y: number
  lineId: string | null
  markerId: string | null
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

function computeLabels(lines: LineRecord[], markers: SceneMarker[], shots: Shot[], w: number, h: number): ShotLabel[] {
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

export default function ScriptCanvas({
  width, height, scriptId, pageNumber, toolState, shots,
  onLineCreated, onLineDeleted, onSceneMarkersChanged,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fabricRef = useRef<Canvas | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isDrawingRef = useRef(false)
  const startPtRef = useRef<{ x: number; y: number } | null>(null)
  const activeLineRef = useRef<Line | null>(null)
  const { token } = useAuthStore()

  const [lines, setLines] = useState<LineRecord[]>([])
  const [markers, setMarkers] = useState<SceneMarker[]>([])
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  const labels = computeLabels(lines, markers, shots, width, height)

  function getPoint(e: PointerEvent | MouseEvent, canvas: Canvas) {
    const rect = canvas.upperCanvasEl.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const loadAll = useCallback(async (canvas: Canvas) => {
    try {
      const [lineData, markerData] = await Promise.all([
        api.get<{ lines: LineRecord[] }>(`/lines?scriptId=${scriptId}&page=${pageNumber}`, token ?? undefined),
        token ? scenesApi.list(token, scriptId, pageNumber) : Promise.resolve({ markers: [] as SceneMarker[] }),
      ])
      canvas.getObjects().forEach((o) => canvas.remove(o))
      lineData.lines.forEach((l) => addLineToCanvas(canvas, l, width, height))
      markerData.markers.forEach((m) => addSceneMarkerToCanvas(canvas, m, width, height))
      canvas.requestRenderAll()
      setLines(lineData.lines)
      setMarkers(markerData.markers)
    } catch {
      // silently ignore
    }
  }, [scriptId, pageNumber, token, width, height])

  // Init Fabric canvas
  useEffect(() => {
    if (!canvasRef.current) return
    const canvas = new Canvas(canvasRef.current, {
      width, height, selection: toolState.mode === 'select', renderOnAddRemove: true,
    })
    fabricRef.current = canvas
    loadAll(canvas)
    return () => { canvas.dispose(); fabricRef.current = null }
  }, [width, height, scriptId, pageNumber])

  // Sync selection/evented mode
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return
    canvas.selection = toolState.mode === 'select'
    canvas.getObjects().forEach((obj) => {
      obj.selectable = toolState.mode === 'select'
      obj.evented = toolState.mode === 'select'
    })
    canvas.requestRenderAll()
  }, [toolState.mode])

  // Context menu on right-click
  useEffect(() => {
    const upperEl = fabricRef.current?.upperCanvasEl
    if (!upperEl) return
    function onContextMenu(e: MouseEvent) {
      e.preventDefault()
      const canvas = fabricRef.current
      if (!canvas) return
      const hit = canvas.findTarget(e as unknown as MouseEvent)
      if (!hit) { setContextMenu(null); return }
      const data = (hit as unknown as { data?: { id?: string; type?: string } }).data
      if (!data?.id) { setContextMenu(null); return }
      if (data.type === 'scene') {
        setContextMenu({ x: e.clientX, y: e.clientY, lineId: null, markerId: data.id })
      } else {
        setContextMenu({ x: e.clientX, y: e.clientY, lineId: data.id, markerId: null })
      }
    }
    upperEl.addEventListener('contextmenu', onContextMenu)
    return () => upperEl.removeEventListener('contextmenu', onContextMenu)
  })

  // Drawing + scene marker creation pointer events
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return

    function onPointerDown(e: PointerEvent) {
      const canvas = fabricRef.current
      if (!canvas) return
      e.preventDefault()

      if (toolState.mode === 'scene') {
        const pt = getPoint(e, canvas)
        const yNorm = pt.y / height
        if (token) {
          scenesApi.create(token, { scriptId, pageNumber, yPosition: yNorm, xOffset: 0 })
            .then((res) => {
              addSceneMarkerToCanvas(canvas, res.marker, width, height)
              canvas.requestRenderAll()
              setMarkers((prev) => [...prev, res.marker])
              onSceneMarkersChanged?.()
            })
            .catch(() => {})
        }
        return
      }

      if (toolState.mode !== 'draw') return
      const pt = getPoint(e, canvas)
      isDrawingRef.current = true
      startPtRef.current = pt
      const line = new Line([pt.x, pt.y, pt.x, pt.y], {
        stroke: toolState.color, strokeWidth: 2.5,
        strokeDashArray: toolState.lineType === 'dashed' ? [8, 5] : undefined,
        selectable: false, evented: false,
      })
      canvas.add(line)
      activeLineRef.current = line
    }

    function onPointerMove(e: PointerEvent) {
      if (!isDrawingRef.current || !activeLineRef.current || !startPtRef.current) return
      const canvas = fabricRef.current
      if (!canvas) return
      const pt = getPoint(e, canvas)
      activeLineRef.current.set({ x1: startPtRef.current.x, x2: startPtRef.current.x, y2: pt.y })
      canvas.requestRenderAll()
    }

    function onPointerUp(e: PointerEvent) {
      if (!isDrawingRef.current || !activeLineRef.current || !startPtRef.current) return
      const canvas = fabricRef.current
      if (!canvas) return
      isDrawingRef.current = false
      const pt = getPoint(e, canvas)
      const x = startPtRef.current.x
      const yStart = Math.min(startPtRef.current.y, pt.y)
      const yEnd = Math.max(startPtRef.current.y, pt.y)
      if (Math.abs(yEnd - yStart) < 10) {
        canvas.remove(activeLineRef.current)
        canvas.requestRenderAll()
        activeLineRef.current = null
        startPtRef.current = null
        return
      }
      activeLineRef.current = null
      startPtRef.current = null
      const xNorm = x / width
      const yStartNorm = yStart / height
      const yEndNorm = yEnd / height
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(async () => {
        try {
          const res = await api.post<{ line: LineRecord }>(
            '/lines',
            { scriptId, pageNumber, lineType: toolState.lineType, xPosition: xNorm, yStart: yStartNorm, yEnd: yEndNorm, color: toolState.color },
            token ?? undefined,
          )
          setLines((prev) => [...prev, res.line])
          onLineCreated?.({ lineId: res.line.id, xPosition: xNorm, yStart: yStartNorm, yEnd: yEndNorm })
        } catch {}
      }, 500)
    }

    const targetEl = fabricRef.current?.upperCanvasEl ?? el
    targetEl.addEventListener('pointerdown', onPointerDown)
    targetEl.addEventListener('pointermove', onPointerMove)
    targetEl.addEventListener('pointerup', onPointerUp)
    targetEl.addEventListener('pointercancel', onPointerUp)
    return () => {
      targetEl.removeEventListener('pointerdown', onPointerDown)
      targetEl.removeEventListener('pointermove', onPointerMove)
      targetEl.removeEventListener('pointerup', onPointerUp)
      targetEl.removeEventListener('pointercancel', onPointerUp)
    }
  }, [toolState, scriptId, pageNumber, token, width, height])

  // Save scene marker position after drag
  useEffect(() => {
    const canvas = fabricRef.current
    if (!canvas) return
    function onModified(e: { target?: unknown }) {
      const obj = e.target as { data?: { id?: string; type?: string }; left?: number; top?: number } | null
      if (!obj?.data || obj.data.type !== 'scene' || !obj.data.id) return
      const xOff = (obj.left ?? 0) / width
      const yPos = (obj.top ?? 0) / height
      const id = obj.data.id
      if (token) {
        scenesApi.update(token, id, { yPosition: yPos, xOffset: xOff })
          .then(() => {
            setMarkers((prev) => prev.map((m) => m.id === id ? { ...m, y_position: yPos, x_offset: xOff } : m))
            onSceneMarkersChanged?.()
          })
          .catch(() => {})
      }
    }
    canvas.on('object:modified', onModified)
    return () => { canvas.off('object:modified', onModified) }
  })

  // Keyboard delete
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (toolState.mode !== 'select') return
      const canvas = fabricRef.current
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
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [toolState.mode])

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

  function handleContextDelete() {
    if (!contextMenu) return
    if (contextMenu.lineId) deleteLineById(contextMenu.lineId)
    else if (contextMenu.markerId) deleteMarkerById(contextMenu.markerId)
    setContextMenu(null)
  }

  const cursor = toolState.mode === 'draw' ? 'crosshair' : toolState.mode === 'scene' ? 'cell' : 'default'

  return (
    <div
      className="script-canvas-wrapper"
      style={{ position: 'absolute', top: 0, left: 0, width, height }}
      onClick={() => contextMenu && setContextMenu(null)}
    >
      <canvas ref={canvasRef} className="fabric-canvas-el" style={{ cursor, touchAction: 'none' }} />

      {/* Shot labels overlay — not interactive */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        {labels.map((label) => (
          <div
            key={label.lineId}
            className="shot-label"
            style={{ left: label.x + 5, top: label.yTop, color: label.color, borderColor: label.color }}
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
          <button className="ctx-menu-item ctx-menu-danger" onClick={handleContextDelete}>
            {contextMenu.lineId ? 'Xóa line + shot' : 'Xóa scene marker'}
          </button>
        </div>
      )}
    </div>
  )
}

function addLineToCanvas(canvas: Canvas, record: LineRecord, w: number, h: number) {
  const x = record.x_position * w
  const y1 = record.y_start * h
  const y2 = record.y_end * h
  const line = new Line([x, y1, x, y2], {
    stroke: record.color,
    strokeWidth: 2.5,
    strokeDashArray: record.line_type === 'dashed' ? [8, 5] : undefined,
    selectable: true,
    evented: true,
  })
  ;(line as unknown as { data: object }).data = { id: record.id, type: 'line' }
  canvas.add(line)
}

function addSceneMarkerToCanvas(canvas: Canvas, marker: SceneMarker, w: number, h: number) {
  const x = marker.x_offset * w
  const y = marker.y_position * h
  // Horizontal arm spanning ~100px to the right from the anchor
  const arm = new Line([0, 0, 100, 0], {
    stroke: '#6b7280', strokeWidth: 1.5, strokeDashArray: [6, 4],
    selectable: false, evented: false,
  })
  // Left-side anchor tick (vertical)
  const tick = new Line([0, -6, 0, 6], {
    stroke: '#6b7280', strokeWidth: 2,
    selectable: false, evented: false,
  })
  // T-handle below tick: vertical stem + horizontal bar
  const tStem = new Line([0, 6, 0, 16], {
    stroke: '#6b7280', strokeWidth: 1.5,
    selectable: false, evented: false,
  })
  const tBar = new Line([-7, 16, 7, 16], {
    stroke: '#6b7280', strokeWidth: 2,
    selectable: false, evented: false,
  })

  const group = new Group([arm, tick, tStem, tBar], {
    left: x, top: y,
    originX: 'left', originY: 'center',
    selectable: true, evented: true,
    lockMovementY: true,   // default: horizontal only; T-handle activates vertical
    hasControls: false, hasBorders: false,
  })
  ;(group as unknown as { data: object }).data = { id: marker.id, type: 'scene' }
  canvas.add(group)
}

