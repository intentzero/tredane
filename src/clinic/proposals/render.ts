/**
 * Corpo e botões determinísticos da proposta (S4 / #175 / DEC-061 / H8).
 * Texto autorizado e campos factuais vêm só do snapshot persistido — nunca do LLM.
 * DEC-090: sem sala nem intervalo/buffer ao cliente.
 * DEC-174: Agendado curto — serviço · variante, weekday DD/MM, só hora de início.
 * DEC-211 opção B: localização no Agendado via `cta_url` «Abrir mapa» (sem URL cru no corpo).
 */
import type { Clock } from '../../db/clock'
import type { ClinicDb } from '../store'
import { readComboSnapshot } from '../config/combos'
import { readZoneSnapshots, zoneLabel } from '../config/zones'
import type { ComboSnapshot, ZoneSnapshot } from '../config/types'
import { formatBookedWhenAt } from '../scheduling/format-booked-when'
import { HUMAN_HANDOFF_BUTTON_TITLE } from '../ai/human-handoff'
import type { AppointmentProposalRow } from './types'
import { PROPOSAL_BODY_MAX, PROPOSAL_BUTTON_TITLE_MAX } from './interactive-limits'

export { formatBookedWhenAt } from '../scheduling/format-booked-when'
export { PROPOSAL_BODY_MAX, PROPOSAL_BUTTON_TITLE_MAX } from './interactive-limits'

export const PROPOSAL_BUTTON_TITLES = {
  confirm: 'Confirmar',
  alter: 'Alterar detalhes',
  human: HUMAN_HANDOFF_BUTTON_TITLE,
} as const

export type ProposalButtonAction = 'confirm' | 'alter' | 'human'

export type ProposalInteractiveButton = {
  id: string
  title: string
  action: ProposalButtonAction
}

export type ProposalInteractivePayload = {
  body: string
  /** 2 botões fora do expediente (sem «Falar com a equipe», DEC-155); 3 dentro. */
  buttons: ProposalInteractiveButton[]
  proposalId: string
  version: number
}

/** Id opaco do botão — versão amarrada para S5 rejeitar propostas substituídas. */
export function proposalButtonId(
  proposalId: string,
  version: number,
  action: ProposalButtonAction,
): string {
  return `prop:${proposalId}:v${version}:${action}`
}

export function parseProposalButtonId(
  raw: string,
): { proposalId: string; version: number; action: ProposalButtonAction } | null {
  const m = /^prop:([^:]+):v(\d+):(confirm|alter|human)$/.exec(raw.trim())
  if (!m) return null
  const version = Number(m[2])
  if (!Number.isInteger(version) || version < 1) return null
  return {
    proposalId: m[1]!,
    version,
    action: m[3] as ProposalButtonAction,
  }
}

export function proposalSendClientRequestId(proposalId: string, version: number): string {
  return `proposal.send:${proposalId}:v${version}`
}

export function proposalResultClientRequestId(
  proposalId: string,
  version: number,
  resultKind: string,
): string {
  return `proposal.result:${proposalId}:v${version}:${resultKind}`
}

function formatBrl(cents: number): string {
  const reais = Math.trunc(cents / 100)
  const rest = Math.abs(cents % 100)
    .toString()
    .padStart(2, '0')
  return `R$ ${reais},${rest}`
}

/**
 * Intervalo no relógio local da clínica (IANA só calcula; nunca aparece no texto).
 * Preferência de produto: ofertas e propostas sem rótulo IANA.
 * A mensagem Agendado usa {@link formatBookedWhen} (DEC-174).
 */
