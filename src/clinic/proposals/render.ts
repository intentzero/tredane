/**
 * Corpo e botões determinísticos da proposta (S4 / #175 / DEC-061 / H8).
 * Texto autorizado e campos factuais vêm só do snapshot persistido — nunca do LLM.
 * DEC-090: sem sala nem intervalo/buffer ao cliente; localização só se a clínica tiver morada.
 * DEC-174: Agendado curto — serviço · variante, weekday DD/MM, só hora de início.
 */
import type { Clock } from '../../db/clock'
import type { ClinicDb } from '../store'
import { readComboSnapshot } from '../config/combos'
import { readZoneSnapshots, zoneLabel } from '../config/zones'
import type { ZoneSnapshot } from '../config/types'
import { dayTextPt } from '../ai/slot-offer'
import { formatClinicTime } from '../ai/schedule-context'
import { clinicCivilDateFromUtc } from '../scheduling/timezone'
import {
  HUMAN_HANDOFF_BUTTON_TITLE,
  isHumanTeamOfferAllowed,
} from '../ai/human-handoff'
import type { AppointmentProposalRow } from './types'

/** Limite Cloud API para título de botão reply. */
export const PROPOSAL_BUTTON_TITLE_MAX = 20

/** Limite Cloud API para corpo de mensagem interactive. */
export const PROPOSAL_BODY_MAX = 1024

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

/**
 * Quando curto para Agendado (DEC-174): `terça 17/11 às 10:00`.
 * Sem ano, sem hora de fim, sem «em …-feira», sem IANA — mesma forma que a lista Horários.
 */
export function formatBookedWhen(proposal: AppointmentProposalRow): string {
  try {
    const civil = clinicCivilDateFromUtc(proposal.timezone, proposal.startsAt)
    const hhmm = formatClinicTime(proposal.timezone, proposal.startsAt)
    const match = hhmm.match(/(\d{1,2})\D(\d{2})/)
    const time = match
      ? `${match[1]!.padStart(2, '0')}:${match[2]}`
      : hhmm
    return `${dayTextPt(civil)} às ${time}`
  } catch {
    return new Date(proposal.startsAt).toISOString()
  }
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
 * DEC-155: fora do expediente omite o botão «Falar com a equipe».
 */
export function renderProposalInteractive(
  proposal: AppointmentProposalRow,
  db?: ClinicDb,
  opts?: { validUntilMs?: number | null; clock?: Clock },
): ProposalInteractivePayload {
  const zones = db ? readZoneSnapshots(db, proposal.tenantId, 'proposal', proposal.id) : []
  const combo = db ? readComboSnapshot(db, proposal.tenantId, 'proposal', proposal.id) : null
  const location = proposal.clinicLocationText.trim()
  const includeHuman =
    db != null && opts?.clock != null
      ? isHumanTeamOfferAllowed(db, proposal.tenantId, opts.clock)
      : true
  const lines: string[] = ['Proposta de horário', '']
  if (location) lines.push(`Local: ${location}`)
  // DEC-100: o cartão não imprime «beneficiária». O facto interno (titular/terceiro) continua na proposta.
  lines.push(
    `Serviço: ${zoneLabel(proposal.serviceName, zones)}`,
    `Quando: ${formatSlotRange(proposal)}`,
    `Duração: ${proposal.durationMinutes} min`,
  )
  if (proposal.professionalName) {
    lines.push(`Profissional: ${proposal.professionalName}`)
  }
  // DEC-090: sala e intervalo/buffer são internos — nunca entram no WhatsApp ao cliente.
  if (proposal.priceCents != null) {
    lines.push(
      combo
        ? `Preço: ${formatBrl(proposal.priceCents)} (combo ${combo.name}, economia de ${formatBrl(
            combo.listPriceCents - combo.priceCents,
          )})`
        : `Preço: ${formatBrl(proposal.priceCents)}`,
    )
  }
  const signal = formatSignal(proposal)
  if (signal) lines.push(signal)
  lines.push('')
  const validUntil =
    opts?.validUntilMs ??
    proposal.expiresAt ??
    null
  lines.push(
    validUntil != null
      ? proposalValidityLine(proposal.timezone, validUntil)
      : 'Válida por 30 minutos após o envio.',
  )
  lines.push(
    includeHuman
      ? 'Toque em Confirmar para seguir, em Alterar detalhes para mudar horário, serviço ou detalhes, ou em Falar com a equipe.'
      : 'Toque em Confirmar para seguir ou em Alterar detalhes para mudar horário, serviço ou detalhes.',
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

/** Frase do WhatsApp quando o tempo não serve (DEC-077). A equipe usa outro aviso. */
export const TEMPO_REFUSED_PHRASE =
  'Nesse horário o tempo não serve para este serviço. A equipe envia outra opção em breve.'

/** Frase do WhatsApp quando a previsão não se confirmou (DEC-077). */
export const TEMPO_UNCONFIRMED_PHRASE =
  'Não deu para confirmar o tempo nesse horário. A equipe envia outra opção em breve.'

export type ProposalResultBodyOpts = {
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
}

/** Textos fixos de resultado — só após commit / decisão (DEC-061). */
export function renderProposalResultBody(
  proposal: AppointmentProposalRow,
  kind: 'booked' | 'slot_refused' | 'pix_signal' | 'expired' | 'tempo_refused' | 'tempo_unconfirmed',
  opts: ProposalResultBodyOpts = {},
): string {
  const when = formatSlotRange(proposal)
  const lista = opts.alternativesListing?.trim() || ''
  switch (kind) {
    case 'booked': {
      const location = proposal.clinicLocationText.trim()
      const service = zoneLabel(proposal.serviceName, opts.zones ?? [])
      const bookedWhen = formatBookedWhen(proposal)
      const omitDoubt = opts.omitDoubtFallback !== false
      return (
        `Agendado: ${service} · ${bookedWhen}` +
        (proposal.professionalName ? ` com ${proposal.professionalName}` : '') +
        `.` +
        (location ? ` Local: ${location}.` : '') +
        (omitDoubt ? '' : ` ${BOOKED_DOUBT_FALLBACK}`)
      )
    }
    case 'slot_refused':
      // #511: sem «equipe envia»; com alternativas do mesmo pedido quando houver.
      if (lista) {
        return (
          `Horário já não está livre para ${proposal.serviceName} em ${when}. ` +
          `Tenho ${lista}. Qual fica melhor?`
        )
      }
      return (
        `Horário já não está livre para ${proposal.serviceName} em ${when}. ` +
        `Quer que eu veja outro horário?`
      )
    case 'pix_signal':
      return (
        `Para garantir ${proposal.serviceName} em ${when}, é preciso sinal Pix. ` +
        `Nada fica reservado antes do pagamento. A equipe envia o pedido de sinal.`
      )
    case 'expired':
      // #511 / CF-33 / A-18: explica validade e oferece horários novos (DEC-061: não marca).
      if (lista) {
        return (
          `Essa proposta já não está válida. ` +
          `Para ${proposal.serviceName}, tenho ${lista}. Qual fica melhor?`
        )
      }
      return (
        `Essa proposta de ${proposal.serviceName} em ${when} já não está válida. ` +
        `Quer que eu veja outros horários?`
      )
    case 'tempo_refused':
      return TEMPO_REFUSED_PHRASE
    case 'tempo_unconfirmed':
      return TEMPO_UNCONFIRMED_PHRASE
  }
}
