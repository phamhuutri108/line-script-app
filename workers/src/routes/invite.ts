import bcrypt from 'bcryptjs'
import { SignJWT } from 'jose'
import { verifyAuth, requireOwnerOrAbove } from '../middleware/auth'
import { jsonResponse, generateId } from '../utils'
import type { Env } from '../index'

const JWT_EXPIRES_IN = '7d'

async function signToken(payload: Record<string, string>, secret: string): Promise<string> {
  const key = new TextEncoder().encode(secret)
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRES_IN)
    .sign(key)
}

export async function handleInvite(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const parts = url.pathname.replace(/^\/invite/, '').split('/').filter(Boolean)
  // POST /invite           — create invite token (owner)
  // GET  /invite/:token    — validate token
  // POST /invite/:token/accept — register via invite

  if (request.method === 'POST' && parts.length === 0) {
    const user = await verifyAuth(request, env)
    requireOwnerOrAbove(user)
    return createInvite(request, user, env)
  }

  if (request.method === 'GET' && parts.length === 1) {
    return validateInvite(parts[0], env)
  }

  if (request.method === 'POST' && parts[1] === 'accept') {
    return acceptInvite(parts[0], request, env)
  }

  return jsonResponse({ error: 'Not found' }, 404)
}

async function createInvite(
  request: Request,
  user: Awaited<ReturnType<typeof verifyAuth>>,
  env: Env,
): Promise<Response> {
  let body: { projectId?: string; email?: string }
  try { body = await request.json() } catch { return jsonResponse({ error: 'Invalid JSON' }, 400) }

  if (!body.projectId) return jsonResponse({ error: 'projectId is required' }, 400)

  // Verify project belongs to requester (or super_admin)
  const project = await env.DB.prepare('SELECT id, name FROM projects WHERE id = ?')
    .bind(body.projectId).first<{ id: string; name: string }>()
  if (!project) return jsonResponse({ error: 'Project not found' }, 404)

  const token = generateId()
  const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 // 7 days

  await env.DB.prepare(
    'INSERT INTO invite_tokens (token, project_id, created_by, email, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(token, body.projectId, user.sub, body.email ?? null, expiresAt).run()

  return jsonResponse({ token, expiresAt, projectName: project.name }, 201)
}

async function validateInvite(token: string, env: Env): Promise<Response> {
  const now = Math.floor(Date.now() / 1000)

  const record = await env.DB.prepare(`
    SELECT it.*, p.name AS project_name
    FROM invite_tokens it
    JOIN projects p ON p.id = it.project_id
    WHERE it.token = ? AND it.expires_at > ? AND it.used_by IS NULL
  `).bind(token, now).first<{
    token: string
    project_id: string
    project_name: string
    email: string | null
    expires_at: number
  }>()

  if (!record) return jsonResponse({ error: 'Invalid or expired invite link' }, 404)

  return jsonResponse({
    valid: true,
    projectId: record.project_id,
    projectName: record.project_name,
    email: record.email,
    expiresAt: record.expires_at,
  })
}

async function acceptInvite(token: string, request: Request, env: Env): Promise<Response> {
  const now = Math.floor(Date.now() / 1000)

  const record = await env.DB.prepare(`
    SELECT it.*, p.name AS project_name
    FROM invite_tokens it
    JOIN projects p ON p.id = it.project_id
    WHERE it.token = ? AND it.expires_at > ? AND it.used_by IS NULL
  `).bind(token, now).first<{
    token: string
    project_id: string
    project_name: string
    email: string | null
    created_by: string
  }>()

  if (!record) return jsonResponse({ error: 'Invalid or expired invite link' }, 404)

  let body: { email?: string; password?: string; name?: string }
  try { body = await request.json() } catch { return jsonResponse({ error: 'Invalid JSON' }, 400) }

  const { email, password, name } = body
  if (!email || !password || !name) {
    return jsonResponse({ error: 'email, password and name are required' }, 400)
  }
  if (password.length < 8) {
    return jsonResponse({ error: 'Password must be at least 8 characters' }, 400)
  }

  // If invite was for a specific email, enforce it
  if (record.email && record.email.toLowerCase() !== email.toLowerCase()) {
    return jsonResponse({ error: 'This invite is for a different email address' }, 400)
  }

  // Check email not already taken
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email.toLowerCase()).first()
  if (existing) return jsonResponse({ error: 'Email already registered' }, 409)

  const passwordHash = await bcrypt.hash(password, 10)
  const userId = generateId()
  const jwtSecret = env.JWT_SECRET

  // Create user as 'member' — bypass pending
  await env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)'
  ).bind(userId, email.toLowerCase(), passwordHash, name.trim(), 'member').run()

  // Add to project
  await env.DB.prepare(
    'INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)'
  ).bind(record.project_id, userId).run()

  // Mark token as used
  await env.DB.prepare('UPDATE invite_tokens SET used_by = ? WHERE token = ?')
    .bind(userId, token).run()

  // Issue JWT
  const jwtToken = await signToken(
    { sub: userId, email: email.toLowerCase(), name: name.trim(), role: 'member' },
    jwtSecret,
  )

  return jsonResponse({
    token: jwtToken,
    user: { id: userId, email: email.toLowerCase(), name: name.trim(), role: 'member' },
    projectId: record.project_id,
    projectName: record.project_name,
  }, 201)
}
