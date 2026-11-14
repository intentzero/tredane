import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { bootClinicDb } from '../test-db'
import { workerCaller } from '../envelopes'
import {
  KNOWLEDGE_MAX_ANSWER_CHARS,
  KNOWLEDGE_MAX_PUBLISHED,
  KNOWLEDGE_SIGNAL_SOURCE_KEY,
  deleteKnowledgeCategory,
  listKnowledgeEntries,
  matchPublishedKnowledge,
  syncSignalPolicyKnowledgeEntry,
  upsertKnowledgeCategory,
  upsertKnowledgeEntry,
} from './knowledge'

function boot(tenantId: string) {
  const { db, close } = bootClinicDb()
  const clock = createControllableClock(Date.UTC(2026, 10, 14, 15))
  return { db, clock, tenantId, close }
}

describe('clinic knowledge (DEC-185)', () => {
  it('CRUD categoria + entrada published e match por cue', () => {
    const { db, clock, tenantId, close } = boot('ten_kn_1')
    try {
      const cat = upsertKnowledgeCategory(db, tenantId, { name: 'Acesso' }, clock)
      const entry = upsertKnowledgeEntry(
        db,
        tenantId,
        {
          categoryId: cat.id,
          question: 'Tem estacionamento?',
          answer: 'Sim, há vagas na rua em frente à clínica.',
          matchCues: ['estacionamento', 'vaga'],
          status: 'published',
        },
        'owner_1',
        clock,
      )
      expect(entry.status).toBe('published')
      const hit = matchPublishedKnowledge(db, tenantId, 'Vocês têm estacionamento aí?')
      expect(hit?.id).toBe(entry.id)
      expect(hit?.answer).toContain('vagas na rua')
      expect(matchPublishedKnowledge(db, tenantId, 'quero massagem')).toBeNull()
    } finally {
      close()
    }
  })

  it('recusa resposta >500 e teto de published', () => {
    const { db, clock, tenantId, close } = boot('ten_kn_2')
    try {
    const cat = upsertKnowledgeCategory(db, tenantId, { name: 'Outro' }, clock)
    expect(() =>
      upsertKnowledgeEntry(
        db,
        tenantId,
        {
          categoryId: cat.id,
          question: 'Longa?',
          answer: 'x'.repeat(KNOWLEDGE_MAX_ANSWER_CHARS + 1),
          status: 'draft',
        },
        'owner_1',
        clock,
      ),
    ).toThrow(/máximo/)

    for (let i = 0; i < KNOWLEDGE_MAX_PUBLISHED; i++) {
      upsertKnowledgeEntry(
        db,
        tenantId,
        {
          categoryId: cat.id,
          question: `Pergunta ${i}?`,
          answer: `Resposta ${i}`,
          matchCues: [`cue${i}xyz`],
          status: 'published',
        },
        'owner_1',
        clock,
      )
    }
    expect(() =>
      upsertKnowledgeEntry(
        db,
        tenantId,
        {
          categoryId: cat.id,
          question: 'Uma a mais?',
          answer: 'Não cabe',
          matchCues: ['excesso'],
          status: 'published',
        },
        'owner_1',
        clock,
      ),
    ).toThrow(/publicadas/)
    } finally {
      close()
    }
  })

  it('não apaga categoria com entradas', () => {
    const { db, clock, tenantId, close } = boot('ten_kn_3')
    try {
      const cat = upsertKnowledgeCategory(db, tenantId, { name: 'Visita' }, clock)
      upsertKnowledgeEntry(
        db,
        tenantId,
        {
          categoryId: cat.id,
          question: 'Chegar cedo?',
          answer: 'Chegue 10 minutos antes.',
          status: 'draft',
        },
        'owner_1',
        clock,
      )
      expect(() => deleteKnowledgeCategory(db, tenantId, cat.id)).toThrow(/entradas/)
    } finally {
      close()
    }
  })

  it('sync da política de sinal cria entrada source_key', () => {
    const { db, clock, tenantId, close } = boot('ten_kn_4')
    try {
      const row = syncSignalPolicyKnowledgeEntry(
        db,
        tenantId,
        {
          enabled: true,
          policyText: 'O sinal de R$ 50 reserva o horário por 30 min.',
        },
        'system:signal-policy',
        clock,
      )
      expect(row?.sourceKey).toBe(KNOWLEDGE_SIGNAL_SOURCE_KEY)
      expect(row?.status).toBe('published')
      const again = syncSignalPolicyKnowledgeEntry(
        db,
        tenantId,
        {
          enabled: true,
          policyText: 'Texto actualizado do sinal.',
        },
        'system:signal-policy',
        clock,
      )
      expect(again?.id).toBe(row?.id)
      expect(
        listKnowledgeEntries(db, tenantId).filter((e) => e.sourceKey === KNOWLEDGE_SIGNAL_SOURCE_KEY),
      ).toHaveLength(1)
      const hit = matchPublishedKnowledge(db, tenantId, 'Como funciona o sinal?')
      expect(hit?.answer).toContain('actualizado')
    } finally {
      close()
    }
  })

  it('listagem vazia no tenant fresco', () => {
    const { db, close } = bootClinicDb()
    try {
      const caller = workerCaller('ten_kn_5', 'user_owner')
      expect(listKnowledgeEntries(db, caller.tenantId)).toEqual([])
    } finally {
      close()
    }
  })
})
