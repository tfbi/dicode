import { create } from 'zustand'
import { ApiError } from '../api/client'
import { dicodeAuthApi, type DicodeAuthStatus } from '../api/dicodeAuth'
import { setAuthToken } from '../api/client'
import { getDesktopHost } from '../lib/desktopHost'

type DicodeAuthState = {
  status: DicodeAuthStatus | null
  isLoading: boolean
  error: string | null
  fetchStatus: () => Promise<DicodeAuthStatus>
  login: () => Promise<void>
  logout: () => Promise<void>
  requireLogin: () => void
}

function applyAuthStatus(status: DicodeAuthStatus) {
  setAuthToken(status.loggedIn ? status.accessToken : null)
}

function toErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function isLoginRequiredError(error: unknown): boolean {
  return error instanceof ApiError &&
    error.status === 401 &&
    error.message === 'Dicode IAM login required'
}

export const useDicodeAuthStore = create<DicodeAuthState>((set, get) => ({
  status: null,
  isLoading: false,
  error: null,

  requireLogin: () => {
    setAuthToken(null)
    const previousStatus = get().status
    const status: DicodeAuthStatus = {
      loggedIn: false,
      required: previousStatus?.required ?? true,
      configured: previousStatus?.configured ?? true,
      ...(previousStatus?.hostUrl ? { hostUrl: previousStatus.hostUrl } : {}),
    }
    set({ status, isLoading: false, error: null })
  },

  fetchStatus: async () => {
    set({ isLoading: true, error: null })
    try {
      const status = await dicodeAuthApi.me()
      applyAuthStatus(status)
      set({ status, isLoading: false })
      return status
    } catch (error) {
      setAuthToken(null)
      if (isLoginRequiredError(error)) {
        get().requireLogin()
        return get().status as DicodeAuthStatus
      }
      set({ isLoading: false, error: toErrorMessage(error, 'Failed to check login status.') })
      throw error
    }
  },

  login: async () => {
    set({ isLoading: true, error: null })
    try {
      const { authorizeUrl } = await dicodeAuthApi.start()
      const code = await getDesktopHost().dicodeAuth.open(authorizeUrl)
      const status = await dicodeAuthApi.exchange(code)
      applyAuthStatus(status)
      set({ status, isLoading: false })
    } catch (error) {
      setAuthToken(null)
      set({ isLoading: false, error: toErrorMessage(error, 'Dicode IAM login failed.') })
      throw error
    }
  },

  logout: async () => {
    set({ isLoading: true, error: null })
    try {
      await dicodeAuthApi.logout()
      setAuthToken(null)
      const previousHostUrl = get().status?.hostUrl
      set({
        status: {
          loggedIn: false,
          required: true,
          configured: true,
          ...(previousHostUrl ? { hostUrl: previousHostUrl } : {}),
        },
        isLoading: false,
      })
    } catch (error) {
      set({ isLoading: false, error: toErrorMessage(error, 'Dicode IAM logout failed.') })
      throw error
    }
  },
}))
