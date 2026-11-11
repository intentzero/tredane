import { describe, expect, it } from 'vitest'
import { authorizeLoginRequiredHtml } from './oauth'

describe('authorizeLoginRequiredHtml (DEC-159 OAuth consent)', () => {
  it('inclui link /entrar e escapa HTML na mensagem', () => {
    const html = authorizeLoginRequiredHtml(
      'https://staging.app.tredane.com/entrar',
      'Sessão ausente <script>',
    )
    expect(html).toContain('href="https://staging.app.tredane.com/entrar"')
    expect(html).toContain('Abrir login Tredane')
    expect(html).toContain('Sessão ausente &#60;script&#62;')
    expect(html).not.toContain('<script>')
  })
})
