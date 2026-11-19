import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { setAiProfileOp } from '../config'
import { updatePixSignalSettings } from '../pix/signal-settings'
import { buildCancellationPolicyReply } from './policy-reply'

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

  it('sinal ligado: texto do sinal primeiro e regras gerais a seguir, juntos', () => {
    const { db, close, clock, caller } = boot()
    try {
      updatePixSignalSettings(db, TENANT, { enabled: true, amountKind: 'fixed', fixedCents: 5000 }, clock)
      setAiProfileOp(db, caller, { reschedulePolicy: 'Atrasos acima de 15 minutos podem perder o horário.' }, clock)
      const out = buildCancellationPolicyReply(db, TENANT, clock)
      const [sinal, geral] = out.split(/\n\n(?=Atrasos)/)
      expect(sinal).toMatch(/sinal|R\$ 50/i)
      expect(geral).toBe('Atrasos acima de 15 minutos podem perder o horário.')
    } finally {
      close()
    }
  })

  it('não repete o texto quando as regras gerais copiam o do sinal', () => {
    const { db, close, clock, caller } = boot()
    try {
      updatePixSignalSettings(db, TENANT, { enabled: true, amountKind: 'fixed', fixedCents: 5000 }, clock)
      const sinalOnly = buildCancellationPolicyReply(db, TENANT, clock)
      setAiProfileOp(db, caller, { reschedulePolicy: sinalOnly }, clock)
      expect(buildCancellationPolicyReply(db, TENANT, clock)).toBe(sinalOnly)
    } finally {
      close()
    }
  })
})
