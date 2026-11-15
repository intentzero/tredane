import { describe, expect, it } from 'vitest'
import { authorizeLoginRequiredHtml, authorizeLoginUrl } from './oauth'

describe('authorizeLoginRequiredHtml (DEC-159 OAuth consent)', () => {
  it('inclui link /entrar e escapa HTML na mensagem', () => {
    const html = authorizeLoginRequiredHtml(
      'https://staging.app.tredane.com/entrar?return_to=%2Fauthorize%3Fclient_id%3Dx',
      'Sessão ausente <script>',
    )
    expect(html).toContain(
      'href="https://staging.app.tredane.com/entrar?return_to=%2Fauthorize%3Fclient_id%3Dx"',
    )
    expect(html).toContain('Abrir login Tredane')
    expect(html).toContain('volta a esta autorização')
    expect(html).toContain('Sessão ausente &#60;script&#62;')
    expect(html).not.toContain('<script>')
  })
})

describe('authorizeLoginUrl', () => {
  it('embute return_to com path+query do /authorize (retoma OAuth após Clerk)', () => {
    const url = authorizeLoginUrl(
      'https://staging.app.tredane.com',
      'https://staging.app.tredane.com/authorize?client_id=abc&scope=lab%3Aconverse&resource=https%3A%2F%2Fstaging.app.tredane.com%2Fapi%2Fmcp%2Flab',
    )
    expect(url.startsWith('https://staging.app.tredane.com/entrar?return_to=')).toBe(
      true,
    )
    const returnTo = new URL(url).searchParams.get('return_to')
    expect(returnTo).toBe(
      '/authorize?client_id=abc&scope=lab%3Aconverse&resource=https%3A%2F%2Fstaging.app.tredane.com%2Fapi%2Fmcp%2Flab',
    )
  })
})
