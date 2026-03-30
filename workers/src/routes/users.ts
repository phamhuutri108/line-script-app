import { verifyAuth, isSuperAdmin, requireSuperAdmin } from '../middleware/auth'
import { jsonResponse } from '../utils'
import type { Env } from '../index'

export async function handleUsers(request: Request, env: Env): Promise<Response> {
  const user = await verifyAuth(request, env)
  const url = new URL(request.url)
  const parts = url.pathname.replace(/^\/users/, '').split('/').filter(Boolean)
  // parts[0] = userId, parts[1] = 'approve' | 'role'

  // GET /users — super_admin: all; owner: members in their projects
  if (request.method === 'GET' && parts.length === 0) {
    return listUsers(url, user, env)
  }
  // PATCH /users/:id/approve — super_admin only
  if (request.method === 'PATCH' && parts[1] === 'approve') {
    requireSuperAdmin(user)
    return approveUser(parts[0], env)
  }
  // PATCH /users/:id/role — super_admin only
  if (request.method === 'PATCH' && parts[1] === 'role') {
    requireSuperAdmin(user)
    return changeRole(parts[0], request, env)
  }
  // DELETE /users/:id — super_admin only
  if (request.method === 'DELETE' && parts.length === 1) {
    requireSuperAdmin(user)
    return deleteUser(parts[0], user.sub, env)
  }

  return jsonResponse({ error: 'Not found' }, 404)
}

async function listUsers(
  url: URL,
  user: Awaited<ReturnType<typeof verifyAuth>>,
  env: Env,
): Promise<Response> {
  const roleFilter = url.searchParams.get('role')

  if (isSuperAdmin(user)) {
    let query = 'SELECT id, email, name, role, created_at FROM users'
    const bindings: string[] = []
    if (roleFilter) {
      query += ' WHERE role = ?'
      bindings.push(roleFilter)
    }
    query += ' ORDER BY created_at DESC'
    const result = await env.DB.prepare(query).bind(...bindings).all()
    return jsonResponse({ users: result.results })
  }

  // Owner: see members in their projects
  const result = await env.DB.prepare(`
    SELECT DISTINCT u.id, u.email, u.name, u.role, u.created_at
    FROM users u
    JOIN project_members pm ON pm.user_id = u.id
    JOIN projects p ON p.id = pm.project_id
    WHERE p.owner_id = ?
    ORDER BY u.name ASC
  `).bind(user.sub).all()

  return jsonResponse({ users: result.results })
}

async function approveUser(userId: string, env: Env): Promise<Response> {
  const target = await env.DB.prepare('SELECT id, role FROM users WHERE id = ?').bind(userId).first<{ role: string }>()
  if (!target) return jsonResponse({ error: 'User not found' }, 404)
  if (target.role !== 'pending') return jsonResponse({ error: 'User is not pending' }, 400)

  await env.DB.prepare("UPDATE users SET role = 'member' WHERE id = ?").bind(userId).run()
  const updated = await env.DB.prepare('SELECT id, email, name, role FROM users WHERE id = ?').bind(userId).first()
  return jsonResponse({ user: updated })
}

async function changeRole(userId: string, request: Request, env: Env): Promise<Response> {
  let body: { role?: string }
  try { body = await request.json() } catch { return jsonResponse({ error: 'Invalid JSON' }, 400) }

  const { role } = body
  if (!role || !['owner', 'member'].includes(role)) {
    return jsonResponse({ error: 'role must be owner or member' }, 400)
  }

  const target = await env.DB.prepare('SELECT id, role FROM users WHERE id = ?').bind(userId).first<{ role: string }>()
  if (!target) return jsonResponse({ error: 'User not found' }, 404)
  if (target.role === 'super_admin') return jsonResponse({ error: 'Cannot change super_admin role' }, 403)

  await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, userId).run()
  const updated = await env.DB.prepare('SELECT id, email, name, role FROM users WHERE id = ?').bind(userId).first()
  return jsonResponse({ user: updated })
}

async function deleteUser(userId: string, requesterId: string, env: Env): Promise<Response> {
  if (userId === requesterId) return jsonResponse({ error: 'Cannot delete your own account' }, 400)

  const target = await env.DB.prepare('SELECT id, role FROM users WHERE id = ?').bind(userId).first<{ role: string }>()
  if (!target) return jsonResponse({ error: 'User not found' }, 404)
  if (target.role === 'super_admin') return jsonResponse({ error: 'Cannot delete super_admin' }, 403)

  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run()
  return jsonResponse({ success: true })
}
