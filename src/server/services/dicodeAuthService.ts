import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

export type DicodeAuthTokens = {
  accessToken: string
  refreshToken?: string
  expiresTime: number
  userId?: string
  userName?: string
  nickName?: string
  email?: string
  deptId?: number
}

export type DicodeAuthUser = {
  userId?: string
  userName?: string
  nickName?: string
  email?: string
  deptId?: number
}

export type DicodeAuthStatus =
  | {
      loggedIn: false
      required: boolean
      configured: boolean
    }
  | {
      loggedIn: true
      required: boolean
      configured: boolean
      accessToken: string
      expiresTime: number
      user: DicodeAuthUser
    }

type TokenExchangeInput = {
  code: string
  state: string
}

type FetchFn = typeof fetch

type IamTokenResponse = {
  code: number
  data?: {
    accessToken?: string
    refreshToken?: string
    expiresTime?: number
    userId?: string
    userName?: string
    nickName?: string
    email?: string
    deptId?: number
  }
  msg?: string
  message?: string
}

const DEFAULT_TOKEN_PATH = '/admin-api/auth/just-auth-login'

export class DicodeAuthService {
  private fetchFn: FetchFn = fetch

  setFetchFn(fn: FetchFn): void {
    this.fetchFn = fn
  }

  resetFetchFn(): void {
    this.fetchFn = fetch
  }

  isConfigured(): boolean {
    return Boolean(this.loginUrl())
  }

  isRequired(): boolean {
    if (process.env.DICODE_IAM_REQUIRED === '0') return false
    if (process.env.DICODE_IAM_REQUIRED === '1') return true
    return this.isConfigured()
  }

  getLoginUrl(): string {
    const loginUrl = this.loginUrl()
    if (!loginUrl) {
      throw new Error('DICODE_IAM_LOGIN_URL is not configured')
    }
    return loginUrl
  }

  buildTokenExchangeUrl({ code, state }: TokenExchangeInput): string {
    const host = this.iamHost()
    if (!host) {
      throw new Error('DICODE_IAM_LOGIN_URL or DICODE_IAM_HOST is not configured')
    }
    const loginURL = new URL('https://placeholder.local')
    loginURL.protocol = 'https:'
    loginURL.host = host
    loginURL.pathname = process.env.DICODE_IAM_TOKEN_PATH || DEFAULT_TOKEN_PATH
    loginURL.searchParams.set('code', code)
    loginURL.searchParams.set('state', state)
    return loginURL.toString()
  }

  async exchangeCodeAndState(input: TokenExchangeInput): Promise<DicodeAuthTokens> {
    const url = this.buildTokenExchangeUrl(input)
    const res = await this.fetchFn(url)
    if (!res.ok) {
      throw new Error(`IAM login failed (${res.status}): ${await res.text()}`)
    }
    const body = await res.json() as IamTokenResponse
    if (body.code !== 0) {
      throw new Error(`IAM login failed: ${body.message ?? body.msg ?? body.code}`)
    }
    const data = body.data
    if (!data?.accessToken || typeof data.expiresTime !== 'number') {
      throw new Error('IAM login failed: missing accessToken or expiresTime')
    }

    const tokens: DicodeAuthTokens = {
      accessToken: data.accessToken,
      ...(data.refreshToken ? { refreshToken: data.refreshToken } : {}),
      expiresTime: data.expiresTime,
      ...(data.userId ? { userId: data.userId } : {}),
      ...(data.userName ? { userName: data.userName } : {}),
      ...(data.nickName ? { nickName: data.nickName } : {}),
      ...(data.email ? { email: data.email } : {}),
      ...(typeof data.deptId === 'number' ? { deptId: data.deptId } : {}),
    }
    await this.saveTokens(tokens)
    return tokens
  }

  async loadTokens(): Promise<DicodeAuthTokens | null> {
    try {
      const raw = await fs.readFile(this.getAuthFilePath(), 'utf-8')
      return JSON.parse(raw) as DicodeAuthTokens
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  async saveTokens(tokens: DicodeAuthTokens): Promise<void> {
    const filePath = this.getAuthFilePath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const tmp = `${filePath}.tmp.${process.pid}`
    await fs.writeFile(tmp, JSON.stringify(tokens, null, 2), { mode: 0o600 })
    await fs.rename(tmp, filePath)
  }

  async deleteTokens(): Promise<void> {
    try {
      await fs.unlink(this.getAuthFilePath())
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }

  async getStatus(): Promise<DicodeAuthStatus> {
    const required = this.isRequired()
    const configured = this.isConfigured()
    const tokens = await this.loadTokens()
    if (!tokens || this.isExpired(tokens)) {
      return { loggedIn: false, required, configured }
    }
    return {
      loggedIn: true,
      required,
      configured,
      accessToken: tokens.accessToken,
      expiresTime: tokens.expiresTime,
      user: this.toUser(tokens),
    }
  }

  async validateAccessToken(token: string): Promise<boolean> {
    const tokens = await this.loadTokens()
    return Boolean(tokens && !this.isExpired(tokens) && tokens.accessToken === token)
  }

  private toUser(tokens: DicodeAuthTokens): DicodeAuthUser {
    return {
      ...(tokens.userId ? { userId: tokens.userId } : {}),
      ...(tokens.userName ? { userName: tokens.userName } : {}),
      ...(tokens.nickName ? { nickName: tokens.nickName } : {}),
      ...(tokens.email ? { email: tokens.email } : {}),
      ...(typeof tokens.deptId === 'number' ? { deptId: tokens.deptId } : {}),
    }
  }

  private isExpired(tokens: DicodeAuthTokens): boolean {
    return tokens.expiresTime <= Date.now()
  }

  private getAuthFilePath(): string {
    const configDir =
      process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
    return path.join(configDir, 'dicode', 'auth.json')
  }

  private loginUrl(): string | undefined {
    const value = process.env.DICODE_IAM_LOGIN_URL?.trim()
    return value || undefined
  }

  private iamHost(): string | undefined {
    const value = process.env.DICODE_IAM_HOST?.trim()
    if (value) {
      try {
        return new URL(value).host
      } catch {
        return value
      }
    }
    const loginUrl = this.loginUrl()
    if (!loginUrl) return undefined
    try {
      return new URL(loginUrl).host
    } catch {
      return undefined
    }
  }
}

export const dicodeAuthService = new DicodeAuthService()
