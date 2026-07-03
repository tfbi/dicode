import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import { createServer } from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { startServer } from '../index.js'
import { ProviderService } from '../services/providerService.js'

let server: ReturnType<typeof Bun.serve> | undefined
let baseUrl = ''
let tmpDir = ''
let originalArgv: string[]
let originalConfigDir: string | undefined
let originalServerAuthRequired: string | undefined
let originalServerPort = 3456

async function availablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (!address || typeof address === 'string') {
        probe.close(() => reject(new Error('Failed to allocate test port')))
        return
      }
      const port = address.port
      probe.close(() => resolve(port))
    })
  })
}

async function waitForServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {}
    await Bun.sleep(50)
  }
  throw new Error(`Timed out waiting for server at ${url}`)
}

async function writeDicodeConfig(): Promise<string> {
  const configPath = path.join(tmpDir, 'bundled-dicode-config.json')
  await fs.writeFile(configPath, JSON.stringify({
    iam: {
      enabled: true,
      loginUrl: 'https://iam.example.com/login',
    },
  }))
  return configPath
}

async function writeAuthJson(expiresTime: number): Promise<void> {
  const authPath = path.join(tmpDir, 'dicode', 'auth.json')
  await fs.mkdir(path.dirname(authPath), { recursive: true })
  await fs.writeFile(authPath, JSON.stringify({
    accessToken: 'dicode-token',
    refreshToken: 'refresh-token',
    expiresTime,
    userId: 'E12345',
    userName: 'zhangsan',
  }))
}

async function startDicodeServer(): Promise<void> {
  const port = await availablePort()
  server = startServer(port, '127.0.0.1')
  baseUrl = `http://127.0.0.1:${port}`
  await waitForServer(`${baseUrl}/health`)
}

describe('Dicode auth gate', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dicode-auth-gate-test-'))
    originalArgv = process.argv
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    originalServerAuthRequired = process.env.SERVER_AUTH_REQUIRED
    originalServerPort = ProviderService.getServerPort()
    process.env.CLAUDE_CONFIG_DIR = tmpDir
    delete process.env.SERVER_AUTH_REQUIRED
    const configPath = await writeDicodeConfig()
    process.argv = [...originalArgv, '--dicode-config-path', configPath]
    await startDicodeServer()
  })

  afterEach(async () => {
    server?.stop(true)
    server = undefined
    ProviderService.setServerPort(originalServerPort)
    process.argv = originalArgv
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    if (originalServerAuthRequired === undefined) delete process.env.SERVER_AUTH_REQUIRED
    else process.env.SERVER_AUTH_REQUIRED = originalServerAuthRequired
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('reports logged out when local auth.json is missing or expired', async () => {
    let response = await fetch(`${baseUrl}/api/dicode-auth/me`)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ loggedIn: false, required: true })

    await writeAuthJson(Date.now() - 1_000)
    response = await fetch(`${baseUrl}/api/dicode-auth/me`)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ loggedIn: false, required: true })
  })

  test('requires a non-expired Dicode token for local API, preview, file, proxy, and websocket routes', async () => {
    const protectedRequests = [
      fetch(`${baseUrl}/api/status`),
      fetch(`${baseUrl}/preview-fs/session-1/index.html`),
      fetch(`${baseUrl}/local-file/${encodeURIComponent(path.join(tmpDir, 'x.txt'))}`),
      fetch(`${baseUrl}/proxy/v1/messages`, { method: 'POST', body: '{}' }),
      fetch(`${baseUrl}/ws/session-1`, {
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
        },
      }),
    ]

    for (const response of await Promise.all(protectedRequests)) {
      expect(response.status).toBe(401)
      await expect(response.json()).resolves.toMatchObject({
        message: 'Dicode IAM login required',
      })
    }

    await writeAuthJson(Date.now() - 1_000)
    const expiredResponse = await fetch(`${baseUrl}/api/status`, {
      headers: { Authorization: 'Bearer dicode-token' },
    })
    expect(expiredResponse.status).toBe(401)
    await expect(expiredResponse.json()).resolves.toMatchObject({
      message: 'Invalid or expired Dicode IAM token',
    })

    await writeAuthJson(Date.now() + 3600_000)
    const validResponse = await fetch(`${baseUrl}/api/status`, {
      headers: { Authorization: 'Bearer dicode-token' },
    })
    expect(validResponse.status).toBe(200)
  })
})
