/**
 * P2 (#184): anexos visíveis na mensagem — só metadados, legenda separada do
 * placeholder, estados com rótulo, vínculo validado e evento idempotente.
 * Dados fictícios; nenhum anexo entra no contexto da IA.
 */
import { describe, expect, it } from 'vitest'
import { bootClinicDb } from '../test-db'
import { clinicAttachments, clinicInbox, ingestContactMessage, workerCaller } from '..'
import { serializeMessage } from '../../inbox/serialize'

function setup() {
  const boot = bootClinicDb()
  const caller = workerCaller('clinic-demo-a', 'user_synth_attendant_a')
  const ing = (key: string, body: string, waId = '5511999000101') =>
    ingestContactMessage(boot.db, caller, { providerEventKey: key, waId, body }, boot.clock)
  return { ...boot, caller, ing }
}

function outboxCount(db: ReturnType<typeof bootClinicDb>['db'], type: string) {
  return db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM outbox_events WHERE type = ?`, type)!.n
}

describe('P2 — anexos na mensagem (#184)', () => {
  it('helpers: placeholder não vira legenda; rótulos por estado', () => {
    expect(clinicAttachments.captionFromBody('[Imagem]')).toBeNull()
    expect(clinicAttachments.captionFromBody('[Documento]')).toBeNull()
    expect(clinicAttachments.captionFromBody('foto do exame')).toBe('foto do exame')
    expect(clinicAttachments.attachmentStatusLabel('pending')).toBe('Anexo a carregar')
    expect(clinicAttachments.attachmentStatusLabel('failed')).toBe('Não foi possível receber o anexo')
    expect(clinicAttachments.attachmentStatusLabel('deleted')).toBe('Anexo removido')
  })

  it('detalhe expõe metadados, legenda e estados (incl. removido), nunca para IA', () => {
    const t = setup()
    const m1 = t.ing('wa:p2:1', 'legenda fictícia')
    const conv = m1.conversation!.id
    const a = clinicAttachments.createPendingAttachmentOp(t.db, t.caller, { contentType: 'image/jpeg', source: 'synthetic' }, t.clock)
    clinicAttachments.linkAttachmentToMessageOp(t.db, t.caller, { attachmentId: a.id, conversationId: conv, messageId: m1.message!.id }, t.clock)
    clinicAttachments.markAttachmentReadyOp(t.db, t.caller, { attachmentId: a.id, byteSize: 10, contentType: 'image/jpeg', filename: 'x.jpg' }, t.clock)

    const m2 = t.ing('wa:p2:2', '[Imagem]')
    const b = clinicAttachments.createPendingAttachmentOp(t.db, t.caller, { contentType: 'image/png', source: 'synthetic', conversationId: conv, messageId: m2.message!.id }, t.clock)
    clinicAttachments.markAttachmentFailedOp(t.db, t.caller, { attachmentId: b.id, failureCode: 'download_failed' }, t.clock)
    const m3 = t.ing('wa:p2:3', '[Documento]')
    const c = clinicAttachments.createPendingAttachmentOp(t.db, t.caller, { contentType: 'application/pdf', source: 'synthetic', conversationId: conv, messageId: m3.message!.id, filename: 'segredo.pdf' }, t.clock)
    clinicAttachments.softDeleteAttachmentOp(t.db, t.caller, c.id, t.clock)

    const d = clinicInbox.getConversationDetailOp(t.db, t.caller, { conversationId: conv }, t.clock)
    const byId = new Map(d.messages.map((m) => [m.id, serializeMessage(m) as Record<string, unknown>]))
    const s1 = byId.get(m1.message!.id)! as { caption: string; attachments: Array<Record<string, unknown>> }
    expect(s1.caption).toBe('legenda fictícia')
    expect(s1.attachments[0]).toMatchObject({ status: 'ready', statusLabel: 'Anexo recebido', includedInAiContext: false })
    const s2 = byId.get(m2.message!.id)! as { caption: unknown; attachments: Array<Record<string, unknown>> }
    expect(s2.caption).toBeNull()
    expect(s2.attachments[0]).toMatchObject({ status: 'failed', statusLabel: 'Não foi possível receber o anexo' })
    const s3 = byId.get(m3.message!.id)! as { attachments: Array<Record<string, unknown>> }
    expect(s3.attachments[0]).toMatchObject({ status: 'deleted', statusLabel: 'Anexo removido', filename: null, byteSize: 0 })
    const json = JSON.stringify([...byId.values()])
    expect(json).not.toMatch(/r2Key|r2_key|https?:\/\//)
  })

  it('vínculo: mensagem de outra conversa/inexistente é recusada; revínculo é conflito', () => {
    const t = setup()
    const m1 = t.ing('wa:p2:a', 'um', '5511999000201')
    const m2 = t.ing('wa:p2:b', 'dois', '5511999000202')
    const a = clinicAttachments.createPendingAttachmentOp(t.db, t.caller, { contentType: 'image/jpeg', source: 'synthetic' }, t.clock)
    expect(() => clinicAttachments.linkAttachmentToMessageOp(t.db, t.caller, { attachmentId: a.id, conversationId: m1.conversation!.id, messageId: m2.message!.id }, t.clock)).toThrow()
    expect(() => clinicAttachments.linkAttachmentToMessageOp(t.db, t.caller, { attachmentId: a.id, conversationId: m1.conversation!.id, messageId: 'msg_inexistente' }, t.clock)).toThrow()
    clinicAttachments.linkAttachmentToMessageOp(t.db, t.caller, { attachmentId: a.id, conversationId: m1.conversation!.id, messageId: m1.message!.id }, t.clock)
    expect(() => clinicAttachments.linkAttachmentToMessageOp(t.db, t.caller, { attachmentId: a.id, conversationId: m2.conversation!.id, messageId: m2.message!.id }, t.clock)).toThrow()
  })

  it('outra clínica não vincula anexo desta', () => {
    const t = setup()
    const m1 = t.ing('wa:p2:x', 'um')
    const a = clinicAttachments.createPendingAttachmentOp(t.db, t.caller, { contentType: 'image/jpeg', source: 'synthetic' }, t.clock)
    const other = workerCaller('clinic-demo-b', 'user_synth_attendant_b')
    expect(() => clinicAttachments.linkAttachmentToMessageOp(t.db, other, { attachmentId: a.id, conversationId: m1.conversation!.id, messageId: m1.message!.id }, t.clock)).toThrow()
  })

  it('evento message.attachments_updated é idempotente e chega após vínculo tardio', () => {
    const t = setup()
    const m1 = t.ing('wa:p2:late', '[Imagem]')
    const a = clinicAttachments.createPendingAttachmentOp(t.db, t.caller, { contentType: 'image/jpeg', source: 'synthetic' }, t.clock)
    expect(outboxCount(t.db, 'message.attachments_updated')).toBe(0)
    const input = { attachmentId: a.id, conversationId: m1.conversation!.id, messageId: m1.message!.id }
    clinicAttachments.linkAttachmentToMessageOp(t.db, t.caller, input, t.clock)
    clinicAttachments.linkAttachmentToMessageOp(t.db, t.caller, input, t.clock)
    expect(outboxCount(t.db, 'message.attachments_updated')).toBe(1)
    const row = clinicAttachments.markAttachmentReadyOp(t.db, t.caller, { attachmentId: a.id, byteSize: 5, contentType: 'image/jpeg' }, t.clock)
    clinicAttachments.emitAttachmentChanged(t.db, 'clinic-demo-a', row, t.clock)
    expect(outboxCount(t.db, 'message.attachments_updated')).toBe(2)
    const p = t.db.get<{ payload_json: string }>(`SELECT payload_json FROM outbox_events WHERE type = 'message.attachments_updated' ORDER BY occurred_at DESC, rowid DESC LIMIT 1`)!
    expect(Object.keys(JSON.parse(p.payload_json)).sort()).toEqual(['attachmentId', 'conversationId', 'messageId', 'status'])
  })
})
