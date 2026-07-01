import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import {
  DicodeAuthService,
  type DicodeAuthTokens,
} from '../services/dicodeAuthService.js'

let tmpDir: string
let originalConfigDir: string | undefined
let service: DicodeAuthService

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dicode-auth-test-'))
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = tmpDir
  await writeConfig({ iam: { enabled: true, loginUrl: 'https://iam.example.com/login' } })
  service = new DicodeAuthService()
}

async function teardown() {
  restoreEnv('CLAUDE_CONFIG_DIR', originalConfigDir)
  await fs.rm(tmpDir, { recursive: true, force: true })
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

async function writeConfig(config: unknown) {
  const configPath = path.join(tmpDir, 'dicode', 'config.json')
  await fs.mkdir(path.dirname(configPath), { recursive: true })
  await fs.writeFile(configPath, JSON.stringify(config, null, 2))
}

describe('DicodeAuthService', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('returns configured login URL', () => {
    expect(service.getLoginUrl()).toBe('https://iam.example.com/login')
  })

  test('builds backend login verification URL from code and state', () => {
    const url = service.buildTokenExchangeUrl({ code: 'abc 123', state: 's/1' })
    expect(url).toBe(
      'https://iam.example.com/admin-api/auth/just-auth-login?code=abc+123&state=s%2F1',
    )
  })

  test('supports custom token path', async () => {
    await fs.writeFile(path.join(tmpDir, 'dicode', 'config.json'), JSON.stringify({
      iam: {
        enabled: true,
        loginUrl: 'https://iam.example.com/login',
        tokenPath: '/internal/auth/login',
      },
    }))
    expect(service.buildTokenExchangeUrl({ code: 'c', state: 's' })).toBe(
      'https://iam.example.com/internal/auth/login?code=c&state=s',
    )
  })

  test('supports host override with full URL', async () => {
    await fs.writeFile(path.join(tmpDir, 'dicode', 'config.json'), JSON.stringify({
      iam: {
        enabled: true,
        loginUrl: 'https://iam.example.com/login',
        host: 'https://auth.example.org',
      },
    }))
    expect(service.buildTokenExchangeUrl({ code: 'c', state: 's' })).toBe(
      'https://auth.example.org/admin-api/auth/just-auth-login?code=c&state=s',
    )
  })

  test('is not configured without config file', async () => {
    await fs.rm(path.join(tmpDir, 'dicode', 'config.json'), { force: true })
    expect(service.isConfigured()).toBe(false)
    expect(service.isRequired()).toBe(false)
  })

  test('is not required when config disables IAM', async () => {
    await writeConfig({ iam: { enabled: false, loginUrl: 'https://iam.example.com/login' } })
    expect(service.isConfigured()).toBe(true)
    expect(service.isRequired()).toBe(false)
  })

  test('saveTokens writes file with 0600 permissions and loadTokens reads it', async () => {
    const tokens: DicodeAuthTokens = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresTime: Date.now() + 3600_000,
      userId: 'E12345',
      userName: 'zhangsan',
      nickName: '张三',
      email: 'zhangsan@example.com',
      deptId: 42,
    }

    await service.saveTokens(tokens)

    const tokenPath = path.join(tmpDir, 'dicode', 'auth.json')
    const stat = await fs.stat(tokenPath)
    if (process.platform !== 'win32') {
      expect(stat.mode & 0o777).toBe(0o600)
    }
    expect(await service.loadTokens()).toEqual(tokens)
  })

  test('status hides refresh token but returns user metadata and access token for local requests', async () => {
    await service.saveTokens({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresTime: Date.now() + 3600_000,
      userId: 'E12345',
      userName: 'zhangsan',
      nickName: '张三',
      email: 'zhangsan@example.com',
      deptId: 42,
    })

    const status = await service.getStatus()

    expect(status).toEqual({
      loggedIn: true,
      required: true,
      configured: true,
      accessToken: 'access-token',
      expiresTime: expect.any(Number),
      user: {
        userId: 'E12345',
        userName: 'zhangsan',
        nickName: '张三',
        email: 'zhangsan@example.com',
        deptId: 42,
      },
    })
    expect(JSON.stringify(status)).not.toContain('refresh-token')
  })

  test('status is loggedOut when token is expired', async () => {
    await service.saveTokens({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresTime: Date.now() - 1_000,
      userId: 'E12345',
    })

    expect(await service.getStatus()).toEqual({
      loggedIn: false,
      required: true,
      configured: true,
    })
  })

  test('exchangeCodeAndState stores token response from IAM backend', async () => {
    service.setFetchFn(async (input) => {
      expect(input.toString()).toBe(
        'https://iam.example.com/admin-api/auth/just-auth-login?code=code-1&state=state-1',
      )
      return new Response(JSON.stringify({
        code: 0,
        data: {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          expiresTime: Date.now() + 3600_000,
          userId: 'E12345',
          userName: 'zhangsan',
          nickName: '张三',
          email: 'zhangsan@example.com',
          deptId: 42,
        },
      }), { status: 200 })
    })

    const tokens = await service.exchangeCodeAndState({ code: 'code-1', state: 'state-1' })

    expect(tokens.accessToken).toBe('access-token')
    expect((await service.loadTokens())?.userId).toBe('E12345')
  })

  test('exchangeCodeAndState rejects non-zero IAM response code', async () => {
    service.setFetchFn(async () => new Response(JSON.stringify({
      code: 401,
      data: {},
    }), { status: 200 }))

    await expect(service.exchangeCodeAndState({ code: 'bad', state: 'bad' }))
      .rejects
      .toThrow('IAM login failed')
  })
})
