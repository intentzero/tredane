import type { Clock } from '../db/clock'
import {
  clinicPix,
  type ClinicCaller,
  type ClinicDb,
} from '../clinic'
import type {
  ConnectPixInput,
  PixAccountPublic,
  PixChargeRow,
  PixConnectDeps,
  PixSignalSettings,
  RecordChargeInput,
  UpdateSignalSettingsInput,
} from '../clinic/pix'

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
  /** Testes / preparação #38 — grava ledger sem enviar WhatsApp. */
  recordCharge?(
    caller: ClinicCaller,
    input: RecordChargeInput,
  ): Promise<PixChargeRow>
}

export function createMemoryPixAccountGateway(
  db: ClinicDb,
  clock: Clock,
): PixAccountGateway {
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
  }
}
