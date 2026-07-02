import * as fs from 'fs'
import * as fsp from 'fs/promises'
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
      hostUrl?: string
    }
  | {
      loggedIn: true
      required: boolean
      configured: boolean
      hostUrl?: string
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

type DicodeConfig = {
  iam?: {
    enabled?: boolean
    loginUrl?: string
    host?: string
    tokenPath?: string
  }
}

const DEFAULT_TOKEN_PATH = '/admin-api/auth/just-auth-login'
const DICODE_CONFIG_PATH_ARG = '--dicode-config-path'

type DicodeAuthServiceOptions = {
  configPath?: string | null
}

export class DicodeAuthService {
  private fetchFn: FetchFn = fetch
  private readonly configPath: string | null

  constructor(options: DicodeAuthServiceOptions = {}) {
    this.configPath = options.configPath ?? readArgValue(DICODE_CONFIG_PATH_ARG) ?? null
  }

  setFetchFn(fn: FetchFn): void {
    this.fetchFn = fn
  }

  resetFetchFn(): void {
    this.fetchFn = fetch
  }

  isConfigured(): boolean {
    return Boolean(this.readIamConfig().loginUrl)
  }

  isRequired(): boolean {
    const config = this.readIamConfig()
    return config.enabled === true && Boolean(config.loginUrl)
  }

  getLoginUrl(): string {
    const loginUrl = this.loginUrl()
    if (!loginUrl) {
      throw new Error('Dicode IAM loginUrl is not configured in dicode/config.json')
    }
    return loginUrl
  }

  buildTokenExchangeUrl({ code, state }: TokenExchangeInput): string {
    const host = this.iamHost()
    if (!host) {
      throw new Error('Dicode IAM host or loginUrl is not configured in dicode/config.json')
    }
    const loginURL = new URL('https://placeholder.local')
    loginURL.protocol = 'https:'
    loginURL.host = host
    loginURL.pathname = this.readIamConfig().tokenPath || DEFAULT_TOKEN_PATH
    loginURL.searchParams.set('code', code)
    loginURL.searchParams.set('state', state)
    return loginURL.toString()
  }

  getHostUrl(): string | undefined {
    const config = this.readIamConfig()
    const host = config.host?.trim()
    if (host) {
      try {
        const parsed = new URL(host)
        return parsed.origin
      } catch {
        return `https://${host}`
      }
    }
    const loginUrl = this.loginUrl()
    if (!loginUrl) return undefined
    try {
      return new URL(loginUrl).origin
    } catch {
      return undefined
    }
  }

  async exchangeCodeAndState(input: TokenExchangeInput): Promise<DicodeAuthTokens> {
    const url = this.buildTokenExchangeUrl(input)
    const res = await this.fetchFn(url)
    if (!res.ok) {
      throw new Error(`IAM login failed (${res.status}): ${await res.text()}`)
    }
    const body = await readIamTokenResponse(res)
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
      const raw = await fsp.readFile(this.getAuthFilePath(), 'utf-8')
      return JSON.parse(raw) as DicodeAuthTokens
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  async saveTokens(tokens: DicodeAuthTokens): Promise<void> {
    const filePath = this.getAuthFilePath()
    await fsp.mkdir(path.dirname(filePath), { recursive: true })
    const tmp = `${filePath}.tmp.${process.pid}`
    await fsp.writeFile(tmp, JSON.stringify(tokens, null, 2), { mode: 0o600 })
    await fsp.rename(tmp, filePath)
  }

  async deleteTokens(): Promise<void> {
    try {
      await fsp.unlink(this.getAuthFilePath())
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }

  async getStatus(): Promise<DicodeAuthStatus> {
    const required = this.isRequired()
    const configured = this.isConfigured()
    const hostUrl = this.getHostUrl()
    const tokens = await this.loadTokens()
    if (!tokens || this.isExpired(tokens)) {
      return { loggedIn: false, required, configured, ...(hostUrl ? { hostUrl } : {}) }
    }
    return {
      loggedIn: true,
      required,
      configured,
      ...(hostUrl ? { hostUrl } : {}),
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

  private getConfigFilePath(): string {
    const configPath = this.configPath ?? readArgValue(DICODE_CONFIG_PATH_ARG)
    if (!configPath) {
      throw new Error('Dicode bundled config path is not configured')
    }
    return configPath
  }

  private readIamConfig(): NonNullable<DicodeConfig['iam']> {
    if (!this.configPath && !readArgValue(DICODE_CONFIG_PATH_ARG)) return {}
    try {
      const raw = fs.readFileSync(this.getConfigFilePath(), 'utf-8')
      const parsed = JSON.parse(raw) as DicodeConfig
      return parsed.iam ?? {}
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw err
    }
  }

  private loginUrl(): string | undefined {
    const value = this.readIamConfig().loginUrl?.trim()
    return value || undefined
  }

  private iamHost(): string | undefined {
    const value = this.readIamConfig().host?.trim()
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

async function readIamTokenResponse(res: Response): Promise<IamTokenResponse> {
  try {
    return await res.json() as IamTokenResponse
  } catch {
    throw new Error('IAM login failed: invalid JSON response from IAM token endpoint')
  }
}

function readArgValue(flag: string): string | undefined {
  const args = process.argv.slice(2)
  const index = args.indexOf(flag)
  if (index === -1) return undefined
  return args[index + 1]
}

export const dicodeAuthService = new DicodeAuthService()
