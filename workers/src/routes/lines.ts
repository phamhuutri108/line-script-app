import type { Env } from '../index'
import { json } from '../middleware/cors'

// TODO (Step 8): implement script lines CRUD
export async function handleLines(_request: Request, _env: Env): Promise<Response> {
  return json({ error: 'Not implemented yet' }, 501)
}
