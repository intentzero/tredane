/**
 * Triagem conversacional — amostras staging 16/11/2026 (pré fe79c1a0).
 * Catálogo sintético espelhando a clínica de teste; contacto 5500…
 */
import { describe, expect, it } from 'vitest'
import { SimulatedAiAdapter } from '../../ai'
import { createControllableClock } from '../../db/clock'
import {
  replaceServiceZonesOp,
  setWeeklyWindowsOp,
  upsertResourceOp,
  upsertServiceOp,
} from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import type { ServiceZoneRow } from '../config/types'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { resolveZoneMention } from '../config/zones'
import { tryAiAutoBook } from './autobook'
import { enqueueAutoDraft, runDueAutoDrafts } from './autodraft'
import { loadTurnContext } from './turn-context'
import { saveBookingFrame } from './schedule-session'

/** Seg 16/11/2026 11:00 America/Sao_Paulo */
const NOW = Date.UTC(2026, 10, 16, 14, 0)

type ClinicSeed = ReturnType<typeof seedSyntheticClinic>

const MASSAGEM_TYPES: Omit<ServiceZoneRow, 'id' | 'tenantId' | 'serviceId' | 'active' | 'sortOrder'>[] = [
  {
    name: 'Liberação miofascial',
    audience: 'ambos',
    durationMinutes: 50,
    priceCents: 15_000,
    synonyms: [],
    clientExplanation: null,
  },
  {
    name: 'Massagem relaxante',
    audience: 'ambos',
    durationMinutes: 50,
    priceCents: 18_000,
    synonyms: [],
    clientExplanation: null,
  },
]

