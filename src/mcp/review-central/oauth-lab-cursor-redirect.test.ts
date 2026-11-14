import { describe, expect, it } from 'vitest'
import {
  LAB_MCP_SCOPE,
  mcpOAuthAuthorizationServerOptions,
  unauthorizedLabMcpResponse,
} from './oauth'
import type { WorkerBindings } from '../../worker/bindings'

describe('OAuth AS — Cursor Desktop private-use redirect (Lab)', () => {
  it('permite cursor:// no AS (senão /authorize devolve Invalid redirect URI → Declined)', () => {
    const opts = mcpOAuthAuthorizationServerOptions(
      { APP_BASE_URL: 'https://staging.app.tredane.com' } as WorkerBindings,
      'https://staging.app.tredane.com/authorize',
    )
    expect(opts.allowPrivateUseRedirectUris).toBe(true)
    expect(opts.resources).toContain('https://staging.app.tredane.com/api/mcp/lab')
    expect(opts.scopesSupported).toContain(LAB_MCP_SCOPE)
  })

  it('401 do Lab inclui scope lab:converse no WWW-Authenticate', () => {
    const res = unauthorizedLabMcpResponse(
      { OAUTH_KV: {} } as WorkerBindings,
      'https://staging.app.tredane.com/api/mcp/lab',
    )
    const wa = res.headers.get('WWW-Authenticate') ?? ''
    expect(wa).toContain('resource_metadata="https://staging.app.tredane.com/.well-known/oauth-protected-resource/api/mcp/lab"')
    expect(wa).toContain(`scope="${LAB_MCP_SCOPE}"`)
  })
})
