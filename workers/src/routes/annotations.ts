import type { Env } from '../index'
import { json } from '../middleware/cors'

// TODO (Step 8): implement annotations CRUD
export async function handleAnnotations(_request: Request, _env: Env): Promise<Response> {
  return json({ error: 'Not implemented yet' }, 501)
}
