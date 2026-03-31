import { api } from './client'

export interface AnnotationRecord {
  id: string
  script_id: string
  user_id: string
  page_number: number
  type: 'highlight' | 'note' | 'drawing'
  fabric_json: string
  created_at: number
}

export const annotationsApi = {
  list: (token: string, scriptId: string, page: number) =>
    api.get<{ annotations: AnnotationRecord[] }>(
      `/annotations?scriptId=${scriptId}&page=${page}`, token
    ),

  create: (token: string, data: {
    scriptId: string
    pageNumber: number
    type: 'highlight' | 'note' | 'drawing'
    fabricJson: string
  }) => api.post<{ annotation: AnnotationRecord }>('/annotations', data, token),

  update: (token: string, id: string, data: { fabricJson: string }) =>
    api.patch<{ annotation: AnnotationRecord }>(`/annotations/${id}`, data, token),

  delete: (token: string, id: string) =>
    api.delete<{ success: boolean }>(`/annotations/${id}`, token),
}
