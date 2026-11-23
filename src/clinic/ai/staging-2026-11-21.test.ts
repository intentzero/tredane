/**
 * Regressões dos fluxos anonimizados de 21/11/2026 (~22:00 America/Sao_Paulo).
 * Nomes e números são fictícios. Não reproduz identificadores reais.
 */
import { describe, expect, it } from 'vitest'
import type { AiGenerateResult } from '../../ai'
import { createControllableClock } from '../../db/clock'
import { routeToClientWeb } from '../../clientweb/route-intent'
import { createClientWebHarness } from './evals/dialogs/clientweb-driver'
import { CLIENT_WEB_LINKS_PER_CONVERSATION, CLIENT_WEB_RESCHEDULE_BODY } from '../../clientweb/offer'
import { replaceServiceZonesOp, setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { zonedCivilToUtc } from '../scheduling'
import { enqueueAutoDraft, runDueAutoDrafts } from './index'
import { catalogReply } from './catalog-reply'
import { getActiveCatalogSubject } from './active-catalog-subject'
import { buildOpeningHoursReply, openingHoursMixedWithBooking } from './opening-hours-reply'
import { handoffReason, readAiReplyPause } from './human-handoff'
import { classifySensitive } from './nlu/sensitive'
import { pickRescheduleAppointment, type UpcomingApt } from './upcoming'

/** Sáb 21/11/2026 22:12 America/Sao_Paulo. */
const SAT_2212 = Date.parse('2026-11-21T22:12:00-03:00')
const TZ = 'America/Sao_Paulo'

const PHRASE_AGENDAR = 'Posso fazer um agendamento para quarta-feira feira?'

function seedClinic(nowMs: number, tenantId: string) {
  const clock = createControllableClock(nowMs)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const caller = workerCaller(tenantId, 'user_owner')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: `bind_${tenantId}`,
      phoneNumberId: `pn_${tenantId}`,
      wabaId: `waba_${tenantId}`,
      displayPhone: '+5511900000201',
      displayName: 'Clínica Fictícia',
      action: 'channel_connected',
    },
    clock,
  )
  const ana = upsertResourceOp(db, caller, { kind: 'professional', name: 'Ana' }, clock)
  const depilacao = upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilação',
      durationMinutes: 30,
      bufferMinutes: 0,
      priceCents: 8000,
      professionalIds: [ana.id],
      roomRequirement: { mode: 'none' },
      variantKind: 'zona',
      variantKindPlural: 'zonas',
    },
    clock,
  )
  replaceServiceZonesOp(
    db,
    caller,
    depilacao.id,
    [
      {
        name: 'axila',
        audience: 'feminino',
        durationMinutes: 10,
        priceCents: 5_000,
      },
      {
        name: 'íntima',
        audience: 'feminino',
        durationMinutes: 20,
        priceCents: 18_000,
        clientExplanation: 'Depilação íntima com cera, para clientes do sexo feminino.',
      },
      {
        name: 'íntima',
        audience: 'masculino',
        durationMinutes: 20,
        priceCents: 20_000,
        clientExplanation:
          'A depilação íntima com cera é um procedimento de remoção dos pelos pela raiz, para clientes do sexo masculino.',
      },
      {
        name: 'ouvido',
        audience: 'masculino',
        durationMinutes: 10,
        priceCents: 4_000,
      },
    ],
    clock,
  )
  setWeeklyWindowsOp(
    db,
    caller,
    {
      resourceId: ana.id,
      windows: [1, 2, 3, 4, 5, 6].map((d) => ({
        dayOfWeek: d,
        startMinute: 9 * 60,
        endMinute: 18 * 60,
      })),
    },
    clock,
  )
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(
    db,
    { tenantId, waId: '5511911110001', displayName: 'Carlos' },
    clock,
  )
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  const adapter = {
    providerId: 'test',
    mode: 'synthetic' as const,
    async generate(): Promise<AiGenerateResult> {
      throw new Error('model_called')
    },
    lastInspection() {
      return null
    },
  }
  const say = (body: string) => {
    const message = insertMessage(
      db,
      {
        tenantId,
        conversationId: cnv.id,
        direction: 'inbound',
        body,
        deliveryState: 'received',
        createdAt: clock.nowMs(),
      },
      clock,
    )
    return message
  }
  return { db, caller, tenantId, clock, cnv, contact, ana, depilacao, adapter, say, close: boot.close }
}

function seedCountedLink(
  s: ReturnType<typeof seedClinic>,
  index: number,
  clientRequestId: string,
  interactiveJson: string | null,
) {
  const messageId = `msg_seed_${s.tenantId}_${index}`
  const createdAt = s.clock.nowMs() - 60_000
  s.db.run(
    `INSERT INTO messages (
      id, tenant_id, conversation_id, direction, body,
      external_message_id, delivery_state,
      author_clerk_user_id, author_display_name, created_at
    ) VALUES (?, ?, ?, 'outbound', ?, NULL, 'accepted', 'system:ai-autodraft', 'IA', ?)`,
    messageId,
    s.tenantId,
    s.cnv.id,
    `Link prévio ${index}`,
    createdAt,
  )
  s.db.run(
    `INSERT INTO outbound_messages (
      id, tenant_id, conversation_id, message_id, client_request_id,
      provider_message_id, kind, template_name, template_language,
      template_params_json, interactive_json, delivery_state, failure_reason, outbox_event_id,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, NULL, 'interactive', NULL, NULL, NULL, ?, 'accepted', NULL, NULL, ?, ?)`,
    `ob_seed_${s.tenantId}_${index}`,
    s.tenantId,
    s.cnv.id,
    messageId,
    clientRequestId,
    interactiveJson,
    createdAt,
    createdAt,
  )
}

