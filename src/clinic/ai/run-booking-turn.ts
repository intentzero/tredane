/**
 * Orquestração de turno de marcação (DEC-C4 / arquitectura P1).
 *
 * Contrato alvo:
 *   cross-cutting gate → pending answer → slot fillers
 *   → applyBookingUpdate → next obligation → sayAct / interactive
 *
 * Nesta fatia: o gate vive em `booking-turn-gate.ts` e é consumido por
 * `tryAiAutoBook`; esta fachada é o ponto estável para o autodraft / testes.
 * `ask_info` (preço) continua a realizar-se em `catalogReply` *antes* desta
 * entrada (interrupt/resume da mesma pending — DEC-C1), e o gate em
 * `tryAiAutoBook` suprime option-miss se o preço chegar ao funil.
 *
 * **Proposto → em progresso.** Não reescreve Flow; não viola DEC-061/104/137/147/152.
 */
import type { Clock } from '../../db/clock'
import type { ClinicCaller } from '../envelopes'
import type { ClinicDb } from '../store'
import { tryAiAutoBook, type AutoBookOutcome } from './autobook'

export type RunBookingTurnInput = Parameters<typeof tryAiAutoBook>[3]

/**
 * Corre o motor de turno de marcação (texto / override sintético).
 * Hoje delega a `tryAiAutoBook`, que já aplica o gate cross-cutting.
 */
export async function runBookingTurn(
  db: ClinicDb,
  caller: ClinicCaller,
  clock: Clock,
  input: RunBookingTurnInput,
): Promise<AutoBookOutcome> {
  return tryAiAutoBook(db, caller, clock, input)
}
