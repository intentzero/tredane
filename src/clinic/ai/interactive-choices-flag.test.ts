/**
 * M5 (#415) / DEC-128: listas e botões de escolha desligados por defeito.
 * Ligados só com `interactiveChoices` (env `AI_INTERACTIVE_CHOICES=on`), depois do primeiro
 * teste real com a Meta. Desligados, o funil volta a ser texto, como antes do M5.
 * Dados fictícios.
 */
import { describe, expect, it } from 'vitest'
import { SimulatedAiAdapter } from '../../ai'
import { createControllableClock } from '../../db/clock'
import { replaceServiceZonesOp, setWeeklyWindowsOp, upsertResourceOp, upsertServiceOp } from '../config'
import { setClinicAiAssistEnabled } from '../config/settings'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import {
  handleChoiceOfferClick,
  VARIANT_LIST_BUTTON_LABEL,
} from './choice-offer'
import { rpcDepsFromEnv, toAiAssistDeps } from './deps'
import { enqueueAutoDraft, runDueAutoDrafts } from './index'
import { getBookingFrame } from './schedule-session'

// Quarta 28/10/2026 15:51 em São Paulo.
const NOW = Date.UTC(2026, 9, 28, 18, 51)

/** Serviço com variantes dos dois géneros: «Quero depilação» abre a pergunta da linha. */
function seed() {
  const clock = createControllableClock(NOW - 10 * 60_000)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-a'
  const caller = workerCaller(tenantId, 'user_synth_owner_a')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_flag',
      phoneNumberId: 'pn_flag',
      wabaId: 'waba_flag',
      displayPhone: '+5511900000077',
      displayName: 'Clínica Flag',
      action: 'channel_connected',
    },
    clock,
  )
  const room = upsertResourceOp(db, caller, { kind: 'room', name: 'Sala 1', category: 'Sala' }, clock)
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Gi', homeRoomId: room.id }, clock)
  const svc = upsertServiceOp(
    db,
    caller,
    {
      name: 'Depilação',
      durationMinutes: 30,
      bufferMinutes: 0,
      priceCents: 8000,
      variantKind: 'zona',
      variantKindPlural: 'zonas',
      professionalIds: [pro.id],
      roomRequirement: { mode: 'none' },
    },
    clock,
  )
  replaceServiceZonesOp(
    db,
    caller,
    svc.id,
    [
      { name: 'Axila', durationMinutes: 15, priceCents: 4000, audience: 'feminino' },
      { name: 'Pernas', durationMinutes: 30, priceCents: 9000, audience: 'feminino' },
      { name: 'Barba', durationMinutes: 15, priceCents: 3000, audience: 'masculino' },
      { name: 'Costas', durationMinutes: 30, priceCents: 7000, audience: 'masculino' },
    ],
    clock,
  )
  const week = [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1020 }))
  setWeeklyWindowsOp(db, caller, { resourceId: pro.id, windows: week }, clock)
  setWeeklyWindowsOp(db, caller, { resourceId: room.id, windows: week }, clock)
  setClinicAiAssistEnabled(db, tenantId, true, clock)
  const contact = upsertContact(db, { tenantId, waId: '5511900000077', displayName: 'Carla Demo' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  clock.advance(60_000)
  insertMessage(
    db,
    {
      tenantId,
      conversationId: cnv.id,
      direction: 'inbound',
      body: 'Quero depilação',
      deliveryState: 'received',
      createdAt: clock.nowMs(),
    },
    clock,
  )
  const run = async (interactiveChoices?: boolean) => {
    const last = db.get<{ id: string }>(
      `SELECT id FROM messages WHERE conversation_id = ? AND direction = 'inbound' ORDER BY created_at DESC LIMIT 1`,
      cnv.id,
    )!
    enqueueAutoDraft(db, tenantId, { conversationId: cnv.id, messageId: last.id }, clock)
    clock.advance(7_000)
    const out = await runDueAutoDrafts(db, caller, clock, {
      mode: 'synthetic',
      adapter: new SimulatedAiAdapter(),
      ...(interactiveChoices === undefined ? {} : { interactiveChoices }),
    })
    expect(out).toHaveLength(1)
    return out[0]!
  }
  const outbound = () =>
    db.all<{ kind: string; interactive_json: string | null }>(
      `SELECT kind, interactive_json FROM outbound_messages WHERE tenant_id = ? ORDER BY created_at`,
      tenantId,
    )
  return { ...boot, tenantId, cnv, run, outbound }
}

describe('DEC-128: escolhas interativas desligadas por defeito', () => {
  it('sem a flag: pergunta a linha em texto, sem mensagem interativa nem ids opacos no frame', async () => {
    const s = seed()
    try {
      const out = await s.run()
      expect(out.status).not.toBe('failed')
      const sent = s.outbound()
      expect(sent.length).toBeGreaterThan(0)
      expect(sent.every((m) => m.kind !== 'interactive')).toBe(true)
      expect(sent.every((m) => m.interactive_json == null)).toBe(true)
      const frame = getBookingFrame(s.db, s.tenantId, s.cnv.id)
      expect(JSON.stringify(frame?.pending ?? null)).not.toMatch(/choice|co:/i)
    } finally {
      s.close()
    }
  })

  it('flag explicitamente false: igual a omitida', async () => {
    const s = seed()
    try {
      await s.run(false)
      expect(s.outbound().every((m) => m.kind !== 'interactive')).toBe(true)
    } finally {
      s.close()
    }
  })

  it('com a flag: a mesma pergunta sai como mensagem interativa (prova de que o M5 funciona ligado)', async () => {
    const s = seed()
    try {
      await s.run(true)
      const interactive = s.outbound().filter((m) => m.kind === 'interactive')
      expect(interactive.length).toBe(1)
      expect(interactive[0]!.interactive_json).toMatch(/Feminina/)
      expect(interactive[0]!.interactive_json).toMatch(/Masculina/)
    } finally {
      s.close()
    }
  })
})

describe('DEC-128: origem da flag', () => {
  it('env ausente ou diferente de «on» → desligada', () => {
    expect(rpcDepsFromEnv({}).interactiveChoices).toBe(false)
    expect(rpcDepsFromEnv({ AI_INTERACTIVE_CHOICES: 'true' }).interactiveChoices).toBe(false)
    expect(rpcDepsFromEnv({ AI_INTERACTIVE_CHOICES: 'off' }).interactiveChoices).toBe(false)
  })

  it('AI_INTERACTIVE_CHOICES=on liga e chega às deps do autodraft', () => {
    const rpc = rpcDepsFromEnv({ AI_INTERACTIVE_CHOICES: 'on' })
    expect(rpc.interactiveChoices).toBe(true)
    expect(toAiAssistDeps(rpc).interactiveChoices).toBe(true)
    expect(toAiAssistDeps(rpcDepsFromEnv({})).interactiveChoices).toBe(false)
  })
})

/**
 * Regressão: toque M5 (linha) → próximo outbound deve herdar a mesma flag
 * que o autodraft. Sem ela, variantes saíam só em texto (Opções ausente).
 */
describe('DEC-128: toque na linha propaga interactiveChoices', () => {
  function femininaButtonId(interactiveJson: string | null): string {
    const parsed = JSON.parse(interactiveJson ?? '{}') as {
      buttons?: Array<{ id: string; title: string }>
    }
    const btn = parsed.buttons?.find((b) => b.title === 'Feminina')
    expect(btn?.id).toBeTruthy()
    return btn!.id
  }

  async function afterLineClick(interactiveChoices: boolean) {
    const s = seed()
    const caller = workerCaller(s.tenantId, 'user_synth_owner_a')
    await s.run(true)
    const lineOutbound = s.outbound().find((m) => m.kind === 'interactive')
    expect(lineOutbound).toBeTruthy()
    const buttonId = femininaButtonId(lineOutbound!.interactive_json)
    // Igual ao queue-consumer: ingest inbound do toque antes do handler.
    s.clock.advance(1_000)
    insertMessage(
      s.db,
      {
        tenantId: s.tenantId,
        conversationId: s.cnv.id,
        direction: 'inbound',
        body: '[Botão] Feminina',
        deliveryState: 'received',
        createdAt: s.clock.nowMs(),
      },
      s.clock,
    )
    const beforeCount = s.outbound().length
    const result = await handleChoiceOfferClick(
      s.db,
      caller,
      {
        tenantId: s.tenantId,
        conversationId: s.cnv.id,
        buttonId,
        providerEventKey: `test-line-${interactiveChoices ? 'on' : 'off'}`,
        interactiveChoices,
      },
      s.clock,
    )
    expect(result.handled).toBe(true)
    expect(result.outcome).toBe('applied')
    return { s, beforeCount, after: s.outbound().slice(beforeCount) }
  }

  it('flag on: após toque Feminina o próximo interactive é lista Opções (+ Todas)', async () => {
    const { s, after } = await afterLineClick(true)
    try {
      const interactive = after.filter((m) => m.kind === 'interactive')
      expect(interactive.length).toBe(1)
      const json = interactive[0]!.interactive_json ?? ''
      expect(json).toContain(VARIANT_LIST_BUTTON_LABEL)
      expect(json).toMatch(/Axila|Pernas/)
      expect(json).toContain('Todas')
      expect(json).not.toMatch(/Feminina|Masculina/)
    } finally {
      s.close()
    }
  })

  it('flag off: após toque Feminina o outbound seguinte é só texto', async () => {
    const { s, after } = await afterLineClick(false)
    try {
      expect(after.length).toBeGreaterThan(0)
      expect(after.every((m) => m.kind !== 'interactive')).toBe(true)
      expect(after.every((m) => m.interactive_json == null)).toBe(true)
    } finally {
      s.close()
    }
  })
})
