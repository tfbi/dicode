import { describe, expect, test } from 'bun:test'

import { handleApiRequest } from '../router.js'

describe('Dicode adapters route', () => {
  test('does not expose IM adapter APIs through the desktop server router', async () => {
    const url = new URL('http://127.0.0.1:3456/api/adapters')
    const response = await handleApiRequest(new Request(url), url)
    const body = await response.json() as { error?: string, message?: string }

    expect(response.status).toBe(404)
    expect(body.error).toBe('Not Found')
    expect(body.message).toBe('Unknown API resource: adapters')
  })
})
