/**
 * Corpus rotulado de intenção (DEC-202 / DEC-221, medição de 18/11/2026 + extensão 21/11).
 * Frases **fictícias** de clientes, sem dados reais. Serve para medir o encaminhamento léxico
 * (`routeToClientWeb`) e o classificador de etiqueta. Não é gate: mede.
 *
 * Rótulos (o que o chat deve fazer):
 * - `agendar`      → link para agendar (com `service` quando um só serviço é reconhecível)
 * - `remarcar`     → link de remarcar (cliente com marcação futura)
 * - `cancelar`     → link de cancelar (cliente com marcação futura)
 * - `misto`        → responde à informação e junta o link
 * - `price`        → preço/valor do cadastro (+ Abrir agenda quando couber)
 * - `team`         → oferta «Falar com a equipe» (sem pausar)
 * - `faq_catalog`  → clarificação / expediente / política / local do cadastro (sem redator)
 * - `faq_clinic`   → FAQ institucional publicada DEC-185 (sem Abrir agenda por defeito)
 * - `nenhum`       → pergunta aberta ou conversa → redator + validador
 */
export type IntentLabel =
  | 'agendar'
  | 'remarcar'
  | 'cancelar'
  | 'misto'
  | 'price'
  | 'team'
  | 'faq_catalog'
  | 'faq_clinic'
  | 'nenhum'

/** Rótulos de agenda (link); o resto fechado ou aberto não conta no recall «há intenção de agenda». */
export const AGENDA_INTENT_LABELS: IntentLabel[] = ['agendar', 'remarcar', 'cancelar', 'misto']

export type IntentSample = {
  text: string
  label: IntentLabel
  /** Nome do serviço do cenário L1 que o link deve pré-escolher; `null` = nenhum. Só em `agendar`/`misto`. */
  service?: string | null
  /** A cliente tem marcação futura (relevante em remarcar e cancelar). Padrão: `true` nesses rótulos. */
  upcoming?: boolean
  /** Categoria do exemplo, para ler o relatório. */
  kind: 'direto' | 'parafrase' | 'escrita' | 'gíria' | 'indireto' | 'informacao' | 'misto' | 'ruido'
}

const S = (
  kind: IntentSample['kind'],
  label: IntentLabel,
  text: string,
  service?: string | null,
): IntentSample => ({ kind, label, text, ...(service !== undefined ? { service } : {}) })

