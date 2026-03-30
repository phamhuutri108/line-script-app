import { api } from './client'

export interface DriveFolder {
  id: string
  name: string
}

export const googleApi = {
  getAuthUrl: (token: string) =>
    api.get<{ url: string }>('/google/auth-url', token),

  getStatus: (token: string) =>
    api.get<{ connected: boolean; sheetsId: string | null; driveFolderId: string | null }>(
      '/google/status', token,
    ),

  disconnect: (token: string) =>
    api.delete<{ success: boolean }>('/google/disconnect', token),

  getDriveFolders: (token: string) =>
    api.get<{ folders: DriveFolder[] }>('/google/drive/folders', token),

  sheetsSetup: (token: string, data: {
    scriptId: string
    folderId?: string
    abbrev: string
    projectName: string
    versionType: 'draft' | 'final'
    versionNum?: string
  }) =>
    api.post<{ sheetsId: string; sheetsUrl: string; title: string }>(
      '/google/sheets/setup', data, token,
    ),

  syncAll: (token: string, scriptId: string) =>
    api.post<{ synced: number; sheetsId: string }>(
      '/google/sheets/sync-all', { scriptId }, token,
    ),
}