function formatSlotRange(proposal: AppointmentProposalRow): string {
  try {
    const start = new Intl.DateTimeFormat('pt-BR', {
      timeZone: proposal.timezone,
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(proposal.startsAt))
    const end = new Intl.DateTimeFormat('pt-BR', {
      timeZone: proposal.timezone,
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(proposal.endsAt))
    return `${start} – ${end}`
  } catch {
    return `${new Date(proposal.startsAt).toISOString()} – ${new Date(proposal.endsAt).toISOString()}`
  }
}

/** Quando curto para Agendado WhatsApp (DEC-174) — delega a {@link formatBookedWhenAt}. */
export function formatBookedWhen(proposal: AppointmentProposalRow): string {
  return formatBookedWhenAt(proposal.timezone, proposal.startsAt)
}

/** Fallback curto só quando o follow-up «Posso ajudar…» não segue (DEC-174). */
export const BOOKED_DOUBT_FALLBACK = 'Qualquer dúvida, responda.'

function formatSignal(proposal: AppointmentProposalRow): string | null {
  if (!proposal.requiresSignal) return null
  const parts: string[] = ['Sinal Pix necessário']
  if (proposal.signalKind === 'fixed' && proposal.signalFixedCents != null) {
    parts.push(formatBrl(proposal.signalFixedCents))
  } else if (proposal.signalKind === 'percent' && proposal.signalPercent != null) {
    parts.push(`${proposal.signalPercent}%`)
  }
  if (proposal.signalConditionsText.trim()) {
    parts.push(proposal.signalConditionsText.trim())
  }
  return parts.join(' · ')
}

/**
 * Validade da proposta no relógio da clínica (#511 / DEC-061).
 * `validUntilMs` = instante de expiração; sem rótulo IANA.
 */
export function proposalValidityLine(timezone: string, validUntilMs: number): string {
  try {
    const hhmm = new Intl.DateTimeFormat('pt-BR', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(validUntilMs))
    const match = hhmm.match(/(\d{1,2})\D(\d{2})/)
    const time = match
      ? `${match[1]!.padStart(2, '0')}:${match[2]}`
      : hhmm
    return `Válida até ${time}.`
  } catch {
    return 'Válida por 30 minutos após o envio.'
  }
}

/**
 * Monta o texto e os botões a partir da proposta persistida.
 * Qualquer mudança material exige nova versão (S3); este render só lê o snapshot.
 * `validUntilMs` (#511): se omitido, usa o `expiresAt` da proposta ou a frase relativa.
 * Item 6: proposta inclui sempre «Falar com a equipe» (3.º botão).
 */
export function renderProposalInteractive(
  proposal: AppointmentProposalRow,
  db?: ClinicDb,
  opts?: { validUntilMs?: number | null; clock?: Clock },
): ProposalInteractivePayload {
  void opts
  const zones = db ? readZoneSnapshots(db, proposal.tenantId, 'proposal', proposal.id) : []
  const combo = db ? readComboSnapshot(db, proposal.tenantId, 'proposal', proposal.id) : null
  const includeHuman = true
  const serviceLabel = zoneLabel(proposal.serviceName, zones)
  const when = formatBookedWhen(proposal)
  const parts = [serviceLabel, when]
  if (proposal.professionalName) {
    parts.push(`com ${proposal.professionalName}`)
  }
  if (proposal.priceCents != null) {
    if (proposal.priceCents === 0) {
      parts.push('gratuita')
    } else if (combo) {
      parts.push(
        `${formatBrl(proposal.priceCents)} (combo ${combo.name}, economia de ${formatBrl(
          combo.listPriceCents - combo.priceCents,
        )})`,
      )
    } else {
      parts.push(formatBrl(proposal.priceCents))
    }
  }
  const summary = parts.join(' · ')
  // Sem «Local: <url>» no corpo: Meta não mistura cta_url com reply buttons;
  // o mapa sai no Agendado (cta_url «Abrir mapa», DEC-211 opção B).
  const lines: string[] = [`Fica assim: ${summary}.`, '', 'Posso confirmar?']
  const signal = formatSignal(proposal)
  if (signal) lines.push(signal)
  lines.push(
    includeHuman
      ? 'É só tocar em Confirmar, em Alterar detalhes se quiser mudar algo, ou em Falar com a equipe.'
      : 'É só tocar em Confirmar ou em Alterar detalhes se quiser mudar algo.',
  )

  let body = lines.join('\n')
  if (body.length > PROPOSAL_BODY_MAX) {
    body = `${body.slice(0, PROPOSAL_BODY_MAX - 1)}…`
  }

  const confirmTitle = PROPOSAL_BUTTON_TITLES.confirm
  const alterTitle = PROPOSAL_BUTTON_TITLES.alter
  const humanTitle = PROPOSAL_BUTTON_TITLES.human
  if (
    confirmTitle.length > PROPOSAL_BUTTON_TITLE_MAX ||
    alterTitle.length > PROPOSAL_BUTTON_TITLE_MAX ||
    humanTitle.length > PROPOSAL_BUTTON_TITLE_MAX
  ) {
    throw new Error('proposal_button_title_too_long')
  }

  const buttons: ProposalInteractiveButton[] = [
    {
      id: proposalButtonId(proposal.id, proposal.version, 'confirm'),
      title: confirmTitle,
      action: 'confirm',
    },
    {
      id: proposalButtonId(proposal.id, proposal.version, 'alter'),
      title: alterTitle,
      action: 'alter',
    },
  ]
  if (includeHuman) {
    buttons.push({
      id: proposalButtonId(proposal.id, proposal.version, 'human'),
      title: humanTitle,
      action: 'human',
    })
  }

  return {
    body,
    buttons,
    proposalId: proposal.id,
    version: proposal.version,
  }
}

export type ProposalResultBodyOpts = {
  /** DEC-197: marcação feita na página — acrescenta o recibo «Não foi você?». */
  webReceipt?: boolean
  /**
   * Lista de horários livres do mesmo pedido (#511).
   * Ex.: «sexta 06/11 às 14:00, 16:00». Sem IANA.
   */
  alternativesListing?: string | null
  /**
   * Variantes/zonas do snapshot da proposta (DEC-174).
   * Com variantes: `Massagem · relaxante` (mesma voz do catálogo / zoneLabel).
   */
  zones?: readonly Pick<
    ZoneSnapshot,
    'name' | 'audience' | 'durationMinutes' | 'priceCents'
  >[]
  /**
   * DEC-174: omitir o rodapé de dúvida quando o follow-up «Posso ajudar em algo mais?»
   * (DEC-086) segue a seguir. `true` por defeito no caminho booked (follow-up é o normal).
   * Passar `false` só quando o follow-up não é enviado.
   */
  omitDoubtFallback?: boolean
  /** Horário civil do compromisso substituído (remarcação DEC-091 / lab S23). */
  replacedStartsAt?: number | null
  combo?: ComboSnapshot | null
}

function formatBookedPriceSuffix(
  proposal: AppointmentProposalRow,
  zones: readonly Pick<ZoneSnapshot, 'name' | 'priceCents'>[],
  combo: ComboSnapshot | null | undefined,
): string {
  const pricedZones = zones.filter((z) => z.priceCents != null)
  const chunks: string[] = []
  if (pricedZones.length > 0) {
    chunks.push(
      `Valores: ${pricedZones.map((z) => `${z.name} ${formatBrl(z.priceCents!)}`).join('; ')}`,
    )
  }
  if (proposal.priceCents != null) {
    if (proposal.priceCents === 0) {
      chunks.push('Gratuito')
    } else if (combo) {
      chunks.push(
        `Total: ${formatBrl(proposal.priceCents)} (combo ${combo.name}, economia de ${formatBrl(
          combo.listPriceCents - combo.priceCents,
        )})`,
      )
    } else {
      chunks.push(`Total: ${formatBrl(proposal.priceCents)}`)
    }
  }
  if (chunks.length === 0) return ''
  return ` ${chunks.join('. ')}.`
}

/** Textos fixos de resultado — só após commit / decisão (DEC-061). */
/** DEC-197: recibo da marcação feita na página; deixa a cliente avisar a equipe se não foi ela. */
export const WEB_RECEIPT_SENTENCE = 'Marcado pela página. Não foi você? Fale com a equipe.'

/**
 * Link https da localização gravado na proposta (DEC-211).
 * Usado como `cta_url` «Abrir mapa» no Agendado — nunca colado no corpo.
 * Propostas antigas com morada em texto devolvem null (sem CTA).
 */
export function proposalBookedMapUrl(proposal: AppointmentProposalRow): string | null {
  const location = proposal.clinicLocationText.trim()
  if (!location || !/^https:\/\//i.test(location)) return null
  try {
    const url = new URL(location)
    if (url.protocol !== 'https:' || location.length > 2000) return null
  } catch {
    return null
  }
  return location
}

export function renderProposalResultBody(
  proposal: AppointmentProposalRow,
  kind: 'booked' | 'slot_refused' | 'pix_signal' | 'expired',
  opts: ProposalResultBodyOpts = {},
): string {
  const when = formatSlotRange(proposal)
  switch (kind) {
    case 'booked': {
      const service = zoneLabel(proposal.serviceName, opts.zones ?? [])
      const bookedWhen = formatBookedWhen(proposal)
      const omitDoubt = opts.omitDoubtFallback !== false
      const rescheduled =
        proposal.replacesAppointmentId != null &&
        opts.replacedStartsAt != null &&
        Number.isFinite(opts.replacedStartsAt)
      const head = rescheduled
        ? `Remarcado: de ${formatBookedWhenAt(proposal.timezone, opts.replacedStartsAt!)} para ${bookedWhen}`
        : `Agendado: ${service} · ${bookedWhen}`
      const priceLine = formatBookedPriceSuffix(proposal, opts.zones ?? [], opts.combo)
      // Sem «Local: <url>» — o mapa vai no botão CTA «Abrir mapa» (DEC-211 opção B).
      return (
        head +
        (!rescheduled && proposal.professionalName ? ` com ${proposal.professionalName}` : '') +
        `.` +
        priceLine +
        (opts.webReceipt ? ` ${WEB_RECEIPT_SENTENCE}` : '') +
        (omitDoubt ? '' : ` ${BOOKED_DOUBT_FALLBACK}`)
      )
    }
    case 'slot_refused':
      // DEC-202: o chat não oferece alternativas nem pergunta «Qual fica melhor?».
      // Canal web: o executor suprime esta mensagem (a página já mostra o erro).
      // `alternativesListing` ignorado (legado #511).
      return (
        `Esse horário já não está livre para ${proposal.serviceName} em ${when}. ` +
        `Para escolher outro, toque em «Abrir agenda».`
      )
    case 'pix_signal':
      return (
        `Para garantir ${proposal.serviceName} em ${when}, é preciso sinal Pix. ` +
        `Nada fica reservado antes do pagamento. A equipe envia o pedido de sinal.`
      )
    case 'expired':
      // DEC-202: sem lista de horas no chat; a cliente escolhe na página.
      return (
        `Essa proposta de ${proposal.serviceName} em ${when} já não está válida. ` +
        `Para escolher outro horário, toque em «Abrir agenda».`
      )
  }
}
