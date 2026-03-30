import type { Env } from '../index'
import { json } from '../middleware/cors'

// TODO (Step 5): implement script upload / list / stream from R2
export async function handleScripts(_request: Request, _env: Env): Promise<Response> {
  return json({ error: 'Not implemented yet' }, 501)
}
