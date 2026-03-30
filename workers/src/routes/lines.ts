import { verifyAuth, isSuperAdmin } from '../middleware/auth'
import { jsonResponse, generateId } from '../utils'
import type { Env } from '../index'

export async function handleLines(request: Request, env: Env): Promise<Response> {
  const user = await verifyAuth(request, env)
  const url = new URL(request.url)
  const parts = url.pathname.replace(/^\/lines/, '').split('/').filter(Boolean)
  // parts[0] = lineId

  // GET /lines?scriptId=&page=
  if (request.method === 'GET' && parts.length === 0) {
    return getLines(url, user, env)
  }
  // POST /lines
  if (request.method === 'POST' && parts.length === 0) {
    return createLine(request, user, env)
  }
  // DELETE /lines/:id
  if (request.method === 'DELETE' && parts.length === 1) {
    return deleteLine(parts[0], user, env)
  }
  // PATCH /lines/:id  (update color, setup_number)
  if (request.method === 'PATCH' && parts.length === 1) {
    return updateLine(parts[0], request, user, env)
  }

  return jsonResponse({ error: 'Not found' }, 404)
}

async function getLines(
  url: URL,
  user: Awaited<ReturnType<typeof verifyAuth>>,
  env: Env,
): Promise<Response> {
  const scriptId = url.searchParams.get('scriptId')
  const page = url.searchParams.get('page')
  const userId = url.searchParams.get('userId') // super_admin can filter by user

  if (!scriptId) return jsonResponse({ error: 'scriptId is required' }, 400)

  // Verify script access
  const access = await checkScriptAccess(scriptId, user.sub, env)
  if (!access && !isSuperAdmin(user)) return jsonResponse({ error: 'Forbidden' }, 403)

  let query: string
  let bindings: (string | number)[]

  if (isSuperAdmin(user) && userId) {
    // Super admin viewing a specific user's lines
    query = page
      ? 'SELECT * FROM script_lines WHERE script_id = ? AND user_id = ? AND page_number = ? ORDER BY created_at ASC'
      : 'SELECT * FROM script_lines WHERE script_id = ? AND user_id = ? ORDER BY page_number ASC, created_at ASC'
    bindings = page ? [scriptId, userId, parseInt(page)] : [scriptId, userId]
  } else if (isSuperAdmin(user)) {
    // Super admin viewing all users' lines (layer view)
    query = page
      ? 'SELECT sl.*, u.name AS user_name FROM script_lines sl JOIN users u ON u.id = sl.user_id WHERE sl.script_id = ? AND sl.page_number = ? ORDER BY sl.created_at ASC'
      : 'SELECT sl.*, u.name AS user_name FROM script_lines sl JOIN users u ON u.id = sl.user_id WHERE sl.script_id = ? ORDER BY sl.page_number ASC, sl.created_at ASC'
    bindings = page ? [scriptId, parseInt(page)] : [scriptId]
  } else {
    // Regular user: only their own lines
    query = page
      ? 'SELECT * FROM script_lines WHERE script_id = ? AND user_id = ? AND page_number = ? ORDER BY created_at ASC'
      : 'SELECT * FROM script_lines WHERE script_id = ? AND user_id = ? ORDER BY page_number ASC, created_at ASC'
    bindings = page ? [scriptId, user.sub, parseInt(page)] : [scriptId, user.sub]
  }

  const stmt = env.DB.prepare(query)
  const result = await stmt.bind(...bindings).all()
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
    lineType?: string
    xPosition?: number
    yStart?: number
    yEnd?: number
    color?: string
    setupNumber?: number
  }
  try { body = await request.json() } catch { return jsonResponse({ error: 'Invalid JSON' }, 400) }

  const { scriptId, pageNumber, lineType, xPosition, yStart, yEnd, color, setupNumber } = body

  if (!scriptId || pageNumber === undefined || !lineType || xPosition === undefined || yStart === undefined || yEnd === undefined) {
    return jsonResponse({ error: 'scriptId, pageNumber, lineType, xPosition, yStart, yEnd are required' }, 400)
  }
  if (lineType !== 'solid' && lineType !== 'dashed') {
    return jsonResponse({ error: 'lineType must be solid or dashed' }, 400)
  }
  if (xPosition < 0 || xPosition > 1 || yStart < 0 || yStart > 1 || yEnd < 0 || yEnd > 1) {
    return jsonResponse({ error: 'Coordinates must be normalized (0-1)' }, 400)
  }

  const access = await checkScriptAccess(scriptId, user.sub, env)
  if (!access && !isSuperAdmin(user)) return jsonResponse({ error: 'Forbidden' }, 403)

  const id = generateId()
  await env.DB.prepare(
    `INSERT INTO script_lines
      (id, script_id, user_id, page_number, line_type, x_position, y_start, y_end, color, setup_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, scriptId, user.sub, pageNumber, lineType,
    xPosition, yStart, yEnd,
    color ?? '#000000',
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

  let body: { color?: string; setupNumber?: number; lineType?: string }
  try { body = await request.json() } catch { return jsonResponse({ error: 'Invalid JSON' }, 400) }

  await env.DB.prepare(
    `UPDATE script_lines SET
      color = COALESCE(?, color),
      setup_number = COALESCE(?, setup_number),
      line_type = COALESCE(?, line_type)
     WHERE id = ?`
  ).bind(body.color ?? null, body.setupNumber ?? null, body.lineType ?? null, lineId).run()

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
