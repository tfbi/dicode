import { describe, expect, it } from 'vitest'
import { shouldStartDicodeAdapters } from './serverRuntime'

describe('Electron server runtime', () => {
  it('keeps IM adapter sidecars disabled for Dicode desktop startup', () => {
    expect(shouldStartDicodeAdapters()).toBe(false)
  })
})
