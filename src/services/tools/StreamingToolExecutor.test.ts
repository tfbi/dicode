import { describe, expect, test } from 'bun:test'
import { getStreamingToolExecutionTimeoutMs } from './StreamingToolExecutor.js'

describe('getStreamingToolExecutionTimeoutMs', () => {
  test('caps web tools so one hung search cannot block the whole turn', () => {
    expect(getStreamingToolExecutionTimeoutMs('WebSearch')).toBe(25_000)
    expect(getStreamingToolExecutionTimeoutMs('WebFetch')).toBe(60_000)
  })

  test('leaves regular tools uncapped by the streaming executor', () => {
    expect(getStreamingToolExecutionTimeoutMs('Read')).toBeNull()
    expect(getStreamingToolExecutionTimeoutMs('Bash')).toBeNull()
  })
})
