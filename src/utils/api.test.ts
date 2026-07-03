import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../Tool.js'
import { WebFetchTool } from '../tools/WebFetchTool/WebFetchTool.js'
import { toolToAPISchema } from './api.js'

describe('toolToAPISchema', () => {
  test('uses Anthropic server-side web_fetch for WebFetch', async () => {
    const schema = await toolToAPISchema(WebFetchTool, {
      getToolPermissionContext: async () => getEmptyToolPermissionContext(),
      tools: [],
      agents: [],
    })

    expect(schema).toMatchObject({
      name: 'web_fetch',
      type: 'web_fetch_20260309',
    })
    expect('input_schema' in schema).toBe(false)
  })
})