const CTA_AGENDA = JSON.stringify({
  ctaUrl: { displayText: 'Abrir agenda', url: 'https://app.l1.test/c/seed' },
})

async function runTurn(s: ReturnType<typeof seedClinic>, body: string) {
  const web = createClientWebHarness()
  const inbound = s.say(body)
  enqueueAutoDraft(s.db, s.tenantId, { conversationId: s.cnv.id, messageId: inbound.id }, s.clock)
  s.clock.advance(7_000)
  const out = await runDueAutoDrafts(s.db, s.caller, s.clock, {
    mode: 'synthetic',
    adapter: s.adapter,
    prepareClientWebOffer: web.prepareOffer,
    clinicName: 'Clínica Fictícia',
  })
  const sent = s.db.get<{ body: string }>(
    `SELECT body FROM messages WHERE tenant_id = ? AND direction = 'outbound' ORDER BY created_at DESC LIMIT 1`,
    s.tenantId,
  )?.body
  return { out, sent, web }
}

describe('21/11 — pedido de agendar não é handoff de terceiro (P24)', () => {
  it('«quarta-feira feira» é pedido de marcar, não terceiro nem profissional', () => {
    const s = seedClinic(SAT_2212, 'clinic-demo-p24-phrase')
    try {
      expect(classifySensitive(PHRASE_AGENDAR).map((hit) => hit.label)).not.toContain('terceiro')
      expect(handoffReason(s.db, s.tenantId, PHRASE_AGENDAR, s.clock)).toBeNull()
      expect(
        routeToClientWeb({ text: PHRASE_AGENDAR, services: [], hasUpcoming: true }),
      ).toMatchObject({ purpose: 'agendar' })
    } finally {
      s.close()
    }
  })

  it('a frase segue para Abrir agenda, sem pausa', async () => {
    const s = seedClinic(SAT_2212, 'clinic-demo-p24-link')
    try {
      const { out, sent } = await runTurn(s, PHRASE_AGENDAR)
      expect(out[0]?.reason).toBe('web_agendar_link')
      expect(readAiReplyPause(s.db, s.tenantId, s.cnv.id)).toBeNull()
      expect(sent).toMatch(/Abrir agenda/i)
      expect(sent).not.toMatch(/equipe continuar/i)
    } finally {
      s.close()
    }
  })

  it('links de informação, Posso ajudar e remarcar não gastam o teto de «quero marcar»', async () => {
    const s = seedClinic(SAT_2212, 'clinic-demo-p24-ceiling')
    try {
      const ids = [
        'followup.postbook:apt_1',
        'ai-web-home:m1',
        'ai-web-remarcar:m2',
        'ai-web-home:m3',
        'ai-web-cancelar:m4',
      ]
      ids.forEach((id, index) => seedCountedLink(s, index, id, CTA_AGENDA))
      const { out, sent } = await runTurn(s, PHRASE_AGENDAR)
      expect(out[0]?.reason).toBe('web_agendar_link')
      expect(readAiReplyPause(s.db, s.tenantId, s.cnv.id)).toBeNull()
      expect(sent).toMatch(/Abrir agenda/i)
      expect(sent).not.toMatch(/equipe continuar/i)
    } finally {
      s.close()
    }
  })

  it('cinco pedidos de agendar na hora ainda passam à equipe', async () => {
    const s = seedClinic(SAT_2212, 'clinic-demo-p24-spam')
    try {
      for (let i = 0; i < CLIENT_WEB_LINKS_PER_CONVERSATION; i++) {
        seedCountedLink(s, i, `ai-web-agendar:seed_${i}`, CTA_AGENDA)
      }
      const { out, sent } = await runTurn(s, PHRASE_AGENDAR)
      expect(out[0]?.reason).toBe('web_link_limit')
      expect(readAiReplyPause(s.db, s.tenantId, s.cnv.id)?.reason).toBe('human_only')
      expect(sent).toMatch(/equipe continuar/i)
    } finally {
      s.close()
    }
  })
})

describe('21/11 — dia fechado oferece a próxima abertura (P27)', () => {
  it('«poderia me atender amanhã?» no sábado diz que domingo está fechado e que segunda abre', () => {
    const s = seedClinic(SAT_2212, 'clinic-demo-p27')
    try {
      const text = 'Boa noite \nVocê poderia me atender amanhã?'
      expect(openingHoursMixedWithBooking(text)).toBe(false)
      expect(routeToClientWeb({ text, services: [], hasUpcoming: false })).toMatchObject({
        purpose: 'agendar',
      })
      const reply = buildOpeningHoursReply(s.db, s.tenantId, s.clock, text, s.cnv.id)
      expect(reply).toMatch(/amanh[aã] \(domingo\): fechado/i)
      expect(reply).toMatch(/segunda-feira: 09:00/)
    } finally {
      s.close()
    }
  })
})

