import { verifyAuth, isSuperAdmin } from '../middleware/auth'
import { jsonResponse, generateId } from '../utils'
import type { Env } from '../index'

interface ShotBody {
  scriptId?: string
  lineId?: string
  shotNumber?: number
  sceneNumber?: string
  location?: string
  intExt?: string
  dayNight?: string
  description?: string
  dialogue?: string
  shotSize?: string
  angle?: string
  movement?: string
  lens?: string
  notes?: string
  pageNumber?: number
}

export async function handleShots(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url)
  const parts = url.pathname.replace(/^\/shots/, '').split('/').filter(Boolean)
  // parts[0] = scriptId or shotId, parts[1] = 'export' | 'share'

  // GET /shots/:scriptId/export?format=csv|json
  if (request.method === 'GET' && parts[1] === 'export') {
    const user = await verifyAuth(request, env)
    return exportShots(parts[0], url, user, env)
  }
  // POST /shots/:scriptId/share
  if (request.method === 'POST' && parts[1] === 'share') {
    const user = await verifyAuth(request, env)
    return createShareToken(parts[0], user, env)
  }
  // GET /shots?scriptId=
  if (request.method === 'GET' && parts.length === 0) {
    const user = await verifyAuth(request, env)
    return listShots(url, user, env)
  }
  // POST /shots
  if (request.method === 'POST' && parts.length === 0) {
    const user = await verifyAuth(request, env)
    return createShot(request, user, env, ctx)
  }
  // PUT /shots/:id
  if (request.method === 'PUT' && parts.length === 1) {
    const user = await verifyAuth(request, env)
    return updateShot(parts[0], request, user, env, ctx)
  }
  // DELETE /shots/:id
  if (request.method === 'DELETE' && parts.length === 1) {
    const user = await verifyAuth(request, env)
    return deleteShot(parts[0], user, env, ctx)
  }

  return jsonResponse({ error: 'Not found' }, 404)
}

export async function handleShare(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const parts = url.pathname.replace(/^\/share/, '').split('/').filter(Boolean)
  const token = parts[0]

  if (!token || request.method !== 'GET') return jsonResponse({ error: 'Not found' }, 404)

  const record = await env.DB.prepare(
    'SELECT st.*, s.name AS script_name FROM share_tokens st JOIN scripts s ON s.id = st.script_id WHERE st.token = ?'
  ).bind(token).first<{ script_id: string; script_name: string }>()

  if (!record) return jsonResponse({ error: 'Invalid or expired share link' }, 404)

  const shots = await env.DB.prepare(
    `SELECT * FROM shots WHERE script_id = ? ORDER BY shot_number ASC`
  ).bind(record.script_id).all()

  return jsonResponse({
    scriptName: record.script_name,
    shots: shots.results,
  })
}

async function listShots(
  url: URL,
  user: Awaited<ReturnType<typeof verifyAuth>>,
  env: Env,
): Promise<Response> {
  const scriptId = url.searchParams.get('scriptId')
  if (!scriptId) return jsonResponse({ error: 'scriptId is required' }, 400)

  const access = await checkScriptAccess(scriptId, user.sub, env)
  if (!access && !isSuperAdmin(user)) return jsonResponse({ error: 'Forbidden' }, 403)

  const userId = isSuperAdmin(user) ? (url.searchParams.get('userId') ?? null) : user.sub

  let result
  if (isSuperAdmin(user) && !userId) {
    result = await env.DB.prepare(
      'SELECT sh.*, u.name AS user_name FROM shots sh JOIN users u ON u.id = sh.user_id WHERE sh.script_id = ? ORDER BY sh.shot_number ASC'
    ).bind(scriptId).all()
  } else {
    result = await env.DB.prepare(
      'SELECT * FROM shots WHERE script_id = ? AND user_id = ? ORDER BY shot_number ASC'
    ).bind(scriptId, userId ?? user.sub).all()
  }

  return jsonResponse({ shots: result.results })
}

