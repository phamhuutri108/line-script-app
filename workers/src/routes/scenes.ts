import { verifyAuth } from '../middleware/auth'
import { jsonResponse, generateId } from '../utils'
import type { Env } from '../index'

export async function handleScenes(request: Request, env: Env): Promise<Response> {
  const user = await verifyAuth(request, env)
  const url = new URL(request.url)
  const parts = url.pathname.replace(/^\/scenes/, '').split('/').filter(Boolean)

  // GET /scenes?scriptId=&page=
  if (request.method === 'GET' && parts.length === 0) {
    const scriptId = url.searchParams.get('scriptId')
    const page = url.searchParams.get('page')
    if (!scriptId) return jsonResponse({ error: 'scriptId required' }, 400)
    const query = page
      ? 'SELECT * FROM scene_markers WHERE script_id = ? AND user_id = ? AND page_number = ? ORDER BY y_position ASC'
      : 'SELECT * FROM scene_markers WHERE script_id = ? AND user_id = ? ORDER BY page_number ASC, y_position ASC'
    const bindings = page ? [scriptId, user.sub, parseInt(page)] : [scriptId, user.sub]
    const result = await (env.DB.prepare(query) as ReturnType<typeof env.DB.prepare>).bind(...bindings).all()
    return jsonResponse({ markers: result.results })
  }

  // POST /scenes
  if (request.method === 'POST' && parts.length === 0) {
    let body: { scriptId?: string; pageNumber?: number; yPosition?: number; xOffset?: number }
    try { body = await request.json() } catch { return jsonResponse({ error: 'Invalid JSON' }, 400) }
    const { scriptId, pageNumber, yPosition, xOffset } = body
    if (!scriptId || pageNumber === undefined || yPosition === undefined) {
      return jsonResponse({ error: 'scriptId, pageNumber, yPosition required' }, 400)
    }
    const id = generateId()
    await env.DB.prepare(
      'INSERT INTO scene_markers (id, script_id, user_id, page_number, y_position, x_offset) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(id, scriptId, user.sub, pageNumber, yPosition, xOffset ?? 0).run()
    const marker = await env.DB.prepare('SELECT * FROM scene_markers WHERE id = ?').bind(id).first()
    return jsonResponse({ marker }, 201)
  }

  // PATCH /scenes/:id  (update y_position or x_offset after drag)
  if (request.method === 'PATCH' && parts.length === 1) {
    const existing = await env.DB.prepare(
      'SELECT user_id FROM scene_markers WHERE id = ?'
    ).bind(parts[0]).first<{ user_id: string }>()
    if (!existing) return jsonResponse({ error: 'Not found' }, 404)
    if (existing.user_id !== user.sub) return jsonResponse({ error: 'Forbidden' }, 403)

    let body: { yPosition?: number; xOffset?: number }
    try { body = await request.json() } catch { return jsonResponse({ error: 'Invalid JSON' }, 400) }

    if (body.yPosition !== undefined) {
      await env.DB.prepare('UPDATE scene_markers SET y_position = ? WHERE id = ?')
        .bind(body.yPosition, parts[0]).run()
    }
    if (body.xOffset !== undefined) {
      await env.DB.prepare('UPDATE scene_markers SET x_offset = ? WHERE id = ?')
        .bind(body.xOffset, parts[0]).run()
    }
    const marker = await env.DB.prepare('SELECT * FROM scene_markers WHERE id = ?').bind(parts[0]).first()
    return jsonResponse({ marker })
  }

  // DELETE /scenes/:id
  if (request.method === 'DELETE' && parts.length === 1) {
    const existing = await env.DB.prepare(
      'SELECT user_id FROM scene_markers WHERE id = ?'
    ).bind(parts[0]).first<{ user_id: string }>()
    if (!existing) return jsonResponse({ error: 'Not found' }, 404)
    if (existing.user_id !== user.sub) return jsonResponse({ error: 'Forbidden' }, 403)
    await env.DB.prepare('DELETE FROM scene_markers WHERE id = ?').bind(parts[0]).run()
    return jsonResponse({ success: true })
  }

  return jsonResponse({ error: 'Not found' }, 404)
}
