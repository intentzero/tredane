/**
 * DEC-142 — consulta de catálogo (Paulo, 06/11/2026). Dados fictícios.
 * Não marca: o Confirmar da proposta fica de fora deste fluxo.
 */
import { describe, expect, it } from 'vitest'
import type { PrepareBookingFlowOffer } from '../../whatsapp/flow/offer-live'
import { FLOW_COPY } from '../../whatsapp/flow/copy'
import { setClinicAiProfile } from '../config/settings'
import { listServices } from '../config/services'
import {
  createProposal,
  getActiveProposalForConversation,
  getProposal,
  markProposalSent,
} from '../proposals/proposals'
import { zonedCivilToUtc } from '../scheduling'
import { enqueueAutoDraft, runDueAutoDrafts } from './autodraft'
import { handleChoiceOfferClick, parseChoiceId } from './choice-offer'
import { forbiddenClientTermsIn } from './client-copy'
import {
  CATALOG_AUDIENCE_LIST_BODY,
  CATALOG_AUDIENCE_LIST_BUTTON,
  CATALOG_AUDIENCE_ROW_FEMININO,
  CATALOG_AUDIENCE_ROW_MASCULINO,
  CATALOG_STAY_FEMININO,
  CATALOG_STAY_MASCULINO,
  catalogConsultIntent,
  catalogEmptyBody,
  catalogNamesBody,
  deliverCatalogConsult,
  planCatalogConsult,
} from './catalog-consult'
import { bootDialogScenario, DIALOG_TZ, type DialogScenario } from './evals/dialogs/scenario'
import { getBookingFrame, saveBookingFrame } from './schedule-session'

function paint(s: DialogScenario): void {
  s.db.run(
    `UPDATE services SET active = 0, audiencia = 'masculino' WHERE tenant_id = ?`,
    s.tenantId,
  )
  s.db.run(
    `UPDATE services SET active = 1, audiencia = 'feminino' WHERE id = ?`,
    s.ids.depilacao,
  )
  s.db.run(
    `UPDATE services SET active = 1, audiencia = 'masculino' WHERE id = ?`,
    s.ids.massagem,
  )
  s.db.run(
    `UPDATE services SET active = 1, audiencia = 'qualquer' WHERE id = ?`,
    s.ids.limpeza,
  )
}

function namesFor(s: DialogScenario, line: 'feminino' | 'masculino'): string {
  const action = planCatalogConsult({
    text: line === 'feminino' ? 'serviços femininos' : 'serviços masculinos',
    frame: null,
    services: listServices(s.db, s.tenantId),
    catalogVersion: 'cat-test',
    hasActiveProposal: false,
  })
  return action!.body
}

function sendConsult(s: DialogScenario, text: string): void {
  s.sayInbound('oi')
  const action = planCatalogConsult({
    text,
    frame: getBookingFrame(s.db, s.tenantId, s.conversationId),
    services: listServices(s.db, s.tenantId),
    catalogVersion: 'cat-test',
    hasActiveProposal:
      getActiveProposalForConversation(s.db, s.tenantId, s.conversationId, s.clock) != null,
  })
  expect(action).not.toBeNull()
  deliverCatalogConsult(s.db, s.caller, s.clock, {
    conversationId: s.conversationId,
    clientRequestId: `test-catalog:${text}:${s.clock.nowMs()}`,
    authorClerkUserId: 'system:ai-autodraft',
    authorDisplayName: 'IA',
    action: action!,
  })
}

function lastOutbound(s: DialogScenario): { body: string; interactive_json: string | null } {
  return s.db.get<{ body: string; interactive_json: string | null }>(
    `SELECT m.body AS body, o.interactive_json AS interactive_json
     FROM messages m
     LEFT JOIN outbound_messages o ON o.message_id = m.id
     WHERE m.conversation_id = ? AND m.direction = 'outbound'
     ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1`,
    s.conversationId,
  )!
}

