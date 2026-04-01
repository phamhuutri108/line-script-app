# Batch 4 — Handoff Report (GitHub Copilot)

## Đã xong

### 1. Backend — `workers/src/routes/lines.ts`
- Hàm `updateLine` (PATCH `/lines/:id`) đã được thêm `yStart` và `yEnd` vào body type và SQL UPDATE.
- **Deploy lên Cloudflare Worker còn thiếu.**

### 2. Frontend — `frontend/src/components/viewer/ScriptCanvas.tsx`

Các phần đã xong và không bị lỗi:
- Thêm `linesRef` và `yDragRef` refs (sau dòng ref block cũ)
- Thêm state `draggingY` (kiểu `Record<string, { yTop: number; yBottom: number }>`)
- Thêm `linesRef.current = lines` sync trước `computeLabels`
- Thêm `useEffect` cho window `pointermove`/`pointerup` xử lý y-drag:
  - Gọi `api.patch('/lines/:id', { yStart, yEnd, segmentsJson })` khi thả
  - Cập nhật `segments_json` (boundary đầu/cuối của segment đầu/cuối)
  - Redraw canvas: remove object cũ → `addLineGroupToCanvas(res.line)`
- Thêm proximity check trước `api.post('/lines', ...)`: block nếu `startX` cách line cũ < 12px
- **Shot labels overlay**: dùng `draggingY[label.lineId]?.yTop ?? label.yTop` cho `top`, thêm `onPointerDown` → set `yDragRef` với `handle: 'start'`, `cursor: 'ns-resize'` ✅

---

## Còn lỗi — cần fix ngay

**Shot badges overlay** (khoảng dòng 1234–1299 trong ScriptCanvas.tsx) bị **broken JSX**: thẻ `<div>` wrapper ngoài cùng không có closing tag `</div>` trước dấu `)`. Gây lỗi parse toàn bộ phần sau (kể cả hàm `addLineGroupToCanvas`).

### Code bị lỗi hiện tại (dòng ~1241):

```jsx
return (
  <div key={label.lineId} style={{ position: 'absolute', left: x, top: yBottom, transform: 'translateX(-50%)' }}>
    {/* End-bracket drag grip */}
    <div style={{ ... }} onPointerDown={...}>
      <div style={{ width: 14, height: 1.5, background: label.color, borderRadius: 1 }} />
      <div style={{ width: 14, height: 1.5, background: label.color, borderRadius: 1 }} />
    </div>
  <div className="shot-badges-group" style={{ left: 'unset', top: 'unset', position: 'relative', transform: 'none' }}>
    ... badges (T / M buttons + popups) ...
  </div>
  {/* ← THIẾU </div> để đóng wrapper ngoài cùng */}
)
```

### Code đúng cần thay thế toàn bộ block `{/* Shot badges overlay */}` thành:

```jsx
{/* Shot badges overlay (Type + Movement near end bracket) */}
<div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
  {labels.map((label) => {
    const x = draggingX[label.lineId] ?? label.x
    const yBottom = draggingY[label.lineId]?.yBottom ?? label.yBottom
    const typeActive = activeBadge?.lineId === label.lineId && activeBadge.field === 'shot_type'
    const movActive = activeBadge?.lineId === label.lineId && activeBadge.field === 'movement'
    return (
      <div key={label.lineId} style={{ position: 'absolute', left: x, top: yBottom, transform: 'translateX(-50%)' }}>
        {/* End-bracket drag grip */}
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center', padding: '3px 6px', cursor: 'ns-resize', pointerEvents: 'auto' }}
          onPointerDown={(e) => {
            e.stopPropagation()
            e.preventDefault()
            const line = linesRef.current.find((l) => l.id === label.lineId)
            if (!line) return
            yDragRef.current = { lineId: label.lineId, handle: 'end', startClientY: e.clientY, origYNorm: line.y_end, latestYNorm: line.y_end }
          }}
        >
          <div style={{ width: 14, height: 1.5, background: label.color, borderRadius: 1 }} />
          <div style={{ width: 14, height: 1.5, background: label.color, borderRadius: 1 }} />
        </div>
        <div className="shot-badges-group" style={{ position: 'relative', transform: 'none' }}>
          <div style={{ position: 'relative' }}>
            <button
              className="shot-badge"
              style={{ borderColor: label.color, color: typeActive ? 'white' : label.color, background: typeActive ? label.color : 'white' }}
              onClick={(e) => { e.stopPropagation(); setActiveBadge(typeActive ? null : { lineId: label.lineId, field: 'shot_type' }) }}
            >
              {label.shotType || 'T'}
            </button>
            {typeActive && (
              <div className="badge-popup">
                {SHOT_TYPE_OPTIONS.map((opt) => (
                  <button key={opt || '__empty__'} className={`badge-popup-item${opt === label.shotType ? ' active' : ''}`}
                    onClick={(e) => { e.stopPropagation(); handleBadgeUpdate(label.lineId, 'shot_type', opt) }}
                  >{opt || '—'}</button>
                ))}
              </div>
            )}
          </div>
          <div style={{ position: 'relative' }}>
            <button
              className="shot-badge"
              style={{ borderColor: label.color, color: movActive ? 'white' : label.color, background: movActive ? label.color : 'white' }}
              onClick={(e) => { e.stopPropagation(); setActiveBadge(movActive ? null : { lineId: label.lineId, field: 'movement' }) }}
            >
              {label.movement ? label.movement.slice(0, 3) : 'M'}
            </button>
            {movActive && (
              <div className="badge-popup">
                {MOVEMENT_OPTIONS.map((opt) => (
                  <button key={opt || '__empty__'} className={`badge-popup-item${opt === label.movement ? ' active' : ''}`}
                    onClick={(e) => { e.stopPropagation(); handleBadgeUpdate(label.lineId, 'movement', opt) }}
                  >{opt || '—'}</button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>   {/* ← closing tag cho wrapper ngoài cùng — dòng này đang bị thiếu */}
    )
  })}
</div>
```

---

## Còn thiếu sau khi fix JSX

1. **Deploy backend** — `cd workers && npx wrangler deploy`
2. **Build + deploy frontend** — `cd frontend && npm run build && npx wrangler pages deploy dist --project-name=script-lining`

---

## Tóm tắt files đã chỉnh sửa

| File | Thay đổi |
|------|----------|
| `workers/src/routes/lines.ts` | PATCH endpoint hỗ trợ `yStart`/`yEnd` |
| `frontend/src/components/viewer/ScriptCanvas.tsx` | Refs, state, useEffect y-drag, proximity check, label drag, badges overlay (cần fix closing tag) |
