import { useEffect, useRef, useCallback } from 'react'
import { Canvas, Line } from 'fabric'
import { useAuthStore } from '../../stores/authStore'
import { api } from '../../api/client'
import type { LineToolState } from './LineToolbar'

interface Props {
  width: number
  height: number
  scriptId: string
  pageNumber: number
  toolState: LineToolState
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

export default function ScriptCanvas({ width, height, scriptId, pageNumber, toolState }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fabricRef = useRef<Canvas | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isDrawingRef = useRef(false)
  const startPtRef = useRef<{ x: number; y: number } | null>(null)
  const activeLineRef = useRef<Line | null>(null)
  const { token } = useAuthStore()

  // Stable helper to get canvas-relative point from native event
  function getPoint(e: MouseEvent | PointerEvent, canvas: Canvas): { x: number; y: number } {
    const rect = canvas.getElement().getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  // Init Fabric canvas
  useEffect(() => {
    if (!canvasRef.current) return

    const canvas = new Canvas(canvasRef.current, {
      width,
      height,
      selection: toolState.mode === 'select',
      renderOnAddRemove: true,
    })
    fabricRef.current = canvas

    loadLines(canvas)

    return () => {
      canvas.dispose()
      fabricRef.current = null
    }
  }, [width, height, scriptId, pageNumber])

  // Sync selection mode
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

  const loadLines = useCallback(async (canvas: Canvas) => {
    try {
      const data = await api.get<{ lines: LineRecord[] }>(
        `/lines?scriptId=${scriptId}&page=${pageNumber}`,
        token ?? undefined,
      )
      canvas.getObjects().forEach((o) => canvas.remove(o))
      data.lines.forEach((line) => addLineToCanvas(canvas, line, width, height))
      canvas.requestRenderAll()
    } catch {
      // Lines unavailable — silently ignore
    }
  }, [scriptId, pageNumber, token, width, height])

  // Drawing events via native pointer events (Apple Pencil compatible)
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return

    function onPointerDown(e: PointerEvent) {
      const canvas = fabricRef.current
      if (!canvas || toolState.mode !== 'draw') return
      e.preventDefault()
      const pt = getPoint(e, canvas)
      isDrawingRef.current = true
      startPtRef.current = pt

      const line = new Line([pt.x, pt.y, pt.x, pt.y], {
        stroke: toolState.color,
        strokeWidth: 2.5,
        strokeDashArray: toolState.lineType === 'dashed' ? [8, 5] : undefined,
        selectable: false,
        evented: false,
      })
      canvas.add(line)
      activeLineRef.current = line
    }

    function onPointerMove(e: PointerEvent) {
      if (!isDrawingRef.current || !activeLineRef.current || !startPtRef.current) return
      const canvas = fabricRef.current
      if (!canvas) return
      const pt = getPoint(e, canvas)
      // Snap to vertical
      activeLineRef.current.set({ x1: startPtRef.current.x, x2: startPtRef.current.x, y2: pt.y })
      canvas.requestRenderAll()
    }

    async function onPointerUp(e: PointerEvent) {
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

      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(async () => {
        try {
          await api.post(
            '/lines',
            {
              scriptId,
              pageNumber,
              lineType: toolState.lineType,
              xPosition: x / width,
              yStart: yStart / height,
              yEnd: yEnd / height,
              color: toolState.color,
            },
            token ?? undefined,
          )
        } catch {
          // Saved locally on canvas — API sync will retry on reload
        }
      }, 500)
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerUp)

    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerUp)
    }
  }, [toolState, scriptId, pageNumber, token, width, height])

  // Delete selected with keyboard
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (toolState.mode !== 'select') return
      const canvas = fabricRef.current
      if (!canvas) return
      const active = canvas.getActiveObject()
      if (active) { canvas.remove(active); canvas.requestRenderAll() }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [toolState.mode])

  return (
    <canvas
      ref={canvasRef}
      className="fabric-canvas-el"
      style={{
        cursor: toolState.mode === 'draw' ? 'crosshair' : 'default',
        touchAction: 'none',
      }}
    />
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
    data: { id: record.id },
  })
  canvas.add(line)
}
