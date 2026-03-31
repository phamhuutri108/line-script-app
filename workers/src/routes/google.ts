import { verifyAuth } from '../middleware/auth'
import { jsonResponse } from '../utils'
import type { Env } from '../index'

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')

interface SetupBody {
  scriptId: string
  folderId?: string
  abbrev: string
  projectName: string
  versionType: 'draft' | 'final'
  versionNum?: string
}

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
  // GET /google/drive/folders
  if (request.method === 'GET' && path === '/drive/folders') {
    const user = await verifyAuth(request, env)
    return getDriveFolders(user.sub, env)
  }
  // GET /google/access-token
  if (request.method === 'GET' && path === '/access-token') {
    const user = await verifyAuth(request, env)
    const token = await getValidToken(user.sub, env)
    if (!token) return jsonResponse({ error: 'Google account not connected' }, 400)
    return jsonResponse({ accessToken: token })
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
    ? 'https://script-lining.phamhuutri.com'
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

async function getDriveFolders(userId: string, env: Env): Promise<Response> {
  const token = await getValidToken(userId, env)
  if (!token) return jsonResponse({ error: 'Google account not connected' }, 400)

  const query = encodeURIComponent("mimeType='application/vnd.google-apps.folder' and trashed=false")
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=drive&fields=files(id,name)&pageSize=100&orderBy=name`,
    { headers: { Authorization: `Bearer ${token}` } },
  )

  if (!res.ok) return jsonResponse({ error: 'Failed to load Drive folders' }, 500)
  const data = await res.json() as { files: Array<{ id: string; name: string }> }

  return jsonResponse({
    folders: [
      { id: 'root', name: 'My Drive (root)' },
      ...data.files,
    ],
  })
}

async function sheetsSetup(request: Request, userId: string, env: Env): Promise<Response> {
  const token = await getValidToken(userId, env)
  if (!token) return jsonResponse({ error: 'Google account not connected' }, 400)

  let body: SetupBody
  try { body = await request.json() } catch { return jsonResponse({ error: 'Invalid JSON' }, 400) }

  if (!body.scriptId || !body.abbrev || !body.projectName) {
    return jsonResponse({ error: 'scriptId, abbrev, projectName required' }, 400)
  }

  // Build filename: YYMMDD_ABBREV_Shotlist_[Draft_01] or [FINAL]
  const now = new Date()
  const yy = String(now.getFullYear()).slice(2)
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const dateStr = `${yy}${mm}${dd}`
  const versionSuffix = body.versionType === 'final'
    ? '[FINAL]'
    : `[Draft_${(body.versionNum ?? '01').padStart(2, '0')}]`
  const sheetTitle = `${dateStr}_${body.abbrev}_Shotlist_${versionSuffix}`

  // Create spreadsheet
  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: { title: sheetTitle },
      sheets: [{ properties: { title: 'Shotlist' } }],
    }),
  })
  if (!createRes.ok) return jsonResponse({ error: 'Failed to create spreadsheet' }, 500)
  const sheet = await createRes.json() as { spreadsheetId: string; spreadsheetUrl: string }
  const spreadsheetId = sheet.spreadsheetId

  // Move to folder if not root
  if (body.folderId && body.folderId !== 'root') {
    await fetch(
      `https://www.googleapis.com/drive/v3/files/${spreadsheetId}?addParents=${encodeURIComponent(body.folderId)}&removeParents=root&fields=id`,
      { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } },
    )
  }

  // Apply visual formatting
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: buildFormatRequests(0) }),
  })

  // Write project title + column headers
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: [
        { range: 'Shotlist!B2', values: [[body.projectName.toUpperCase()]] },
        {
          range: 'Shotlist!A3:R3',
          values: [['', '#', 'SCENE #', 'LOCATION', 'INT/EXT', 'D/N', 'DESCRIPTION',
            'DIALOGUE', 'SUBJECTS', 'SCRIPT TIME', 'SHOT SIZE', 'SHOT TYPE',
            'SIDE', 'ANGLE', 'MOVEMENT', 'LENS', 'NOTES', 'STORYBOARD']],
        },
      ],
    }),
  })

  // Save sheets_id + sheets_url to scripts table (sheet per script)
  await env.DB.prepare(
    'UPDATE scripts SET sheets_id = ?, sheets_url = ? WHERE id = ?'
  ).bind(spreadsheetId, sheet.spreadsheetUrl, body.scriptId).run()

  // Sync existing shots (data starts at row 5 = index 4)
  const shots = await env.DB.prepare(
    'SELECT * FROM shots WHERE script_id = ? AND user_id = ? ORDER BY shot_number ASC'
  ).bind(body.scriptId, userId).all()

  if (shots.results.length > 0) {
    const rows = shots.results.map((s: Record<string, unknown>) => buildShotRow(s))
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Shotlist!A5:R${shots.results.length + 4}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: rows }),
      },
    )
  }

  return jsonResponse({ sheetsId: spreadsheetId, sheetsUrl: sheet.spreadsheetUrl, title: sheetTitle })
}

