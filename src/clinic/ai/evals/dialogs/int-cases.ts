/**
 * Família INT- (DEC-202 §2 revisão 18/11/2026): preço e catálogo determinísticos no chat.
 *
 * | ID     | Estado    | Descrição resumida |
 * |--------|-----------|--------------------|
 * | INT-01 | Proposto  | (não implementado neste PR) |
 * | INT-02 | Proposto  | (não implementado neste PR) |
 * | INT-03 | Proposto  | (não implementado neste PR) |
 * | INT-04 | Proposto  | (não implementado neste PR) |
 * | INT-05 | Confirmado| Preço após pergunta de linha (rsamp_62934e63) |
 * | INT-06 | Confirmado| «Todas» após pergunta de zonas com linha conhecida |
 * | INT-07 | Proposto  | (não implementado neste PR) |
 */
import { saveScheduleSession } from '../../schedule-session'
import type { DialogCase } from './runner'

export const INT_DIALOG_CASES: DialogCase[] = [
  {
    id: 'INT-05',
    title: 'Valores da depilação → linha masculina lista preços sem modelo',
    turnosIdeais: 2,
    turns: [
      { role: 'client', text: 'Quais os valores da depilação?' },
      { role: 'client', text: 'Masculina' },
    ],
    expect: {
      turns: [
        { turn: 0, excludes: [/R\$/] },
        {
          turn: 1,
          matches: [/R\$\s*50,00/, /R\$\s*140,00/],
          excludes: [/google/i, /equipe confirma o valor da clínica/i],
        },
      ],
      turnDecided: [{ modelCalled: false }, { modelCalled: false }],
      outboundExcludes: [/maps\.google/i, /Não tenho os valores/i],
    },
  },
  {
    id: 'INT-06',
    title: 'Linha masculina conhecida → «Todas» lista tabela de preços',
    turnosIdeais: 2,
    prepare: (s) => {
      saveScheduleSession(
        s.db,
        s.tenantId,
        s.conversationId,
        { serviceId: s.ids.depilacao, audienceLine: 'masculino' },
        s.clock,
      )
    },
    turns: [
      { role: 'client', text: 'Quanto custa a depilação?' },
      { role: 'client', text: 'Todas' },
    ],
    expect: {
      turns: [
        { turn: 0, matches: [/zonas/i], excludes: [/R\$/] },
        {
          turn: 1,
          matches: [/R\$\s*50,00/, /R\$\s*140,00/],
          excludes: [/Não tenho os valores/i],
        },
      ],
      turnDecided: [{ modelCalled: false }, { modelCalled: false }],
    },
  },
  {
    id: 'INT-01',
    title: 'Proposto — reservado',
    turnosIdeais: 1,
    pendingHarness: 'proposto-sem-implementacao',
    turns: [],
  },
  {
    id: 'INT-02',
    title: 'Proposto — reservado',
    turnosIdeais: 1,
    pendingHarness: 'proposto-sem-implementacao',
    turns: [],
  },
  {
    id: 'INT-03',
    title: 'Proposto — reservado',
    turnosIdeais: 1,
    pendingHarness: 'proposto-sem-implementacao',
    turns: [],
  },
  {
    id: 'INT-04',
    title: 'Proposto — reservado',
    turnosIdeais: 1,
    pendingHarness: 'proposto-sem-implementacao',
    turns: [],
  },
  {
    id: 'INT-07',
    title: 'Proposto — reservado',
    turnosIdeais: 1,
    pendingHarness: 'proposto-sem-implementacao',
    turns: [],
  },
]