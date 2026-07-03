import { LogIn } from 'lucide-react'
import { Button } from '../shared/Button'

type DicodeLoginViewProps = {
  loading: boolean
  error: string | null
  configured: boolean
  onLogin: () => void
}

export function DicodeLoginView({
  loading,
  error,
  configured,
  onLogin,
}: DicodeLoginViewProps) {
  return (
    <div className="app-shell-viewport flex items-center justify-center bg-[var(--color-surface)] px-6 text-[var(--color-text-primary)]">
      <div className="flex w-full max-w-[360px] flex-col items-center gap-5 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--color-surface-container)] text-[var(--color-text-primary)] shadow-[var(--shadow-elevated)]">
          <LogIn size={22} />
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-normal">Dicode</h1>
          <p className="text-sm leading-6 text-[var(--color-text-secondary)]">
            Sign in with your enterprise IAM account to continue.
          </p>
        </div>
        <Button
          type="button"
          size="lg"
          loading={loading}
          disabled={!configured}
          icon={<LogIn size={16} />}
          onClick={onLogin}
          className="w-full"
        >
          Sign in
        </Button>
        {!configured ? (
          <p className="text-xs leading-5 text-[var(--color-error)]">
            Dicode IAM is required but not configured.
          </p>
        ) : null}
        {error ? (
          <p className="max-w-full break-words text-xs leading-5 text-[var(--color-error)]">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}
