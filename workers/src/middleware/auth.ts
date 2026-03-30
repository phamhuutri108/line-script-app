import { jwtVerify } from 'jose'
import type { Env } from '../index'

export interface JWTPayload {
  sub: string       // user id
  email: string
  role: string
  name: string
}

export async function verifyAuth(request: Request, env: Env): Promise<JWTPayload> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const token = authHeader.slice(7)
  const secret = new TextEncoder().encode(env.JWT_SECRET)

  try {
    const { payload } = await jwtVerify(token, secret)
    return payload as unknown as JWTPayload
  } catch {
    throw new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

export function requireRole(user: JWTPayload, role: 'admin'): void {
  if (user.role !== role) {
    throw new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
