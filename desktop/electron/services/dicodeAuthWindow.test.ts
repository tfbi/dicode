import { describe, expect, it } from 'vitest'
import { extractDicodeAuthCode } from './dicodeAuthWindow'

describe('dicode auth window helpers', () => {
  it('extracts code and state from redirect URL query params', () => {
    expect(extractDicodeAuthCode('https://iam.example.com/callback?code=abc&state=s1')).toEqual({
      code: 'abc',
      state: 's1',
    })
  })

  it('returns null when redirect URL does not include both code and state', () => {
    expect(extractDicodeAuthCode('https://iam.example.com/login')).toBeNull()
    expect(extractDicodeAuthCode('https://iam.example.com/callback?code=abc')).toBeNull()
    expect(extractDicodeAuthCode('not a url')).toBeNull()
  })
})
