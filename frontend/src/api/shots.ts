import { api } from './client'

export interface Shot {
  id: string
  script_id: string
  line_id: string | null
  user_id: string
  shot_number: number
  scene_number: string | null
  location: string | null
  int_ext: string | null
  day_night: string | null
  description: string | null
  dialogue: string | null
  shot_size: string | null
  angle: string | null
  movement: string | null
  lens: string | null
  notes: string | null
  created_at: number
  updated_at: number
}

export type ShotUpdate = Partial<Pick<Shot,
  'scene_number' | 'location' | 'int_ext' | 'day_night' |
  'description' | 'dialogue' | 'shot_size' | 'angle' |
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
  }) => api.post<{ shot: Shot }>('/shots', data, token),

  update: (token: string, id: string, data: ShotUpdate) =>
    api.put<{ shot: Shot }>(`/shots/${id}`, data, token),

  delete: (token: string, id: string) =>
    api.delete<{ success: boolean }>(`/shots/${id}`, token),

  createShareToken: (token: string, scriptId: string) =>
    api.post<{ token: string; url: string }>(`/shots/${scriptId}/share`, {}, token),

  getCsvUrl: (scriptId: string) =>
    `${import.meta.env.VITE_API_URL}/shots/${scriptId}/export?format=csv`,
}
