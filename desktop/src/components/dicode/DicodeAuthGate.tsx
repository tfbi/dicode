import { useEffect, useState, type ReactNode } from 'react'
import { setAuthToken } from '../../api/client'
import { initializeDesktopServerUrl } from '../../lib/desktopRuntime'
import { useDicodeAuthStore } from '../../stores/dicodeAuthStore'
import { DicodeLoginView } from './DicodeLoginView'

type DicodeAuthGateProps = {
  children: ReactNode
}

export function DicodeAuthGate({ children }: DicodeAuthGateProps) {
  const status = useDicodeAuthStore((s) => s.status)
  const isLoading = useDicodeAuthStore((s) => s.isLoading)
  const error = useDicodeAuthStore((s) => s.error)
  const fetchStatus = useDicodeAuthStore((s) => s.fetchStatus)
  const login = useDicodeAuthStore((s) => s.login)
  const [ready, setReady] = useState(false)
  const [startupError, setStartupError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function bootstrapAuth() {
      try {
        await initializeDesktopServerUrl()
        const nextStatus = await fetchStatus()
        if (nextStatus.loggedIn) {
          setAuthToken(nextStatus.accessToken)
        }
        if (!cancelled) {
          setReady(true)
        }
      } catch (err) {
        setAuthToken(null)
        if (!cancelled) {
          setStartupError(err instanceof Error ? err.message : String(err))
          setReady(true)
        }
      }
    }
    void bootstrapAuth()
    return () => {
      cancelled = true
    }
  }, [fetchStatus])

  if (!ready) {
    return (
      <div className="app-shell-viewport flex items-center justify-center bg-[var(--color-surface)] text-[var(--color-text-secondary)]">
        Checking login status
      </div>
    )
  }

  if (status?.loggedIn || status?.required === false) {
    return <>{children}</>
  }

  return (
    <DicodeLoginView
      loading={isLoading}
      configured={status?.configured ?? false}
      error={error ?? startupError}
      onLogin={() => {
        void login()
      }}
    />
  )
}
