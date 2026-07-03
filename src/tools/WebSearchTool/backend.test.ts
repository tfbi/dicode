import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  isLikelyClaudeModel,
  isWebSearchEnabledForModel,
  resolveWebSearchProvider,
  shouldFallbackFromNativeError,
} from './backend.js'

describe('WebSearch backend resolver', () => {
  const originalDesktopServerUrl = process.env.CC_HAHA_DESKTOP_SERVER_URL

  beforeEach(() => {
    delete process.env.CC_HAHA_DESKTOP_SERVER_URL
  })

  afterEach(() => {
    if (originalDesktopServerUrl === undefined) {
      delete process.env.CC_HAHA_DESKTOP_SERVER_URL
    } else {
      process.env.CC_HAHA_DESKTOP_SERVER_URL = originalDesktopServerUrl
    }
  })

  test('detects Claude models by model name instead of provider URL', () => {
    expect(isLikelyClaudeModel('claude-sonnet-4-5')).toBe(true)
    expect(isLikelyClaudeModel('anthropic/claude-3-7-sonnet')).toBe(true)
    expect(isLikelyClaudeModel('anthropic.claude-opus-4-1')).toBe(true)
    expect(isLikelyClaudeModel('MiniMax-M2.7-highspeed')).toBe(false)
  })

  test('auto mode prefers native Anthropic web search for Claude model names', () => {
    expect(
      resolveWebSearchProvider('anthropic/claude-3-7-sonnet', {
        mode: 'auto',
        tavilyApiKey: 'tvly-key',
        braveApiKey: 'brave-key',
      }).provider,
    ).toBe('anthropic')
  })

  test('auto mode keeps WebSearch available for non-Claude models with fallback keys', () => {
    expect(
      resolveWebSearchProvider('gpt-5.4', {
        mode: 'auto',
        tavilyApiKey: 'tvly-key',
        braveApiKey: 'brave-key',
      }).provider,
    ).toBe('tavily')

    expect(
      resolveWebSearchProvider('gpt-5.4', {
        mode: 'auto',
        braveApiKey: 'brave-key',
      }).provider,
    ).toBe('brave')
  })

  test('desktop sessions try native WebSearch for non-Claude models before external fallback', () => {
    process.env.CC_HAHA_DESKTOP_SERVER_URL = 'http://127.0.0.1:3456'

    expect(
      resolveWebSearchProvider('deepseek-v4-pro', {
        mode: 'auto',
      }).provider,
    ).toBe('anthropic')

    expect(isWebSearchEnabledForModel('deepseek-v4-pro', { mode: 'auto' })).toBe(
      true,
    )
  })

  test('explicit provider modes require their API key', () => {
    expect(resolveWebSearchProvider('gpt-5.4', { mode: 'tavily' }).provider).toBe(
      'disabled',
    )
    expect(
      resolveWebSearchProvider('gpt-5.4', {
        mode: 'brave',
        braveApiKey: 'brave-key',
      }).provider,
    ).toBe('brave')
  })

  test('isEnabled reflects native Claude or external fallback availability', () => {
    expect(isWebSearchEnabledForModel('claude-sonnet-4-5', { mode: 'auto' })).toBe(
      true,
    )
    expect(
      isWebSearchEnabledForModel('qwen3-coder', {
        mode: 'auto',
        tavilyApiKey: 'tvly-key',
      }),
    ).toBe(true)
    expect(isWebSearchEnabledForModel('qwen3-coder', { mode: 'auto' })).toBe(
      false,
    )
  })

  test('falls back on native tool schema/provider mismatch errors', () => {
    expect(
      shouldFallbackFromNativeError(
        new Error('422 Extra inputs are not permitted: web_search_20250305'),
      ),
    ).toBe(true)
    expect(shouldFallbackFromNativeError(new Error('network timeout'))).toBe(
      false,
    )
  })
})
