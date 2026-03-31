import { verifyAuth, isSuperAdmin } from '../middleware/auth'
import { jsonResponse, generateId } from '../utils'
import type { Env } from '../index'

export async function handleLines(request: Request, env: Env): Promise<Response> {
  const user = await verifyAuth(request, env)
  const url = new URL(request.url)
  const parts = url.pathname.replace(/^\/lines/, '').split('/').filter(Boolean)

  if (request.method === 'GET' && parts.length === 0) return getLines(url, user, env)
  if (request.method === 'POST' && parts.length === 0) return createLine(request, user, env)
  if (request.method === 'DELETE' && parts.length === 1) return deleteLine(parts[0], user, env)
  if (request.method === 'PATCH' && parts.length === 1) return updateLine(parts[0], request, user, env)

  return jsonResponse({ error: 'Not found' }, 404)
}

async function getLines(
  url: URL,
  user: Awaited<ReturnType<typeof verifyAuth>>,
  env: Env,
): Promise<Response> {
  const scriptId = url.searchParams.get('scriptId')
  const page = url.searchParams.get('page')
  const userId = url.searchParams.get('userId')

  if (!scriptId) return jsonResponse({ error: 'scriptId is required' }, 400)

  const access = await checkScriptAccess(scriptId, user.sub, env)
  if (!access && !isSuperAdmin(user)) return jsonResponse({ error: 'Forbidden' }, 403)

  let query: string
  let bindings: (string | number)[]

  if (isSuperAdmin(user) && userId) {
    query = page
      ? 'SELECT * FROM script_lines WHERE script_id = ? AND user_id = ? AND page_number = ? ORDER BY created_at ASC'
      : 'SELECT * FROM script_lines WHERE script_id = ? AND user_id = ? ORDER BY page_number ASC, created_at ASC'
    bindings = page ? [scriptId, userId, parseInt(page)] : [scriptId, userId]
  } else if (isSuperAdmin(user)) {
    query = page
      ? 'SELECT sl.*, u.name AS user_name FROM script_lines sl JOIN users u ON u.id = sl.user_id WHERE sl.script_id = ? AND sl.page_number = ? ORDER BY sl.created_at ASC'
      : 'SELECT sl.*, u.name AS user_name FROM script_lines sl JOIN users u ON u.id = sl.user_id WHERE sl.script_id = ? ORDER BY sl.page_number ASC, sl.created_at ASC'
    bindings = page ? [scriptId, parseInt(page)] : [scriptId]
  } else {
    query = page
      ? 'SELECT * FROM script_lines WHERE script_id = ? AND user_id = ? AND page_number = ? ORDER BY created_at ASC'
      : 'SELECT * FROM script_lines WHERE script_id = ? AND user_id = ? ORDER BY page_number ASC, created_at ASC'
    bindings = page ? [scriptId, user.sub, parseInt(page)] : [scriptId, user.sub]
  }

  const result = await env.DB.prepare(query).bind(...bindings).all()
  return jsonResponse({ lines: result.results })
}

