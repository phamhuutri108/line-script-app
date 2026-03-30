import { api } from './client'

export interface SceneMarker {
  id: string
  script_id: string
  user_id: string
  page_number: number
  y_position: number
  x_offset: number
  created_at: number
}

export const scenesApi = {
  list: (token: string, scriptId: string, page: number) =>
    api.get<{ markers: SceneMarker[] }>(`/scenes?scriptId=${scriptId}&page=${page}`, token),

  create: (token: string, data: {
    scriptId: string
    pageNumber: number
    yPosition: number
    xOffset?: number
  }) => api.post<{ marker: SceneMarker }>('/scenes', data, token),

  update: (token: string, id: string, data: { yPosition?: number; xOffset?: number }) =>
    api.patch<{ marker: SceneMarker }>(`/scenes/${id}`, data, token),

  delete: (token: string, id: string) =>
    api.delete<{ success: boolean }>(`/scenes/${id}`, token),
}
