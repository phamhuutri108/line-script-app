import type { Env } from '../index'
import { json } from '../middleware/cors'

// TODO (Step 5): implement projects CRUD
export async function handleProjects(_request: Request, _env: Env): Promise<Response> {
  return json({ error: 'Not implemented yet' }, 501)
}
