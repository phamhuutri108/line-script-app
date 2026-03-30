import { verifyAuth } from '../middleware/auth'
import { jsonResponse } from '../utils'
import type { Env } from '../index'

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')

interface GoogleTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
}

interface GoogleToken {
  user_id: string
  access_token: string
  refresh_token: string
  expiry: number
  sheets_id: string | null
  drive_folder_id: string | null
}

export async function handleGoogle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname.replace(/^\/google/, '')

  // GET /google/auth-url
  if (request.method === 'GET' && path === '/auth-url') {
    const user = await verifyAuth(request, env)
    return getAuthUrl(user.sub, env)
  }
  // GET /google/callback
  if (request.method === 'GET' && path === '/callback') {
    return handleCallback(url, env)
  }
  // GET /google/status
  if (request.method === 'GET' && path === '/status') {
    const user = await verifyAuth(request, env)
    return getStatus(user.sub, env)
  }
  // DELETE /google/disconnect
  if (request.method === 'DELETE' && path === '/disconnect') {
    const user = await verifyAuth(request, env)
    return disconnect(user.sub, env)
  }
  // POST /google/sheets/setup
  if (request.method === 'POST' && path === '/sheets/setup') {
    const user = await verifyAuth(request, env)
    return sheetsSetup(request, user.sub, env)
  }
  // POST /google/sheets/sync-all
  if (request.method === 'POST' && path === '/sheets/sync-all') {
    const user = await verifyAuth(request, env)
    return syncAll(request, user.sub, env)
  }

  return jsonResponse({ error: 'Not found' }, 404)
}