describe('catalogConsultIntent', () => {
  const asks = [
    'quais serviços você tem?',
    'quais servicos voces tem',
    'quero outro serviço',
    'quero outro agendamento',
    'outro agendamento',
    'quero marcar outro',
    'quero marcar outra coisa',
    'nova marcação',
    'quero agendar de novo',
    'lista os serviços',
    'o que vocês oferecem',
    'quais serviços femininos e masculinos',
  ]
  const feminino = ['serviços femininos', 'servicos femininos', 'femininos', 'ver o feminino']
  const masculino = ['serviços masculinos', 'ver o masculino', 'masculinos']
  const no = [
    'quero depilação',
    'quero marcar',
    'quero marcar outra sessão de limpeza',
    'feminino',
    'quanto custa',
    'outro horário',
    'começar de novo',
    'o que vocês fazem',
  ]

  it.each(asks)('pede o catálogo: %s', (text) => {
    expect(catalogConsultIntent(text)).toEqual({ kind: 'ask' })
  })

  it.each(feminino)('troca para o feminino: %s', (text) => {
    expect(catalogConsultIntent(text)).toEqual({ kind: 'switch', line: 'feminino' })
  })

  it.each(masculino)('troca para o masculino: %s', (text) => {
    expect(catalogConsultIntent(text)).toEqual({ kind: 'switch', line: 'masculino' })
  })

  it.each(no)('não é consulta: %s', (text) => {
    expect(catalogConsultIntent(text)).toBeNull()
  })
})

