import { verifyAuth, isSuperAdmin, requireOwnerOrAbove } from '../middleware/auth'
import { jsonResponse } from '../utils'
import { generateId } from '../utils'
import type { Env } from '../index'

export async function handleProjects(request: Request, env: Env): Promise<Response> {
  const user = await verifyAuth(request, env)
  const url = new URL(request.url)
  const parts = url.pathname.replace(/^\/projects/, '').split('/').filter(Boolean)
  // parts[0] = projectId, parts[1] = 'members', parts[2] = memberId

  // GET /projects
  if (request.method === 'GET' && parts.length === 0) {
    return listProjects(user, env)
  }
  // POST /projects
  if (request.method === 'POST' && parts.length === 0) {
    requireOwnerOrAbove(user)
    return createProject(request, user, env)
  }
  // GET /projects/trash
  if (request.method === 'GET' && parts[0] === 'trash' && parts.length === 1) {
    return listTrash(user, env)
  }
  // GET /projects/:id
  if (request.method === 'GET' && parts.length === 1) {
    return getProject(parts[0], user, env)
  }
  // PUT /projects/:id
  if (request.method === 'PUT' && parts.length === 1) {
    return updateProject(parts[0], request, user, env)
  }
  // DELETE /projects/:id
  if (request.method === 'DELETE' && parts.length === 1) {
    return softDeleteProject(parts[0], user, env)
  }
  // POST /projects/:id/restore
  if (request.method === 'POST' && parts[1] === 'restore') {
    return restoreProject(parts[0], user, env)
  }
  // DELETE /projects/:id/permanent
  if (request.method === 'DELETE' && parts[1] === 'permanent') {
    return permanentDeleteProject(parts[0], user, env)
  }
  // POST /projects/:id/members
  if (request.method === 'POST' && parts[1] === 'members') {
    return addMember(parts[0], request, user, env)
  }
  // DELETE /projects/:id/members/:userId
  if (request.method === 'DELETE' && parts[1] === 'members' && parts[2]) {
    return removeMember(parts[0], parts[2], user, env)
  }

  return jsonResponse({ error: 'Not found' }, 404)
}

async function listProjects(user: Awaited<ReturnType<typeof verifyAuth>>, env: Env): Promise<Response> {
  let rows

  if (isSuperAdmin(user)) {
    const result = await env.DB.prepare(`
      SELECT p.*, u.name AS owner_name,
        (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) AS member_count,
        (SELECT COUNT(*) FROM scripts s WHERE s.project_id = p.id) AS script_count
      FROM projects p
      LEFT JOIN users u ON u.id = p.owner_id
      WHERE p.deleted_at IS NULL
      ORDER BY p.created_at DESC
    `).all()
    rows = result.results
  } else {
    const result = await env.DB.prepare(`
      SELECT p.*, u.name AS owner_name,
        (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) AS member_count,
        (SELECT COUNT(*) FROM scripts s WHERE s.project_id = p.id) AS script_count
      FROM projects p
      LEFT JOIN users u ON u.id = p.owner_id
      WHERE p.deleted_at IS NULL AND (p.owner_id = ? OR p.id IN (
        SELECT project_id FROM project_members WHERE user_id = ?
      ))
      ORDER BY p.created_at DESC
    `).bind(user.sub, user.sub).all()
    rows = result.results
  }

  return jsonResponse({ projects: rows })
}

async function listTrash(user: Awaited<ReturnType<typeof verifyAuth>>, env: Env): Promise<Response> {
  const expiry = Math.floor(Date.now() / 1000) - 30 * 86400

  // Auto-purge projects in trash for more than 30 days
  if (isSuperAdmin(user)) {
    await env.DB.prepare('DELETE FROM projects WHERE deleted_at IS NOT NULL AND deleted_at < ?').bind(expiry).run()
  } else {
    await env.DB.prepare('DELETE FROM projects WHERE deleted_at IS NOT NULL AND deleted_at < ? AND owner_id = ?').bind(expiry, user.sub).run()
  }

  let rows
  if (isSuperAdmin(user)) {
    const result = await env.DB.prepare(`
      SELECT p.*, u.name AS owner_name
      FROM projects p
      LEFT JOIN users u ON u.id = p.owner_id
      WHERE p.deleted_at IS NOT NULL
      ORDER BY p.deleted_at DESC
    `).all()
    rows = result.results
  } else {
    const result = await env.DB.prepare(`
      SELECT p.*, u.name AS owner_name
      FROM projects p
      LEFT JOIN users u ON u.id = p.owner_id
      WHERE p.deleted_at IS NOT NULL AND p.owner_id = ?
      ORDER BY p.deleted_at DESC
    `).bind(user.sub).all()
    rows = result.results
  }

  return jsonResponse({ projects: rows })
}

async function createProject(request: Request, user: Awaited<ReturnType<typeof verifyAuth>>, env: Env): Promise<Response> {
  let body: { name?: string; description?: string }
  try { body = await request.json() } catch { return jsonResponse({ error: 'Invalid JSON' }, 400) }

  if (!body.name?.trim()) return jsonResponse({ error: 'name is required' }, 400)

  const id = generateId()
  await env.DB.prepare(
    'INSERT INTO projects (id, name, description, owner_id) VALUES (?, ?, ?, ?)'
  ).bind(id, body.name.trim(), body.description ?? null, user.sub).run()

  // Owner is automatically a member
  await env.DB.prepare(
    'INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)'
  ).bind(id, user.sub).run()

  const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first()
  return jsonResponse({ project }, 201)
}