function getAuthUrl(userId: string, env: Env): Response {
  const state = btoa(JSON.stringify({ userId }))
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
  return jsonResponse({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` })
}

async function handleCallback(url: URL, env: Env): Promise<Response> {
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  const frontendBase = env.ENVIRONMENT === 'production'
    ? 'https://line-script-app.phamhuutri.com'
    : 'http://localhost:5173'

  if (error || !code || !state) {
    return Response.redirect(`${frontendBase}/settings?google=error`, 302)
  }

  let userId: string
  try {
    const decoded = JSON.parse(atob(state))
    userId = decoded.userId
  } catch {
    return Response.redirect(`${frontendBase}/settings?google=error`, 302)
  }

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })

  if (!tokenRes.ok) {
    return Response.redirect(`${frontendBase}/settings?google=error`, 302)
  }

  const tokens = await tokenRes.json() as GoogleTokenResponse
  if (!tokens.refresh_token) {
    return Response.redirect(`${frontendBase}/settings?google=error&reason=no_refresh`, 302)
  }

  const expiry = Math.floor(Date.now() / 1000) + tokens.expires_in

  await env.DB.prepare(`
    INSERT INTO google_tokens (user_id, access_token, refresh_token, expiry)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expiry = excluded.expiry,
      updated_at = unixepoch()
  `).bind(userId, tokens.access_token, tokens.refresh_token, expiry).run()

  return Response.redirect(`${frontendBase}/settings?google=success`, 302)
}

async function getStatus(userId: string, env: Env): Promise<Response> {
  const record = await env.DB.prepare(
    'SELECT user_id, expiry, sheets_id, drive_folder_id FROM google_tokens WHERE user_id = ?'
  ).bind(userId).first<GoogleToken>()

  if (!record) return jsonResponse({ connected: false })

  return jsonResponse({
    connected: true,
    sheetsId: record.sheets_id,
    driveFolderId: record.drive_folder_id,
  })
}

async function disconnect(userId: string, env: Env): Promise<Response> {
  await env.DB.prepare('DELETE FROM google_tokens WHERE user_id = ?').bind(userId).run()
  return jsonResponse({ success: true })
}

async function sheetsSetup(request: Request, userId: string, env: Env): Promise<Response> {
  const token = await getValidToken(userId, env)
  if (!token) return jsonResponse({ error: 'Google account not connected' }, 400)

  let body: { scriptName?: string } = {}
  try { body = await request.json() } catch { /* optional body */ }

  const title = body.scriptName ? `Shotlist — ${body.scriptName}` : 'Line Script — Shotlist'

  // Create spreadsheet
  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: { title },
      sheets: [{ properties: { title: 'Shotlist' } }],
    }),
  })

  if (!createRes.ok) return jsonResponse({ error: 'Failed to create spreadsheet' }, 500)
  const sheet = await createRes.json() as { spreadsheetId: string; spreadsheetUrl: string }

  // Add header row (17 columns: A–Q)
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheet.spreadsheetId}/values/Shotlist!A1:Q1?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        values: [['#', 'Cảnh', 'Địa điểm', 'INT/EXT', 'Ngày/Đêm', 'Mô tả', 'Thoại', 'Nhân vật', 'Thời lượng', 'Cỡ cảnh', 'Loại cảnh', 'Phía', 'Góc máy', 'Di chuyển', 'Ống kính', 'Ghi chú', 'Storyboard']],
      }),
    }
  )

  // Save sheets_id
  await env.DB.prepare(
    'UPDATE google_tokens SET sheets_id = ?, updated_at = unixepoch() WHERE user_id = ?'
  ).bind(sheet.spreadsheetId, userId).run()

  return jsonResponse({ sheetsId: sheet.spreadsheetId, sheetsUrl: sheet.spreadsheetUrl })
}

async function syncAll(request: Request, userId: string, env: Env): Promise<Response> {
  const token = await getValidToken(userId, env)
  if (!token) return jsonResponse({ error: 'Google account not connected' }, 400)

  const gtRecord = await env.DB.prepare(
    'SELECT sheets_id FROM google_tokens WHERE user_id = ?'
  ).bind(userId).first<{ sheets_id: string | null }>()

  if (!gtRecord?.sheets_id) return jsonResponse({ error: 'Sheets not set up yet' }, 400)

  let body: { scriptId?: string } = {}
  try { body = await request.json() } catch { /* optional */ }
  if (!body.scriptId) return jsonResponse({ error: 'scriptId required' }, 400)

  const shots = await env.DB.prepare(
    'SELECT * FROM shots WHERE script_id = ? AND user_id = ? ORDER BY shot_number ASC'
  ).bind(body.scriptId, userId).all()

  if (shots.results.length === 0) return jsonResponse({ synced: 0 })

  const rows = shots.results.map((s: Record<string, unknown>) => [
    s.shot_number, s.scene_number ?? '', s.location ?? '',
    s.int_ext ?? '', s.day_night ?? '', s.description ?? '',
    s.dialogue ?? '', s.subjects ?? '', s.script_time ?? '',
    s.shot_size ?? '', s.shot_type ?? '', s.side ?? '',
    s.angle ?? '', s.movement ?? '', s.lens ?? '',
    s.notes ?? '',
    s.storyboard_view_url ? `=IMAGE("${s.storyboard_view_url}")` : '',
  ])

  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${gtRecord.sheets_id}/values/Shotlist!A2:Q${shots.results.length + 1}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: rows }),
    }
  )

  // Update sheets_row_index for each shot
  for (let i = 0; i < shots.results.length; i++) {
    const shot = shots.results[i] as Record<string, unknown>
    await env.DB.prepare(
      'UPDATE shots SET sheets_row_index = ? WHERE id = ?'
    ).bind(i + 2, shot.id).run()
  }

  return jsonResponse({ synced: shots.results.length, sheetsId: gtRecord.sheets_id })
}

// Get valid access token, refresh if needed
export async function getValidToken(userId: string, env: Env): Promise<string | null> {
  const record = await env.DB.prepare(
    'SELECT access_token, refresh_token, expiry FROM google_tokens WHERE user_id = ?'
  ).bind(userId).first<{ access_token: string; refresh_token: string; expiry: number }>()

  if (!record) return null

  const now = Math.floor(Date.now() / 1000)
  if (record.expiry - now > 300) return record.access_token

  // Refresh token
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: record.refresh_token,
      grant_type: 'refresh_token',
    }),
  })

  if (!res.ok) return null

  const tokens = await res.json() as GoogleTokenResponse
  const newExpiry = now + tokens.expires_in

  await env.DB.prepare(
    'UPDATE google_tokens SET access_token = ?, expiry = ?, updated_at = unixepoch() WHERE user_id = ?'
  ).bind(tokens.access_token, newExpiry, userId).run()

  return tokens.access_token
}
