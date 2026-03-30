import { verifyAuth } from '../middleware/auth'
import { jsonResponse } from '../utils'
import { getValidToken } from './google'
import type { Env } from '../index'

const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export async function handleStoryboard(request: Request, env: Env): Promise<Response> {
  const user = await verifyAuth(request, env)
  const url = new URL(request.url)
  const parts = url.pathname.replace(/^\/storyboard/, '').split('/').filter(Boolean)

  // POST /storyboard/upload
  if (request.method === 'POST' && parts[0] === 'upload') {
    return uploadStoryboard(request, user.sub, env)
  }
  // DELETE /storyboard/:shotId
  if (request.method === 'DELETE' && parts.length === 1) {
    return deleteStoryboard(parts[0], user.sub, env)
  }

  return jsonResponse({ error: 'Not found' }, 404)
}

async function uploadStoryboard(request: Request, userId: string, env: Env): Promise<Response> {
  // Check Google token exists
  const googleToken = await getValidToken(userId, env)
  if (!googleToken) {
    return jsonResponse({
      error: 'Google Drive not connected. Please connect in Settings to use storyboard upload.',
      code: 'GOOGLE_NOT_CONNECTED',
    }, 403)
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return jsonResponse({ error: 'Expected multipart/form-data' }, 400)
  }

  const shotId = formData.get('shotId') as string | null
  const file = formData.get('file') as File | null

  if (!shotId || !file) {
    return jsonResponse({ error: 'shotId and file are required' }, 400)
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return jsonResponse({ error: 'Only JPEG, PNG, WebP, and GIF images are accepted' }, 400)
  }
  if (file.size > MAX_IMAGE_SIZE) {
    return jsonResponse({ error: 'File size exceeds 10MB limit' }, 400)
  }

  // Verify shot belongs to user
  const shot = await env.DB.prepare(
    'SELECT id, script_id, user_id FROM shots WHERE id = ?'
  ).bind(shotId).first<{ id: string; script_id: string; user_id: string }>()

  if (!shot) return jsonResponse({ error: 'Shot not found' }, 404)
  if (shot.user_id !== userId) return jsonResponse({ error: 'Forbidden' }, 403)

  // Ensure Drive folder exists
  const gtRecord = await env.DB.prepare(
    'SELECT drive_folder_id FROM google_tokens WHERE user_id = ?'
  ).bind(userId).first<{ drive_folder_id: string | null }>()

  let folderId = gtRecord?.drive_folder_id ?? null
  if (!folderId) {
    folderId = await createDriveFolder(googleToken, env)
    if (folderId) {
      await env.DB.prepare(
        'UPDATE google_tokens SET drive_folder_id = ? WHERE user_id = ?'
      ).bind(folderId, userId).run()
    }
  }

  // Upload file to Google Drive
  const arrayBuffer = await file.arrayBuffer()
  const metadata = {
    name: `storyboard_${shotId}_${Date.now()}.${file.type.split('/')[1]}`,
    parents: folderId ? [folderId] : [],
  }

  const boundary = '-------storyboard_boundary'
  const metaPart = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(metadata)}\r\n`
  const filePart = `--${boundary}\r\nContent-Type: ${file.type}\r\n\r\n`
  const closing = `\r\n--${boundary}--`

  const metaBytes = new TextEncoder().encode(metaPart)
  const filePartBytes = new TextEncoder().encode(filePart)
  const closingBytes = new TextEncoder().encode(closing)
  const fileBytes = new Uint8Array(arrayBuffer)

  const body = new Uint8Array(metaBytes.length + filePartBytes.length + fileBytes.length + closingBytes.length)
  let offset = 0
  body.set(metaBytes, offset); offset += metaBytes.length
  body.set(filePartBytes, offset); offset += filePartBytes.length
  body.set(fileBytes, offset); offset += fileBytes.length
  body.set(closingBytes, offset)

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${googleToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  )

  if (!uploadRes.ok) {
    const err = await uploadRes.text()
    console.error('Drive upload error:', err)
    return jsonResponse({ error: 'Failed to upload to Google Drive' }, 502)
  }

  const uploadData = await uploadRes.json() as { id: string }
  const fileId = uploadData.id

  // Set file public (anyone with link can view)
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${googleToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'anyone', role: 'reader' }),
  })

  // Get view URL
  const viewUrl = `https://drive.google.com/uc?export=view&id=${fileId}`

  // Save to shots table
  await env.DB.prepare(
    'UPDATE shots SET storyboard_drive_id = ?, storyboard_view_url = ?, updated_at = unixepoch() WHERE id = ?'
  ).bind(fileId, viewUrl, shotId).run()

  return jsonResponse({
    driveFileId: fileId,
    viewUrl,
  })
}

async function deleteStoryboard(shotId: string, userId: string, env: Env): Promise<Response> {
  const shot = await env.DB.prepare(
    'SELECT id, user_id, storyboard_drive_id FROM shots WHERE id = ?'
  ).bind(shotId).first<{ id: string; user_id: string; storyboard_drive_id: string | null }>()

  if (!shot) return jsonResponse({ error: 'Shot not found' }, 404)
  if (shot.user_id !== userId) return jsonResponse({ error: 'Forbidden' }, 403)
  if (!shot.storyboard_drive_id) return jsonResponse({ error: 'No storyboard to delete' }, 400)

  // Try to delete from Drive (best-effort — don't block if fails)
  const googleToken = await getValidToken(userId, env)
  if (googleToken) {
    await fetch(
      `https://www.googleapis.com/drive/v3/files/${shot.storyboard_drive_id}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${googleToken}` },
      }
    ).catch(() => { /* ignore */ })
  }

  // Clear from DB regardless
  await env.DB.prepare(
    'UPDATE shots SET storyboard_drive_id = NULL, storyboard_view_url = NULL, updated_at = unixepoch() WHERE id = ?'
  ).bind(shotId).run()

  return jsonResponse({ success: true })
}

async function createDriveFolder(token: string, _env: Env): Promise<string | null> {
  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Line Script — Storyboards',
      mimeType: 'application/vnd.google-apps.folder',
    }),
  })
  if (!res.ok) return null
  const data = await res.json() as { id: string }
  return data.id
}
