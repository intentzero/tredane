import { describe, expect, it } from 'vitest'
import { authorizeSessionRequest } from './oauth'

describe('authorizeSessionRequest (DEC-159 OAuth consent GET)', () => {
  it('sintetiza Origin no GET sem Origin (redirect MCP top-level)', () => {
    const req = new Request('https://staging.app.tredane.com/authorize?x=1', {
      method: 'GET',
      headers: { Referer: 'https://cursor.com/mcp' },
    })
    const out = authorizeSessionRequest(req, {
      APP_BASE_URL: 'https://staging.app.tredane.com',
    } as never)
    expect(out.headers.get('Origin')).toBe('https://staging.app.tredane.com')
  })

  it('não altera POST nem GET que já tem Origin', () => {
    const withOrigin = new Request('https://staging.app.tredane.com/authorize', {
      method: 'GET',
      headers: { Origin: 'https://evil.example' },
    })
    expect(
      authorizeSessionRequest(withOrigin, {
        APP_BASE_URL: 'https://staging.app.tredane.com',
      } as never).headers.get('Origin'),
    ).toBe('https://evil.example')

    const post = new Request('https://staging.app.tredane.com/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'decision=approve',
    })
    expect(
      authorizeSessionRequest(post, {
        APP_BASE_URL: 'https://staging.app.tredane.com',
      } as never).headers.get('Origin'),
    ).toBeNull()
  })
})
