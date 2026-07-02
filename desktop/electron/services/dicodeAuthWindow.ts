import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'

export type DicodeAuthCode = {
  code: string
  state: string
}

type BrowserWindowConstructor = new (options: BrowserWindowConstructorOptions) => BrowserWindow
type NavigationEvent = {
  preventDefault?: () => void
}

function codeFromParams(params: URLSearchParams): DicodeAuthCode | null {
  const code = params.get('code')
  const state = params.get('state')
  if (!code || !state) return null
  return { code, state }
}

export function extractDicodeAuthCode(targetUrl: string): DicodeAuthCode | null {
  try {
    const url = new URL(targetUrl)
    const queryResult = codeFromParams(url.searchParams)
    if (queryResult) return queryResult

    const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash
    if (!hash) return null
    const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : hash
    return codeFromParams(new URLSearchParams(hashQuery))
  } catch {
    return null
  }
}

export function openDicodeAuthWindow(
  BrowserWindowCtor: BrowserWindowConstructor,
  loginUrl: string,
): Promise<DicodeAuthCode> {
  return new Promise((resolve, reject) => {
    const authWindow = new BrowserWindowCtor({
      width: 520,
      height: 720,
      minWidth: 420,
      minHeight: 560,
      title: 'Dicode Login',
      autoHideMenuBar: true,
      show: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        partition: `dicode-auth-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        sandbox: true,
      },
    })

    let settled = false
    const finish = (result: DicodeAuthCode) => {
      if (settled) return
      settled = true
      authWindow.close()
      resolve(result)
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    const inspect = (targetUrl: string) => {
      const result = extractDicodeAuthCode(targetUrl)
      if (result) {
        finish(result)
        return true
      }
      return false
    }
    const interceptNavigation = (event: NavigationEvent, targetUrl: string) => {
      if (inspect(targetUrl)) {
        event.preventDefault?.()
      }
    }

    authWindow.webContents.session.webRequest.onBeforeRequest(
      { urls: ['<all_urls>'] },
      (details, callback) => {
        const shouldCancel = details.resourceType === 'mainFrame' && inspect(details.url)
        callback({ cancel: shouldCancel })
      },
    )
    authWindow.webContents.on('will-redirect', (event, targetUrl) => interceptNavigation(event, targetUrl))
    authWindow.webContents.on('will-navigate', (event, targetUrl) => interceptNavigation(event, targetUrl))
    authWindow.webContents.on('did-navigate', (_event, targetUrl) => inspect(targetUrl))
    authWindow.webContents.on('did-navigate-in-page', (_event, targetUrl) => inspect(targetUrl))
    authWindow.on('closed', () => {
      if (!settled) {
        fail(new Error('Dicode login window was closed before authentication completed'))
      }
    })

    authWindow.loadURL(loginUrl).catch(fail)
  })
}
