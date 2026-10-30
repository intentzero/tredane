import { describe, expect, it } from 'vitest'
import { bootClinicDb } from '../test-db'
import { ValidationError, workerCaller } from '../index'
import { GOOGLE_BUSINESS_URL_MAX_LENGTH, checkGoogleBusinessUrl } from './google-business-link'
import { getConfigSnapshotOp, setAiProfileOp } from './index'
import { buildClinicAiContext } from '../ai/schedule-context'

describe('Link do Google Business — validação', () => {
  it('aceita vazio e https', () => {
    expect(checkGoogleBusinessUrl('  ')).toEqual({ ok: true, value: '' })
    expect(checkGoogleBusinessUrl(' https://maps.app.goo.gl/ficticio123 ')).toEqual({
      ok: true,
      value: 'https://maps.app.goo.gl/ficticio123',
    })
  })
  it.each([
    'http://maps.app.goo.gl/ficticio',
    'maps.app.goo.gl/ficticio',
    'javascript:alert(1)',
    'https://',
    'https://localhost/x',
    'https://user:pass@exemplo.com.br/x',
    'https://exemplo.com.br/a b',
    'ftp://exemplo.com.br',
  ])('recusa %s', (raw) => {
    const r = checkGoogleBusinessUrl(raw)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/https:\/\//)
  })
  it('recusa acima do limite com mensagem clara', () => {
    const r = checkGoogleBusinessUrl(
      `https://exemplo.com.br/${'a'.repeat(GOOGLE_BUSINESS_URL_MAX_LENGTH)}`,
    )
    expect(r).toEqual({
      ok: false,
      message: expect.stringContaining(`${GOOGLE_BUSINESS_URL_MAX_LENGTH} caracteres`),
    })
  })
})

describe('Link do Google Business — persistência e contexto da IA', () => {
  it('persiste com o endereço, preserva quando omitido, recusa inválido e entra no contexto', async () => {
    const { db, clock, close } = bootClinicDb()
    try {
      const caller = workerCaller('clinic-demo-a', 'user_synth_owner_a')
      setAiProfileOp(
        db,
        caller,
        {
          clinicAddress: 'Rua Fictícia, 123',
          googleBusinessUrl: 'https://maps.app.goo.gl/ficticio123',
          reschedulePolicy: null,
        },
        clock,
      )
      let s = getConfigSnapshotOp(db, caller, clock).settings
      expect(s.clinicAddress).toBe('Rua Fictícia, 123')
      expect(s.googleBusinessUrl).toBe('https://maps.app.goo.gl/ficticio123')

      setAiProfileOp(db, caller, { clinicAddress: 'Rua Fictícia, 456' }, clock)
      s = getConfigSnapshotOp(db, caller, clock).settings
      expect(s.googleBusinessUrl).toBe('https://maps.app.goo.gl/ficticio123')

      expect(() =>
        setAiProfileOp(db, caller, { googleBusinessUrl: 'http://exemplo.com.br' }, clock),
      ).toThrow(ValidationError)
      s = getConfigSnapshotOp(db, caller, clock).settings
      expect(s.googleBusinessUrl).toBe('https://maps.app.goo.gl/ficticio123')

      const ctx = await buildClinicAiContext(db, 'clinic-demo-a', clock, {
        contactId: 'contato-ficticio',
        recentTexts: [],
      })
      expect(ctx.googleBusinessUrl).toBe('https://maps.app.goo.gl/ficticio123')

      setAiProfileOp(db, caller, { googleBusinessUrl: '' }, clock)
      expect(getConfigSnapshotOp(db, caller, clock).settings.googleBusinessUrl).toBe('')
    } finally {
      close()
    }
  })
})
