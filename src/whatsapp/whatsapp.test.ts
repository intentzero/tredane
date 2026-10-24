import { describe, expect, it } from 'vitest'
import { bootAdminDb } from '../db/test-db'
import { bootClinicDb } from '../clinic/test-db'
import { clinicWhatsapp } from '../clinic'
import { createControllableClock } from '../db/clock'
import { createWhatsappService } from './service'
import { SYNTHETIC_CODES } from './meta'
import { createMemoryWhatsappChannelSync } from './routes'
import { getCredentialCipher, resolveTenantByPhoneNumberId } from './bindings'
import { assertNoSecretsInPayload, serializeConnection } from './serialize'

const OWNER_A = 'user_synth_owner_a'
const OWNER_B = 'user_synth_owner_b'
const T_A = 'clinic-demo-a'
const T_B = 'clinic-demo-b'

function harness() {
  const admin = bootAdminDb()
  const clinics = new Map<string, ReturnType<typeof bootClinicDb>>()
  const getClinic = (tenantId: string) => {
    let boot = clinics.get(tenantId)
    if (!boot) {
      boot = bootClinicDb()
      clinics.set(tenantId, boot)
    }
    return { db: boot.db, clock: boot.clock }
  }
  const channelSync = createMemoryWhatsappChannelSync(getClinic)
  const clock = createControllableClock(1_700_000_000_000)
  const service = createWhatsappService({
    db: admin.db,
    clock,
    channelSync,
    metaEnv: { META_MODE: 'synthetic' },
  })
  return {
    service,
    admin,
    getClinic,
    clock,
    close: () => {
      for (const c of clinics.values()) c.close()
      admin.close()
    },
  }
}

