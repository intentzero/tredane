/**
 * TRE-78 / DEC-180 — contexto IA usa o texto efectivo da política de sinal
 * (mesmo que Recebimento/cobrança), não só a coluna legada vazia.
 */
import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { upsertContact } from '../contacts'
import { workerCaller } from '../index'
import { updatePixSignalSettingsOp } from '../pix'
import { buildSignalPolicyPreview } from '../pix/signal-policy-text'
import { ensureClinicSettings } from '../config/settings'
import { bootClinicDb } from '../test-db'
import { buildClinicAiContext } from './schedule-context'

const CLOCK = Date.UTC(2024, 0, 8, 11, 0)

describe('buildClinicAiContext — política de sinal DEC-180', () => {
  it('usa o texto gerado gravado em cancellation_policy após salvar Recebimento', async () => {
    const clock = createControllableClock(CLOCK)
    const { db, close } = bootClinicDb({ clock })
    const tenantId = 'clinic-demo-a'
    const caller = workerCaller(tenantId, 'user_synth_owner_a')
    try {
      const saved = updatePixSignalSettingsOp(
        db,
        caller,
        {
          enabled: true,
          amountKind: 'fixed',
          fixedCents: 5000,
          deadlineSeconds: 30 * 60,
          policyKind: 'credit_next',
          creditWindowMinutes: 24 * 60,
        },
        clock,
      )
      expect(saved.cancellationPolicy).toContain('R$\u00a050,00')
      expect(saved.cancellationPolicy).toContain('crédito')

      const contact = upsertContact(
        db,
        { tenantId, waId: '5511999000099', displayName: 'Lia' },
        clock,
      )
      const { clinic } = await buildClinicAiContext(db, tenantId, clock, {
        contactId: contact.id,
        recentTexts: ['Qual a política do sinal?'],
      })
      expect(clinic.cancellationPolicy).toBe(saved.cancellationPolicy)
      // Coluna legada via ClinicSettingsRow continua preenchida após save.
      expect(ensureClinicSettings(db, tenantId, clock).signalCancellationPolicy).toBe(
        saved.cancellationPolicy,
      )
    } finally {
      close()
    }
  })

  it('com sinal ligado e coluna vazia, regenera o preview (drift)', async () => {
    const clock = createControllableClock(CLOCK)
    const { db, close } = bootClinicDb({ clock })
    const tenantId = 'clinic-demo-a'
    const caller = workerCaller(tenantId, 'user_synth_owner_a')
    try {
      updatePixSignalSettingsOp(
        db,
        caller,
        {
          enabled: true,
          amountKind: 'percent',
          percent: 20,
          deadlineSeconds: 15 * 60,
          policyKind: 'keep',
        },
        clock,
      )
      // Simula drift: regras estruturadas DEC-180 sem texto persistido.
      db.run(
        `UPDATE clinic_settings SET signal_cancellation_policy = '' WHERE id = 1 AND tenant_id = ?`,
        tenantId,
      )
      expect(ensureClinicSettings(db, tenantId, clock).signalCancellationPolicy).toBe('')

      const expected = buildSignalPolicyPreview({
        amountKind: 'percent',
        fixedCents: null,
        percent: 20,
        deadlineSeconds: 15 * 60,
        policyKind: 'keep',
        creditWindowMinutes: null,
      }).combined

      const contact = upsertContact(
        db,
        { tenantId, waId: '5511999000098', displayName: 'Bia' },
        clock,
      )
      const { clinic } = await buildClinicAiContext(db, tenantId, clock, {
        contactId: contact.id,
        recentTexts: ['Se eu cancelar, o sinal volta?'],
      })
      expect(clinic.cancellationPolicy).toBe(expected)
      expect(clinic.cancellationPolicy).toContain('20% do serviço')
      expect(clinic.cancellationPolicy).toContain('fica com a clínica')
    } finally {
      close()
    }
  })

  it('sinal desligado e coluna vazia: não inventa política default no contexto', async () => {
    const clock = createControllableClock(CLOCK)
    const { db, close } = bootClinicDb({ clock })
    const tenantId = 'clinic-demo-a'
    try {
      ensureClinicSettings(db, tenantId, clock)
      expect(ensureClinicSettings(db, tenantId, clock).signalCancellationPolicy).toBe('')
      const contact = upsertContact(
        db,
        { tenantId, waId: '5511999000096', displayName: 'Duda' },
        clock,
      )
      const { clinic } = await buildClinicAiContext(db, tenantId, clock, {
        contactId: contact.id,
        recentTexts: ['Tem multa se desmarcar?'],
      })
      expect(clinic.cancellationPolicy).toBeNull()
    } finally {
      close()
    }
  })

  it('Outro… (custom) chega ao bloco Cancelamento do contexto', async () => {
    const clock = createControllableClock(CLOCK)
    const { db, close } = bootClinicDb({ clock })
    const tenantId = 'clinic-demo-a'
    const caller = workerCaller(tenantId, 'user_synth_owner_a')
    const custom =
      'Política fictícia: o sinal só vale se remarcar com 48 h; sem devolução Pix.'
    try {
      updatePixSignalSettingsOp(
        db,
        caller,
        {
          enabled: true,
          amountKind: 'fixed',
          fixedCents: 9000,
          deadlineSeconds: 30 * 60,
          policyKind: 'custom',
          customPolicyText: custom,
        },
        clock,
      )
      const contact = upsertContact(
        db,
        { tenantId, waId: '5511999000097', displayName: 'Nara' },
        clock,
      )
      const { clinic } = await buildClinicAiContext(db, tenantId, clock, {
        contactId: contact.id,
        recentTexts: ['Como funciona o sinal?'],
      })
      expect(clinic.cancellationPolicy).toBe(custom)
    } finally {
      close()
    }
  })
})
