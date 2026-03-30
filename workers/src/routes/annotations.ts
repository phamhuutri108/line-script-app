import { verifyAuth, isSuperAdmin } from '../middleware/auth'
import { jsonResponse, generateId } from '../utils'
import type { Env } from '../index'

export async function handleAnnotations(request: Request, env: Env): Promise<Response> {
  const user = await verifyAuth(request, env)
  const url = new URL(request.url)
  const parts = url.pathname.replace(/^\/annotations/, '').split('/').filter(Boolean)

  // GET /annotations?scriptId=&page=&userId=
  if (request.method === 'GET' && parts.length === 0) {
    return getAnnotations(url, user, env)
  }
  // POST /annotations
  if (request.method === 'POST' && parts.length === 0) {
    return createAnnotation(request, user, env)
  }
  // PUT /annotations/:id
  if (request.method === 'PUT' && parts.length === 1) {
    return updateAnnotation(parts[0], request, user, env)
  }
  // DELETE /annotations/:id
  if (request.method === 'DELETE' && parts.length === 1) {
    return deleteAnnotation(parts[0], user, env)
  }

  return jsonResponse({ error: 'Not found' }, 404)
}

async function getAnnotations(
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
      ? 'SELECT * FROM annotations WHERE script_id = ? AND user_id = ? AND page_number = ? ORDER BY created_at ASC'
      : 'SELECT * FROM annotations WHERE script_id = ? AND user_id = ? ORDER BY page_number ASC, created_at ASC'
    bindings = page ? [scriptId, userId, parseInt(page)] : [scriptId, userId]
  } else if (isSuperAdmin(user) && !userId) {
    // Layer view — all users
    query = page
      ? 'SELECT a.*, u.name AS user_name FROM annotations a JOIN users u ON u.id = a.user_id WHERE a.script_id = ? AND a.page_number = ? ORDER BY a.created_at ASC'
      : 'SELECT a.*, u.name AS user_name FROM annotations a JOIN users u ON u.id = a.user_id WHERE a.script_id = ? ORDER BY a.page_number ASC, a.created_at ASC'
    bindings = page ? [scriptId, parseInt(page)] : [scriptId]
  } else {
    query = page
      ? 'SELECT * FROM annotations WHERE script_id = ? AND user_id = ? AND page_number = ? ORDER BY created_at ASC'
      : 'SELECT * FROM annotations WHERE script_id = ? AND user_id = ? ORDER BY page_number ASC, created_at ASC'
    bindings = page ? [scriptId, user.sub, parseInt(page)] : [scriptId, user.sub]
  }

  const result = await env.DB.prepare(query).bind(...bindings).all()
  return jsonResponse({ annotations: result.results })
}

async function createAnnotation(
  request: Request,
  user: Awaited<ReturnType<typeof verifyAuth>>,
  env: Env,
): Promise<Response> {
  let body: {
    scriptId?: string
    pageNumber?: number
    type?: string
    fabricJson?: string
  }
  try { body = await request.json() } catch { return jsonResponse({ error: 'Invalid JSON' }, 400) }

  const { scriptId, pageNumber, type, fabricJson } = body

  if (!scriptId || pageNumber === undefined || !type || !fabricJson) {
    return jsonResponse({ error: 'scriptId, pageNumber, type, fabricJson are required' }, 400)
  }
  if (!['highlight', 'note', 'drawing'].includes(type)) {
    return jsonResponse({ error: 'type must be highlight, note, or drawing' }, 400)
  }

  const access = await checkScriptAccess(scriptId, user.sub, env)
  if (!access && !isSuperAdmin(user)) return jsonResponse({ error: 'Forbidden' }, 403)

  const id = generateId()
  await env.DB.prepare(
    'INSERT INTO annotations (id, script_id, user_id, page_number, type, fabric_json) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, scriptId, user.sub, pageNumber, type, fabricJson).run()

  const annotation = await env.DB.prepare('SELECT * FROM annotations WHERE id = ?').bind(id).first()
  return jsonResponse({ annotation }, 201)
}

async function updateAnnotation(
  annotationId: string,
  request: Request,
  user: Awaited<ReturnType<typeof verifyAuth>>,
  env: Env,
): Promise<Response> {
  const annotation = await env.DB.prepare('SELECT * FROM annotations WHERE id = ?').bind(annotationId).first<{ user_id: string }>()
  if (!annotation) return jsonResponse({ error: 'Annotation not found' }, 404)
  if (!isSuperAdmin(user) && annotation.user_id !== user.sub) return jsonResponse({ error: 'Forbidden' }, 403)

  let body: { fabricJson?: string }
  try { body = await request.json() } catch { return jsonResponse({ error: 'Invalid JSON' }, 400) }
  if (!body.fabricJson) return jsonResponse({ error: 'fabricJson is required' }, 400)

  await env.DB.prepare('UPDATE annotations SET fabric_json = ? WHERE id = ?').bind(body.fabricJson, annotationId).run()

  const updated = await env.DB.prepare('SELECT * FROM annotations WHERE id = ?').bind(annotationId).first()
  return jsonResponse({ annotation: updated })
}

async function deleteAnnotation(
  annotationId: string,
  user: Awaited<ReturnType<typeof verifyAuth>>,
  env: Env,
): Promise<Response> {
  const annotation = await env.DB.prepare('SELECT * FROM annotations WHERE id = ?').bind(annotationId).first<{ user_id: string }>()
  if (!annotation) return jsonResponse({ error: 'Annotation not found' }, 404)
  if (!isSuperAdmin(user) && annotation.user_id !== user.sub) return jsonResponse({ error: 'Forbidden' }, 403)

  await env.DB.prepare('DELETE FROM annotations WHERE id = ?').bind(annotationId).run()
  return jsonResponse({ success: true })
}

async function checkScriptAccess(scriptId: string, userId: string, env: Env): Promise<boolean> {
  const script = await env.DB.prepare(
    'SELECT s.id, p.owner_id FROM scripts s JOIN projects p ON p.id = s.project_id WHERE s.id = ?'
  ).bind(scriptId).first<{ owner_id: string }>()

  if (!script) return false
  if (script.owner_id === userId) return true

  const member = await env.DB.prepare(
    'SELECT 1 FROM project_members pm JOIN scripts s ON s.project_id = pm.project_id WHERE s.id = ? AND pm.user_id = ?'
  ).bind(scriptId, userId).first()

  return !!member
}