async function createShot(
  request: Request,
  user: Awaited<ReturnType<typeof verifyAuth>>,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  let body: ShotBody
  try { body = await request.json() } catch { return jsonResponse({ error: 'Invalid JSON' }, 400) }

  if (!body.scriptId) return jsonResponse({ error: 'scriptId is required' }, 400)

  const access = await checkScriptAccess(body.scriptId, user.sub, env)
  if (!access && !isSuperAdmin(user)) return jsonResponse({ error: 'Forbidden' }, 403)

  // Auto-increment shot_number per user per script
  const lastShot = await env.DB.prepare(
    'SELECT MAX(shot_number) AS max_num FROM shots WHERE script_id = ? AND user_id = ?'
  ).bind(body.scriptId, user.sub).first<{ max_num: number | null }>()

  const shotNumber = body.shotNumber ?? (lastShot?.max_num ?? 0) + 1
  const id = generateId()

  await env.DB.prepare(`
    INSERT INTO shots
      (id, script_id, line_id, user_id, shot_number, scene_number, location,
       int_ext, day_night, description, dialogue, shot_size, angle, movement, lens, notes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
  `).bind(
    id, body.scriptId, body.lineId ?? null, user.sub, shotNumber,
    body.sceneNumber ?? null, body.location ?? null,
    body.intExt ?? null, body.dayNight ?? null,
    body.description ?? null, body.dialogue ?? null,
    body.shotSize ?? null, body.angle ?? null,
    body.movement ?? null, body.lens ?? null, body.notes ?? null,
  ).run()

  const shot = await env.DB.prepare('SELECT * FROM shots WHERE id = ?').bind(id).first()
  ctx.waitUntil(autoSync(body.scriptId, user.sub, env))
  return jsonResponse({ shot }, 201)
}

async function updateShot(
  shotId: string,
  request: Request,
  user: Awaited<ReturnType<typeof verifyAuth>>,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const shot = await env.DB.prepare('SELECT * FROM shots WHERE id = ?').bind(shotId).first<{ user_id: string; script_id: string }>()
  if (!shot) return jsonResponse({ error: 'Shot not found' }, 404)
  if (!isSuperAdmin(user) && shot.user_id !== user.sub) return jsonResponse({ error: 'Forbidden' }, 403)

  let body: ShotBody
  try { body = await request.json() } catch { return jsonResponse({ error: 'Invalid JSON' }, 400) }

  await env.DB.prepare(`
    UPDATE shots SET
      scene_number = COALESCE(?, scene_number),
      location     = COALESCE(?, location),
      int_ext      = COALESCE(?, int_ext),
      day_night    = COALESCE(?, day_night),
      description  = COALESCE(?, description),
      dialogue     = COALESCE(?, dialogue),
      shot_size    = COALESCE(?, shot_size),
      angle        = COALESCE(?, angle),
      movement     = COALESCE(?, movement),
      lens         = COALESCE(?, lens),
      notes        = COALESCE(?, notes),
      updated_at   = unixepoch()
    WHERE id = ?
  `).bind(
    body.sceneNumber ?? null, body.location ?? null,
    body.intExt ?? null, body.dayNight ?? null,
    body.description ?? null, body.dialogue ?? null,
    body.shotSize ?? null, body.angle ?? null,
    body.movement ?? null, body.lens ?? null,
    body.notes ?? null, shotId,
  ).run()

  const updated = await env.DB.prepare('SELECT * FROM shots WHERE id = ?').bind(shotId).first()
  ctx.waitUntil(autoSync(shot.script_id, user.sub, env))
  return jsonResponse({ shot: updated })
}

async function deleteShot(
  shotId: string,
  user: Awaited<ReturnType<typeof verifyAuth>>,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const shot = await env.DB.prepare('SELECT * FROM shots WHERE id = ?').bind(shotId).first<{ user_id: string; script_id: string }>()
  if (!shot) return jsonResponse({ error: 'Shot not found' }, 404)
  if (!isSuperAdmin(user) && shot.user_id !== user.sub) return jsonResponse({ error: 'Forbidden' }, 403)

  await env.DB.prepare('DELETE FROM shots WHERE id = ?').bind(shotId).run()
  ctx.waitUntil(autoSync(shot.script_id, user.sub, env))
  return jsonResponse({ success: true })
}

