/**
 * Stopwords pt-BR para *option matching* (zonas / serviços) — Confirmado Paulo 10/11/2026.
 *
 * Só entram aqui tokens que, se ecoados como sobra («Não encontrei X» /
 * «Não entendi bem «X»»), geram ruído. Não stripam data/intent nem nomes
 * de zona/serviço; feminino/masculino e todas/tudo ficam fora deste set
 * canónico (continuam nas listas locais quando o leftover os exige).
 *
 * Formas já *fold* (sem acento, minúsculas). Quem consulta deve foldar o token.
 */
export const OPTION_MATCH_STOP: ReadonlySet<string> = new Set([
  // Cortesia
  'por',
  'favor',
  'porfavor',
  'obrigado',
  'obrigada',
  'pf',
  'pfv',
  // Filler / modal
  'seria',
  'gostaria',
  'queria',
  'preciso',
  'quero',
  'posso',
  'poderia',
  'vamos',
  'teria',
  'pode',
  'ser',
  // Agendar genérico
  'agendar',
  'agenda',
  'agendamento',
  'agendamentos',
  'marcar',
  'marca',
  'marcacao',
  'marcacoes',
  'horario',
  'horarios',
  'hora',
  'horas',
  // Partícula de período («na parte da manhã/tarde») — não é serviço; «Parte íntima» casa pelo resto.
  'parte',
  'dia',
  'data',
  'consulta',
  'vaga',
  'disponivel',
  'disponiveis',
  // Saudação
  'oi',
  'ola',
  'bom',
  'boa',
  'tarde',
  'noite',
  'manha',
  // Conectores / determinantes (os curtos também; o filtro de comprimento local pode ignorá-los)
  'um',
  'uma',
  'uns',
  'umas',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'ou',
  'para',
  'pra',
  'com',
  'sem',
  'no',
  'na',
  'nos',
  'nas',
  'em',
  'ao',
  'aos',
  'a',
  'o',
  'as',
  'os',
])
