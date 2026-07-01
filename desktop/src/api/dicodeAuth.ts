import { api } from './client'

export type DicodeAuthUser = {
  userId?: string
  userName?: string
  nickName?: string
  email?: string
  deptId?: number
}

export type DicodeAuthStatus =
  | {
      loggedIn: false
      required: boolean
      configured: boolean
      hostUrl?: string
    }
  | {
      loggedIn: true
      required: boolean
      configured: boolean
      hostUrl?: string
      accessToken: string
      expiresTime: number
      user: DicodeAuthUser
    }

export const dicodeAuthApi = {
  start() {
    return api.post<{ authorizeUrl: string }>('/api/dicode-auth/start')
  },

  exchange(input: { code: string; state: string }) {
    const query = new URLSearchParams(input)
    return api.post<DicodeAuthStatus>(`/api/dicode-auth/exchange?${query.toString()}`)
  },

  me() {
    return api.get<DicodeAuthStatus>('/api/dicode-auth/me')
  },

  logout() {
    return api.delete<{ ok: true }>('/api/dicode-auth')
  },
}
