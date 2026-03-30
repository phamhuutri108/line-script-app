import bcrypt from 'bcryptjs'
import { SignJWT } from 'jose'
import type { Env } from '../index'
import { generateId, jsonResponse } from '../utils'

const JWT_EXPIRES_IN = '7d'

async function signToken(payload: Record<string, string>, secret: string): Promise<string> {
  const key = new TextEncoder().encode(secret)
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRES_IN)
    .sign(key)
}

export async function handleAuth(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)

  if (url.pathname === '/auth/register' && request.method === 'POST') {
    return register(request, env)
  }
  if (url.pathname === '/auth/login' && request.method === 'POST') {
    return login(request, env)
  }

  return jsonResponse({ error: 'Not found' }, 404)
}

async function register(request: Request, env: Env): Promise<Response> {
  let body: { email?: string; password?: string; name?: string }
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  const { email, password, name } = body
  if (!email || !password || !name) {
    return jsonResponse({ error: 'email, password and name are required' }, 400)
  }
  if (password.length < 8) {
    return jsonResponse({ error: 'Password must be at least 8 characters' }, 400)
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ error: 'Invalid email format' }, 400)
  }

  // Check duplicate email
  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE email = ?'
  ).bind(email.toLowerCase()).first()
  if (existing) {
    return jsonResponse({ error: 'Email already registered' }, 409)
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const id = generateId()

  await env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, email.toLowerCase(), passwordHash, name.trim(), 'pending').run()

  return jsonResponse({
    message: 'Registration successful. Your account is pending admin approval.',
    user: { id, email: email.toLowerCase(), name: name.trim(), role: 'pending' },
  }, 201)
}

async function login(request: Request, env: Env): Promise<Response> {
  let body: { email?: string; password?: string }
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  const { email, password } = body
  if (!email || !password) {
    return jsonResponse({ error: 'email and password are required' }, 400)
  }

  const user = await env.DB.prepare(
    'SELECT id, email, password_hash, name, role FROM users WHERE email = ?'
  ).bind(email.toLowerCase()).first<{
    id: string
    email: string
    password_hash: string
    name: string
    role: string
  }>()

  if (!user) {
    return jsonResponse({ error: 'Invalid email or password' }, 401)
  }

  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid) {
    return jsonResponse({ error: 'Invalid email or password' }, 401)
  }

  if (user.role === 'pending') {
    return jsonResponse({ error: 'Your account is pending admin approval.' }, 403)
  }

  const token = await signToken(
    { sub: user.id, email: user.email, name: user.name, role: user.role },
    env.JWT_SECRET
  )

  return jsonResponse({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  })
}
