import '@testing-library/jest-dom'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, getDefaultBaseUrl, setAuthToken, setBaseUrl } from '../../api/client'
import { useDicodeAuthStore } from '../../stores/dicodeAuthStore'
import { DicodeAuthGate } from './DicodeAuthGate'

vi.mock('../../lib/desktopRuntime', () => ({
  initializeDesktopServerUrl: vi.fn().mockResolvedValue('http://127.0.0.1:3456'),
}))

const loggedInStatus = {
  loggedIn: true as const,
  required: true,
  configured: true,
  hostUrl: 'https://it.byd.com',
  accessToken: 'local-dev-dicode-token',
  expiresTime: 1798732799000,
  user: {
    userId: '5711094',
    userName: '5711094',
    nickName: '毕腾飞',
    email: 'bi.tengfei1@byd.com',
    deptId: 0,
  },
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('DicodeAuthGate', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    setAuthToken(null)
    setBaseUrl(getDefaultBaseUrl())
    useDicodeAuthStore.setState({ status: null, isLoading: false, error: null })
  })

  it('keeps valid local auth when an early authenticated request reports login required', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const path = new URL(String(url)).pathname

      if (path === '/api/dicode-auth/me') {
        return Promise.resolve(jsonResponse(loggedInStatus))
      }

      if (path === '/api/sessions') {
        return Promise.resolve(jsonResponse({ message: 'Dicode IAM login required' }, 401))
      }

      if (path === '/api/diagnostics/events') {
        return Promise.resolve(jsonResponse({ ok: true }))
      }

      return Promise.reject(new Error(`Unexpected request: ${String(url)}`))
    })

    await act(async () => {
      render(
        <DicodeAuthGate>
          <div>App content</div>
        </DicodeAuthGate>,
      )
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(screen.getByText('App content')).toBeInTheDocument()

    let requestError: unknown
    await act(async () => {
      try {
        await api.get('/api/sessions')
      } catch (error) {
        requestError = error
      }
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(requestError).toBeInstanceOf(Error)
    expect((requestError as Error).message).toBe('Dicode IAM login required')

    await waitFor(() => {
      expect(useDicodeAuthStore.getState().status).toMatchObject({
        loggedIn: true,
        accessToken: 'local-dev-dicode-token',
      })
    })
    expect(screen.getByText('App content')).toBeInTheDocument()
    expect(screen.queryByText('Sign in with Dicode IAM')).not.toBeInTheDocument()
  })
})