async function syncAll(request: Request, userId: string, env: Env): Promise<Response> {
  const token = await getValidToken(userId, env)
  if (!token) return jsonResponse({ error: 'Google account not connected' }, 400)

  let body: { scriptId?: string } = {}
  try { body = await request.json() } catch { /* optional */ }
  if (!body.scriptId) return jsonResponse({ error: 'scriptId required' }, 400)

  const scriptRecord = await env.DB.prepare(
    'SELECT sheets_id FROM scripts WHERE id = ?'
  ).bind(body.scriptId).first<{ sheets_id: string | null }>()

  if (!scriptRecord?.sheets_id) return jsonResponse({ error: 'Sheet not set up for this script' }, 400)

  const shots = await env.DB.prepare(
    'SELECT * FROM shots WHERE script_id = ? AND user_id = ? ORDER BY shot_number ASC'
  ).bind(body.scriptId, userId).all()

  // Clear data rows (row 5+ = index 4+)
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${scriptRecord.sheets_id}/values/Shotlist!A5:R1000:clear`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    },
  )

  if (shots.results.length === 0) return jsonResponse({ synced: 0 })

  const rows = shots.results.map((s: Record<string, unknown>) => buildShotRow(s))
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${scriptRecord.sheets_id}/values/Shotlist!A5:R${shots.results.length + 4}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: rows }),
    },
  )

  return jsonResponse({ synced: shots.results.length, sheetsId: scriptRecord.sheets_id })
}

// 18 cols: A(empty marker) + B(#) + C-R (data fields)
function buildShotRow(s: Record<string, unknown>): unknown[] {
  return [
    '',
    s.shot_number,
    s.scene_number ?? '',
    s.location ?? '',
    s.int_ext ?? '',
    s.day_night ?? '',
    s.description ?? '',
    s.dialogue ?? '',
    s.subjects ?? '',
    s.script_time ?? '',
    s.shot_size ?? '',
    s.shot_type ?? '',
    s.side ?? '',
    s.angle ?? '',
    s.movement ?? '',
    s.lens ?? '',
    s.notes ?? '',
    s.storyboard_view_url ? `=IMAGE("${s.storyboard_view_url}")` : '',
  ]
}

// Sheet visual format matching the HTML mẫu
function buildFormatRequests(sheetId: number): unknown[] {
  const b7 = { red: 0.718, green: 0.718, blue: 0.718 }    // #b7b7b7
  const d9 = { red: 0.851, green: 0.851, blue: 0.851 }    // #d9d9d9
  const dark = { red: 0.263, green: 0.263, blue: 0.263 }  // #434343
  const white = { red: 1, green: 1, blue: 1 }
  const black = { red: 0, green: 0, blue: 0 }
  const lgray = { red: 0.8, green: 0.8, blue: 0.8 }
  const solidBlack = { style: 'SOLID', width: 1, color: black }
  const solidLight = { style: 'SOLID', width: 1, color: lgray }
  // A=10, B=40, C=70, D=150, E=70, F=60, G=300, H=200, I=150, J=90, K=80, L=90, M=60, N=100, O=110, P=80, Q=150, R=120
  const colWidths = [10, 40, 70, 150, 70, 60, 300, 200, 150, 90, 80, 90, 60, 100, 110, 80, 150, 120]

  return [
    // Column widths
    ...colWidths.map((px, i) => ({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
        properties: { pixelSize: px },
        fields: 'pixelSize',
      },
    })),
    // Row heights
    { updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 8 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 1, endIndex: 2 }, properties: { pixelSize: 100 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 2, endIndex: 4 }, properties: { pixelSize: 50 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 4, endIndex: 1000 }, properties: { pixelSize: 100 }, fields: 'pixelSize' } },
    // Merge: title B2:R2
    { mergeCells: { range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 18 }, mergeType: 'MERGE_ALL' } },
    // Merge: each header col spans rows 3-4
    ...Array.from({ length: 18 }, (_, i) => ({
      mergeCells: { range: { sheetId, startRowIndex: 2, endRowIndex: 4, startColumnIndex: i, endColumnIndex: i + 1 }, mergeType: 'MERGE_ALL' },
    })),
    // Row 1 background
    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: b7 } }, fields: 'userEnteredFormat.backgroundColor' } },
    // Title row: col A dark, B:R = d9 + large bold
    { repeatCell: { range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: dark } }, fields: 'userEnteredFormat.backgroundColor' } },
    { repeatCell: { range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 18 }, cell: { userEnteredFormat: { backgroundColor: d9, textFormat: { fontSize: 20, bold: true, fontFamily: 'Arial' }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)' } },
    // Header rows: gray + bold
    { repeatCell: { range: { sheetId, startRowIndex: 2, endRowIndex: 4 }, cell: { userEnteredFormat: { backgroundColor: b7, textFormat: { fontSize: 11, bold: true, fontFamily: 'Arial' }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)' } },
    // Borders: headers
    { updateBorders: { range: { sheetId, startRowIndex: 2, endRowIndex: 4, startColumnIndex: 0, endColumnIndex: 18 }, top: solidBlack, bottom: solidBlack, left: solidBlack, right: solidBlack, innerHorizontal: solidBlack, innerVertical: solidBlack } },
    // Data rows: white + Arial 11 + wrap
    { repeatCell: { range: { sheetId, startRowIndex: 4, endRowIndex: 1000 }, cell: { userEnteredFormat: { backgroundColor: white, textFormat: { fontSize: 11, fontFamily: 'Arial' }, verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,wrapStrategy)' } },
    // Borders: data area
    { updateBorders: { range: { sheetId, startRowIndex: 4, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: 18 }, top: solidLight, bottom: solidLight, left: solidLight, right: solidLight, innerHorizontal: solidLight, innerVertical: solidLight } },
    // Freeze top 4 rows
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 4 } }, fields: 'gridProperties.frozenRowCount' } },
  ]
}

// Get valid access token, refresh if expired
export async function getValidToken(userId: string, env: Env): Promise<string | null> {
  const record = await env.DB.prepare(
    'SELECT access_token, refresh_token, expiry FROM google_tokens WHERE user_id = ?'
  ).bind(userId).first<{ access_token: string; refresh_token: string; expiry: number }>()

  if (!record) return null

  const now = Math.floor(Date.now() / 1000)
  if (record.expiry - now > 300) return record.access_token

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
