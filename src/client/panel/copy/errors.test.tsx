import { describe, expect, it } from 'vitest'
import { PanelApiError } from '../api'
import { errorDetail, friendlyError, friendlyReason } from './errors'

describe('friendlyError', () => {
  it('traduz códigos do servidor', () => {
    expect(friendlyError(new PanelApiError(400, 'unknown', 'invalid_body'))).toBe(
      'Confira os dados e tente de novo.',
    )
    expect(friendlyError(new PanelApiError(409, 'unknown', 'slot_occupied'))).toBe(
      'Esse horário acabou de ser ocupado. Escolha outro.',
    )
  })

  it('traduz erros de aceite de convite (S3)', () => {
    expect(friendlyError(new PanelApiError(409, 'unknown', 'invitation_expired'))).toMatch(
      /expirou/i,
    )
    expect(
      friendlyError(new PanelApiError(409, 'unknown', 'invitation_token_invalid')),
    ).toMatch(/cancelado|usado|substituído/i)
    expect(
      friendlyError(new PanelApiError(409, 'unknown', 'invitation_email_mismatch')),
    ).toMatch(/outro e-mail/i)
    expect(
      friendlyError(new PanelApiError(403, 'unknown', 'invitation_email_unverified')),
    ).toMatch(/Confirme o e-mail/i)
  })

  it('traduz o código tipado da API quando a mensagem é o próprio código', () => {
    expect(friendlyError(new PanelApiError(403, 'permission_denied'))).toBe(
      'Só o responsável pela clínica pode fazer isso.',
    )
    expect(friendlyError(new PanelApiError(401, 'session_expired'))).toBe(
      'Sua sessão terminou. Entre de novo para continuar.',
    )
  })

  it('usa o status HTTP quando o código é desconhecido', () => {
    expect(friendlyError(new PanelApiError(404, 'unknown', 'algo_novo'))).toBe(
      'Não encontramos isso. Pode ter sido removido.',
    )
    expect(friendlyError(new PanelApiError(503, 'unknown', 'algo_novo'))).toBe(
      'Algo deu errado do nosso lado. Tente de novo em instantes.',
    )
  })

  it('erro interno do servidor vira «do nosso lado», sem texto técnico', () => {
    expect(friendlyError(new PanelApiError(500, 'unknown', 'internal_error'))).toBe(
      'Algo deu errado do nosso lado. Tente de novo em instantes.',
    )
  })

  it('mantém mensagens que já são frases', () => {
    const msg = 'A conexão com o WhatsApp ainda não está liberada. Fale com o suporte.'
    expect(friendlyError(new PanelApiError(501, 'unknown', msg))).toBe(msg)
  })

  it('nunca devolve o código cru', () => {
    for (const code of ['meta_live_missing_credentials', 'zzz_inventado', 'invalid_state']) {
      expect(friendlyError(new PanelApiError(0, 'unknown', code))).not.toContain('_')
    }
  })

  it('sem rede mostra o aviso de internet; erro desconhecido usa o texto de reserva', () => {
    expect(friendlyError(new TypeError('Failed to fetch'))).toContain('Sem conexão com a internet')
    // o cliente da API embrulha a falha do fetch em PanelApiError(0, 'network', mensagem do navegador)
    expect(friendlyError(new PanelApiError(0, 'network', 'Failed to fetch'))).toContain('Sem conexão com a internet')
    expect(friendlyError(new PanelApiError(0, 'network', 'Load failed'))).toContain('Sem conexão com a internet')
    expect(friendlyError(new Error('boom'), 'Não foi possível enviar.')).toBe(
      'Não foi possível enviar.',
    )
  })
})

describe('errorDetail', () => {
  it('guarda o código para o suporte', () => {
    expect(errorDetail(new PanelApiError(400, 'unknown', 'invalid_body'))).toBe(
      'invalid_body · HTTP 400',
    )
    expect(errorDetail(new PanelApiError(403, 'permission_denied'))).toBe(
      'permission_denied · HTTP 403',
    )
  })
})

describe('friendlyReason', () => {
  it('traduz o motivo da interrupção do WhatsApp', () => {
    expect(friendlyReason('meta_live_missing_credentials')).toContain('suporte do Tredane')
    expect(friendlyReason('meta_http_400_131030')).toContain('A Meta recusou')
  })

  it('mantém frases e esconde códigos desconhecidos', () => {
    expect(friendlyReason('Autorização removida ou expirada')).toBe(
      'Autorização removida ou expirada',
    )
    expect(friendlyReason('codigo_estranho')).toBeNull()
    expect(friendlyReason(null)).toBeNull()
  })
})
