import type { Env } from '../index'
import { json } from '../middleware/cors'

// TODO (Step 3): implement login + register
export async function handleAuth(request: Request, _env: Env): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname === '/auth/login' && request.method === 'POST') {
    return json({ error: 'Not implemented yet' }, 501)
  }
  if (url.pathname === '/auth/register' && request.method === 'POST') {
    return json({ error: 'Not implemented yet' }, 501)
  }
  return json({ error: 'Not found' }, 404)
}
