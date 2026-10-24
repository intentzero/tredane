import type { Clock } from '../db/clock'
import {
  clinicPipeline,
  type ClinicCaller,
  type ClinicDb,
  workerCaller,
} from '../clinic'
import type {
  LinkAppointmentInput,
  ListOpportunitiesInput,
  MoveStageInput,
  OpportunityDetail,
  OpportunityListItem,
  ReopenOpportunityInput,
  StageCount,
} from '../clinic/pipeline'

export type PipelineGateway = {
  list(
    caller: ClinicCaller,
    input: ListOpportunitiesInput,
  ): Promise<{ items: OpportunityListItem[]; counts: StageCount[] }>
  get(caller: ClinicCaller, opportunityId: string): Promise<OpportunityDetail>
  move(
    caller: ClinicCaller,
    input: MoveStageInput,
  ): Promise<OpportunityDetail>
  linkAppointment(
    caller: ClinicCaller,
    input: LinkAppointmentInput,
  ): Promise<OpportunityDetail>
  reopen(
    caller: ClinicCaller,
    input: ReopenOpportunityInput,
  ): Promise<OpportunityDetail>
  seedDemo(
    caller: ClinicCaller,
    opts?: { force?: boolean },
  ): Promise<{
    seeded: boolean
    opportunityCount: number
    val02Fixtures: {
      openPerConversation: 'at_most_one'
      reopenCreatesNewCycle: true
      concluidoClosesCycle: true
      hypothesis: 'VAL-02'
    }
  }>
}

export function createMemoryPipelineGateway(
  db: ClinicDb,
  clock: Clock,
): PipelineGateway {
  return {
    async list(caller, input) {
      return clinicPipeline.listOpportunitiesOp(db, caller, input, clock)
    },
    async get(caller, opportunityId) {
      return clinicPipeline.getOpportunityOp(db, caller, opportunityId, clock)
    },
    async move(caller, input) {
      return clinicPipeline.moveOpportunityStageOp(db, caller, input, clock).value
    },
    async linkAppointment(caller, input) {
      return clinicPipeline.linkAppointmentOp(db, caller, input, clock).value
    },
    async reopen(caller, input) {
      return clinicPipeline.reopenOpportunityCycleOp(db, caller, input, clock).value
    },
    async seedDemo(caller, opts) {
      return clinicPipeline.seedSyntheticPipelineOp(db, caller, clock, opts)
    },
  }
}

export function createMemoryPipelineRegistry(
  getDb: (tenantId: string) => { db: ClinicDb; clock: Clock },
): (tenantId: string) => PipelineGateway {
  const cache = new Map<string, PipelineGateway>()
  return (tenantId: string) => {
    let gw = cache.get(tenantId)
    if (!gw) {
      const { db, clock } = getDb(tenantId)
      // Garante schema pronto no tenant sintético.
      clinicPipeline.listOpportunitiesOp(db, workerCaller(tenantId), {}, clock)
      gw = createMemoryPipelineGateway(db, clock)
      cache.set(tenantId, gw)
    }
    return gw
  }
}
