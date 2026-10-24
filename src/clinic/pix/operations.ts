import type { Clock } from '../../db/clock'
import {
  appIdHint,
  openPixAppId,
  sealPixAppId,
  WooviPixAdapter,
  createWooviSandboxFixture,
} from '../../pix'
import { writeOperationalAudit } from '../audit'
import type { ClinicCaller } from '../envelopes'
import { assertValidCaller } from '../envelopes'
import { ValidationError } from '../errors'
import { assertClinicSchemaReady } from '../migrations'
import type { ClinicDb } from '../store'
import { bindOrAssertTenant } from '../tenant'
import { ensureClinicSettings } from '../config/settings'
import {
  connectPixAccount,
  disconnectPixAccount,
  ensurePixAccount,
  getPixAccount,
  revokePixAccountCredential,
  toPixAccountPublic,
} from './account'
import {
  countPixCharges,
  listPixCharges,
  listPixChargesByAccount,
  recordPixCharge,
} from './charges'
import {
  getPixSignalSettings,
  updatePixSignalSettings,
} from './signal-settings'
import type {
  ConnectPixInput,
  PixAccountPublic,
  PixChargeRow,
  PixSignalSettings,
  RecordChargeInput,
  UpdateSignalSettingsInput,
} from './types'
import type { PixEnvironment } from '../constants'

export type PixConnectDeps = {
  /** Segredo para cifrar App ID (ausente → synth:). */
  tokenSecret?: string
  /**
   * Ambiente efectivo (PIX_MODE). synthetic = fixture local sem rede.
   * sandbox/live = Woovi HTTP (requer App ID real; CI usa synthetic).
   */
  environment: PixEnvironment
  /**
   * Fetch injectável (sandbox fixture nos testes).
   * Em synthetic, se omitido, usa fixture in-process efémera só para verify.
   */
  fetchImpl?: typeof fetch
  baseUrl?: string
  webhookPublicKeys?: string[]
}

function prepare(db: ClinicDb, caller: ClinicCaller, clock: Clock) {
  assertClinicSchemaReady(db)
  assertValidCaller(caller)
  const meta = bindOrAssertTenant(db, caller, clock)
  ensureClinicSettings(db, meta.tenantId, clock)
  ensurePixAccount(db, meta.tenantId, clock)
  return meta
}

export function getPixAccountOp(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
): PixAccountPublic {
  const meta = prepare(db, caller, clock)
  const row = getPixAccount(db, meta.tenantId)!
  return toPixAccountPublic(row)
}

export function getPixSignalSettingsOp(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
): PixSignalSettings {
  const meta = prepare(db, caller, clock)
  return getPixSignalSettings(db, meta.tenantId, clock)
}

export function updatePixSignalSettingsOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: UpdateSignalSettingsInput,
  clock: Clock,
): PixSignalSettings {
  const meta = prepare(db, caller, clock)
  return db.transactionSync(() => {
    const settings = updatePixSignalSettings(db, meta.tenantId, input, clock)
    writeOperationalAudit(
      db,
      {
        tenantId: meta.tenantId,
        actor: caller.actorId ?? caller.kind,
        action: 'pix.signal_settings_updated',
        objectType: 'clinic_settings',
        objectId: '1',
        detail: {
          deadlineSeconds: settings.deadlineSeconds,
          policyLength: settings.cancellationPolicy.length,
        },
      },
      clock,
    )
    return settings
  })
}

/**
 * Conecta conta Woovi: valida App ID no provedor (ou fixture), cifra e persiste.
 * Rotação: novo App ID incrementa credential_version.
 */
