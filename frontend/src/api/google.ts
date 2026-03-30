import { api } from './client'

export const googleApi = {
  getAuthUrl: (token: string) =>
    api.get<{ url: string }>('/google/auth-url', token),

  getStatus: (token: string) =>
    api.get<{ connected: boolean; sheetsId: string | null; driveFolderId: string | null }>(
      '/google/status', token,
    ),

  disconnect: (token: string) =>
    api.delete<{ success: boolean }>('/google/disconnect', token),

  sheetsSetup: (token: string, scriptName?: string) =>
    api.post<{ sheetsId: string; sheetsUrl: string }>(
      '/google/sheets/setup', { scriptName }, token,
    ),

  syncAll: (token: string, scriptId: string) =>
    api.post<{ synced: number; sheetsId: string }>(
      '/google/sheets/sync-all', { scriptId }, token,
    ),
}
