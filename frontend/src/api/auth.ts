import { api } from './client'

export interface User {
  id: string
  email: string
  name: string
  role: 'admin' | 'member' | 'pending'
}

export interface LoginResponse {
  token: string
  user: User
}

export interface RegisterResponse {
  message: string
  user: User
}

export const authApi = {
  login: (email: string, password: string) =>
    api.post<LoginResponse>('/auth/login', { email, password }),

  register: (email: string, password: string, name: string) =>
    api.post<RegisterResponse>('/auth/register', { email, password, name }),
}
