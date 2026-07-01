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
let originalLoginUrl: string | undefined
let originalHost: string | undefined
let originalTokenPath: string | undefined
let service: DicodeAuthService

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dicode-auth-test-'))
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  originalLoginUrl = process.env.DICODE_IAM_LOGIN_URL
  originalHost = process.env.DICODE_IAM_HOST
  originalTokenPath = process.env.DICODE_IAM_TOKEN_PATH
  process.env.CLAUDE_CONFIG_DIR = tmpDir
  process.env.DICODE_IAM_LOGIN_URL = 'https://iam.example.com/login'
  delete process.env.DICODE_IAM_HOST
  delete process.env.DICODE_IAM_TOKEN_PATH
  service = new DicodeAuthService()
}

async function teardown() {
  restoreEnv('CLAUDE_CONFIG_DIR', originalConfigDir)
  restoreEnv('DICODE_IAM_LOGIN_URL', originalLoginUrl)
  restoreEnv('DICODE_IAM_HOST', originalHost)
  restoreEnv('DICODE_IAM_TOKEN_PATH', originalTokenPath)
  await fs.rm(tmpDir, { recursive: true, force: true })
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
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

  test('supports custom token path', () => {
    process.env.DICODE_IAM_TOKEN_PATH = '/internal/auth/login'
    expect(service.buildTokenExchangeUrl({ code: 'c', state: 's' })).toBe(
      'https://iam.example.com/internal/auth/login?code=c&state=s',
    )
  })

  test('supports host override with full URL', () => {
    process.env.DICODE_IAM_HOST = 'https://auth.example.org'
    expect(service.buildTokenExchangeUrl({ code: 'c', state: 's' })).toBe(
      'https://auth.example.org/admin-api/auth/just-auth-login?code=c&state=s',
    )
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