describe('consulta de catálogo (DEC-142)', () => {
  it('as frases fixas não levam jargão nem «linha», «versão» ou «mulher/homem»', () => {
    const phrases = [
      CATALOG_AUDIENCE_LIST_BODY,
      CATALOG_AUDIENCE_LIST_BUTTON,
      CATALOG_AUDIENCE_ROW_FEMININO,
      CATALOG_AUDIENCE_ROW_MASCULINO,
      CATALOG_STAY_FEMININO,
      CATALOG_STAY_MASCULINO,
      catalogNamesBody(['Depilação', 'Limpeza de pele']),
      catalogEmptyBody('feminino'),
      catalogEmptyBody('masculino'),
    ]
    for (const text of phrases) {
      expect(forbiddenClientTermsIn(text), text).toEqual([])
      expect(text).not.toMatch(/\blinha\b|\bversão\b|\bmulher\b|\bhomem\b|\bcatálogo\b/i)
    }
  })

  it('sem audiência: lista interativa Feminino e Masculino, não botões nem Flow', () => {
    const s = bootDialogScenario()
    try {
      paint(s)
      sendConsult(s, 'quais serviços você tem?')
      const last = lastOutbound(s)
      expect(last.body).toBe(CATALOG_AUDIENCE_LIST_BODY)
      const parsed = JSON.parse(last.interactive_json ?? '{}') as {
        list?: { button: string; sections: Array<{ rows: Array<{ id: string; title: string }> }> }
        buttons?: unknown
        flow?: unknown
      }
      expect(parsed.buttons).toBeUndefined()
      expect(parsed.flow).toBeUndefined()
      expect(parsed.list?.button).toBe(CATALOG_AUDIENCE_LIST_BUTTON)
      const rows = parsed.list?.sections[0]?.rows ?? []
      expect(rows.map((row) => row.title)).toEqual(['Feminino', 'Masculino'])
      expect(rows.map((row) => parseChoiceId(row.id)?.slot)).toEqual(['audiencia', 'audiencia'])
      expect(last.interactive_json ?? '').not.toContain('Falar com a equipe')
      const frame = getBookingFrame(s.db, s.tenantId, s.conversationId)
      expect(frame?.line).toBeNull()
      expect(frame?.serviceId).toBeNull()
      expect(frame?.pending?.slot).toBe('audiencia')
      expect(s.appointmentCount()).toBe(0)
    } finally {
      s.close()
    }
  })

  it('toque em Feminino lista nomes gravados dessa audiência ou qualquer', async () => {
    const s = bootDialogScenario()
    try {
      paint(s)
      let calls = 0
      const generate = s.adapter.generate.bind(s.adapter)
      s.adapter.generate = async (input) => {
        calls += 1
        return generate(input)
      }
      sendConsult(s, 'quero outro serviço')
      const list = lastOutbound(s)
      const rows = (
        JSON.parse(list.interactive_json ?? '{}') as {
          list: { sections: Array<{ rows: Array<{ id: string; title: string }> }> }
        }
      ).list.sections[0]!.rows
      const feminino = rows.find((row) => row.title === 'Feminino')!
      s.clock.advance(1_000)
      const click = await handleChoiceOfferClick(
        s.db,
        s.caller,
        {
          tenantId: s.tenantId,
          conversationId: s.conversationId,
          buttonId: feminino.id,
          providerEventKey: 'wa:catalog:fem',
        },
        s.clock,
      )
      expect(click.handled).toBe(true)
      if (click.handled) expect(click.outcome).toBe('applied')
      const last = lastOutbound(s)
      expect(last.body).toBe(namesFor(s, 'feminino'))
      expect(last.body).toBe('Temos:\nDepilação\nLimpeza de pele profunda\nQual você quer?')
      expect(last.body).not.toMatch(/depilação/)
      expect(last.body).not.toContain('Massagem relaxante')
      expect(last.interactive_json).toBeNull()
      const frame = getBookingFrame(s.db, s.tenantId, s.conversationId)
      expect(frame?.line).toBe('feminino')
      expect(frame?.serviceId).toBeNull()
      expect(frame?.pending).toBeNull()
      expect(s.appointmentCount()).toBe(0)
      expect(calls).toBe(0)
    } finally {
      s.close()
    }
  })

  it('audiência já na conversa não volta a perguntar', () => {
    const s = bootDialogScenario()
    try {
      paint(s)
      s.sayInbound('oi')
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.conversationId,
        { serviceId: null, line: 'feminino', pending: null, phase: 'idle', catalogVersion: 'cat-test' },
        s.clock,
      )
      sendConsult(s, 'quais serviços você tem?')
      const last = lastOutbound(s)
      expect(last.body).toBe('Temos:\nDepilação\nLimpeza de pele profunda\nQual você quer?')
      expect(last.body).not.toContain(CATALOG_AUDIENCE_LIST_BODY)
      expect(last.body).not.toContain('Continuo no feminino')
      expect(last.interactive_json).toBeNull()
      expect(getBookingFrame(s.db, s.tenantId, s.conversationId)?.line).toBe('feminino')
    } finally {
      s.close()
    }
  })

  it('a meio da marcação limpa o quadro, mantém o feminino e diz como ver o outro', () => {
    const s = bootDialogScenario()
    try {
      paint(s)
      s.sayInbound('oi')
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.conversationId,
        {
          serviceId: s.ids.limpeza,
          line: 'feminino',
          variantIds: ['z_ficticia'],
          date: '2026-11-06',
          time: '14:00',
          phase: 'proposto',
          pending: {
            slot: 'horario',
            options: [{ key: '14:00', label: '14:00' }],
            messageId: 'm_old',
          },
          lastOffer: {
            slots: [{ startsAt: Date.UTC(2026, 10, 6, 17, 0), professionalId: s.ids.ana }],
            messageId: 'm_old',
          },
          catalogVersion: 'cat-test',
        },
        s.clock,
      )
      const proposal = createProposal(
        s.db,
        s.tenantId,
        {
          contactId: s.contactId,
          conversationId: s.conversationId,
          serviceId: s.ids.limpeza,
          professionalId: s.ids.ana,
          startsAt: zonedCivilToUtc(DIALOG_TZ, 2026, 11, 6, 14, 0),
        },
        s.clock,
      )
      markProposalSent(s.db, s.tenantId, proposal.id, s.clock)
      sendConsult(s, 'quero outro serviço')
      const last = lastOutbound(s)
      expect(last.body).toBe(
        `${CATALOG_STAY_FEMININO}\nTemos:\nDepilação\nLimpeza de pele profunda\nQual você quer?`,
      )
      expect(last.interactive_json).toBeNull()
      const frame = getBookingFrame(s.db, s.tenantId, s.conversationId)
      expect(frame?.line).toBe('feminino')
      expect(frame?.serviceId).toBeNull()
      expect(frame?.variantIds).toBeNull()
      expect(frame?.pending).toBeNull()
      expect(frame?.lastOffer).toBeNull()
      expect(frame?.proposal).toBeNull()
      expect(frame?.date).toBeNull()
      expect(frame?.time).toBeNull()
      expect(getActiveProposalForConversation(s.db, s.tenantId, s.conversationId, s.clock)).toBeNull()
      expect(getProposal(s.db, s.tenantId, proposal.id)?.state).toBe('substituida')
      expect(s.appointmentCount()).toBe(0)
    } finally {
      s.close()
    }
  })

  it('espelha a frase quando a audiência já é o masculino', () => {
    const s = bootDialogScenario()
    try {
      paint(s)
      s.sayInbound('oi')
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.conversationId,
        { serviceId: s.ids.massagem, line: 'masculino', phase: 'coletando', catalogVersion: 'cat-test' },
        s.clock,
      )
      sendConsult(s, 'lista os serviços')
      expect(lastOutbound(s).body).toBe(
        `${CATALOG_STAY_MASCULINO}\nTemos:\nLimpeza de pele profunda\nMassagem relaxante\nQual você quer?`,
      )
      expect(getBookingFrame(s.db, s.tenantId, s.conversationId)?.line).toBe('masculino')
    } finally {
      s.close()
    }
  })

  it('«serviços masculinos» troca a audiência e não repete o «continuo»', () => {
    const s = bootDialogScenario()
    try {
      paint(s)
      s.sayInbound('oi')
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.conversationId,
        { serviceId: s.ids.depilacao, line: 'feminino', phase: 'coletando', catalogVersion: 'cat-test' },
        s.clock,
      )
      sendConsult(s, 'serviços masculinos')
      const body = lastOutbound(s).body
      expect(body).toBe('Temos:\nLimpeza de pele profunda\nMassagem relaxante\nQual você quer?')
      expect(body).not.toContain('Continuo no feminino')
      expect(body).not.toContain('Depilação')
      expect(getBookingFrame(s.db, s.tenantId, s.conversationId)?.line).toBe('masculino')
      expect(getBookingFrame(s.db, s.tenantId, s.conversationId)?.serviceId).toBeNull()
    } finally {
      s.close()
    }
  })

  it('filtro vazio: frase curta, sem inventar serviço nem link', () => {
    const s = bootDialogScenario()
    try {
      s.db.run(`UPDATE services SET audiencia = 'masculino', active = 1 WHERE tenant_id = ?`, s.tenantId)
      setClinicAiProfile(
        s.db,
        s.tenantId,
        { googleBusinessUrl: 'https://maps.app.goo.gl/ficticio123' },
        s.clock,
      )
      sendConsult(s, 'serviços femininos')
      const body = lastOutbound(s).body
      expect(body).toBe('Não tenho serviços no feminino.')
      expect(body).not.toMatch(/http|google|maps/i)
      expect(body).not.toContain('Depilação')
      expect(getBookingFrame(s.db, s.tenantId, s.conversationId)?.line).toBe('feminino')
    } finally {
      s.close()
    }
  })

  it('texto «[Lista] Feminino» com a lista pendente escolhe o feminino', () => {
    const s = bootDialogScenario()
    try {
      paint(s)
      sendConsult(s, 'quais serviços você tem?')
      const action = planCatalogConsult({
        text: '[Lista] Feminino',
        frame: getBookingFrame(s.db, s.tenantId, s.conversationId),
        services: listServices(s.db, s.tenantId),
        catalogVersion: 'cat-test',
        hasActiveProposal: false,
      })
      expect(action?.body).toBe('Temos:\nDepilação\nLimpeza de pele profunda\nQual você quer?')
      expect(action?.framePatch.line).toBe('feminino')
    } finally {
      s.close()
    }
  })
})

