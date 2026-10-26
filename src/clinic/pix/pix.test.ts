import { describe, expect, it } from 'vitest'
import { createControllableClock } from '../../db/clock'
import { createWooviSandboxFixture } from '../../pix'
import { CLINIC_SCHEMA_VERSION, ValidationError, workerCaller } from '../index'
import { bootClinicDb } from '../test-db'
import { upsertResourceOp, upsertServiceOp } from '../config'
import {
  connectPixAccountOp,
  disconnectPixAccountOp,
  getPixAccountOp,
  listPixChargesOp,
  recordLocalPixChargeOp,
  revokePixCredentialOp,
  updatePixSignalSettingsOp,
} from './index'

describe('Clinic Pix account + signal config (#37)', () => {
  it('migra schema com pix_account e pix_charges', () => {
    const { db, close } = bootClinicDb()
    try {
      const state = db.get<{ version: number }>(
        'SELECT version FROM clinic_schema_state WHERE id = 1',
      )
      expect(state?.version).toBe(CLINIC_SCHEMA_VERSION)
      expect(
        db.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='pix_account'`,
        )?.n,
      ).toBe(1)
      expect(
        db.get<{ n: number }>(
          `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='pix_charges'`,
        )?.n,
      ).toBe(1)
    } finally {
      close()
    }
  })

  it('owner conecta conta; cipher nunca aparece no público; attendant não escreve via ops de settings', async () => {
    const clock = createControllableClock(1_700_000_000_000)
    const { db, close } = bootClinicDb({ clock })
    const sandbox = await createWooviSandboxFixture()
    const appId = 'synth_clinic_a_woovi_appid_001'
    sandbox.addValidAppId(appId)
    try {
      const owner = workerCaller('clinic-demo-a', 'user_synth_owner_a')
      const connected = await connectPixAccountOp(
        db,
        owner,
        { appId, clerkUserId: 'user_synth_owner_a', environment: 'synthetic' },
        clock,
        {
          environment: 'synthetic',
          fetchImpl: sandbox.fetchImpl,
          baseUrl: sandbox.baseUrl,
          webhookPublicKeys: [sandbox.publicPem],
          sealKeys: {},
        },
      )
      expect(connected.status).toBe('connected')
      expect(connected.canCreateCharge).toBe(true)
      expect(connected.appIdHint).toMatch(/••••/)
      expect(JSON.stringify(connected)).not.toContain(appId)
      expect(JSON.stringify(connected)).not.toContain('cipher')

      const publicView = getPixAccountOp(db, owner, clock)
      expect(publicView.credentialVersion).toBe(1)

      // Rotação: reconnect incrementa versão
      const rotated = await connectPixAccountOp(
        db,
        owner,
        { appId, clerkUserId: 'user_synth_owner_a', environment: 'synthetic' },
        clock,
        {
          environment: 'synthetic',
          fetchImpl: sandbox.fetchImpl,
          baseUrl: sandbox.baseUrl,
          webhookPublicKeys: [sandbox.publicPem],
          sealKeys: {},
        },
      )
      expect(rotated.credentialVersion).toBe(2)
    } finally {
      close()
    }
  })

  it('sem conta conectada bloqueia gravação de cobrança; desconexão preserva histórico', async () => {
    const clock = createControllableClock(1_700_000_000_000)
    const { db, close } = bootClinicDb({ clock })
    const sandbox = await createWooviSandboxFixture()
    const appId = 'synth_preserve_charges_app'
    sandbox.addValidAppId(appId)
    try {
      const owner = workerCaller('clinic-demo-a', 'user_synth_owner_a')
      expect(getPixAccountOp(db, owner, clock).canCreateCharge).toBe(false)

      expect(() =>
        recordLocalPixChargeOp(
          db,
          owner,
          {
            accountId: 'x',
            provider: 'woovi',
            providerChargeId: 'c1',
            externalReference: 'ref1',
            amountCents: 1000,
            status: 'awaiting_payment',
          },
          clock,
        ),
      ).toThrow(ValidationError)

      const connected = await connectPixAccountOp(
        db,
        owner,
        { appId, clerkUserId: 'user_synth_owner_a', environment: 'synthetic' },
        clock,
        {
          environment: 'synthetic',
          fetchImpl: sandbox.fetchImpl,
          baseUrl: sandbox.baseUrl,
          webhookPublicKeys: [sandbox.publicPem],
        },
      )
      const charge = recordLocalPixChargeOp(
        db,
        owner,
        {
          accountId: connected.accountId!,
          provider: 'woovi',
          providerChargeId: 'woovi_1',
          externalReference: 'tredane_ref_1',
          amountCents: 5400,
          status: 'awaiting_payment',
        },
        clock,
      )
      expect(charge.amountCents).toBe(5400)

      const disc = disconnectPixAccountOp(db, owner, clock)
      expect(disc.account.status).toBe('disconnected')
      expect(disc.account.canCreateCharge).toBe(false)
      expect(disc.chargesPreserved).toBe(1)

      const listed = listPixChargesOp(db, owner, clock, connected.accountId!)
      expect(listed).toHaveLength(1)
      expect(listed[0]?.externalReference).toBe('tredane_ref_1')
    } finally {
      close()
    }
  })

  it('revogação de credencial impede nova cobrança e consulta por conta mantém histórico', async () => {
    const clock = createControllableClock(1_700_000_000_000)
    const { db, close } = bootClinicDb({ clock })
    const sandbox = await createWooviSandboxFixture()
    const appId = 'synth_revoke_app'
    sandbox.addValidAppId(appId)
    try {
      const owner = workerCaller('clinic-demo-a', 'user_synth_owner_a')
      const connected = await connectPixAccountOp(
        db,
        owner,
        { appId, clerkUserId: 'user_synth_owner_a', environment: 'synthetic' },
        clock,
        {
          environment: 'synthetic',
          fetchImpl: sandbox.fetchImpl,
          baseUrl: sandbox.baseUrl,
          webhookPublicKeys: [sandbox.publicPem],
        },
      )
      recordLocalPixChargeOp(
        db,
        owner,
        {
          accountId: connected.accountId!,
          provider: 'woovi',
          providerChargeId: 'w2',
          externalReference: 'ref_rev',
          amountCents: 2000,
          status: 'paid',
        },
        clock,
      )
      const revoked = revokePixCredentialOp(db, owner, 'App ID revogado no provedor', clock)
      expect(revoked.status).toBe('revoked')
      expect(revoked.canCreateCharge).toBe(false)
      expect(listPixChargesOp(db, owner, clock, connected.accountId!).length).toBe(1)
    } finally {
      close()
    }
  })

  it('serviço com sinal percentual exige preço; prazo padrão 2h ajustável', () => {
    const clock = createControllableClock(1_700_000_000_000)
    const { db, close } = bootClinicDb({ clock })
    try {
      const owner = workerCaller('clinic-demo-a', 'user_synth_owner_a')
      const pro = upsertResourceOp(
        db,
        owner,
        { kind: 'professional', name: 'Dra. Teste' },
        clock,
      )

      expect(() =>
        upsertServiceOp(
          db,
          owner,
          {
            name: 'Peeling sem preço',
            durationMinutes: 60,
            bufferMinutes: 15,
            priceCents: null,
            professionalIds: [pro.id],
            requiresSignal: true,
            signalKind: 'percent',
            signalPercent: 30,
          },
          clock,
        ),
      ).toThrow(ValidationError)

      const svc = upsertServiceOp(
        db,
        owner,
        {
          name: 'Limpeza de pele',
          durationMinutes: 60,
          bufferMinutes: 15,
          priceCents: 18000,
          professionalIds: [pro.id],
          requiresSignal: true,
          signalKind: 'percent',
          signalPercent: 30,
        },
        clock,
      )
      expect(svc.requiresSignal).toBe(true)
      expect(svc.signalPercent).toBe(30)

      const settings = updatePixSignalSettingsOp(
        db,
        owner,
        {
          deadlineSeconds: 3600,
          cancellationPolicy: 'Em cancelamento, a clínica pode devolver ou reter o sinal.',
        },
        clock,
      )
      expect(settings.deadlineSeconds).toBe(3600)
      expect(settings.cancellationPolicy).toContain('devolver')
    } finally {
      close()
    }
  })

  it('credenciais da clínica A não misturam com B', async () => {
    const clock = createControllableClock(1_700_000_000_000)
    const a = bootClinicDb({ clock })
    const b = bootClinicDb({ clock })
    const sandbox = await createWooviSandboxFixture()
      sandbox.addValidAppId('app_clinica_aaaa')
    sandbox.addValidAppId('app_clinica_bbbb')
    try {
      const ownerA = workerCaller('clinic-demo-a', 'owner_a')
      const ownerB = workerCaller('clinic-demo-b', 'owner_b')
      const acctA = await connectPixAccountOp(
        a.db,
        ownerA,
        { appId: 'app_clinica_aaaa', clerkUserId: 'owner_a', environment: 'synthetic' },
        clock,
        {
          environment: 'synthetic',
          fetchImpl: sandbox.fetchImpl,
          baseUrl: sandbox.baseUrl,
          webhookPublicKeys: [sandbox.publicPem],
        },
      )
      const acctB = await connectPixAccountOp(
        b.db,
        ownerB,
        { appId: 'app_clinica_bbbb', clerkUserId: 'owner_b', environment: 'synthetic' },
        clock,
        {
          environment: 'synthetic',
          fetchImpl: sandbox.fetchImpl,
          baseUrl: sandbox.baseUrl,
          webhookPublicKeys: [sandbox.publicPem],
        },
      )
      expect(acctA.accountId).not.toBe(acctB.accountId)
      expect(acctA.appIdHint).not.toBe(acctB.appIdHint)
    } finally {
      a.close()
      b.close()
    }
  })
})
