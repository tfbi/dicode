import { describe, expect, test } from 'bun:test'
import { createNativeToolTimeout } from './nativeToolTimeout.js'

function waitForAbort(signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) {
    return Promise.resolve(signal.reason)
  }
  return new Promise(resolve => {
    signal.addEventListener('abort', () => resolve(signal.reason), {
      once: true,
    })
  })
}

describe('createNativeToolTimeout', () => {
  test('aborts native tool subrequests with a tool-specific timeout error', async () => {
    const parent = new AbortController()
    const timeout = createNativeToolTimeout(parent.signal, 'web_search', 5)
    void timeout.timeout.catch(() => undefined)

    const reason = await waitForAbort(timeout.signal)
    timeout.dispose()

    expect(reason).toBeInstanceOf(Error)
    expect((reason as Error).message).toBe(
      'Native web_search timed out after 5ms',
    )
  })

  test('exposes a timeout promise for streams that ignore abort signals', async () => {
    const parent = new AbortController()
    const timeout = createNativeToolTimeout(parent.signal, 'web_search', 5)

    await expect(timeout.timeout).rejects.toThrow(
      'Native web_search timed out after 5ms',
    )
    timeout.dispose()
  })

  test('propagates parent abort reason instead of timeout', async () => {
    const parent = new AbortController()
    const timeout = createNativeToolTimeout(parent.signal, 'web_fetch', 1000)
    const parentReason = new Error('user cancelled')

    parent.abort(parentReason)
    const reason = await waitForAbort(timeout.signal)
    timeout.dispose()

    expect(reason).toBe(parentReason)
  })
})
