export type {
  LinkAppointmentInput,
  LinkedAppointmentSummary,
  ListOpportunitiesInput,
  MoveStageInput,
  OpportunityDetail,
  OpportunityListItem,
  OpportunityRow,
  ReopenOpportunityInput,
  StageCount,
  StageHistoryRow,
} from './types'

export {
  ensureOpenOpportunity,
  getOpportunityOp,
  linkAppointmentOp,
  listOpportunitiesOp,
  moveOpportunityStageOp,
  reopenOpportunityCycleOp,
  type PipelineMutationResult,
} from './operations'

export { seedSyntheticPipelineOp } from './seed'

export {
  countByStage,
  findOpenOpportunityForConversation,
  getOpportunity,
  getOpportunityDetail,
  isOpportunityStage,
  isTerminalStage,
  listOpportunities,
  listStageHistory,
  requireOpportunity,
} from './opportunities'

export {
  boardKeyFor,
  countFutureConfirmedAppointmentsForContact,
  hasOpenAttendance,
  openAttendanceBoardStage,
  shouldProjectOpenAttendance,
  toOpenAttendanceCard,
  type BoardCardKind,
} from './board-cards'
