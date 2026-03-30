import { api } from './client'
import type { User } from './auth'

export const usersApi = {
  list: (token: string, role?: string) => {
    const qs = role ? `?role=${role}` : ''
    return api.get<{ users: User[] }>(`/users${qs}`, token)
  },

  approve: (token: string, userId: string) =>
    api.patch<{ user: User }>(`/users/${userId}/approve`, {}, token),

  changeRole: (token: string, userId: string, role: 'owner' | 'member') =>
    api.patch<{ user: User }>(`/users/${userId}/role`, { role }, token),

  delete: (token: string, userId: string) =>
    api.delete<{ success: boolean }>(`/users/${userId}`, token),
}
