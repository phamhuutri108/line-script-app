import type { Env } from '../index'
import { json } from '../middleware/cors'

// TODO (Step 9): implement shots CRUD + export + share
export async function handleShots(_request: Request, _env: Env): Promise<Response> {
  return json({ error: 'Not implemented yet' }, 501)
}

export async function handleShare(_request: Request, _env: Env): Promise<Response> {
  return json({ error: 'Not implemented yet' }, 501)
}
