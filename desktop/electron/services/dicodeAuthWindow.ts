import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'

export type DicodeAuthCode = {
  code: string
  state: string
}

type BrowserWindowConstructor = new (options: BrowserWindowConstructorOptions) => BrowserWindow

export function extractDicodeAuthCode(targetUrl: string): DicodeAuthCode | null {
  try {
    const url = new URL(targetUrl)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    if (!code || !state) return null
    return { code, state }
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
      }
    }

    authWindow.webContents.on('will-redirect', (_event, targetUrl) => inspect(targetUrl))
    authWindow.webContents.on('will-navigate', (_event, targetUrl) => inspect(targetUrl))
    authWindow.webContents.on('did-navigate', (_event, targetUrl) => inspect(targetUrl))
    authWindow.on('closed', () => {
      if (!settled) {
        fail(new Error('Dicode login window was closed before authentication completed'))
      }
    })

    authWindow.loadURL(loginUrl).catch(fail)
  })
}
