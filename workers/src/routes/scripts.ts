import { verifyAuth, isSuperAdmin } from '../middleware/auth'
import { jsonResponse } from '../utils'
import { generateId } from '../utils'
import type { Env } from '../index'

const MAX_PDF_SIZE = 50 * 1024 * 1024 // 50MB

export async function handleScripts(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const parts = url.pathname.replace(/^\/scripts/, '').split('/').filter(Boolean)
  // parts[0] = scriptId or 'upload', parts[1] = 'pdf'

  // POST /scripts/upload — multipart form upload
  if (request.method === 'POST' && parts[0] === 'upload') {
    const user = await verifyAuth(request, env)
    return uploadScript(request, user, env)
  }

  // GET /scripts/:id/pdf — stream from R2 (no auth required — URL is private by design)
  if (request.method === 'GET' && parts[1] === 'pdf') {
    const user = await verifyAuth(request, env)
    return streamPdf(parts[0], user, env)
  }

  // GET /scripts?projectId=
  if (request.method === 'GET' && parts.length === 0) {
    const user = await verifyAuth(request, env)
    return listScripts(url, user, env)
  }

  // DELETE /scripts/:id
  if (request.method === 'DELETE' && parts.length === 1) {
    const user = await verifyAuth(request, env)
    return deleteScript(parts[0], user, env)
  }

  return jsonResponse({ error: 'Not found' }, 404)
}

async function uploadScript(request: Request, user: Awaited<ReturnType<typeof verifyAuth>>, env: Env): Promise<Response> {
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return jsonResponse({ error: 'Expected multipart/form-data' }, 400)
  }

  const projectId = formData.get('projectId') as string | null
  const name = formData.get('name') as string | null
  const file = formData.get('file') as File | null

  if (!projectId || !name || !file) {
    return jsonResponse({ error: 'projectId, name, and file are required' }, 400)
  }
  if (file.type !== 'application/pdf') {
    return jsonResponse({ error: 'Only PDF files are accepted' }, 400)
  }
  if (file.size > MAX_PDF_SIZE) {
    return jsonResponse({ error: 'File size exceeds 50MB limit' }, 400)
  }

  // Check project access
  const project = await env.DB.prepare('SELECT id, owner_id FROM projects WHERE id = ?').bind(projectId).first<{ id: string; owner_id: string }>()
  if (!project) return jsonResponse({ error: 'Project not found' }, 404)

  if (!isSuperAdmin(user)) {
    const access = await env.DB.prepare(
      'SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?'
    ).bind(projectId, user.sub).first()
    if (!access && project.owner_id !== user.sub) return jsonResponse({ error: 'Forbidden' }, 403)
  }

  const scriptId = generateId()
  const r2Key = `${user.sub}/${projectId}/${scriptId}/${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`

  const arrayBuffer = await file.arrayBuffer()
  await env.SCRIPTS_BUCKET.put(r2Key, arrayBuffer, {
    httpMetadata: { contentType: 'application/pdf' },
  })

  await env.DB.prepare(
    'INSERT INTO scripts (id, project_id, name, r2_key, uploaded_by) VALUES (?, ?, ?, ?, ?)'
  ).bind(scriptId, projectId, name.trim(), r2Key, user.sub).run()

  const script = await env.DB.prepare('SELECT * FROM scripts WHERE id = ?').bind(scriptId).first()
  return jsonResponse({ script }, 201)
}

async function streamPdf(scriptId: string, user: Awaited<ReturnType<typeof verifyAuth>>, env: Env): Promise<Response> {
  const script = await env.DB.prepare(
    'SELECT s.*, p.owner_id FROM scripts s JOIN projects p ON p.id = s.project_id WHERE s.id = ?'
  ).bind(scriptId).first<{ r2_key: string; project_id: string; owner_id: string }>()

  if (!script) return jsonResponse({ error: 'Script not found' }, 404)

  // Check access
  if (!isSuperAdmin(user)) {
    const access = await env.DB.prepare(
      'SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?'
    ).bind(script.project_id, user.sub).first()
    if (!access && script.owner_id !== user.sub) return jsonResponse({ error: 'Forbidden' }, 403)
  }

  const object = await env.SCRIPTS_BUCKET.get(script.r2_key)
  if (!object) return jsonResponse({ error: 'File not found in storage' }, 404)

  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

async function listScripts(url: URL, user: Awaited<ReturnType<typeof verifyAuth>>, env: Env): Promise<Response> {
  const projectId = url.searchParams.get('projectId')
  if (!projectId) return jsonResponse({ error: 'projectId is required' }, 400)

  // Check project access
  const project = await env.DB.prepare('SELECT id, owner_id FROM projects WHERE id = ?').bind(projectId).first<{ id: string; owner_id: string }>()
  if (!project) return jsonResponse({ error: 'Project not found' }, 404)

  if (!isSuperAdmin(user)) {
    const access = await env.DB.prepare(
      'SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?'
    ).bind(projectId, user.sub).first()
    if (!access && project.owner_id !== user.sub) return jsonResponse({ error: 'Forbidden' }, 403)
  }

  const result = await env.DB.prepare(
    'SELECT id, name, page_count, uploaded_by, created_at FROM scripts WHERE project_id = ? ORDER BY created_at DESC'
  ).bind(projectId).all()

  return jsonResponse({ scripts: result.results })
}

async function deleteScript(scriptId: string, user: Awaited<ReturnType<typeof verifyAuth>>, env: Env): Promise<Response> {
  const script = await env.DB.prepare(
    'SELECT s.*, p.owner_id AS project_owner FROM scripts s JOIN projects p ON p.id = s.project_id WHERE s.id = ?'
  ).bind(scriptId).first<{ r2_key: string; uploaded_by: string; project_owner: string }>()

  if (!script) return jsonResponse({ error: 'Script not found' }, 404)

  // Only uploader, project owner, or super_admin can delete
  if (!isSuperAdmin(user) && script.uploaded_by !== user.sub && script.project_owner !== user.sub) {
    return jsonResponse({ error: 'Forbidden' }, 403)
  }

  // Delete from R2 first
  await env.SCRIPTS_BUCKET.delete(script.r2_key)
  // Delete from DB (cascades to lines, annotations, shots)
  await env.DB.prepare('DELETE FROM scripts WHERE id = ?').bind(scriptId).run()

  return jsonResponse({ success: true })
}
