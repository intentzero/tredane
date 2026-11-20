/**
 * Item 6 — botão «Falar com a equipe» sempre nas interactivas + copy centralizada (16/11/2026).
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { setWeeklyWindowsOp, upsertResourceOp } from '../config'
import { sendOutboundMessageOp } from '../inbox/operations'
import { workerCaller } from '../index'
import { upsertContact } from '../contacts'
import { createConversation } from '../inbox/conversations'
import { insertMessage } from '../inbox/messages'
import { bootClinicDb } from '../test-db'
import { syncWhatsappChannel } from '../whatsapp/channel'
import { OPEN_AGENDA_REPLY_BUTTON_ID } from '../../clientweb/offer'
import {
  HUMAN_HANDOFF_BUTTON_ID,
  augmentOutboundWithHumanTeam,
  humanHelpRequestButtons,
  humanTeamAccessExplanation,
  humanTeamOfferButtons,
} from './human-handoff'

const TZ_OPEN = Date.UTC(2026, 10, 12, 15, 0)
const TZ_CLOSED = Date.UTC(2026, 10, 7, 20, 0)

function seed(nowMs: number) {
  const clock = createControllableClock(nowMs)
  const boot = bootClinicDb({ clock })
  const { db } = boot
  const tenantId = 'clinic-demo-human-access'
  const caller = workerCaller(tenantId, 'user_owner')
  syncWhatsappChannel(
    db,
    tenantId,
    {
      status: 'connected',
      bindingId: 'bind_hacc',
      phoneNumberId: 'pn_hacc',
      wabaId: 'waba_hacc',
      displayPhone: '+5511900000888',
      displayName: 'C',
      action: 'channel_connected',
    },
    clock,
  )
  const pro = upsertResourceOp(db, caller, { kind: 'professional', name: 'Ana' }, clock)
  setWeeklyWindowsOp(
    db,
    caller,
    {
      resourceId: pro.id,
      windows: [1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startMinute: 540, endMinute: 1080 })),
    },
    clock,
  )
  const contact = upsertContact(db, { tenantId, waId: '5511900000888', displayName: 'C' }, clock)
  const cnv = createConversation(db, { tenantId, contactId: contact.id, status: 'open' }, clock)
  insertMessage(
    db,
    {
      tenantId,
      conversationId: cnv.id,
      direction: 'inbound',
      body: 'oi',
      deliveryState: 'received',
      createdAt: nowMs - 60_000,
    },
    clock,
  )
  return { ...boot, db, tenantId, caller, cnv, clock }
}

describe('humanTeamAccess (item 6)', () => {
  it('humanTeamOfferButtons devolve Abrir agenda + Equipe (DEC-216), também fora do expediente', () => {
    const s = seed(TZ_CLOSED)
    try {
      expect(humanTeamOfferButtons(s.db, s.tenantId, s.clock)).toEqual([
        { id: OPEN_AGENDA_REPLY_BUTTON_ID, title: 'Abrir agenda' },
        { id: HUMAN_HANDOFF_BUTTON_ID, title: 'Falar com a equipe' },
      ])
      expect(
        humanTeamOfferButtons(s.db, s.tenantId, s.clock, { serviceId: 'svc_x' }),
      ).toEqual([
        { id: 'cw:abrir-agenda:svc_x', title: 'Abrir agenda' },
        { id: HUMAN_HANDOFF_BUTTON_ID, title: 'Falar com a equipe' },
      ])
    } finally {
      s.close()
    }
  })

  it('humanHelpRequestButtons (ack) só Abrir agenda — sem Equipe (TRE-54)', () => {
    const s = seed(TZ_CLOSED)
    try {
      expect(humanHelpRequestButtons(s.db, s.tenantId, s.clock)).toEqual([
        { id: OPEN_AGENDA_REPLY_BUTTON_ID, title: 'Abrir agenda' },
      ])
      expect(
        humanHelpRequestButtons(s.db, s.tenantId, s.clock, { serviceId: 'svc_x' }),
      ).toEqual([{ id: 'cw:abrir-agenda:svc_x', title: 'Abrir agenda' }])
    } finally {
      s.close()
    }
  })

  it('augmentOutboundWithHumanTeam — 1 botão ganha Abrir agenda + Equipe (DEC-216)', () => {
    const s = seed(TZ_OPEN)
    try {
      const aug = augmentOutboundWithHumanTeam(s.db, s.tenantId, s.clock, {
        body: 'Opção:',
        interactive: {
          buttons: [{ id: 'a', title: 'Continuar' }],
        },
      })
      expect(aug.interactive?.buttons).toEqual([
        { id: 'a', title: 'Continuar' },
        { id: OPEN_AGENDA_REPLY_BUTTON_ID, title: 'Abrir agenda' },
        { id: HUMAN_HANDOFF_BUTTON_ID, title: 'Falar com a equipe' },
      ])
    } finally {
      s.close()
    }
  })

  it('augmentOutboundWithHumanTeam — 2 botões ganham só o terceiro (Equipe; sem vaga para o par)', () => {
    const s = seed(TZ_OPEN)
    try {
      const aug = augmentOutboundWithHumanTeam(s.db, s.tenantId, s.clock, {
        body: 'Escolha:',
        interactive: {
          buttons: [
            { id: 'a', title: 'Sim' },
            { id: 'b', title: 'Não' },
          ],
        },
      })
      expect(aug.interactive?.buttons).toHaveLength(3)
      expect(aug.interactive?.buttons?.[2]?.id).toBe(HUMAN_HANDOFF_BUTTON_ID)
      expect(aug.body).toBe('Escolha:')
    } finally {
      s.close()
    }
  })

  it('augmentOutboundWithHumanTeam — lista com vagas acrescenta Abrir agenda + Equipe', () => {
    const s = seed(TZ_CLOSED)
    try {
      const expl = humanTeamAccessExplanation(s.db, s.tenantId, s.clock)
      expect(expl).toMatch(/Fora do horário/)
      const aug = augmentOutboundWithHumanTeam(s.db, s.tenantId, s.clock, {
        body: 'Horários:',
        interactive: {
          list: {
            button: 'Horários',
            sections: [
              {
                title: 'Manhã',
                rows: [{ id: 'slot:1', title: '09:00' }],
              },
            ],
          },
        },
      })
      const rows = aug.interactive?.list?.sections.flatMap((x) => x.rows) ?? []
      expect(rows.some((r) => r?.id === OPEN_AGENDA_REPLY_BUTTON_ID)).toBe(true)
      expect(rows.some((r) => r?.id === HUMAN_HANDOFF_BUTTON_ID)).toBe(true)
      expect(aug.body).toBe('Horários:')
    } finally {
      s.close()
    }
  })

  it('sendOutboundMessageOp aplica augment nas interactivas', () => {
    const s = seed(TZ_OPEN)
    try {
      sendOutboundMessageOp(
        s.db,
        s.caller,
        {
          conversationId: s.cnv.id,
          body: 'Opções',
          clientRequestId: 'human-access:send:1',
          authorClerkUserId: 'ia',
          authorDisplayName: 'IA',
          interactive: { buttons: [{ id: 'opt:1', title: 'Continuar' }] },
        },
        s.clock,
      )
      const ob = s.db.get<{ interactive_json: string | null }>(
        `SELECT interactive_json FROM outbound_messages WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1`,
        s.tenantId,
      )
      expect(ob?.interactive_json).toContain(HUMAN_HANDOFF_BUTTON_ID)
      expect(ob?.interactive_json).toContain(OPEN_AGENDA_REPLY_BUTTON_ID)
    } finally {
      s.close()
    }
  })
})