export const INTENT_CORPUS: IntentSample[] = [
  // — agendar: diretos
  S('direto', 'agendar', 'Quero marcar uma limpeza de pele', 'Limpeza de pele'),
  S('direto', 'agendar', 'Gostaria de agendar massagem relaxante para amanhã', 'Massagem relaxante'),
  S('direto', 'agendar', 'Quero agendar depilação', 'Depilação'),
  S('direto', 'agendar', 'Tem horário amanhã de manhã?', null),
  S('direto', 'agendar', 'Tem vaga na sexta?', null),
  S('direto', 'agendar', 'Quero marcar', null),
  S('direto', 'agendar', 'Preciso agendar um horário', null),
  S('direto', 'agendar', 'Quero marcar axilas na sexta às 10h', 'Depilação'),
  S('direto', 'agendar', 'Quero agendar peeling químico', 'Peeling químico'),
  S('direto', 'agendar', 'Quero marcar bronzeamento sábado', 'Bronzeamento'),
  S('direto', 'agendar', 'Quero agendar microagulhamento', 'Microagulhamento'),
  S('direto', 'agendar', 'Posso marcar massagem hoje?', 'Massagem'),
  S('direto', 'agendar', 'Agendar limpeza de pele profunda terça às 14h', 'Limpeza de pele profunda'),
  S('direto', 'agendar', 'Quero reservar um horário', null),
  S('direto', 'agendar', 'Disponibilidade para quinta à tarde?', null),
  // — agendar: paráfrases
  S('parafrase', 'agendar', 'Dá pra encaixar uma depilação na sexta?', 'Depilação'),
  S('parafrase', 'agendar', 'Vocês teriam horário livre amanhã cedo?', null),
  S('parafrase', 'agendar', 'Consigo uma vaga na quarta de manhã?', null),
  S('parafrase', 'agendar', 'Tem como eu ir aí fazer uma massagem relaxante amanhã?', 'Massagem relaxante'),
  S('parafrase', 'agendar', 'Quando vocês têm um horário para limpeza de pele?', 'Limpeza de pele'),
  S('parafrase', 'agendar', 'Quero fazer depilação na segunda às 9h', 'Depilação'),
  S('parafrase', 'agendar', 'Tem agenda para esta semana?', null),
  S('parafrase', 'agendar', 'Qual o próximo horário livre?', null),
  S('parafrase', 'agendar', 'Quero relaxar as costas amanhã', null),
  S('parafrase', 'agendar', 'Queria ir aí tirar os pelos das pernas', 'Depilação'),
  // — agendar: escrita e gíria
  S('escrita', 'agendar', 'Quero agnedar uma limpeza de pele', 'Limpeza de pele'),
  S('escrita', 'agendar', 'qro marca massagem relaxante amanha', 'Massagem relaxante'),
  S('escrita', 'agendar', 'tem orario hj?', null),
  S('escrita', 'agendar', 'quero marcar depilaçao na sesta', 'Depilação'),
  S('escrita', 'agendar', 'Gostaria de aggendar peeling', 'Peeling químico'),
  S('gíria', 'agendar', 'bora marcar uma massagem relaxante?', 'Massagem relaxante'),
  S('gíria', 'agendar', 'vcs tem vaga sexta?', null),
  S('gíria', 'agendar', 'to precisando marcar uma limpeza de pele', 'Limpeza de pele'),
  // — remarcar
  S('direto', 'remarcar', 'Quero remarcar minha consulta'),
  S('direto', 'remarcar', 'Preciso remarcar para sexta'),
  S('direto', 'remarcar', 'Quero reagendar meu horário'),
  S('direto', 'remarcar', 'Posso mudar o horário da minha marcação?'),
  S('direto', 'remarcar', 'Preciso trocar o horário de amanhã'),
  S('parafrase', 'remarcar', 'Não vou poder ir, dá pra passar para outro dia?'),
  S('indireto', 'remarcar', 'Preciso mudar meu dia'),
  S('indireto', 'remarcar', 'Tem como adiar minha sessão?'),
  S('escrita', 'remarcar', 'quero remarca o meu horario'),
  S('gíria', 'remarcar', 'vcs conseguem mudar meu horário pra semana q vem?'),
  // — cancelar
  S('direto', 'cancelar', 'Quero cancelar minha marcação'),
  S('direto', 'cancelar', 'Preciso cancelar'),
  S('direto', 'cancelar', 'Quero desmarcar a limpeza de pele de amanhã'),
  S('direto', 'cancelar', 'Cancela meu horário, por favor'),
  S('parafrase', 'cancelar', 'Não vou conseguir ir, pode desmarcar?'),
  S('escrita', 'cancelar', 'quero cancelra meu agendamento'),
  S('gíria', 'cancelar', 'vou ter q desmarcar, pode ser?'),
  S('indireto', 'cancelar', 'Não quero mais a sessão de sexta'),
  // — remarcar e cancelar sem marcação futura (o link abre em agendar)
  { kind: 'direto', label: 'agendar', text: 'Quero cancelar minha consulta', service: null, upcoming: false },
  { kind: 'direto', label: 'agendar', text: 'Preciso remarcar para sexta', service: null, upcoming: false },
  // — misto: informação + marcar
  S('misto', 'misto', 'Quanto custa a limpeza de pele e tem horário amanhã?', 'Limpeza de pele'),
  S('misto', 'misto', 'Qual o valor da massagem relaxante? Quero marcar para sexta', 'Massagem relaxante'),
  S('misto', 'misto', 'Quanto tempo dura a depilação de axilas e tem vaga na quarta?', 'Depilação'),
  S('misto', 'misto', 'Quanto é o peeling químico? Tem como agendar hoje?', 'Peeling químico'),
  S('misto', 'misto', 'Quais os preços e tem horário amanhã?', null),
  S('misto', 'misto', 'Quanto custa o bronzeamento e quero marcar sábado', 'Bronzeamento'),
  // — informação (sem link)
  S('informacao', 'nenhum', 'Quanto custa a limpeza de pele?'),
  S('informacao', 'nenhum', 'Quanto tempo dura a massagem relaxante?'),
  S('informacao', 'nenhum', 'O que é peeling químico?'),
  S('informacao', 'nenhum', 'Onde fica a clínica?'),
  S('informacao', 'nenhum', 'Qual o endereço de vocês?'),
  S('informacao', 'nenhum', 'Qual o horário de funcionamento?'),
  S('informacao', 'nenhum', 'Vocês abrem aos sábados?'),
  S('informacao', 'nenhum', 'Vocês fazem botox?'),
  S('informacao', 'nenhum', 'A depilação dói?'),
  S('informacao', 'nenhum', 'Quais serviços vocês têm?'),
  S('informacao', 'nenhum', 'Quem faz a limpeza de pele?'),
  S('informacao', 'nenhum', 'Como funciona o cancelamento?'),
  S('informacao', 'nenhum', 'Se eu precisar cancelar, tem multa?'),
  S('informacao', 'nenhum', 'Aceitam cartão de crédito?'),
  S('informacao', 'nenhum', 'Dá para parcelar?'),
  S('informacao', 'nenhum', 'Tem estacionamento?'),
  S('informacao', 'nenhum', 'Qual a diferença entre limpeza de pele e limpeza profunda?'),
  S('informacao', 'nenhum', 'Precisa de preparo antes da depilação?'),
  S('informacao', 'nenhum', 'Grávida pode fazer massagem?'),
  S('informacao', 'nenhum', 'Qual o valor da depilação de axilas?'),
  S('informacao', 'nenhum', 'Quanto fica a depilação das pernas?'),
  S('informacao', 'nenhum', 'Vocês recomendam fazer limpeza antes do peeling?'),
  S('informacao', 'nenhum', 'Qual o telefone de vocês?'),
  S('informacao', 'nenhum', 'Vocês têm Instagram?'),
  S('informacao', 'nenhum', 'Quais os cuidados depois do bronzeamento?'),
  // — ruído e conversa
  S('ruido', 'nenhum', 'Obrigada!'),
  S('ruido', 'nenhum', 'Ok, vou pensar'),
  S('ruido', 'nenhum', 'Valeu'),
  S('ruido', 'nenhum', 'kkkk'),
  S('ruido', 'nenhum', 'Entendi'),
  S('ruido', 'nenhum', 'Pode ser'),
  S('ruido', 'nenhum', 'Mais tarde eu falo com vocês'),
  S('ruido', 'nenhum', 'Qual o seu nome?'),
  // — mais agendar (paráfrases, escrita, gíria, indiretos)
  S('parafrase', 'agendar', 'Tem algum horário vago para depilação nesta semana?', 'Depilação'),
  S('parafrase', 'agendar', 'Vocês atendem amanhã? Queria uma massagem relaxante', 'Massagem relaxante'),
  S('parafrase', 'agendar', 'Gostaria de ver horários para peeling químico', 'Peeling químico'),
  S('parafrase', 'agendar', 'Dá para eu passar aí hoje à tarde?', null),
  S('parafrase', 'agendar', 'Tem como fazer uma limpeza de pele no sábado?', 'Limpeza de pele'),
  S('parafrase', 'agendar', 'Estou querendo fazer bronzeamento, quando posso ir?', 'Bronzeamento'),
  S('parafrase', 'agendar', 'Qual dia tem vaga para microagulhamento?', 'Microagulhamento'),
  S('parafrase', 'agendar', 'Preciso de um horário para a semana que vem', null),
  S('parafrase', 'agendar', 'Quais horários vocês têm na terça?', null),
  S('parafrase', 'agendar', 'Consegue me encaixar na quinta de manhã?', null),
  S('escrita', 'agendar', 'quero marca massagem relaxante pra sexta', 'Massagem relaxante'),
  S('escrita', 'agendar', 'tem vga amanha?', null),
  S('escrita', 'agendar', 'queria agedar depilação', 'Depilação'),
  S('escrita', 'agendar', 'qro um horario pra limpeza de pele', 'Limpeza de pele'),
  S('escrita', 'agendar', 'marcar peeling quimico sabado', 'Peeling químico'),
  S('gíria', 'agendar', 'vamo marcar essa depilação?', 'Depilação'),
  S('gíria', 'agendar', 'me encaixa na sexta pfv', null),
  S('gíria', 'agendar', 'tem horario p massagem relaxante hj?', 'Massagem relaxante'),
  S('indireto', 'agendar', 'Quero me cuidar essa semana, o que vocês têm de horário?', null),
  S('indireto', 'agendar', 'Preciso de uma limpeza de pele antes do casamento, tem vaga?', 'Limpeza de pele'),
  S('indireto', 'agendar', 'Será que tenho como ir aí amanhã?', null),
  S('indireto', 'agendar', 'Quero começar o tratamento de microagulhamento', 'Microagulhamento'),
  // — mais remarcar
  S('parafrase', 'remarcar', 'Surgiu um imprevisto, posso trocar para a próxima semana?'),
  S('parafrase', 'remarcar', 'Consigo passar meu horário de sexta para sábado?'),
  S('escrita', 'remarcar', 'preciso remarca pra outro dia'),
  S('escrita', 'remarcar', 'queria reagendra a depilação'),
  S('gíria', 'remarcar', 'vcs podem mudar meu horario de amanha?'),
  S('indireto', 'remarcar', 'Meu horário de quinta não dá mais, tem outro dia?'),
  S('indireto', 'remarcar', 'Posso vir mais tarde do que marquei?'),
  S('direto', 'remarcar', 'Quero adiar minha sessão'),
  // — mais cancelar
  S('direto', 'cancelar', 'Quero desmarcar'),
  S('direto', 'cancelar', 'Cancelar agendamento de amanhã'),
  S('parafrase', 'cancelar', 'Não poderei comparecer, podem cancelar?'),
  S('parafrase', 'cancelar', 'Pode tirar meu nome da agenda de sexta?'),
  S('escrita', 'cancelar', 'preciso cancela minha limpeza de pele'),
  S('gíria', 'cancelar', 'cancela ai pfv'),
  S('indireto', 'cancelar', 'Desisti da depilação, não precisa mais'),
  S('indireto', 'cancelar', 'Vou viajar e não vou conseguir ir'),
  // — mais mistos
  S('misto', 'misto', 'Quanto custa a depilação de pernas? Quero marcar na sexta', 'Depilação'),
  S('misto', 'misto', 'Quanto tempo dura a limpeza de pele e tem vaga amanhã?', 'Limpeza de pele'),
  S('misto', 'misto', 'Qual o preço do microagulhamento? Quero agendar', 'Microagulhamento'),
  S('misto', 'misto', 'Quanto é a massagem? Tem horário hoje?', 'Massagem'),
  // — mais informação
  S('informacao', 'nenhum', 'Qual o valor do microagulhamento?'),
  S('informacao', 'nenhum', 'Quanto custa o peeling químico?'),
  S('informacao', 'nenhum', 'Quanto tempo leva a depilação das pernas?'),
  S('informacao', 'nenhum', 'O que inclui a limpeza de pele profunda?'),
  S('informacao', 'nenhum', 'Para que serve o microagulhamento?'),
  S('informacao', 'nenhum', 'Em que dias vocês atendem?'),
  S('informacao', 'nenhum', 'Vocês abrem no feriado?'),
  S('informacao', 'nenhum', 'Qual o preço da massagem?'),
  S('informacao', 'nenhum', 'Quanto custa depilar as axilas?'),
  S('informacao', 'nenhum', 'Como é feita a depilação?'),
  S('informacao', 'nenhum', 'Tem desconto para pacote?'),
  S('informacao', 'nenhum', 'Aceitam Pix?'),
  S('informacao', 'nenhum', 'Qual o link do Google Maps?'),
  S('informacao', 'nenhum', 'O peeling deixa a pele vermelha?'),
  S('informacao', 'nenhum', 'Quanto tempo dura o efeito do bronzeamento?'),
  S('informacao', 'nenhum', 'Quem é a profissional que faz massagem?'),
  S('informacao', 'nenhum', 'Qual a política de cancelamento?'),
  S('informacao', 'nenhum', 'Se eu remarcar em cima da hora, cobram alguma coisa?'),
  S('informacao', 'nenhum', 'Preciso levar algum documento?'),
  S('informacao', 'nenhum', 'Posso levar acompanhante?'),
  // — mais ruído
  S('ruido', 'nenhum', 'Bom, depois eu vejo'),
  S('ruido', 'nenhum', 'Ótimo, obrigada pela informação'),
  S('ruido', 'nenhum', 'Tá bom'),
  S('ruido', 'nenhum', '👍'),
  S('ruido', 'nenhum', 'Imagina, por nada'),
  S('ruido', 'nenhum', 'Você é uma pessoa?'),
  // — DEC-221: price / team / faq_catalog (paráfrases que o léxico costuma perder)
  S('parafrase', 'price', 'Me fala o valorzinho da limpeza de pele'),
  S('parafrase', 'price', 'A massagem relaxante sai por quanto?'),
  S('escrita', 'price', 'qto custa o peeling quimico'),
  S('gíria', 'price', 'massa, e a depilação de axila quanto fica?'),
  S('indireto', 'price', 'Queria saber se a limpeza profunda é cara'),
  S('parafrase', 'team', 'Consegue me passar pra alguém da recepção?'),
  S('parafrase', 'team', 'Prefiro conversar com uma pessoa real'),
  S('escrita', 'team', 'quero fala com alguem ai'),
  S('gíria', 'team', 'tem como me transferir pra atendente?'),
  S('indireto', 'team', 'Não quero robô, preciso de humano'),
  S('parafrase', 'faq_catalog', 'O que exatamente entra na íntima?'),
  S('parafrase', 'faq_catalog', 'Me explica como é a limpeza de pele profunda'),
  S('parafrase', 'faq_catalog', 'A íntima cobre ânus também?'),
  S('direto', 'faq_catalog', 'Vocês abrem que horas no sábado?'),
  S('direto', 'faq_catalog', 'Onde fica o salão de vocês?'),
  S('parafrase', 'faq_catalog', 'Como funciona se eu precisar remarcar em cima da hora?'),
  S('escrita', 'faq_catalog', 'o q inclui a depilaçao de pernas'),
  S('gíria', 'faq_catalog', 'como é essa massagem relaxante aí?'),
  // — DEC-221 D3: faq_clinic (FAQ institucional DEC-185)
  S('direto', 'faq_clinic', 'Vocês têm estacionamento?'),
  S('parafrase', 'faq_clinic', 'Dá pra levar o pet junto?'),
  S('parafrase', 'faq_clinic', 'O que eu preciso levar no dia?'),
  S('direto', 'faq_clinic', 'Aceitam cartão no dia do atendimento?'),
  S('escrita', 'faq_clinic', 'tem estacionamento ai perto'),
  S('gíria', 'faq_clinic', 'posso ir de short ou tem dress code?'),
]
