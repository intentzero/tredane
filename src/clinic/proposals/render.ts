/**
 * Corpo e botões determinísticos da proposta (S4 / #175 / DEC-061 / H8).
 * Texto autorizado e campos factuais vêm só do snapshot persistido — nunca do LLM.
 */
import type { ClinicDb } from '../store'
import { readZoneSnapshots, zoneLabel } from '../config/zones'
import type { AppointmentProposalRow } from './types'

/** Limite Cloud API para título de botão reply. */
export const PROPOSAL_BUTTON_TITLE_MAX = 20

/** Limite Cloud API para corpo de mensagem interactive. */
export const PROPOSAL_BODY_MAX = 1024

export const PROPOSAL_BUTTON_TITLES = {
  confirm: 'Confirmar',
  alter: 'Alterar detalhes',
} as const

export type ProposalButtonAction = 'confirm' | 'alter'

export type ProposalInteractiveButton = {
  id: string
  title: string
  action: ProposalButtonAction
}

export type ProposalInteractivePayload = {
  body: string
  buttons: [ProposalInteractiveButton, ProposalInteractiveButton]
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
  const m = /^prop:([^:]+):v(\d+):(confirm|alter)$/.exec(raw.trim())
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
    return `${start} – ${end} (${proposal.timezone})`
  } catch {
    return `${new Date(proposal.startsAt).toISOString()} – ${new Date(proposal.endsAt).toISOString()}`
  }
}

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
 * Monta o texto e os dois botões a partir da proposta persistida.
 * Qualquer mudança material exige nova versão (S3); este render só lê o snapshot.
 */
export function renderProposalInteractive(
  proposal: AppointmentProposalRow,
  db?: ClinicDb,
): ProposalInteractivePayload {
  const zones = db ? readZoneSnapshots(db, proposal.tenantId, 'proposal', proposal.id) : []
  const lines: string[] = [
    'Proposta de horário',
    '',
    `Local: ${proposal.clinicLocationText || 'Clínica'}`,
    `Beneficiária: ${proposal.beneficiaryName}${
      proposal.beneficiaryKind === 'terceiro' ? ' (terceiro)' : ''
    }`,
    `Serviço: ${zoneLabel(proposal.serviceName, zones)}`,
    `Quando: ${formatSlotRange(proposal)}`,
    `Duração: ${proposal.durationMinutes} min`,
  ]
  if (proposal.professionalName) {
    lines.push(`Profissional: ${proposal.professionalName}`)
  }
  if (proposal.priceCents != null) {
    lines.push(`Preço: ${formatBrl(proposal.priceCents)}`)
  }
  const signal = formatSignal(proposal)
  if (signal) lines.push(signal)
  lines.push('')
  lines.push('Esta proposta vale 30 minutos após o envio.')
  lines.push('Toque em Confirmar para seguir ou em Alterar detalhes para falar com a equipe.')

  let body = lines.join('\n')
  if (body.length > PROPOSAL_BODY_MAX) {
    body = `${body.slice(0, PROPOSAL_BODY_MAX - 1)}…`
  }

  const confirmTitle = PROPOSAL_BUTTON_TITLES.confirm
  const alterTitle = PROPOSAL_BUTTON_TITLES.alter
  if (confirmTitle.length > PROPOSAL_BUTTON_TITLE_MAX || alterTitle.length > PROPOSAL_BUTTON_TITLE_MAX) {
    throw new Error('proposal_button_title_too_long')
  }

  return {
    body,
    buttons: [
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
    ],
    proposalId: proposal.id,
    version: proposal.version,
  }
}

/** Textos fixos de resultado — só após commit / decisão (DEC-061). */
export function renderProposalResultBody(
  proposal: AppointmentProposalRow,
  kind: 'booked' | 'slot_refused' | 'pix_signal' | 'expired' | 'tempo_refused' | 'tempo_unconfirmed',
): string {
  const when = formatSlotRange(proposal)
  switch (kind) {
    case 'booked':
      return (
        `Agendado: ${proposal.serviceName} em ${when}` +
        (proposal.professionalName ? ` com ${proposal.professionalName}` : '') +
        `. Qualquer dúvida, responda esta mensagem.`
      )
    case 'slot_refused':
      return (
        `Horário já não está livre para ${proposal.serviceName} em ${when}. ` +
        `A equipe envia outra opção em breve.`
      )
    case 'pix_signal':
      return (
        `Para garantir ${proposal.serviceName} em ${when}, é preciso sinal Pix. ` +
        `Nada fica reservado antes do pagamento. A equipe envia o pedido de sinal.`
      )
    case 'expired':
      return (
        `A proposta de ${proposal.serviceName} em ${when} expirou. ` +
        `A equipe pode enviar uma nova proposta.`
      )
    case 'tempo_refused':
      return 'Nesse horário o tempo não serve para este serviço. A equipe envia outra opção em breve.'
    case 'tempo_unconfirmed':
      return 'Não deu para confirmar o tempo nesse horário. A equipe envia outra opção em breve.'
  }
}
