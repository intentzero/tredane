/**
 * M5 (#415) / DEC-133 (revisão 03/11/2026): listas e botões de escolha sempre ligados.
 * Sem env gate — o funil envia Feminina/Masculina, Opções e Horários como interativos.
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
import { enqueueAutoDraft, runDueAutoDrafts } from './index'

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
  const run = async () => {
    const last = db.get<{ id: string }>(
      `SELECT id FROM messages WHERE conversation_id = ? AND direction = 'inbound' ORDER BY created_at DESC LIMIT 1`,
      cnv.id,
    )!
    enqueueAutoDraft(db, tenantId, { conversationId: cnv.id, messageId: last.id }, clock)
    clock.advance(7_000)
    const out = await runDueAutoDrafts(db, caller, clock, {
      mode: 'synthetic',
      adapter: new SimulatedAiAdapter(),
    })
    expect(out).toHaveLength(1)
    return out[0]!
  }
  const outbound = () =>
    db.all<{ kind: string; interactive_json: string | null }>(
      `SELECT kind, interactive_json FROM outbound_messages WHERE tenant_id = ? ORDER BY created_at`,
      tenantId,
    )
  return { ...boot, clock, tenantId, cnv, run, outbound }
}

describe('DEC-133: escolhas interativas sempre ligadas', () => {
  it('pergunta a linha sai como mensagem interativa (Feminina / Masculina)', async () => {
    const s = seed()
    try {
      const out = await s.run()
      expect(out.status).not.toBe('failed')
      const interactive = s.outbound().filter((m) => m.kind === 'interactive')
      expect(interactive.length).toBe(1)
      expect(interactive[0]!.interactive_json).toMatch(/Feminina/)
      expect(interactive[0]!.interactive_json).toMatch(/Masculina/)
    } finally {
      s.close()
    }
  })
})

/**
 * Regressão: toque M5 (linha) em serviço `varias` → pergunta de zonas + Opções (DEC-178).
 */
describe('DEC-128 / DEC-178: toque na linha em varias pede zonas com Opções', () => {
  function femininaButtonId(interactiveJson: string | null): string {
    const parsed = JSON.parse(interactiveJson ?? '{}') as {
      buttons?: Array<{ id: string; title: string }>
    }
    const btn = parsed.buttons?.find((b) => b.title === 'Feminina')
    expect(btn?.id).toBeTruthy()
    return btn!.id
  }

  async function afterLineClick() {
    const s = seed()
    const caller = workerCaller(s.tenantId, 'user_synth_owner_a')
    await s.run()
    const lineOutbound = s.outbound().find((m) => m.kind === 'interactive')
    expect(lineOutbound).toBeTruthy()
    const buttonId = femininaButtonId(lineOutbound!.interactive_json)
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
        providerEventKey: 'test-line-always-on',
      },
      s.clock,
    )
    expect(result.handled).toBe(true)
    if (!result.handled) throw new Error('expected choice click handled')
    expect(result.outcome).toBe('applied')
    return { s, beforeCount, after: s.outbound().slice(beforeCount), result }
  }

  it('após toque Feminina pergunta zonas com lista Opções (DEC-178)', async () => {
    const { s, after, result } = await afterLineClick()
    try {
      expect(result.handled).toBe(true)
      if (!result.handled) return
      const reply = result.autoBook?.replyText ?? ''
      expect(reply).toMatch(/quais zonas|zonas/i)
      expect(reply).toMatch(/Toque em Opções|axila e pernas/i)
      expect(result.autoBook?.interactive?.mode).toBe('list')
      const optionsLists = after.filter((m) =>
        (m.interactive_json ?? '').includes(VARIANT_LIST_BUTTON_LABEL),
      )
      expect(optionsLists.length).toBeGreaterThanOrEqual(1)
    } finally {
      s.close()
    }
  })
})
