import { describe, expect, it } from 'vitest'
import type { ServiceRow, ServiceZoneRow } from '../config/types'
import {
  answerFaqFromCatalog,
  FAQ_MISSING_DETAIL_BODY,
  isCatalogClarificationAsk,
  normalizeInclusionAskText,
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
  clientExplanation: null,
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
  clientExplanation: null,
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

  it('rsamp_fa7f138: «Como é a íntima?» / «quero saber como é o bronzeamento»', () => {
    expect(isCatalogClarificationAsk('Como é a íntima?')).toBe(true)
    expect(isCatalogClarificationAsk('Quero saber como é o bronzeamento')).toBe(true)
  })

  it('lab: «é o que?» / «como é feita» são clarificação (não leftover de zona)', () => {
    expect(isCatalogClarificationAsk('A depilação íntima é o que?')).toBe(true)
    expect(isCatalogClarificationAsk('A íntima é o quê?')).toBe(true)
    expect(isCatalogClarificationAsk('Como é feita a depilação íntima?')).toBe(true)
    expect(isCatalogClarificationAsk('Como se faz a íntima?')).toBe(true)
    expect(isCatalogClarificationAsk('O que inclui a íntima?')).toBe(true)
  })

  it('não trata escolha de zona como pergunta', () => {
    expect(isCatalogClarificationAsk('axila e pernas')).toBe(false)
    expect(isCatalogClarificationAsk('Intima')).toBe(false)
    expect(isCatalogClarificationAsk('todas')).toBe(false)
  })

  it('P1 rsamp_fa7f138: pergunta de abrangência («é a perna inteira?») é clarificação', () => {
    expect(isCatalogClarificationAsk('Pernas é a perna inteira?')).toBe(true)
    expect(isCatalogClarificationAsk('Braços é o braço todo?')).toBe(true)
    expect(isCatalogClarificationAsk('A axila é só a axila completa?')).toBe(true)
  })

  it('P1 rsamp_fa7f138: escolha de zona com «?» ou «e» conjunção não é clarificação', () => {
    expect(isCatalogClarificationAsk('pernas e axila?')).toBe(false)
    expect(isCatalogClarificationAsk('axila e pernas inteiras?')).toBe(false)
    expect(isCatalogClarificationAsk('Pernas inteiras')).toBe(false)
    expect(isCatalogClarificationAsk('Pernas é a perna inteira')).toBe(false)
    expect(isCatalogClarificationAsk('Na terça?')).toBe(false)
    expect(isCatalogClarificationAsk('todas?')).toBe(false)
  })
})

