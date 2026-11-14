import { describe, expect, it } from 'vitest'
import {
  authorizeRequestWithInferredResource,
  LAB_MCP_SCOPE,
} from './oauth'
import { REVIEW_SAMPLES_SCOPE } from '../../review-samples'
import type { WorkerBindings } from '../../worker/bindings'

const env = { APP_BASE_URL: 'https://staging.app.tredane.com' } as WorkerBindings

function authorizeUrl(params: Record<string, string>): Request {
  const u = new URL('https://staging.app.tredane.com/authorize')
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  return new Request(u)
}

describe('authorizeRequestWithInferredResource (Cursor omits resource)', () => {
  it('injeta resource do Lab quando scope=lab:converse e resource falta', () => {
    const out = authorizeRequestWithInferredResource(
      authorizeUrl({
        response_type: 'code',
        client_id: 'c',
        redirect_uri: 'cursor://anysphere.cursor-mcp/oauth/callback',
        scope: LAB_MCP_SCOPE,
      }),
      env,
    )
    expect(new URL(out.url).searchParams.get('resource')).toBe(
      'https://staging.app.tredane.com/api/mcp/lab',
    )
  })

  it('injeta resource do Review quando scope=review_samples:read', () => {
    const out = authorizeRequestWithInferredResource(
      authorizeUrl({
        response_type: 'code',
        client_id: 'c',
        redirect_uri: 'https://www.cursor.com/agents/mcp/oauth/callback',
        scope: `${REVIEW_SAMPLES_SCOPE} offline_access`,
      }),
      env,
    )
    expect(new URL(out.url).searchParams.get('resource')).toBe(
      'https://staging.app.tredane.com/api/mcp/review-central',
    )
  })

  it('não altera resource já presente', () => {
    const existing = 'https://staging.app.tredane.com/api/mcp/lab'
    const out = authorizeRequestWithInferredResource(
      authorizeUrl({
        scope: LAB_MCP_SCOPE,
        resource: existing,
      }),
      env,
    )
    expect(new URL(out.url).searchParams.get('resource')).toBe(existing)
  })

  it('não inventa resource se scope pede Lab e Review juntos', () => {
    const out = authorizeRequestWithInferredResource(
      authorizeUrl({
        scope: `${LAB_MCP_SCOPE} ${REVIEW_SAMPLES_SCOPE}`,
      }),
      env,
    )
    expect(new URL(out.url).searchParams.get('resource')).toBeNull()
  })

  it('não inventa resource sem scope útil', () => {
    const out = authorizeRequestWithInferredResource(
      authorizeUrl({ scope: 'offline_access' }),
      env,
    )
    expect(new URL(out.url).searchParams.get('resource')).toBeNull()
  })
})
