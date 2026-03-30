import { api } from './client'

export interface Project {
  id: string
  name: string
  description: string | null
  owner_id: string
  owner_name?: string
  member_count?: number
  script_count?: number
  created_at: number
}

export interface ProjectMember {
  id: string
  name: string
  email: string
  role: string
}

export interface Script {
  id: string
  project_id?: string
  name: string
  page_count: number | null
  uploaded_by?: string
  created_at: number
  sheets_id?: string | null
  sheets_url?: string | null
}

export const projectsApi = {
  list: (token: string) =>
    api.get<{ projects: Project[] }>('/projects', token),

  create: (token: string, data: { name: string; description?: string }) =>
    api.post<{ project: Project }>('/projects', data, token),

  get: (token: string, id: string) =>
    api.get<{ project: Project; members: ProjectMember[]; scripts: Script[] }>(`/projects/${id}`, token),

  update: (token: string, id: string, data: { name?: string; description?: string }) =>
    api.put<{ project: Project }>(`/projects/${id}`, data, token),

  delete: (token: string, id: string) =>
    api.delete<{ success: boolean }>(`/projects/${id}`, token),

  addMember: (token: string, projectId: string, userId: string) =>
    api.post<{ member: ProjectMember }>(`/projects/${projectId}/members`, { userId }, token),

  removeMember: (token: string, projectId: string, userId: string) =>
    api.delete<{ success: boolean }>(`/projects/${projectId}/members/${userId}`, token),
}

export const scriptsApi = {
  list: (token: string, projectId: string) =>
    api.get<{ scripts: Script[] }>(`/scripts?projectId=${projectId}`, token),

  upload: async (token: string, projectId: string, name: string, file: File): Promise<{ script: Script }> => {
    const formData = new FormData()
    formData.append('projectId', projectId)
    formData.append('name', name)
    formData.append('file', file)

    const BASE_URL = import.meta.env.VITE_API_URL
    const res = await fetch(`${BASE_URL}/scripts/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    })
    const data = await res.json() as { script: Script } | { error: string }
    if (!res.ok) throw new Error((data as { error: string }).error)
    return data as { script: Script }
  },

  delete: (token: string, id: string) =>
    api.delete<{ success: boolean }>(`/scripts/${id}`, token),

  getPdfUrl: (id: string) =>
    `${import.meta.env.VITE_API_URL}/scripts/${id}/pdf`,
}

export const inviteApi = {
  create: (token: string, projectId: string, email?: string) =>
    api.post<{ token: string; expiresAt: number; projectName: string }>(
      '/invite', { projectId, email }, token,
    ),
}
