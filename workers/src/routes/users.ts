import type { Env } from '../index'
import { json } from '../middleware/cors'

// TODO (Step 3): implement user management (admin only)
export async function handleUsers(_request: Request, _env: Env): Promise<Response> {
  return json({ error: 'Not implemented yet' }, 501)
}