describe('WhatsApp Embedded Signup (#31)', () => {
  it('conecta com state/nonce; tokens ficam só no D1 e fora da vista', async () => {
    const { service, admin, getClinic, close } = harness()
    try {
      const session = service.startSignupSession({
        tenantId: T_A,
        actorClerkUserId: OWNER_A,
        purpose: 'connect',
      })
      expect(session.state.length).toBeGreaterThan(16)
      expect(session.metaMode).toBe('synthetic')

      const view = await service.completeSignup({
        tenantId: T_A,
        actorClerkUserId: OWNER_A,
        payload: {
          state: session.state,
          code: SYNTHETIC_CODES.valid,
          phoneNumberId: 'pnid_a_1',
          wabaId: 'waba_a_1',
          displayPhone: '+5511999990001',
          displayName: 'Demo A',
        },
      })
      expect(view.status).toBe('connected')
      expect(view.phoneNumberId).toBe('pnid_a_1')
      const body = serializeConnection(view)
      assertNoSecretsInPayload(body)
      expect(JSON.stringify(body)).not.toContain('synth_token_')

      const cipher = getCredentialCipher(
        admin.db,
        resolveTenantByPhoneNumberId(admin.db, 'pnid_a_1')!.bindingId,
      )
      expect(cipher?.startsWith('synth:')).toBe(true)

      const mirror = clinicWhatsapp.getWhatsappChannel(getClinic(T_A).db, T_A)
      expect(mirror?.status).toBe('connected')
      expect(clinicWhatsapp.isWhatsappConnected(getClinic(T_A).db, T_A)).toBe(true)
    } finally {
      close()
    }
  })

  it('mesmo phone_number_id não associa a duas clínicas; fluxo forjado não activa', async () => {
    const { service, close } = harness()
    try {
      const sA = service.startSignupSession({
        tenantId: T_A,
        actorClerkUserId: OWNER_A,
        purpose: 'connect',
      })
      await service.completeSignup({
        tenantId: T_A,
        actorClerkUserId: OWNER_A,
        payload: {
          state: sA.state,
          code: SYNTHETIC_CODES.valid,
          phoneNumberId: 'pnid_shared',
          wabaId: 'waba_shared',
          displayPhone: '+551100000001',
        },
      })

      const sB = service.startSignupSession({
        tenantId: T_B,
        actorClerkUserId: OWNER_B,
        purpose: 'connect',
      })
      await expect(
        service.completeSignup({
          tenantId: T_B,
          actorClerkUserId: OWNER_B,
          payload: {
            state: sB.state,
            code: SYNTHETIC_CODES.valid,
            phoneNumberId: 'pnid_shared',
            wabaId: 'waba_shared',
            displayPhone: '+551100000001',
          },
        }),
      ).rejects.toMatchObject({ code: 'phone_in_use' })

      expect(service.getConnection(T_B).status).toBe('disconnected')

      const sForge = service.startSignupSession({
        tenantId: T_B,
        actorClerkUserId: OWNER_B,
        purpose: 'connect',
      })
      await expect(
        service.completeSignup({
          tenantId: T_B,
          actorClerkUserId: OWNER_B,
          payload: {
            state: sForge.state,
            code: SYNTHETIC_CODES.forged,
            phoneNumberId: 'pnid_b_forge',
            wabaId: 'waba_b',
          },
        }),
      ).rejects.toMatchObject({ code: 'code_invalid' })
      expect(service.getConnection(T_B).status).toBe('disconnected')

      await expect(
        service.completeSignup({
          tenantId: T_B,
          actorClerkUserId: OWNER_B,
          payload: {
            state: 'state_forjado_inexistente',
            code: SYNTHETIC_CODES.valid,
            phoneNumberId: 'pnid_b_2',
            wabaId: 'waba_b',
          },
        }),
      ).rejects.toMatchObject({ code: 'invalid_state' })
    } finally {
      close()
    }
  })

  it('interrupção, reconexão e troca preservam isolamento; disconnect liberta índice', async () => {
    const { service, admin, getClinic, close } = harness()
    try {
      const s1 = service.startSignupSession({
        tenantId: T_A,
        actorClerkUserId: OWNER_A,
        purpose: 'connect',
      })
      await service.completeSignup({
        tenantId: T_A,
        actorClerkUserId: OWNER_A,
        payload: {
          state: s1.state,
          code: SYNTHETIC_CODES.valid,
          phoneNumberId: 'pnid_swap_old',
          wabaId: 'waba_a',
          displayPhone: '+551111111111',
        },
      })

      await service.markInterrupted({
        tenantId: T_A,
        reason: 'Autorização removida',
        actorClerkUserId: OWNER_A,
      })
      expect(service.getConnection(T_A).status).toBe('interrupted')
      expect(
        clinicWhatsapp.getWhatsappChannel(getClinic(T_A).db, T_A)?.status,
      ).toBe('interrupted')
      // Índice ainda aponta para A (não reencaminha a outra clínica).
      expect(resolveTenantByPhoneNumberId(admin.db, 'pnid_swap_old')?.tenantId).toBe(T_A)
      expect(getCredentialCipher(
        admin.db,
        resolveTenantByPhoneNumberId(admin.db, 'pnid_swap_old')!.bindingId,
      )).toBeNull()

      const sRe = service.startSignupSession({
        tenantId: T_A,
        actorClerkUserId: OWNER_A,
        purpose: 'reconnect',
      })
      await service.completeSignup({
        tenantId: T_A,
        actorClerkUserId: OWNER_A,
        payload: {
          state: sRe.state,
          code: SYNTHETIC_CODES.valid,
          phoneNumberId: 'pnid_swap_old',
          wabaId: 'waba_a',
          displayPhone: '+551111111111',
        },
      })
      expect(service.getConnection(T_A).status).toBe('connected')

      const sRep = service.startSignupSession({
        tenantId: T_A,
        actorClerkUserId: OWNER_A,
        purpose: 'replace',
      })
      await service.completeSignup({
        tenantId: T_A,
        actorClerkUserId: OWNER_A,
        payload: {
          state: sRep.state,
          code: SYNTHETIC_CODES.valid,
          phoneNumberId: 'pnid_swap_new',
          wabaId: 'waba_a2',
          displayPhone: '+551122222222',
        },
      })
      expect(service.getConnection(T_A).phoneNumberId).toBe('pnid_swap_new')
      // Número antigo libertado — pode ir a B; não roteia para A.
      expect(resolveTenantByPhoneNumberId(admin.db, 'pnid_swap_old')).toBeNull()

      const sB = service.startSignupSession({
        tenantId: T_B,
        actorClerkUserId: OWNER_B,
        purpose: 'connect',
      })
      await service.completeSignup({
        tenantId: T_B,
        actorClerkUserId: OWNER_B,
        payload: {
          state: sB.state,
          code: SYNTHETIC_CODES.valid,
          phoneNumberId: 'pnid_swap_old',
          wabaId: 'waba_b',
          displayPhone: '+551111111111',
        },
      })
      expect(resolveTenantByPhoneNumberId(admin.db, 'pnid_swap_old')?.tenantId).toBe(T_B)
      expect(service.getConnection(T_A).phoneNumberId).toBe('pnid_swap_new')

      await service.disconnect({
        tenantId: T_A,
        actorClerkUserId: OWNER_A,
        clinicNameConfirmation: 'Clínica Aurora (fictícia)',
        expectedClinicName: 'Clínica Aurora (fictícia)',
      })
      expect(service.getConnection(T_A).status).toBe('disconnected')
      expect(resolveTenantByPhoneNumberId(admin.db, 'pnid_swap_new')).toBeNull()
      expect(
        clinicWhatsapp.getWhatsappChannel(getClinic(T_A).db, T_A)?.status,
      ).toBe('disconnected')
    } finally {
      close()
    }
  })
})
