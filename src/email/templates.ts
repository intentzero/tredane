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

/** Evita injecção CRLF no Subject (nomes de clínica / motivos livres). */
export function sanitizeEmailSubjectPart(value: string): string {
  return value
    .split('')
    .map((ch) => (ch === '\r' || ch === '\n' || ch === '\0' ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
}

function htmlParagraphs(...lines: string[]): string {
  return lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')
}

export function renderInvitationEmail(payload: InvitationEmailPayload): RenderedEmail {
  const inviteUrl = buildInviteUrl(payload.appBaseUrl, payload.rawToken)
  const tenantName = sanitizeEmailSubjectPart(payload.tenantName) || 'clínica'
  const subject = `Convite Tredane — ${tenantName}`
  const text = [
    `Você foi convidada(o) para a clínica ${tenantName} no Tredane.`,
    '',
    'Abra o link abaixo para aceitar (válido por 7 dias):',
    inviteUrl,
    '',
    'Se não esperava este e-mail, ignore-o.',
  ].join('\n')
  const html = [
    htmlParagraphs(`Você foi convidada(o) para a clínica ${tenantName} no Tredane.`),
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
  const tenantName = sanitizeEmailSubjectPart(payload.tenantName) || 'clínica'
  const reason = sanitizeEmailSubjectPart(payload.reason)
  const scope = sanitizeEmailSubjectPart(payload.scope)
  const subject = `Pedido de suporte — ${tenantName}`
  const text = [
    `Há um pedido de suporte para a clínica ${tenantName}.`,
    '',
    `Motivo: ${reason}`,
    `Âmbito: ${scope}`,
    '',
    'Abra o painel para rever:',
    requestUrl,
  ].join('\n')
  const html = [
    htmlParagraphs(
      `Há um pedido de suporte para a clínica ${tenantName}.`,
      `Motivo: ${reason}`,
      `Âmbito: ${scope}`,
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
  const tenantName = sanitizeEmailSubjectPart(payload.tenantName) || 'clínica'
  const reason = sanitizeEmailSubjectPart(payload.reason)
  const scope = sanitizeEmailSubjectPart(payload.scope)
  const subject = `Suporte iniciado — ${tenantName}`
  const text = [
    `A sessão de suporte na clínica ${tenantName} foi iniciada.`,
    '',
    `Motivo: ${reason}`,
    `Âmbito: ${scope}`,
    '',
    'Estado no painel:',
    sessionUrl,
  ].join('\n')
  const html = [
    htmlParagraphs(
      `A sessão de suporte na clínica ${tenantName} foi iniciada.`,
      `Motivo: ${reason}`,
      `Âmbito: ${scope}`,
    ),
    `<p>Estado no painel:</p>`,
    `<p><a href="${escapeHtml(sessionUrl)}">${escapeHtml(sessionUrl)}</a></p>`,
  ].join('')
  return { subject, text, html }
}