async function createLine(
  request: Request,
  user: Awaited<ReturnType<typeof verifyAuth>>,
  env: Env,
): Promise<Response> {
  let body: {
    scriptId?: string
    pageNumber?: number
    xPosition?: number
    yStart?: number
    yEnd?: number
    color?: string
    segmentsJson?: string
    continuesNextPage?: boolean
    setupNumber?: string
    // lineType kept for backwards compat but ignored — segments_json is source of truth
    lineType?: string
  }
  try { body = await request.json() } catch { return jsonResponse({ error: 'Invalid JSON' }, 400) }

  const { scriptId, pageNumber, xPosition, yStart, yEnd, color, segmentsJson, continuesNextPage, setupNumber } = body

  if (!scriptId || pageNumber === undefined || xPosition === undefined || yStart === undefined || yEnd === undefined) {
    return jsonResponse({ error: 'scriptId, pageNumber, xPosition, yStart, yEnd are required' }, 400)
  }
  if (xPosition < 0 || xPosition > 1 || yStart < 0 || yStart > 1 || yEnd < 0 || yEnd > 1) {
    return jsonResponse({ error: 'Coordinates must be normalized (0-1)' }, 400)
  }

  const access = await checkScriptAccess(scriptId, user.sub, env)
  if (!access && !isSuperAdmin(user)) return jsonResponse({ error: 'Forbidden' }, 403)

  // Auto-detect if this line is a continuation from the previous page
  let continuesFromPrev = 0
  if (pageNumber > 1) {
    const prevLine = await env.DB.prepare(
      `SELECT id FROM script_lines
       WHERE script_id = ? AND user_id = ? AND page_number = ?
         AND continues_to_next_page = 1
         AND ABS(x_position - ?) < 0.03
       LIMIT 1`
    ).bind(scriptId, user.sub, pageNumber - 1, xPosition).first()
    if (prevLine) continuesFromPrev = 1
  }

  const id = generateId()
  await env.DB.prepare(
    `INSERT INTO script_lines
      (id, script_id, user_id, page_number, line_type, x_position, y_start, y_end,
       color, segments_json, continues_to_next_page, continues_from_prev_page, setup_number)
     VALUES (?, ?, ?, ?, 'solid', ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, scriptId, user.sub, pageNumber,
    xPosition, yStart, yEnd,
    color ?? '#000000',
    segmentsJson ?? null,
    continuesNextPage ? 1 : 0,
    continuesFromPrev,
    setupNumber ?? null,
  ).run()

  const line = await env.DB.prepare('SELECT * FROM script_lines WHERE id = ?').bind(id).first()
  return jsonResponse({ line }, 201)
}

async function updateLine(
  lineId: string,
  request: Request,
  user: Awaited<ReturnType<typeof verifyAuth>>,
  env: Env,
): Promise<Response> {
  const line = await env.DB.prepare('SELECT * FROM script_lines WHERE id = ?').bind(lineId).first<{ user_id: string }>()
  if (!line) return jsonResponse({ error: 'Line not found' }, 404)
  if (!isSuperAdmin(user) && line.user_id !== user.sub) return jsonResponse({ error: 'Forbidden' }, 403)

  let body: {
    color?: string
    setupNumber?: string
    xPosition?: number
    segmentsJson?: string
    continuesNextPage?: boolean
    continuesPrevPage?: boolean
  }
  try { body = await request.json() } catch { return jsonResponse({ error: 'Invalid JSON' }, 400) }

  await env.DB.prepare(
    `UPDATE script_lines SET
      color = COALESCE(?, color),
      setup_number = COALESCE(?, setup_number),
      x_position = COALESCE(?, x_position),
      segments_json = COALESCE(?, segments_json),
      continues_to_next_page = COALESCE(?, continues_to_next_page),
      continues_from_prev_page = COALESCE(?, continues_from_prev_page)
     WHERE id = ?`
  ).bind(
    body.color ?? null,
    body.setupNumber ?? null,
    body.xPosition ?? null,
    body.segmentsJson ?? null,
    body.continuesNextPage !== undefined ? (body.continuesNextPage ? 1 : 0) : null,
    body.continuesPrevPage !== undefined ? (body.continuesPrevPage ? 1 : 0) : null,
    lineId,
  ).run()

  const updated = await env.DB.prepare('SELECT * FROM script_lines WHERE id = ?').bind(lineId).first()
  return jsonResponse({ line: updated })
}

async function deleteLine(
  lineId: string,
  user: Awaited<ReturnType<typeof verifyAuth>>,
  env: Env,
): Promise<Response> {
  const line = await env.DB.prepare('SELECT * FROM script_lines WHERE id = ?').bind(lineId).first<{ user_id: string }>()
  if (!line) return jsonResponse({ error: 'Line not found' }, 404)
  if (!isSuperAdmin(user) && line.user_id !== user.sub) return jsonResponse({ error: 'Forbidden' }, 403)

  await env.DB.prepare('DELETE FROM script_lines WHERE id = ?').bind(lineId).run()
  return jsonResponse({ success: true })
}

async function checkScriptAccess(scriptId: string, userId: string, env: Env): Promise<boolean> {
  const script = await env.DB.prepare(
    `SELECT s.id, p.owner_id
     FROM scripts s JOIN projects p ON p.id = s.project_id
     WHERE s.id = ?`
  ).bind(scriptId).first<{ owner_id: string }>()

  if (!script) return false
  if (script.owner_id === userId) return true

  const member = await env.DB.prepare(
    `SELECT 1 FROM project_members pm
     JOIN scripts s ON s.project_id = pm.project_id
     WHERE s.id = ? AND pm.user_id = ?`
  ).bind(scriptId, userId).first()

  return !!member
}
