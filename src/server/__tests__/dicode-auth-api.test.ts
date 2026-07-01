import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { handleDicodeAuthApi } from '../api/dicode-auth.js'
import { dicodeAuthService } from '../services/dicodeAuthService.js'

let tmpDir: string
let originalConfigDir: string | undefined
let originalArgv: string[]
let configPath: string

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dicode-auth-api-test-'))
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR
  originalArgv = process.argv
  process.env.CLAUDE_CONFIG_DIR = tmpDir
  configPath = path.join(tmpDir, 'bundled-dicode-config.json')
  process.argv = [...originalArgv, '--dicode-config-path', configPath]
  await writeConfig({ iam: { enabled: true, loginUrl: 'https://iam.example.com/login' } })
}

async function teardown() {
  restoreEnv('CLAUDE_CONFIG_DIR', originalConfigDir)
  process.argv = originalArgv
  dicodeAuthService.resetFetchFn()
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
  await fs.mkdir(path.dirname(configPath), { recursive: true })
  await fs.writeFile(configPath, JSON.stringify(config, null, 2))
}

function buildReq(method: string, pathname: string): { req: Request; url: URL; segments: string[] } {
  const url = new URL(`http://localhost:3456${pathname}`)
  const req = new Request(url.toString(), { method })
  const segments = url.pathname.split('/').filter(Boolean)
  return { req, url, segments }
}

describe('Dicode auth API', () => {
  beforeEach(setup)
  afterEach(teardown)

  test('POST /api/dicode-auth/start returns configured authorize URL', async () => {
    const { req, url, segments } = buildReq('POST', '/api/dicode-auth/start')

    const res = await handleDicodeAuthApi(req, url, segments)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ authorizeUrl: 'https://iam.example.com/login' })
  })

  test('POST /api/dicode-auth/exchange stores IAM token response', async () => {
    dicodeAuthService.setFetchFn(async () => new Response(JSON.stringify({
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
    }), { status: 200 }))
    const { req, url, segments } = buildReq(
      'POST',
      '/api/dicode-auth/exchange?code=code-1&state=state-1',
    )

    const res = await handleDicodeAuthApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = await res.json() as { loggedIn: boolean; accessToken?: string }
    expect(body.loggedIn).toBe(true)
    expect(body.accessToken).toBe('access-token')
    expect(JSON.stringify(body)).not.toContain('refresh-token')
  })

  test('GET /api/dicode-auth/me returns loggedIn=false when no token is stored', async () => {
    const { req, url, segments } = buildReq('GET', '/api/dicode-auth/me')

    const res = await handleDicodeAuthApi(req, url, segments)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      loggedIn: false,
      required: true,
      configured: true,
      hostUrl: 'https://iam.example.com',
    })
  })

  test('DELETE /api/dicode-auth clears token file', async () => {
    await dicodeAuthService.saveTokens({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresTime: Date.now() + 3600_000,
    })
    const { req, url, segments } = buildReq('DELETE', '/api/dicode-auth')

    const res = await handleDicodeAuthApi(req, url, segments)

    expect(res.status).toBe(200)
    expect(await dicodeAuthService.loadTokens()).toBeNull()
  })
})
