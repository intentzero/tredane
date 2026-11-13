import { describe, expect, it } from 'vitest'
import type { ServiceRow, ServiceZoneRow } from '../config/types'
import {
  answerFaqFromCatalog,
  FAQ_MISSING_DETAIL_BODY,
  isCatalogClarificationAsk,
} from './faq-clarification'

const intima: ServiceZoneRow = {
  id: 'z_int',
  tenantId: 't',
  serviceId: 'svc_d',
  name: 'Intima',
  audience: 'feminino',
  durationMinutes: 20,
  priceCents: 15000,
  active: true,
  sortOrder: 0,
  synonyms: ['anus'],
}

const axila: ServiceZoneRow = {
  id: 'z_ax',
  tenantId: 't',
  serviceId: 'svc_d',
  name: 'Axila',
  audience: 'feminino',
  durationMinutes: 15,
  priceCents: 4000,
  active: true,
  sortOrder: 1,
  synonyms: [],
}

const service = {
  id: 'svc_d',
  name: 'Depilação',
  clientExplanation: null,
  zones: [intima, axila],
  synonyms: [],
  variantSelection: 'varias',
} as unknown as ServiceRow

describe('isCatalogClarificationAsk (DEC-177)', () => {
  it('detecta inclui / o que é / cobre', () => {
    expect(isCatalogClarificationAsk('A íntima inclui anus?')).toBe(true)
    expect(isCatalogClarificationAsk('o que é íntima?')).toBe(true)
    expect(isCatalogClarificationAsk('íntima cobre ânus?')).toBe(true)
    expect(isCatalogClarificationAsk('faz parte da íntima o ânus?')).toBe(true)
  })

  it('não trata escolha de zona como pergunta', () => {
    expect(isCatalogClarificationAsk('axila e pernas')).toBe(false)
    expect(isCatalogClarificationAsk('Intima')).toBe(false)
    expect(isCatalogClarificationAsk('todas')).toBe(false)
  })
})

describe('answerFaqFromCatalog (DEC-177)', () => {
  it('sinónimo sob íntima → resposta afirmativa de cadastro', () => {
    const r = answerFaqFromCatalog({
      text: 'A íntima inclui anus?',
      conversationId: 'cnv',
      service,
      zones: [intima, axila],
    })
    expect(r.kind).toBe('covered')
    if (r.kind === 'covered') {
      expect(r.replyText).toMatch(/faz parte de Intima/i)
      expect(r.replyText).toMatch(/anus|ânus/i)
    }
  })

  it('sem sinónimo nem explicação → missing', () => {
    const bare = { ...intima, synonyms: [] }
    const r = answerFaqFromCatalog({
      text: 'A íntima inclui anus?',
      conversationId: 'cnv',
      service: { ...service, clientExplanation: null } as ServiceRow,
      zones: [bare, axila],
    })
    expect(r).toEqual({ kind: 'missing', replyText: FAQ_MISSING_DETAIL_BODY })
  })

  it('Explicação para clientes → informar_explicacao', () => {
    const r = answerFaqFromCatalog({
      text: 'o que é depilação?',
      conversationId: 'cnv',
      service: {
        ...service,
        clientExplanation: 'Retirada de pelos com cera.',
      } as ServiceRow,
      zones: [intima, axila],
    })
    expect(r.kind).toBe('explanation')
    if (r.kind === 'explanation') {
      expect(r.replyText).toMatch(/Retirada de pelos com cera/)
    }
  })
})
