import { api } from './client'

export interface Shot {
  id: string
  script_id: string
  line_id: string | null
  user_id: string
  shot_number: number
  page_number: number | null
  scene_number: string | null
  location: string | null
  int_ext: string | null
  day_night: string | null
  description: string | null       // auto-extracted from PDF (shown blurred in UI)
  user_notes: string | null        // user-written notes — the primary editable description
  dialogue: string | null
  shot_size: string | null
  angle: string | null
  movement: string | null
  lens: string | null
  subjects: string | null
  script_time: string | null
  shot_type: string | null
  side: string | null
  notes: string | null
  storyboard_drive_id: string | null
  storyboard_view_url: string | null
  created_at: number
  updated_at: number
}

export type ShotUpdate = Partial<Pick<Shot,
  'scene_number' | 'location' | 'int_ext' | 'day_night' |
  'description' | 'user_notes' | 'dialogue' | 'subjects' | 'script_time' |
  'shot_size' | 'shot_type' | 'side' | 'angle' |
  'movement' | 'lens' | 'notes' | 'shot_number'
>>

export const shotsApi = {
  list: (token: string, scriptId: string) =>
    api.get<{ shots: Shot[] }>(`/shots?scriptId=${scriptId}`, token),

  create: (token: string, data: {
    scriptId: string
    lineId?: string
    sceneNumber?: string
    location?: string
    intExt?: string
    dayNight?: string
    description?: string
    dialogue?: string
    pageNumber?: number
    userNotes?: string
  }) => api.post<{ shot: Shot }>('/shots', data, token),

  update: (token: string, id: string, data: ShotUpdate) =>
    api.put<{ shot: Shot }>(`/shots/${id}`, data, token),

  delete: (token: string, id: string) =>
    api.delete<{ success: boolean }>(`/shots/${id}`, token),

  createShareToken: (token: string, scriptId: string) =>
    api.post<{ token: string; url: string }>(`/shots/${scriptId}/share`, {}, token),

  getCsvUrl: (scriptId: string) =>
    `${import.meta.env.VITE_API_URL}/shots/${scriptId}/export?format=csv`,

  uploadStoryboard: async (token: string, shotId: string, file: File) => {
    const form = new FormData()
    form.append('shotId', shotId)
    form.append('file', file)
    const res = await fetch(`${import.meta.env.VITE_API_URL}/storyboard/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
    const data = await res.json() as { driveFileId?: string; viewUrl?: string; error?: string; code?: string }
    if (!res.ok) throw Object.assign(new Error(data.error ?? 'Upload failed'), { code: data.code })
    return data as { driveFileId: string; viewUrl: string }
  },

  deleteStoryboard: (token: string, shotId: string) =>
    fetch(`${import.meta.env.VITE_API_URL}/storyboard/${shotId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json()) as Promise<{ success: boolean }>,
}