describe('autodraft não manda a consulta ao modelo nem ao Flow', () => {
  async function draft(s: DialogScenario, text: string) {
    const msgId = s.sayInbound(text)
    enqueueAutoDraft(s.db, s.tenantId, { conversationId: s.conversationId, messageId: msgId }, s.clock)
    s.clock.advance(8_000)
    const prepare: PrepareBookingFlowOffer = async (input) => ({
      body: input.body ?? FLOW_COPY.openBody,
      flowToken: 'fl1_catalog_should_not_run',
      interactive: {
        flow: {
          flowId: '1858344942174587',
          flowCta: FLOW_COPY.flowCta,
          flowToken: 'fl1_catalog_should_not_run',
          flowAction: 'data_exchange',
          flowMessageVersion: '3',
          mode: 'published',
        },
      },
    })
    return runDueAutoDrafts(s.db, s.caller, s.clock, {
      mode: 'synthetic',
      adapter: s.adapter,
      clinicName: 'Clínica Teste Paulo',
      prepareBookingFlowOffer: prepare,
    })
  }

  it('«quero outro serviço» é a lista de audiência, não o hub', async () => {
    const s = bootDialogScenario()
    try {
      paint(s)
      const out = await draft(s, 'quero outro serviço')
      expect(out).toHaveLength(1)
      expect(out[0]!.reason).toBe('catalog_consult')
      expect(out[0]!.suggestion).toBeNull()
      const last = lastOutbound(s)
      expect(last.body).toBe(CATALOG_AUDIENCE_LIST_BODY)
      expect(last.interactive_json ?? '').toContain('Feminino')
      expect(last.interactive_json ?? '').toContain('Masculino')
      expect(last.interactive_json ?? '').not.toContain('Abrir opções')
      expect(last.interactive_json ?? '').not.toContain('1858344942174587')
    } finally {
      s.close()
    }
  })

  it('«quais serviços você tem?» também fica no backend', async () => {
    const s = bootDialogScenario()
    try {
      paint(s)
      const out = await draft(s, 'quais serviços você tem?')
      expect(out[0]!.reason).toBe('catalog_consult')
      expect(out[0]!.suggestion).toBeNull()
      expect(lastOutbound(s).body).toBe(CATALOG_AUDIENCE_LIST_BODY)
    } finally {
      s.close()
    }
  })
})
