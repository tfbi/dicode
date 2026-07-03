import { describe, expect, it, vi } from 'vitest'
import { extractDicodeAuthCode, openDicodeAuthWindow } from './dicodeAuthWindow'

type Handler = (...args: unknown[]) => void

class FakeWebRequest {
  handler: ((details: { url: string; resourceType: string }, callback: (response: { cancel: boolean }) => void) => void) | null = null

  onBeforeRequest(
    _filter: { urls: string[] },
    handler: (details: { url: string; resourceType: string }, callback: (response: { cancel: boolean }) => void) => void,
  ) {
    this.handler = handler
  }

  trigger(url: string, resourceType = 'mainFrame') {
    let response: { cancel: boolean } | null = null
    this.handler?.({ url, resourceType }, next => {
      response = next
    })
    return response
  }
}

class FakeWebContents {
  session = { webRequest: new FakeWebRequest() }
  handlers = new Map<string, Handler[]>()

  on(event: string, handler: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler])
  }

  emit(event: string, ...args: unknown[]) {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(...args)
    }
  }
}

class FakeBrowserWindow {
  static latest: FakeBrowserWindow | null = null
  webContents = new FakeWebContents()
  handlers = new Map<string, Handler[]>()
  close = vi.fn(() => this.emit('closed'))
  loadURL = vi.fn(async () => {})

  constructor(public options: unknown) {
    FakeBrowserWindow.latest = this
  }

  on(event: string, handler: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler])
  }

  emit(event: string, ...args: unknown[]) {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(...args)
    }
  }
}

describe('dicode auth window helpers', () => {
  it('extracts code and state from redirect URL query params', () => {
    expect(extractDicodeAuthCode('https://iam.example.com/callback?code=abc&state=s1')).toEqual({
      code: 'abc',
      state: 's1',
    })
  })

  it('extracts code and state from hash params', () => {
    expect(extractDicodeAuthCode('https://dicode.example.com/#/login/callback?code=abc&state=s1')).toEqual({
      code: 'abc',
      state: 's1',
    })
    expect(extractDicodeAuthCode('https://dicode.example.com/#code=abc&state=s1')).toEqual({
      code: 'abc',
      state: 's1',
    })
  })

  it('returns null when redirect URL does not include both code and state', () => {
    expect(extractDicodeAuthCode('https://iam.example.com/login')).toBeNull()
    expect(extractDicodeAuthCode('https://iam.example.com/callback?code=abc')).toBeNull()
    expect(extractDicodeAuthCode('not a url')).toBeNull()
  })

  it('intercepts callback URLs before the redirected page loads', async () => {
    const promise = openDicodeAuthWindow(FakeBrowserWindow as never, 'https://iam.example.com/login')
    const win = FakeBrowserWindow.latest
    expect(win?.options).toMatchObject({
      webPreferences: expect.objectContaining({
        partition: expect.stringContaining('dicode-auth-'),
      }),
    })

    const response = win?.webContents.session.webRequest.trigger(
      'https://dicode.example.com/?code=abc&state=s1',
    )

    await expect(promise).resolves.toEqual({ code: 'abc', state: 's1' })
    expect(response).toEqual({ cancel: true })
    expect(win?.close).toHaveBeenCalledTimes(1)
  })

  it('captures in-page callback navigations', async () => {
    const promise = openDicodeAuthWindow(FakeBrowserWindow as never, 'https://iam.example.com/login')
    const win = FakeBrowserWindow.latest

    win?.webContents.emit(
      'did-navigate-in-page',
      {},
      'https://dicode.example.com/#/callback?code=abc&state=s1',
    )

    await expect(promise).resolves.toEqual({ code: 'abc', state: 's1' })
    expect(win?.close).toHaveBeenCalledTimes(1)
  })

  it('rejects when the user closes the login window before code and state are captured', async () => {
    const promise = openDicodeAuthWindow(FakeBrowserWindow as never, 'https://iam.example.com/login')

    FakeBrowserWindow.latest?.emit('closed')

    await expect(promise).rejects.toThrow('Dicode login window was closed before authentication completed')
  })
})
