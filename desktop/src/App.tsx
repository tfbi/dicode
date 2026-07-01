import { AppShell } from './components/layout/AppShell'
import { useScheduledTaskDesktopNotifications } from './hooks/useScheduledTaskDesktopNotifications'
import { installDesktopNotificationNavigation } from './lib/desktopNotificationNavigation'
import { useEffect } from 'react'
import { DicodeAuthGate } from './components/dicode/DicodeAuthGate'

export function App() {
  useScheduledTaskDesktopNotifications()
  useEffect(() => {
    let cleanup: (() => void) | undefined
    let cancelled = false
    installDesktopNotificationNavigation()
      .then((fn) => {
        if (cancelled) {
          fn()
        } else {
          cleanup = fn
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [])
  return (
    <DicodeAuthGate>
      <AppShell />
    </DicodeAuthGate>
  )
}
