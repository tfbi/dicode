import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  shouldFallbackFromNativeWebFetchError,
  WebFetchTool,
} from './WebFetchTool.js'

describe('WebFetchTool enablement', () => {
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

  test('stays enabled for regular CLI sessions', () => {
    expect(WebFetchTool.isEnabled()).toBe(true)
  })

  test('stays enabled for desktop sessions so unsupported native fetch can fallback locally', () => {
    process.env.CC_HAHA_DESKTOP_SERVER_URL = 'http://127.0.0.1:3456'

    expect(WebFetchTool.isEnabled()).toBe(true)
  })

  test('falls back only for native web_fetch support errors', () => {
    expect(
      shouldFallbackFromNativeWebFetchError(
        new Error('422 Extra inputs are not permitted: web_fetch_20260309'),
      ),
    ).toBe(true)
    expect(
      shouldFallbackFromNativeWebFetchError(
        new Error('unsupported server tool web_fetch'),
      ),
    ).toBe(true)
    expect(
      shouldFallbackFromNativeWebFetchError(
        new Error('Native web_fetch timed out after 60000ms'),
      ),
    ).toBe(true)
    expect(shouldFallbackFromNativeWebFetchError(new Error('network timeout'))).toBe(
      false,
    )
  })
})