describe('21/11 — preço seguinte mantém a variante (P28)', () => {
  it('«Quanto custa?» depois de íntima masculina responde R$ 200, não a faixa da depilação', () => {
    const s = seedClinic(SAT_2212, 'clinic-demo-p28')
    try {
      const offer = catalogReply(
        s.db,
        s.tenantId,
        'Oi tudo bem? Fazem depilação íntima masculina?',
        s.clock,
        { conversationId: s.cnv.id },
      )
      expect(offer).toMatch(/íntima/i)
      const subject = getActiveCatalogSubject(s.db, s.tenantId, s.cnv.id, { nowMs: s.clock.nowMs() })
      expect(subject?.serviceId).toBe(s.depilacao.id)
      expect(subject?.variantIds).toHaveLength(1)
      expect(subject?.audienceLine).toBe('masculino')

      const price = catalogReply(s.db, s.tenantId, 'Quanto custa?', s.clock, {
        conversationId: s.cnv.id,
      })
      expect(price).toMatch(/íntima/i)
      expect(price).toMatch(/200/)
      expect(price).not.toMatch(/vão de/i)
      expect(price).not.toMatch(/180/)
      expect(price).not.toMatch(/40,00/)
    } finally {
      s.close()
    }
  })
})

describe('21/11 — remarcar com várias marcações identifica o dia', () => {
  function book(s: ReturnType<typeof seedClinic>, id: string, year: number, month: number, day: number, hour: number, minute: number) {
    const startsAt = zonedCivilToUtc(TZ, year, month, day, hour, minute)
    s.db.run(
      `INSERT INTO appointments (id, tenant_id, service_id, professional_id, starts_at, ends_at, status, created_at, contact_id, confirmed_by)
       VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, 'system:proposal-send')`,
      id,
      s.tenantId,
      s.depilacao.id,
      s.ana.id,
      startsAt,
      startsAt + 30 * 60_000,
      s.clock.nowMs() - 60_000,
      s.contact.id,
    )
  }

  it('«dia 26» com duas marcações abre a de quinta e nomeia-a', async () => {
    const s = seedClinic(SAT_2212, 'clinic-demo-remarca')
    try {
      book(s, 'apt_seg', 2026, 11, 23, 16, 45)
      book(s, 'apt_qui', 2026, 11, 26, 16, 0)
      const { out, sent, web } = await runTurn(s, 'Gostaria de reagendar meu horário do dia 26')
      expect(out[0]?.reason).toBe('web_remarcar_link')
      expect(readAiReplyPause(s.db, s.tenantId, s.cnv.id)).toBeNull()
      expect(web.issued()[0]).toMatchObject({ purpose: 'remarcar', appointmentId: 'apt_qui' })
      expect(sent).toMatch(/26\/11/)
      expect(sent).toMatch(/16:00/)
      expect(sent).toMatch(/Abrir agenda/)
    } finally {
      s.close()
    }
  })

  it('«dia 23» sem marcação nesse dia não abre a outra data', async () => {
    const s = seedClinic(SAT_2212, 'clinic-demo-remarca-miss')
    try {
      book(s, 'apt_qui', 2026, 11, 26, 16, 0)
      const { sent, web } = await runTurn(s, 'Gostaria de reagendar meu horário do dia 23')
      expect(web.issued()[0]).toMatchObject({ purpose: 'remarcar', appointmentId: null })
      expect(sent).toBe(CLIENT_WEB_RESCHEDULE_BODY)
    } finally {
      s.close()
    }
  })
})

describe('pickRescheduleAppointment', () => {
  const apts: UpcomingApt[] = [
    {
      id: 'apt_a',
      serviceId: 'svc',
      professionalId: 'pro',
      startsAt: 1,
      endsAt: 2,
      serviceName: 'Depilação',
    },
    {
      id: 'apt_b',
      serviceId: 'svc',
      professionalId: 'pro',
      startsAt: 3,
      endsAt: 4,
      serviceName: 'Depilação',
    },
  ]
  const civil = (startsAt: number) => (startsAt === 1 ? '2026-11-23' : '2026-11-26')

  it('dia nomeado com uma marcação devolve essa', () => {
    expect(pickRescheduleAppointment(apts, '2026-11-26', civil)?.id).toBe('apt_b')
  })

  it('dia nomeado sem marcação não cai na outra', () => {
    expect(pickRescheduleAppointment(apts, '2026-11-24', civil)).toBeNull()
  })

  it('sem dia e uma só marcação devolve essa', () => {
    expect(pickRescheduleAppointment([apts[0]!], null, civil)?.id).toBe('apt_a')
  })

  it('sem dia e várias marcações não escolhe', () => {
    expect(pickRescheduleAppointment(apts, null, civil)).toBeNull()
  })
})
