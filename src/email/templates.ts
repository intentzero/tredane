/**
 * Corpos mínimos de e-mail transaccional (Equipe / suporte).
 * Sem marketing. Token/link só no corpo — nunca em logs/audit.
 */
import {
  buildInviteUrl,
  buildSupportRequestUrl,
  buildSupportSessionUrl,
} from './simulated'
import type {
  InvitationEmailPayload,
  SupportAccessRequestEmailPayload,
  SupportSessionStartedEmailPayload,
} from './types'

export type RenderedEmail = {
  subject: string
  text: string
  html: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function htmlParagraphs(...lines: string[]): string {
  return lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')
}

export function renderInvitationEmail(payload: InvitationEmailPayload): RenderedEmail {
  const inviteUrl = buildInviteUrl(payload.appBaseUrl, payload.rawToken)
  const subject = `Convite Tredane — ${payload.tenantName}`
  const text = [
    `Você foi convidada(o) para a clínica ${payload.tenantName} no Tredane.`,
    '',
    'Abra o link abaixo para aceitar (válido por 7 dias):',
    inviteUrl,
    '',
    'Se não esperava este e-mail, ignore-o.',
  ].join('\n')
  const html = [
    htmlParagraphs(
      `Você foi convidada(o) para a clínica ${payload.tenantName} no Tredane.`,
    ),
    `<p>Abra o link abaixo para aceitar (válido por 7 dias):</p>`,
    `<p><a href="${escapeHtml(inviteUrl)}">${escapeHtml(inviteUrl)}</a></p>`,
    htmlParagraphs('Se não esperava este e-mail, ignore-o.'),
  ].join('')
  return { subject, text, html }
}

export function renderSupportAccessRequestEmail(
  payload: SupportAccessRequestEmailPayload,
): RenderedEmail {
  const requestUrl = buildSupportRequestUrl(
    payload.appBaseUrl,
    payload.tenantId,
    payload.supportRequestId,
  )
  const subject = `Pedido de suporte — ${payload.tenantName}`
  const text = [
    `Há um pedido de suporte para a clínica ${payload.tenantName}.`,
    '',
    `Motivo: ${payload.reason}`,
    `Âmbito: ${payload.scope}`,
    '',
    'Abra o painel para rever:',
    requestUrl,
  ].join('\n')
  const html = [
    htmlParagraphs(
      `Há um pedido de suporte para a clínica ${payload.tenantName}.`,
      `Motivo: ${payload.reason}`,
      `Âmbito: ${payload.scope}`,
    ),
    `<p>Abra o painel para rever:</p>`,
    `<p><a href="${escapeHtml(requestUrl)}">${escapeHtml(requestUrl)}</a></p>`,
  ].join('')
  return { subject, text, html }
}

export function renderSupportSessionStartedEmail(
  payload: SupportSessionStartedEmailPayload,
): RenderedEmail {
  const sessionUrl = buildSupportSessionUrl(
    payload.appBaseUrl,
    payload.tenantId,
    payload.supportSessionId,
  )
  const subject = `Suporte iniciado — ${payload.tenantName}`
  const text = [
    `A sessão de suporte na clínica ${payload.tenantName} foi iniciada.`,
    '',
    `Motivo: ${payload.reason}`,
    `Âmbito: ${payload.scope}`,
    '',
    'Estado no painel:',
    sessionUrl,
  ].join('\n')
  const html = [
    htmlParagraphs(
      `A sessão de suporte na clínica ${payload.tenantName} foi iniciada.`,
      `Motivo: ${payload.reason}`,
      `Âmbito: ${payload.scope}`,
    ),
    `<p>Estado no painel:</p>`,
    `<p><a href="${escapeHtml(sessionUrl)}">${escapeHtml(sessionUrl)}</a></p>`,
  ].join('')
  return { subject, text, html }
}
