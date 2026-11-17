/**
 * Família CW- — página web da cliente oferecida no chat (ADR-0018, Fase 5; DEC-196).
 * A abertura do hub leva o botão «Abrir agenda» em vez do CTA do Flow quando a página está ligada
 * (plataforma e owner). O corpo é determinístico (DEC-104). Texto **Proposto**.
 *
 * Relógio por defeito: qui 05/11/2026 10:00 America/Sao_Paulo (clínica aberta 09:00–18:00).
 */
import type { DialogCase } from './runner'

const HUB_OPENING = /Hoje funcionamos das 09:00 às 18:00/
const OFFER = /Para agendar, remarcar ou cancelar, toque em «Abrir agenda»\. Para tirar dúvidas, escreva aqui\./
const NO_LEAK = [/America\/|Sao_Paulo|São Paulo \(/, /maps\.google|goo\.gl/i, /\{|\}|\[Flow\]/, /cw1_/]

export const CW_DIALOG_CASES: DialogCase[] = [
  {
    id: 'CW-01',
    title: 'Hub: «Oi» abre com o expediente de hoje e o botão «Abrir agenda» (sem Flow)',
    turnosIdeais: 1,
    clientWeb: true,
    turns: [{ role: 'client', text: 'Oi' }],
    expect: {
      clientWebOffers: 1,
      proposal: false,
      notPaused: true,
      outboundCount: 1,
      // O token vai só no botão: nunca no corpo da mensagem.
      outboundExcludes: [...NO_LEAK, /Falar com a equipe/, /O que você precisa\?/, /Abrir opções/],
      turns: [{ turn: 0, matches: [HUB_OPENING, OFFER] }],
    },
  },
  {
    id: 'CW-02',
    title: 'Pedido vago de marcar («quero marcar») recebe o mesmo botão',
    turnosIdeais: 1,
    clientWeb: true,
    turns: [{ role: 'client', text: 'Quero marcar um horário' }],
    expect: {
      clientWebOffers: 1,
      proposal: false,
      notPaused: true,
      outboundCount: 1,
      outboundExcludes: NO_LEAK,
      turns: [{ turn: 0, matches: [OFFER] }],
    },
  },
  {
    id: 'CW-03',
    title: 'Serviço nomeado no pedido segue o funil: não abre link',
    turnosIdeais: 2,
    clientWeb: true,
    turns: [{ role: 'client', text: 'Quero marcar massagem amanhã às 10h' }],
    expect: {
      clientWebOffers: 0,
      noCtaUrl: true,
      notPaused: true,
      outboundExcludes: NO_LEAK,
    },
  },
  {
    id: 'CW-04',
    title: 'Pergunta de informação não abre link (as dúvidas continuam no chat)',
    turnosIdeais: 1,
    clientWeb: true,
    turns: [{ role: 'client', text: 'Quanto custa a massagem?' }],
    expect: {
      clientWebOffers: 0,
      noCtaUrl: true,
      notPaused: true,
      outboundExcludes: NO_LEAK,
    },
  },
  {
    id: 'CW-05',
    title: 'Com a página desligada, «Oi» não leva botão de URL',
    turnosIdeais: 1,
    turns: [{ role: 'client', text: 'Oi' }],
    expect: {
      noCtaUrl: true,
      outboundExcludes: NO_LEAK,
    },
  },
]
