import { api } from './client'

export type Role = 'admin' | 'viewer'

export interface AuthStatus {
  role: Role
}

export async function fetchAuthMe(): Promise<AuthStatus> {
  const { data } = await api.get<AuthStatus>('/auth/me')
  return data
}
