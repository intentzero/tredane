import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { ValidationError, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import {
  acceptUnmatchedTermOp,
  dismissUnmatchedTermOp,
  listUnmatchedTermsOp,
  upsertServiceOp,
} from './operations'
import { getService } from './services'
import { probableServiceFor, recordUnmatchedTerm } from './unmatched-terms'

function boot(tenantId = 'clinic-demo-a') {
  const { db, close } = bootClinicDb()
  const clock = createControllableClock(Date.UTC(2026, 10, 5, 13))
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  const svc = (name: string, synonyms: string[] = []) =>
    upsertServiceOp(
      db,
      caller,
      {
        name,
        durationMinutes: 30,
        bufferMinutes: 0,
        professionalIds: [],
        roomRequirement: { mode: 'none' },
        synonyms,
      },
      clock,
    )
  // Primeiro op liga o tenant ao DO.
  listUnmatchedTermsOp(db, caller, clock)
  return { db, clock, caller, tenantId, svc, close }
}

describe('termos não reconhecidos → sugestão de sinónimo (DEC-141)', () => {
  it('regista só o termo, soma repetições e propõe o serviço provável', () => {
    const s = boot()
    try {
      const dep = s.svc('Depilação')
      s.svc('Limpeza de pele')
      recordUnmatchedTerm(s.db, s.tenantId, 'depilar', s.clock)
      recordUnmatchedTerm(s.db, s.tenantId, ' Depilar ', s.clock)
      const items = listUnmatchedTermsOp(s.db, s.caller, s.clock)
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({ term: 'depilar', hits: 2, suggestedServiceId: dep.id })
      // Só o termo: a tabela não tem conversa, contato nem mensagem.
      const cols = s.db
        .all<{ name: string }>(`PRAGMA table_info(unmatched_terms)`)
        .map((c) => c.name)
      expect(cols.some((c) => /conversation|contact|message|body/.test(c))).toBe(false)
    } finally {
      s.close()
    }
  })

  it('ignora termo vazio, longo demais ou que já é nome/sinónimo', () => {
    const s = boot()
    try {
      s.svc('Depilação', ['laser'])
      recordUnmatchedTerm(s.db, s.tenantId, null, s.clock)
      recordUnmatchedTerm(s.db, s.tenantId, 'x', s.clock)
      recordUnmatchedTerm(s.db, s.tenantId, 'uma frase com palavras demais', s.clock)
      recordUnmatchedTerm(s.db, s.tenantId, 'Laser', s.clock)
      recordUnmatchedTerm(s.db, s.tenantId, 'depilação', s.clock)
      expect(listUnmatchedTermsOp(s.db, s.caller, s.clock)).toEqual([])
    } finally {
      s.close()
    }
  })

  it('serviço provável: null quando empata ou o prefixo é curto', () => {
    const s = boot()
    try {
      const a = s.svc('Massagem relaxante')
      const b = s.svc('Massagem modeladora')
      const services = [getService(s.db, s.tenantId, a.id)!, getService(s.db, s.tenantId, b.id)!]
      expect(probableServiceFor('massagista', services)).toBeNull()
      expect(probableServiceFor('relaxar', services)).toBe(a.id)
      expect(probableServiceFor('unha', services)).toBeNull()
    } finally {
      s.close()
    }
  })

  it('gravar acrescenta o sinónimo ao serviço escolhido e fecha a sugestão', () => {
    const s = boot()
    try {
      const dep = s.svc('Depilação', ['laser'])
      recordUnmatchedTerm(s.db, s.tenantId, 'depilar', s.clock)
      const [item] = listUnmatchedTermsOp(s.db, s.caller, s.clock)
      const row = acceptUnmatchedTermOp(s.db, s.caller, { id: item!.id, serviceId: dep.id }, s.clock)
      expect(row.synonyms).toEqual(['laser', 'depilar'])
      expect(listUnmatchedTermsOp(s.db, s.caller, s.clock)).toEqual([])
      expect(() =>
        acceptUnmatchedTermOp(s.db, s.caller, { id: item!.id, serviceId: dep.id }, s.clock),
      ).toThrow(ValidationError)
      // Depois de gravado, o termo já é sinónimo: não volta a ser registado.
      recordUnmatchedTerm(s.db, s.tenantId, 'depilar', s.clock)
      expect(listUnmatchedTermsOp(s.db, s.caller, s.clock)).toEqual([])
      const audit = s.db.all<{ action: string }>(
        `SELECT action FROM operational_audit WHERE action LIKE 'config.synonym_suggestion%'`,
      )
      expect(audit.map((a) => a.action)).toEqual(['config.synonym_suggestion_accepted'])
    } finally {
      s.close()
    }
  })

  it('gravar respeita as regras da ficha (limite e colisão)', () => {
    const s = boot()
    try {
      const full = s.svc('Depilação', ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'])
      recordUnmatchedTerm(s.db, s.tenantId, 'depilar', s.clock)
      const [item] = listUnmatchedTermsOp(s.db, s.caller, s.clock)
      expect(() =>
        acceptUnmatchedTermOp(s.db, s.caller, { id: item!.id, serviceId: full.id }, s.clock),
      ).toThrow(/no máximo 8/)
      // Continua aberta para a owner escolher outro caminho.
      expect(listUnmatchedTermsOp(s.db, s.caller, s.clock)).toHaveLength(1)
    } finally {
      s.close()
    }
  })

  it('descartar esconde a sugestão mesmo que o termo volte', () => {
    const s = boot()
    try {
      s.svc('Depilação')
      recordUnmatchedTerm(s.db, s.tenantId, 'sobrancelha', s.clock)
      const [item] = listUnmatchedTermsOp(s.db, s.caller, s.clock)
      expect(item!.suggestedServiceId).toBeNull()
      dismissUnmatchedTermOp(s.db, s.caller, item!.id, s.clock)
      recordUnmatchedTerm(s.db, s.tenantId, 'sobrancelha', s.clock)
      expect(listUnmatchedTermsOp(s.db, s.caller, s.clock)).toEqual([])
    } finally {
      s.close()
    }
  })
})