export async function connectPixAccountOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: ConnectPixInput,
  clock: Clock,
  deps: PixConnectDeps,
): Promise<PixAccountPublic> {
  const meta = prepare(db, caller, clock)
  const appId = input.appId.trim()
  if (!appId || appId.length < 8) {
    throw new ValidationError('invalid_pix_app_id', 'App ID Woovi inválido')
  }
  if (appId.toLowerCase().includes('bearer')) {
    throw new ValidationError(
      'invalid_pix_app_id',
      'Envie só o App ID, sem prefixo Bearer',
    )
  }

  const environment = input.environment ?? deps.environment
  let fetchImpl = deps.fetchImpl
  let baseUrl = deps.baseUrl
  let webhookPublicKeys = deps.webhookPublicKeys

  if (environment === 'synthetic' && !fetchImpl) {
    const fixture = await createWooviSandboxFixture({
      validAppIds: new Set([appId, 'synth_woovi_app_valid']),
    })
    fixture.addValidAppId(appId)
    fetchImpl = fixture.fetchImpl
    baseUrl = fixture.baseUrl
    webhookPublicKeys = [fixture.publicPem]
  }

  // accountId provisório só para o adaptador de verificação
  const provisionalAccountId = `pixacct_pending_${meta.tenantId}`
  const adapter = new WooviPixAdapter({
    appId,
    tenantId: meta.tenantId,
    accountId: provisionalAccountId,
    environment: environment === 'live' ? 'live' : 'sandbox',
    baseUrl,
    fetchImpl,
    webhookPublicKeys,
  })

  const verified = await adapter.verifyCredentials()
  if (!verified.ok) {
    throw new ValidationError(
      verified.code === 'invalid_signature'
        ? 'pix_credentials_rejected'
        : 'pix_provider_unavailable',
      verified.message,
      { code: verified.code },
    )
  }

  const cipher = await sealPixAppId(
    appId,
    deps.tokenSecret,
    environment === 'synthetic' ? 'synthetic' : environment,
  )
  const hint = appIdHint(appId)

  return db.transactionSync(() => {
    const row = connectPixAccount(
      db,
      meta.tenantId,
      {
        appIdCipher: cipher,
        appIdHint: hint,
        clerkUserId: input.clerkUserId,
        environment,
      },
      clock,
    )
    writeOperationalAudit(
      db,
      {
        tenantId: meta.tenantId,
        actor: caller.actorId ?? caller.kind,
        action: 'pix.account_connected',
        objectType: 'pix_account',
        objectId: row.accountId ?? '1',
        detail: {
          environment,
          credentialVersion: row.credentialVersion,
          appIdHint: hint,
        },
      },
      clock,
    )
    return toPixAccountPublic(row)
  })
}

export function disconnectPixAccountOp(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
): { account: PixAccountPublic; chargesPreserved: number } {
  const meta = prepare(db, caller, clock)
  return db.transactionSync(() => {
    const before = getPixAccount(db, meta.tenantId)!
    const chargesPreserved = before.accountId
      ? listPixChargesByAccount(db, meta.tenantId, before.accountId).length
      : countPixCharges(db, meta.tenantId)
    const row = disconnectPixAccount(db, meta.tenantId, clock)
    writeOperationalAudit(
      db,
      {
        tenantId: meta.tenantId,
        actor: caller.actorId ?? caller.kind,
        action: 'pix.account_disconnected',
        objectType: 'pix_account',
        objectId: row.accountId ?? '1',
        detail: { chargesPreserved },
      },
      clock,
    )
    return { account: toPixAccountPublic(row), chargesPreserved }
  })
}

export function revokePixCredentialOp(
  db: ClinicDb,
  caller: ClinicCaller,
  reason: string,
  clock: Clock,
): PixAccountPublic {
  const meta = prepare(db, caller, clock)
  return db.transactionSync(() => {
    const row = revokePixAccountCredential(db, meta.tenantId, reason, clock)
    writeOperationalAudit(
      db,
      {
        tenantId: meta.tenantId,
        actor: caller.actorId ?? caller.kind,
        action: 'pix.credential_revoked',
        objectType: 'pix_account',
        objectId: row.accountId ?? '1',
        detail: { reason: reason.slice(0, 200) },
      },
      clock,
    )
    return toPixAccountPublic(row)
  })
}

export function listPixChargesOp(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
  accountId?: string,
): PixChargeRow[] {
  const meta = prepare(db, caller, clock)
  if (accountId) {
    return listPixChargesByAccount(db, meta.tenantId, accountId)
  }
  return listPixCharges(db, meta.tenantId)
}

/**
 * Grava cobrança no ledger local (usado por testes e, depois, #38).
 * Exige conta connected; não chama o provedor aqui.
 */
export function recordLocalPixChargeOp(
  db: ClinicDb,
  caller: ClinicCaller,
  input: RecordChargeInput,
  clock: Clock,
): PixChargeRow {
  const meta = prepare(db, caller, clock)
  const account = getPixAccount(db, meta.tenantId)!
  if (account.status !== 'connected' || !account.accountId) {
    throw new ValidationError(
      'pix_account_not_connected',
      'Sem conta Pix conectada não é possível criar cobrança',
    )
  }
  if (input.accountId !== account.accountId) {
    throw new ValidationError(
      'account_mismatch',
      'accountId não corresponde à conta conectada',
    )
  }
  return db.transactionSync(() => {
    return recordPixCharge(db, meta.tenantId, input, clock)
  })
}

/**
 * Abre App ID cifrado da clínica — só backend. Retorna null se desconectada.
 */
export async function openClinicPixAppId(
  db: ClinicDb,
  tenantId: string,
  tokenSecret: string | undefined,
): Promise<{ appId: string; accountId: string; environment: PixEnvironment } | null> {
  const row = getPixAccount(db, tenantId)
  if (!row || row.status !== 'connected' || !row.appIdCipher || !row.accountId) {
    return null
  }
  const appId = await openPixAppId(row.appIdCipher, tokenSecret)
  return { appId, accountId: row.accountId, environment: row.environment }
}
