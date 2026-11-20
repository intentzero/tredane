import { describe, expect, it } from 'vitest'
import { catalogReply } from './catalog-reply'
import { createControllableClock } from '../../db/clock'
import { workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { setAiProfileOp } from '../config'
import { updatePixSignalSettings } from '../pix/signal-settings'
import {
  GENERAL_POLICY_MAX_CHARS,
  POLICY_JOIN_PHRASE,
  POLICY_OVERFLOW_PHRASE,
  POLICY_REPLY_MAX_CHARS,
  buildCancellationPolicyReply,
} from './policy-reply'

const TENANT = 'clinic-demo-a'

function boot() {
  const clock = createControllableClock(Date.UTC(2026, 10, 19, 12))
  const { db, close } = bootClinicDb({ clock })
  const caller = workerCaller(TENANT, 'user_synth_owner_a')
  return { db, close, clock, caller }
}

describe('resposta «Remarcar e cancelar» (DEC-210)', () => {
  it('sem sinal e sem regras gerais: vazio (a pergunta passa à equipe)', () => {
    const { db, close, clock } = boot()
    try {
      expect(buildCancellationPolicyReply(db, TENANT, clock)).toBe('')
    } finally {
      close()
    }
  })

  it('sinal desligado: sai só o texto geral da clínica', () => {
    const { db, close, clock, caller } = boot()
    try {
      setAiProfileOp(db, caller, { reschedulePolicy: 'Avise com 24 h de antecedência.' }, clock)
      expect(buildCancellationPolicyReply(db, TENANT, clock)).toBe('Avise com 24 h de antecedência.')
    } finally {
      close()
    }
  })

  it('sinal ligado: texto do sinal, frase de ligação e regras gerais, juntos', () => {
    const { db, close, clock, caller } = boot()
    try {
      updatePixSignalSettings(db, TENANT, { enabled: true, amountKind: 'fixed', fixedCents: 5000 }, clock)
      setAiProfileOp(db, caller, { reschedulePolicy: 'Atrasos acima de 15 minutos podem perder o horário.' }, clock)
      const out = buildCancellationPolicyReply(db, TENANT, clock)
      const [sinal, resto] = out.split(`\n\n${POLICY_JOIN_PHRASE}\n`)
      expect(sinal).toMatch(/sinal|R\$ 50/i)
      expect(resto).toBe('Atrasos acima de 15 minutos podem perder o horário.')
      expect(out.length).toBeLessThanOrEqual(POLICY_REPLY_MAX_CHARS)
    } finally {
      close()
    }
  })

  it('acima do limite: sai o texto do sinal e o resto vai para a equipe', () => {
    const { db, close, clock, caller } = boot()
    try {
      updatePixSignalSettings(db, TENANT, { enabled: true, amountKind: 'fixed', fixedCents: 5000 }, clock)
      const sinal = buildCancellationPolicyReply(db, TENANT, clock)
      // 500 é o máximo das regras gerais (servidor); com o sinal gerado pode passar de 1000.
      setAiProfileOp(db, caller, { reschedulePolicy: 'x'.repeat(GENERAL_POLICY_MAX_CHARS + 200) }, clock)
      const out = buildCancellationPolicyReply(db, TENANT, clock)
      if (`${sinal}\n\n${POLICY_JOIN_PHRASE}\n${'x'.repeat(GENERAL_POLICY_MAX_CHARS)}`.length > POLICY_REPLY_MAX_CHARS) {
        expect(out).toBe(`${sinal}\n\n${POLICY_OVERFLOW_PHRASE}`)
      } else {
        expect(out.length).toBeLessThanOrEqual(POLICY_REPLY_MAX_CHARS)
      }
    } finally {
      close()
    }
  })

  it('não repete o texto quando as regras gerais copiam o do sinal', () => {
    const { db, close, clock } = boot()
    try {
      updatePixSignalSettings(db, TENANT, { enabled: true, amountKind: 'fixed', fixedCents: 5000 }, clock)
      const sinalOnly = buildCancellationPolicyReply(db, TENANT, clock)
      // Cópia exacta de A em B seria rejeitada pelo U1; simula legado já gravado.
      db.run(
        `UPDATE clinic_settings SET reschedule_policy = ?, updated_at = ? WHERE id = 1 AND tenant_id = ?`,
        sinalOnly,
        clock.nowMs(),
        TENANT,
      )
      expect(buildCancellationPolicyReply(db, TENANT, clock)).toBe(sinalOnly)
    } finally {
      close()
    }
  })

  it('B legado conflituoso continua a sair no chat até a owner editar (Q3)', () => {
    const { db, close, clock } = boot()
    try {
      updatePixSignalSettings(db, TENANT, { enabled: true, amountKind: 'fixed', fixedCents: 5000 }, clock)
      // Gravação directa (legado): contorna a validação U1 do setClinicAiProfile.
      db.run(
        `UPDATE clinic_settings SET reschedule_policy = ?, updated_at = ? WHERE id = 1 AND tenant_id = ?`,
        'Avise com 24 h de antecedência.',
        clock.nowMs(),
        TENANT,
      )
      const out = buildCancellationPolicyReply(db, TENANT, clock)
      expect(out).toContain(POLICY_JOIN_PHRASE)
      expect(out).toContain('Avise com 24 h')
      expect(out).toMatch(/sinal|R\$ 50/i)
    } finally {
      close()
    }
  })
})

describe('pergunta sobre o sinal recebe a resposta completa (DEC-210)', () => {
  it('«tenho de pagar antes?» → texto do sinal + regras gerais', () => {
    const { db, close, clock, caller } = boot()
    try {
      updatePixSignalSettings(db, TENANT, { enabled: true, amountKind: 'fixed', fixedCents: 5000 }, clock)
      setAiProfileOp(db, caller, { reschedulePolicy: 'Atrasos acima de 15 minutos podem perder o horário.' }, clock)
      const out = catalogReply(db, TENANT, 'tenho de pagar antes?', clock, {})
      expect(out).toContain(POLICY_JOIN_PHRASE)
      expect(out).toContain('Atrasos acima de 15 minutos')
    } finally {
      close()
    }
  })
})