describe('answerFaqFromCatalog (DEC-177)', () => {
  it('«inclui virilha» com explicação cadastrada → covered (determinístico)', () => {
    const withExplain = {
      ...intima,
      synonyms: [],
      clientExplanation: 'Inclui virilha e ânus no feminino.',
    }
    const r = answerFaqFromCatalog({
      text: 'A íntima inclui a virilha?',
      conversationId: 'cnv',
      service,
      zones: [withExplain, axila],
    })
    expect(r.kind).toBe('covered')
    if (r.kind === 'covered') {
      expect(r.replyText).toMatch(/virilha/i)
      expect(r.replyText).toMatch(/faz parte de Intima/i)
    }
  })

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

  it('cobertura sem prova não usa Explicação geral do serviço (Bugbot / DEC-177)', () => {
    const bare = { ...intima, synonyms: [] }
    const r = answerFaqFromCatalog({
      text: 'A íntima inclui anus?',
      conversationId: 'cnv',
      service: {
        ...service,
        clientExplanation: 'Retirada de pelos com cera em várias zonas.',
      } as ServiceRow,
      zones: [bare, axila],
    })
    expect(r).toEqual({ kind: 'missing', replyText: FAQ_MISSING_DETAIL_BODY })
    expect(r.replyText).not.toMatch(/Retirada de pelos/)
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

  it('explicação da variante prevalece sobre a do serviço', () => {
    const withZone = {
      ...intima,
      clientExplanation: 'Inclui virilha e ânus no feminino.',
    }
    const r = answerFaqFromCatalog({
      text: 'o que é íntima?',
      conversationId: 'cnv',
      service: {
        ...service,
        clientExplanation: 'Retirada de pelos com cera em várias zonas.',
      } as ServiceRow,
      zones: [withZone, axila],
    })
    expect(r.kind).toBe('explanation')
    if (r.kind === 'explanation') {
      expect(r.replyText).toMatch(/Inclui virilha e ânus/)
      expect(r.replyText).not.toMatch(/várias zonas/)
    }
  })

  it('DEC-189: override por género prevalece sobre a explicação comum', () => {
    const withZone = {
      ...intima,
      clientExplanation: 'Zona íntima com cera.',
      clientExplanationAudience: 'Inclui virilha e ânus no feminino.',
    }
    const r = answerFaqFromCatalog({
      text: 'o que é íntima?',
      conversationId: 'cnv',
      service: {
        ...service,
        clientExplanation: 'Retirada de pelos com cera em várias zonas.',
      } as ServiceRow,
      zones: [withZone, axila],
    })
    expect(r.kind).toBe('explanation')
    if (r.kind === 'explanation') {
      expect(r.replyText).toMatch(/Inclui virilha e ânus/)
      expect(r.replyText).not.toMatch(/Zona íntima com cera|várias zonas/)
    }
  })

  it('DEC-189: sem override, usa a explicação comum do nome', () => {
    const withZone = {
      ...intima,
      clientExplanation: 'Zona íntima com cera.',
      clientExplanationAudience: null,
    }
    const r = answerFaqFromCatalog({
      text: 'o que é íntima?',
      conversationId: 'cnv',
      service: {
        ...service,
        clientExplanation: 'Retirada de pelos com cera em várias zonas.',
      } as ServiceRow,
      zones: [withZone, axila],
    })
    expect(r.kind).toBe('explanation')
    if (r.kind === 'explanation') {
      expect(r.replyText).toMatch(/Zona íntima com cera/)
      expect(r.replyText).not.toMatch(/várias zonas/)
    }
  })

  it('zona nomeada sem explicação não cai na prosa do serviço («O que inclui a íntima?»)', () => {
    const r = answerFaqFromCatalog({
      text: 'O que inclui a íntima?',
      conversationId: 'cnv',
      service: {
        ...service,
        clientExplanation:
          'Remoção dos pelos pela raiz utilizando cera depilatória, proporcionando uma pele mais lisa.',
      } as ServiceRow,
      zones: [intima, axila],
    })
    expect(r).toEqual({ kind: 'missing', replyText: FAQ_MISSING_DETAIL_BODY })
    expect(r.replyText).not.toMatch(/Remoção dos pelos|Sobre isso/i)
  })

  it('«o que é íntima?» sem explicação da zona → missing (mesmo com serviço preenchido)', () => {
    const r = answerFaqFromCatalog({
      text: 'o que é íntima?',
      conversationId: 'cnv',
      service: {
        ...service,
        clientExplanation: 'Retirada de pelos com cera em várias zonas.',
      } as ServiceRow,
      zones: [intima, axila],
    })
    expect(r).toEqual({ kind: 'missing', replyText: FAQ_MISSING_DETAIL_BODY })
    expect(r.replyText).not.toMatch(/Retirada de pelos/)
  })

  it('«A depilação íntima é o que?» com explicação da zona → variante (não prosa do serviço)', () => {
    const withZone = {
      ...intima,
      clientExplanation: 'Inclui virilha e ânus no feminino.',
    }
    const r = answerFaqFromCatalog({
      text: 'A depilação íntima é o que?',
      conversationId: 'cnv',
      service: {
        ...service,
        clientExplanation: 'Remoção dos pelos pela raiz utilizando cera depilatória.',
      } as ServiceRow,
      zones: [withZone, axila],
    })
    expect(r.kind).toBe('explanation')
    if (r.kind === 'explanation') {
      expect(r.replyText).toMatch(/Inclui virilha e ânus/)
      expect(r.replyText).not.toMatch(/Remoção dos pelos/)
    }
  })

  it('cnv_b8df6c59165f4668 seq28: «A íntima inclui o que?» → explicação (não «que faz parte»)', () => {
    const withZone = {
      ...intima,
      clientExplanation: 'Inclui virilha e ânus no feminino.',
    }
    const r = answerFaqFromCatalog({
      text: 'A íntima inclui o que?',
      conversationId: 'cnv_b8df6c59165f4668',
      service,
      zones: [withZone, axila],
    })
    expect(r.kind).toBe('explanation')
    if (r.kind === 'explanation') {
      expect(r.replyText).toMatch(/Inclui virilha e ânus/)
      expect(r.replyText).not.toMatch(/que faz parte/i)
    }
  })

  it('«Como é feita a depilação íntima?» sem explicação da zona → missing (não cobertura «feita»)', () => {
    const r = answerFaqFromCatalog({
      text: 'Como é feita a depilação íntima?',
      conversationId: 'cnv',
      service: {
        ...service,
        clientExplanation: 'Remoção dos pelos pela raiz utilizando cera depilatória.',
      } as ServiceRow,
      zones: [intima, axila],
    })
    expect(r).toEqual({ kind: 'missing', replyText: FAQ_MISSING_DETAIL_BODY })
    expect(r.replyText).not.toMatch(/Remoção dos pelos|faz parte/i)
  })

  it('rsamp_f72ce590 seq82: «O que inclui a depilação íntima?» → explicação do serviço', () => {
    const explanation =
      'A depilação íntima com cera remove os pelos pelas regiões íntimas, virilha e períneo.'
    const r = answerFaqFromCatalog({
      text: 'O que inclui a depilação íntima?',
      conversationId: 'cnv_b8df6c59165f4668',
      service: {
        ...service,
        name: 'Depilação',
        clientExplanation: explanation,
      } as ServiceRow,
      zones: [{ ...intima, name: 'Íntima' }, axila],
    })
    expect(r.kind).toBe('explanation')
    if (r.kind === 'explanation') {
      expect(r.replyText).toMatch(/depilação íntima com cera/i)
      expect(r.replyText).not.toMatch(/faz parte de/i)
      expect(r.replyText).not.toMatch(/\bdepilacao\b/i)
    }
  })

  it('«o que vem na depilação íntima?» e «o que faz parte da depilação íntima?» usam o cadastro do serviço', () => {
    const explanation = 'Inclui virilha, genital e perianal conforme cadastro.'
    for (const text of [
      'o que vem na depilação íntima?',
      'o que faz parte da depilação íntima?',
    ]) {
      const r = answerFaqFromCatalog({
        text,
        conversationId: 'cnv',
        service: {
          ...service,
          name: 'Depilação',
          clientExplanation: explanation,
        } as ServiceRow,
        zones: [{ ...intima, name: 'Íntima' }, axila],
      })
      expect(r.kind).toBe('explanation')
      if (r.kind === 'explanation') {
        expect(r.replyText).toMatch(/virilha/)
      }
    }
  })

  it('cobertura usa nome do catálogo, não termo dobrado («anus» → cadastro)', () => {
    const withSyn = { ...intima, name: 'Íntima', synonyms: ['ânus'] }
    const r = answerFaqFromCatalog({
      text: 'A íntima inclui anus?',
      conversationId: 'cnv',
      service,
      zones: [withSyn, axila],
    })
    expect(r.kind).toBe('covered')
    if (r.kind === 'covered') {
      expect(r.replyText).toMatch(/ânus/)
      expect(r.replyText).not.toMatch(/\banus faz parte\b/i)
    }
  })
})

describe('normalizeInclusionAskText (typos)', () => {
  it('«Íntima incluinnariz?» normaliza para leitura de inclusão', () => {
    expect(normalizeInclusionAskText('Íntima incluinnariz?')).toBe('Íntima inclui nariz?')
    expect(isCatalogClarificationAsk('Íntima incluinnariz?')).toBe(true)
  })
})