async function getProject(projectId: string, user: Awaited<ReturnType<typeof verifyAuth>>, env: Env): Promise<Response> {
  const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first()
  if (!project) return jsonResponse({ error: 'Project not found' }, 404)

  // Check access
  if (!isSuperAdmin(user)) {
    const access = await env.DB.prepare(
      'SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?'
    ).bind(projectId, user.sub).first()
    const isOwner = (project as { owner_id: string }).owner_id === user.sub
    if (!access && !isOwner) return jsonResponse({ error: 'Forbidden' }, 403)
  }

  const members = await env.DB.prepare(`
    SELECT u.id, u.name, u.email, u.role
    FROM project_members pm
    JOIN users u ON u.id = pm.user_id
    WHERE pm.project_id = ?
  `).bind(projectId).all()

  const scripts = await env.DB.prepare(
    'SELECT id, name, page_count, created_at FROM scripts WHERE project_id = ? ORDER BY created_at DESC'
  ).bind(projectId).all()

  return jsonResponse({ project, members: members.results, scripts: scripts.results })
}

async function updateProject(projectId: string, request: Request, user: Awaited<ReturnType<typeof verifyAuth>>, env: Env): Promise<Response> {
  const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first<{ owner_id: string }>()
  if (!project) return jsonResponse({ error: 'Project not found' }, 404)
  if (!isSuperAdmin(user) && project.owner_id !== user.sub) return jsonResponse({ error: 'Forbidden' }, 403)

  let body: { name?: string; description?: string }
  try { body = await request.json() } catch { return jsonResponse({ error: 'Invalid JSON' }, 400) }

  await env.DB.prepare(
    'UPDATE projects SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?'
  ).bind(body.name ?? null, body.description ?? null, projectId).run()

  const updated = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first()
  return jsonResponse({ project: updated })
}

async function softDeleteProject(projectId: string, user: Awaited<ReturnType<typeof verifyAuth>>, env: Env): Promise<Response> {
  const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL').bind(projectId).first<{ owner_id: string }>()
  if (!project) return jsonResponse({ error: 'Project not found' }, 404)
  if (!isSuperAdmin(user) && project.owner_id !== user.sub) return jsonResponse({ error: 'Forbidden' }, 403)

  await env.DB.prepare('UPDATE projects SET deleted_at = ? WHERE id = ?').bind(Math.floor(Date.now() / 1000), projectId).run()
  return jsonResponse({ success: true })
}

async function restoreProject(projectId: string, user: Awaited<ReturnType<typeof verifyAuth>>, env: Env): Promise<Response> {
  const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ? AND deleted_at IS NOT NULL').bind(projectId).first<{ owner_id: string }>()
  if (!project) return jsonResponse({ error: 'Project not found' }, 404)
  if (!isSuperAdmin(user) && project.owner_id !== user.sub) return jsonResponse({ error: 'Forbidden' }, 403)

  await env.DB.prepare('UPDATE projects SET deleted_at = NULL WHERE id = ?').bind(projectId).run()
  return jsonResponse({ success: true })
}

async function permanentDeleteProject(projectId: string, user: Awaited<ReturnType<typeof verifyAuth>>, env: Env): Promise<Response> {
  const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first<{ owner_id: string }>()
  if (!project) return jsonResponse({ error: 'Project not found' }, 404)
  if (!isSuperAdmin(user) && project.owner_id !== user.sub) return jsonResponse({ error: 'Forbidden' }, 403)

  await env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(projectId).run()
  return jsonResponse({ success: true })
}

async function addMember(projectId: string, request: Request, user: Awaited<ReturnType<typeof verifyAuth>>, env: Env): Promise<Response> {
  const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first<{ owner_id: string }>()
  if (!project) return jsonResponse({ error: 'Project not found' }, 404)
  if (!isSuperAdmin(user) && project.owner_id !== user.sub) return jsonResponse({ error: 'Forbidden' }, 403)

  let body: { userId?: string }
  try { body = await request.json() } catch { return jsonResponse({ error: 'Invalid JSON' }, 400) }
  if (!body.userId) return jsonResponse({ error: 'userId is required' }, 400)

  const member = await env.DB.prepare('SELECT id, name, email, role FROM users WHERE id = ?').bind(body.userId).first()
  if (!member) return jsonResponse({ error: 'User not found' }, 404)

  await env.DB.prepare(
    'INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)'
  ).bind(projectId, body.userId).run()

  return jsonResponse({ member }, 201)
}

async function removeMember(projectId: string, memberId: string, user: Awaited<ReturnType<typeof verifyAuth>>, env: Env): Promise<Response> {
  const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first<{ owner_id: string }>()
  if (!project) return jsonResponse({ error: 'Project not found' }, 404)
  if (!isSuperAdmin(user) && project.owner_id !== user.sub) return jsonResponse({ error: 'Forbidden' }, 403)
  if (memberId === project.owner_id) return jsonResponse({ error: 'Cannot remove project owner' }, 400)

  await env.DB.prepare(
    'DELETE FROM project_members WHERE project_id = ? AND user_id = ?'
  ).bind(projectId, memberId).run()

  return jsonResponse({ success: true })
}
