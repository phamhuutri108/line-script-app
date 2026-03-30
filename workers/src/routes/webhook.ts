import { jsonResponse } from '../utils'
import type { Env } from '../index'

interface WebhookBody {
  secret?: string
  rowIndex?: number
  data?: {
    shot_number?: number
    scene_number?: string
    location?: string
    int_ext?: string
    day_night?: string
    description?: string
    dialogue?: string
    shot_size?: string
    angle?: string
    movement?: string
    lens?: string
    notes?: string
  }
}

export async function handleWebhook(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname.replace(/^\/webhook/, '')

  if (request.method === 'POST' && path === '/sheets') {
    return handleSheetsWebhook(request, env)
  }

  return jsonResponse({ error: 'Not found' }, 404)
}

async function handleSheetsWebhook(request: Request, env: Env): Promise<Response> {
  let body: WebhookBody
  try { body = await request.json() } catch { return jsonResponse({ error: 'Invalid JSON' }, 400) }

  // Verify webhook secret
  if (!body.secret || body.secret !== env.WEBHOOK_SECRET) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  if (!body.rowIndex || !body.data) {
    return jsonResponse({ error: 'rowIndex and data required' }, 400)
  }

  // Find shot by sheets_row_index
  const shot = await env.DB.prepare(
    'SELECT * FROM shots WHERE sheets_row_index = ?'
  ).bind(body.rowIndex).first<{ id: string }>()

  if (!shot) return jsonResponse({ error: 'Shot not found for row ' + body.rowIndex }, 404)

  const d = body.data
  await env.DB.prepare(`
    UPDATE shots SET
      scene_number = COALESCE(?, scene_number),
      location     = COALESCE(?, location),
      int_ext      = COALESCE(?, int_ext),
      day_night    = COALESCE(?, day_night),
      description  = COALESCE(?, description),
      dialogue     = COALESCE(?, dialogue),
      shot_size    = COALESCE(?, shot_size),
      angle        = COALESCE(?, angle),
      movement     = COALESCE(?, movement),
      lens         = COALESCE(?, lens),
      notes        = COALESCE(?, notes),
      updated_at   = unixepoch()
    WHERE id = ?
  `).bind(
    d.scene_number ?? null, d.location ?? null,
    d.int_ext ?? null, d.day_night ?? null,
    d.description ?? null, d.dialogue ?? null,
    d.shot_size ?? null, d.angle ?? null,
    d.movement ?? null, d.lens ?? null,
    d.notes ?? null, shot.id,
  ).run()

  return jsonResponse({ success: true })
}