function seedSyntheticClinic() {
  const clock = createControllableClock(NOW)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-triage-1611'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'b_triage_1611',
      phoneNumberId: 'p_triage',
      wabaId: 'w_triage',
      displayPhone: '+5511999005500',
      displayName: 'Clínica Sintética',
      action: 'channel_connected',
    },
    clock,
  )
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Luiza' }, clock)
  const depi = upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilação a laser',
      durationMinutes: 15,
      bufferMinutes: 0,
      priceCents: null,
      variantKind: 'zona',
      variantKindPlural: 'zonas',
      variantSelection: 'varias',
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  replaceServiceZonesOp(
    db,
    caller,
    depi.id,
    [
      {
        name: 'Íntima',
        audience: 'feminino',
        durationMinutes: 20,
        priceCents: 18_000,
        clientExplanation: 'Inclui virilha e ânus no feminino.',
      },
      {
        name: 'Tórax e Abdômen',
        audience: 'feminino',
        durationMinutes: 25,
        priceCents: 12_000,
      },
      { name: 'Costas', audience: 'feminino', durationMinutes: 25, priceCents: 11_000 },
      { name: 'Pernas', audience: 'feminino', durationMinutes: 35, priceCents: 14_000 },
    ],
    clock,
  )
  const massagem = upsertServiceOp(
    db,
    caller,
    {
      name: 'Massagem',
      durationMinutes: 50,
      bufferMinutes: 0,
      priceCents: 18_000,
      variantKind: 'tipo',
      variantKindPlural: 'tipos',
      variantSelection: 'uma',
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  replaceServiceZonesOp(
    db,
    caller,
    massagem.id,
    MASSAGEM_TYPES.map((z) => ({ ...z, synonyms: [] })),
    clock,
  )
  const bronze = upsertServiceOp(
    db,
    caller,
    {
      name: 'Bronzeamento',
      durationMinutes: 45,
      bufferMinutes: 0,
      priceCents: 12_000,
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
      clientExplanation: 'Bronze em cabine com tempo de secagem.',
    },
    clock,
  )
  setWeeklyWindowsOp(
    db,
    caller,
    {
      resourceId: pro.id,
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
    { tenantId, waId: '5511999005500', displayName: 'Cliente Sintética' },
    clock,
  )
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  return { ...boot, clock, tenantId, caller, cnv, depi, massagem, bronze, db }
}

async function autoBookReply(s: ClinicSeed, body: string) {
  const inbound = insertMessage(
    s.db,
    {
      tenantId: s.tenantId,
      conversationId: s.cnv.id,
      direction: 'inbound',
      body,
      deliveryState: 'received',
      createdAt: s.clock.nowMs() + 1,
    },
    s.clock,
  )
  const turn = loadTurnContext(
    s.db,
    s.tenantId,
    {
      conversationId: s.cnv.id,
      contactId: s.cnv.contactId,
      messageId: inbound.id,
      inboundBody: inbound.body,
    },
    s.clock,
  )
  const out = await tryAiAutoBook(s.db, s.caller, s.clock, {
    conversationId: s.cnv.id,
    enabled: true,
    capability: true,
    turn,
    confirmationMessageIdOverride: inbound.id,
  })
  return out.replyText ?? ''
}

async function draftReply(s: ClinicSeed, body: string) {
  const msg = insertMessage(
    s.db,
    {
      tenantId: s.tenantId,
      conversationId: s.cnv.id,
      direction: 'inbound',
      body,
      deliveryState: 'received',
      createdAt: s.clock.nowMs() + 1,
    },
    s.clock,
  )
  enqueueAutoDraft(s.db, s.tenantId, { conversationId: s.cnv.id, messageId: msg.id }, s.clock)
  s.clock.advance(8_000)
  const out = await runDueAutoDrafts(s.db, s.caller, s.clock, {
    mode: 'synthetic',
    adapter: new SimulatedAiAdapter(),
    clinicName: 'Clínica Sintética',
  })
  return (
    out[0]?.autoBook?.replyText ??
    s.db.get<{ body: string }>(
      `SELECT body FROM messages WHERE conversation_id = ? AND direction = 'outbound' ORDER BY created_at DESC LIMIT 1`,
      s.cnv.id,
    )?.body ??
    ''
  )
}

function massagemZoneRows(): ServiceZoneRow[] {
  return MASSAGEM_TYPES.map((z, i) => ({
    ...z,
    id: `z_${i}`,
    tenantId: 't',
    serviceId: 'mass',
    active: true,
    sortOrder: i,
    synonyms: [],
    clientExplanation: null,
  }))
}

describe('P1 — palavras comuns não viram serviço/zona', () => {
  it.each(['disponibilidade', 'atende', 'opa', 'abdominal', 'como'])(
    'menção isolada «%s» não gera Entendi/Não encontrei como serviço',
    async (word) => {
      const s = seedSyntheticClinic()
      try {
        saveBookingFrame(
          s.db,
          s.tenantId,
          s.cnv.id,
          { serviceId: s.massagem.id, phase: 'coletando' },
          s.clock,
        )
        const reply = await autoBookReply(s, word)
        expect(reply).not.toMatch(new RegExp(`Entendi:\\s*${word}`, 'i'))
        expect(reply).not.toMatch(new RegExp(`Não encontrei\\s+${word}`, 'i'))
      } finally {
        s.close()
      }
    },
  )

  it('typo «miofaacial» resolve a variante sem leftover', () => {
    const mention = resolveZoneMention('Liberação miofaacial', massagemZoneRows(), {
      ignoreWords: ['Massagem'],
    })
    expect(mention.unrecognized).toBe(false)
    expect(mention.leftover).toBeNull()
    expect(mention.zones[0]?.name).toBe('Liberação miofascial')
  })

  it('pergunta o tipo sem eco incoerente («miofaacial»)', async () => {
    const s = seedSyntheticClinic()
    try {
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        { serviceId: s.massagem.id, phase: 'coletando' },
        s.clock,
      )
      const reply = await autoBookReply(s, 'Liberação miofaacial')
      expect(reply).not.toMatch(/Não encontrei miofaacial/i)
      expect(reply).not.toMatch(/Entendi:.*Não encontrei/i)
      expect(reply).toMatch(/liberação miofascial|tipo/i)
    } finally {
      s.close()
    }
  })
})

describe('P12 — disponibilidade sem serviço na abertura', () => {
  it('«tem disponibilidade amanhã?» pede serviço e não trata disponibilidade como procedimento', async () => {
    const s = seedSyntheticClinic()
    try {
      const reply = await draftReply(s, 'tem disponibilidade amanhã?')
      expect(reply).not.toMatch(/Não encontrei disponibilidade/i)
      expect(reply).not.toMatch(/Entendi:\s*disponibilidade/i)
      expect(reply).toMatch(/serviço|procedimento|qual|Depilação|Massagem|Bronzeamento/i)
    } finally {
      s.close()
    }
  })
})

describe('P15 — FAQ íntima / virilha determinístico', () => {
  it('«A íntima inclui a virilha?» responde Sim com base no cadastro (repetível)', async () => {
    const s = seedSyntheticClinic()
    try {
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        {
          serviceId: s.depi.id,
          line: 'feminino',
          phase: 'coletando',
        },
        s.clock,
      )
      const r1 = await autoBookReply(s, 'A íntima inclui a virilha?')
      const r2 = await autoBookReply(s, 'A íntima inclui a virilha?')
      expect(r1).toMatch(/virilha|Sim/i)
      expect(r1).not.toMatch(/não tenho esse detalhe/i)
      expect(r2).toBe(r1)
    } finally {
      s.close()
    }
  })
})

describe('P16 — explicação bronzeamento (já #809 S15/S17)', () => {
  it('«Quero saber como é o bronzeamento» não oferece horários', async () => {
    const s = seedSyntheticClinic()
    try {
      const reply = await autoBookReply(s, 'Quero saber como é o bronzeamento')
      expect(reply).toMatch(/cabine|Bronze|cadastro|secagem/i)
      expect(reply).not.toMatch(/09:00|tenho amanhã|Horários/i)
    } finally {
      s.close()
    }
  })
})

describe('P17 — preço do serviço pedido (já #809 S16)', () => {
  it('«Qual o valor do bronzeamento?» não devolve preço da massagem no quadro', async () => {
    const s = seedSyntheticClinic()
    try {
      saveBookingFrame(
        s.db,
        s.tenantId,
        s.cnv.id,
        { serviceId: s.massagem.id, phase: 'coletando' },
        s.clock,
      )
      const reply = await autoBookReply(s, 'Qual o valor do bronzeamento?')
      expect(reply).toMatch(/R\$\s*120,00|120,00/)
      expect(reply).not.toMatch(/R\$\s*180,00|180,00/)
    } finally {
      s.close()
    }
  })
})