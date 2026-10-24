import type { Clock } from '../db/clock'
import {
  clinicPix,
  type ClinicCaller,
  type ClinicDb,
} from '../clinic'
import type {
  ConfirmWithoutSignalInput,
  ConfirmWithoutSignalResult,
  ConnectPixInput,
  CreateSignalChargeInput,
  PixAccountPublic,
  PixChargeRow,
  PixConnectDeps,
  PixSignalSettings,
  RecordChargeInput,
  SchedulingIntentRow,
  SignalChargeResult,
  UpdateSignalSettingsInput,
} from '../clinic/pix'
import type { PixProviderAdapter } from '../pix'
import { SimulatedPixAdapter } from '../pix'

export type PixChargeCreateDeps = PixConnectDeps & {
  /** Injectável em testes (Simulated / fixture). */
  simulatedAdapter?: PixProviderAdapter
}

export type PixAccountGateway = {
  getAccount(caller: ClinicCaller): Promise<PixAccountPublic>
  connect(
    caller: ClinicCaller,
    input: ConnectPixInput,
    deps: PixConnectDeps,
  ): Promise<PixAccountPublic>
  disconnect(
    caller: ClinicCaller,
  ): Promise<{ account: PixAccountPublic; chargesPreserved: number }>
  revoke(
    caller: ClinicCaller,
    reason: string,
  ): Promise<PixAccountPublic>
  getSignalSettings(caller: ClinicCaller): Promise<PixSignalSettings>
  updateSignalSettings(
    caller: ClinicCaller,
    input: UpdateSignalSettingsInput,
  ): Promise<PixSignalSettings>
  listCharges(caller: ClinicCaller, accountId?: string): Promise<PixChargeRow[]>
  /** Testes / ledger sem WhatsApp. */
  recordCharge?(
    caller: ClinicCaller,
    input: RecordChargeInput,
  ): Promise<PixChargeRow>
  createSignalCharge?(
    caller: ClinicCaller,
    input: CreateSignalChargeInput,
    deps: PixChargeCreateDeps,
  ): Promise<SignalChargeResult>
  reconcileCharge?(
    caller: ClinicCaller,
    chargeId: string,
    deps: PixChargeCreateDeps,
  ): Promise<SignalChargeResult>
  confirmWithoutSignal?(
    caller: ClinicCaller,
    input: ConfirmWithoutSignalInput,
    deps?: PixChargeCreateDeps,
  ): Promise<ConfirmWithoutSignalResult>
  getChargeDetail?(
    caller: ClinicCaller,
    chargeId: string,
  ): Promise<{ charge: PixChargeRow; intent: SchedulingIntentRow | null }>
  listConversationCharges?(
    caller: ClinicCaller,
    conversationId: string,
  ): Promise<PixChargeRow[]>
}

export function createMemoryPixAccountGateway(
  db: ClinicDb,
  clock: Clock,
  options?: { simulatedAdapter?: SimulatedPixAdapter },
): PixAccountGateway {
  const defaultAdapter = options?.simulatedAdapter ?? new SimulatedPixAdapter()
  return {
    async getAccount(caller) {
      return clinicPix.getPixAccountOp(db, caller, clock)
    },
    async connect(caller, input, deps) {
      return clinicPix.connectPixAccountOp(db, caller, input, clock, deps)
    },
    async disconnect(caller) {
      return clinicPix.disconnectPixAccountOp(db, caller, clock)
    },
    async revoke(caller, reason) {
      return clinicPix.revokePixCredentialOp(db, caller, reason, clock)
    },
    async getSignalSettings(caller) {
      return clinicPix.getPixSignalSettingsOp(db, caller, clock)
    },
    async updateSignalSettings(caller, input) {
      return clinicPix.updatePixSignalSettingsOp(db, caller, input, clock)
    },
    async listCharges(caller, accountId) {
      return clinicPix.listPixChargesOp(db, caller, clock, accountId)
    },
    async recordCharge(caller, input) {
      return clinicPix.recordLocalPixChargeOp(db, caller, input, clock)
    },
    async createSignalCharge(caller, input, deps) {
      const adapter = deps.simulatedAdapter ?? defaultAdapter
      return clinicPix.createSignalChargeAndSendOp(db, caller, input, clock, {
        adapter,
      })
    },
    async reconcileCharge(caller, chargeId, deps) {
      const adapter = (deps.simulatedAdapter ?? defaultAdapter) as SimulatedPixAdapter
      return clinicPix.reconcileUncertainChargeOp(db, caller, chargeId, clock, {
        adapter,
        findByIdempotencyKey: (key) => adapter.findChargeByIdempotencyKey(key),
      })
    },
    async confirmWithoutSignal(caller, input, deps) {
      const adapter = deps?.simulatedAdapter ?? defaultAdapter
      return clinicPix.confirmWithoutSignalOp(db, caller, input, clock, {
        adapter,
      })
    },
    async getChargeDetail(caller, chargeId) {
      return clinicPix.getPixChargeDetailOp(db, caller, chargeId, clock)
    },
    async listConversationCharges(caller, conversationId) {
      return clinicPix.listConversationPixChargesOp(
        db,
        caller,
        conversationId,
        clock,
      )
    },
  }
}
