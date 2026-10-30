import type {
  AbuseLimitsView,
  AppointmentRow,
  ConfigReadiness,
  ConfigSnapshot,
  CreateBlockResult,
  ResourceBlockRow,
  ResourceRow,
  ServiceRow,
  WeeklyWindowRow,
  ClinicSettingsRow,
} from '../clinic/config'

export function serializeSettings(row: ClinicSettingsRow) {
  return {
    tenantId: row.tenantId,
    timezone: row.timezone,
    signalDeadlineSeconds: row.signalDeadlineSeconds,
    signalCancellationPolicy: row.signalCancellationPolicy,
    aiAssistEnabled: row.aiAssistEnabled,
    clinicAddress: row.clinicAddress,
    googleBusinessUrl: row.googleBusinessUrl,
    reschedulePolicy: row.reschedulePolicy,
    forecastMode: row.forecastMode,
    forecastCity: row.forecastCity,
    forecastLatitude: row.forecastLatitude,
    forecastLongitude: row.forecastLongitude,
    updatedAt: row.updatedAt,
  }
}

export function serializeAbuseLimits(view: AbuseLimitsView) {
  return {
    enabled: view.enabled,
    autoBookPaused: view.autoBookPaused,
    limits: view.limits,
    defaults: view.defaults,
    caps: view.caps,
    platformCeilings: view.platformCeilings,
    effective: {
      enabled: view.effective.enabled,
      windowHours: Math.round(view.effective.windowMs / (60 * 60 * 1000)),
      autoDraftsPerContact: view.effective.autoDraftsPerContact,
      aiBookingsPerContact: view.effective.aiBookingsPerContact,
      aiBookingsPerClinic: view.effective.aiBookingsPerClinic,
      futureAppointmentsPerContact: view.effective.futureAppointmentsPerContact,
      pendingPixPerContact: view.effective.pendingPixPerContact,
      pendingProposalsPerContact: view.effective.pendingProposalsPerContact,
      proposalsPerContact: view.effective.proposalsPerContact,
      proposalsPerClinic: view.effective.proposalsPerClinic,
    },
    updatedAt: view.updatedAt,
  }
}

export function serializeService(row: ServiceRow) {
  return {
    id: row.id,
    name: row.name,
    durationMinutes: row.durationMinutes,
    bufferMinutes: row.bufferMinutes,
    audiencia: row.audiencia,
    tempoCeu: row.tempoCeu,
    tempoTemperatura: row.tempoTemperatura,
    tempoCelsius: row.tempoCelsius,
    occupiedMinutes: row.durationMinutes + row.bufferMinutes,
    priceCents: row.priceCents,
    clientExplanation: row.clientExplanation,
    active: row.active,
    requiresSignal: row.requiresSignal,
    signalKind: row.signalKind,
    signalFixedCents: row.signalFixedCents,
    signalPercent: row.signalPercent,
    durationAdjustable: row.durationAdjustable,
    durationMinMinutes: row.durationMinMinutes,
    durationMaxMinutes: row.durationMaxMinutes,
    professionalIds: row.professionalIds,
    roomRequirement: row.roomRequirement,
    weeklyWindows: row.weeklyWindows,
    deletable: row.deletable,
    variantKind: row.variantKind,
    variantKindPlural: row.variantKindPlural,
    zones: row.zones.map((z) => ({
      id: z.id,
      name: z.name,
      durationMinutes: z.durationMinutes,
      priceCents: z.priceCents,
      audience: z.audience,
      active: z.active,
      sortOrder: z.sortOrder,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function serializeResource(
  row: ResourceRow & {
    servicesWithoutResource?: string[]
    overCapacity?: Array<{ startsAt: number; endsAt: number; count: number }>
  },
) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    category: row.category,
    active: row.active,
    capacity: row.capacity,
    sharedSpaceNotice: row.sharedSpaceNotice,
    hoursMode: row.hoursMode,
    homeRoomId: row.homeRoomId,
    attendanceMode: row.attendanceMode,
    sameSexInSlot: row.sameSexInSlot,
    overCapacity: row.overCapacity,
    futureAppointmentCount: row.futureAppointmentCount,
    hasAppointmentHistory: row.hasAppointmentHistory,
    servicesWithoutResource: row.servicesWithoutResource,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function serializeWindow(row: WeeklyWindowRow) {
  return {
    id: row.id,
    resourceId: row.resourceId,
    dayOfWeek: row.dayOfWeek,
    startMinute: row.startMinute,
    endMinute: row.endMinute,
  }
}

export function serializeBlock(row: ResourceBlockRow) {
  return {
    id: row.id,
    resourceId: row.resourceId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    reason: row.reason,
    note: row.note,
    createdAt: row.createdAt,
  }
}

export function serializeAppointment(row: AppointmentRow) {
  return {
    id: row.id,
    serviceId: row.serviceId,
    professionalId: row.professionalId,
    roomResourceId: row.roomResourceId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    status: row.status,
    contactLabel: row.contactLabel,
  }
}

export function serializeReadiness(row: ConfigReadiness) {
  return {
    agendaConfigured: row.agendaConfigured,
    readyToServe: row.readyToServe,
    schedulingAllowed: row.schedulingAllowed,
    missing: row.missing,
    timezone: row.timezone,
    counts: row.counts,
  }
}

export function serializeSnapshot(snap: ConfigSnapshot) {
  return {
    settings: serializeSettings(snap.settings),
    services: snap.services.map(serializeService),
    resources: snap.resources.map(serializeResource),
    weeklyWindows: snap.weeklyWindows.map(serializeWindow),
    blocks: snap.blocks.map(serializeBlock),
    readiness: serializeReadiness(snap.readiness),
  }
}

export function serializeBlockResult(result: CreateBlockResult) {
  return {
    created: result.created,
    block: result.block ? serializeBlock(result.block) : null,
    affectedAppointments: result.affectedAppointments.map(serializeAppointment),
  }
}
