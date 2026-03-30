import { jwtVerify } from 'jose'
import type { Env } from '../index'

export type UserRole = 'super_admin' | 'owner' | 'member' | 'pending'

export interface JWTPayload {
  sub: string
  email: string
  role: UserRole
  name: string
}

export async function verifyAuth(request: Request, env: Env): Promise<JWTPayload> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
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
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
}

export function requireSuperAdmin(user: JWTPayload): void {
  if (user.role !== 'super_admin') {
    throw new Response(JSON.stringify({ error: 'Forbidden: super admin only' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
}

export function requireOwnerOrAbove(user: JWTPayload): void {
  if (user.role !== 'super_admin' && user.role !== 'owner') {
    throw new Response(JSON.stringify({ error: 'Forbidden: owner or above required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
}

export function isSuperAdmin(user: JWTPayload): boolean {
  return user.role === 'super_admin'
}
