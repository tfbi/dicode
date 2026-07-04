export function createNativeToolTimeout(
  parentSignal: AbortSignal,
  toolName: string,
  timeoutMs: number,
): { signal: AbortSignal; timeout: Promise<never>; dispose: () => void } {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout>

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      const error = new Error(
        `Native ${toolName} timed out after ${timeoutMs}ms`,
      )
      controller.abort(error)
      reject(error)
    }, timeoutMs)
  })

  const abortFromParent = () => {
    controller.abort(parentSignal.reason)
  }

  if (parentSignal.aborted) {
    abortFromParent()
  } else {
    parentSignal.addEventListener('abort', abortFromParent, { once: true })
  }

  return {
    signal: controller.signal,
    timeout: timeoutPromise,
    dispose: () => {
      clearTimeout(timeout)
      parentSignal.removeEventListener('abort', abortFromParent)
    },
  }
}