async function autoSync(scriptId: string, userId: string, env: Env): Promise<void> {
  try {
    const { getValidToken } = await import('./google')
    const token = await getValidToken(userId, env)
    if (!token) return

    const gtRecord = await env.DB.prepare(
      'SELECT sheets_id FROM google_tokens WHERE user_id = ?'
    ).bind(userId).first<{ sheets_id: string | null }>()
    if (!gtRecord?.sheets_id) return

    const sheetsId = gtRecord.sheets_id
    const shots = await env.DB.prepare(
      'SELECT * FROM shots WHERE script_id = ? AND user_id = ? ORDER BY shot_number ASC'
    ).bind(scriptId, userId).all()

    // Clear existing data rows
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetsId}/values/Shotlist!A2:M1000:clear`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      }
    )

    if (shots.results.length === 0) return

    const rows = shots.results.map((s: Record<string, unknown>) => [
      s.shot_number, s.scene_number ?? '', s.location ?? '',
      s.int_ext ?? '', s.day_night ?? '', s.description ?? '',
      s.dialogue ?? '', s.angle ?? '', s.shot_size ?? '',
      s.movement ?? '', s.lens ?? '', s.notes ?? '',
      s.storyboard_view_url ? `=IMAGE("${s.storyboard_view_url}")` : '',
    ])

    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetsId}/values/Shotlist!A2:M${shots.results.length + 1}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: rows }),
      }
    )
  } catch {
    // Silent fail — don't affect the main response
  }
}

async function exportShots(
  scriptId: string,
  url: URL,
  user: Awaited<ReturnType<typeof verifyAuth>>,
  env: Env,
): Promise<Response> {
  const access = await checkScriptAccess(scriptId, user.sub, env)
  if (!access && !isSuperAdmin(user)) return jsonResponse({ error: 'Forbidden' }, 403)

  const format = url.searchParams.get('format') ?? 'json'
  const result = await env.DB.prepare(
    'SELECT * FROM shots WHERE script_id = ? AND user_id = ? ORDER BY shot_number ASC'
  ).bind(scriptId, user.sub).all()
  const shots = result.results as Record<string, unknown>[]

  if (format === 'csv') {
    const headers = ['shot_number','scene_number','location','int_ext','day_night','description','dialogue','shot_size','angle','movement','lens','notes']
    const rows = shots.map((s) => headers.map((h) => {
      const val = String(s[h] ?? '')
      return val.includes(',') || val.includes('"') || val.includes('\n')
        ? `"${val.replace(/"/g, '""')}"` : val
    }).join(','))
    const csv = [headers.join(','), ...rows].join('\r\n')
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="shotlist.csv"`,
        'Access-Control-Allow-Origin': '*',
      },
    })
  }

  return jsonResponse({ shots })
}

async function createShareToken(
  scriptId: string,
  user: Awaited<ReturnType<typeof verifyAuth>>,
  env: Env,
): Promise<Response> {
  const access = await checkScriptAccess(scriptId, user.sub, env)
  if (!access && !isSuperAdmin(user)) return jsonResponse({ error: 'Forbidden' }, 403)

  const token = generateId()
  await env.DB.prepare(
    'INSERT INTO share_tokens (token, script_id, created_by) VALUES (?, ?, ?)'
  ).bind(token, scriptId, user.sub).run()

  return jsonResponse({ token, url: `/share/${token}` }, 201)
}

async function checkScriptAccess(scriptId: string, userId: string, env: Env): Promise<boolean> {
  const script = await env.DB.prepare(
    'SELECT s.id, p.owner_id FROM scripts s JOIN projects p ON p.id = s.project_id WHERE s.id = ?'
  ).bind(scriptId).first<{ owner_id: string }>()
  if (!script) return false
  if (script.owner_id === userId) return true
  const member = await env.DB.prepare(
    'SELECT 1 FROM project_members pm JOIN scripts s ON s.project_id = pm.project_id WHERE s.id = ? AND pm.user_id = ?'
  ).bind(scriptId, userId).first()
  return !!member
}
