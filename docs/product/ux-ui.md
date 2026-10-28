# Especificação de UI/UX do painel — MVP

**Estado:** proposta de design para revisão pelo responsável pelo produto, 23 de outubro de 2026; abordagem **mobile first** confirmada na mesma data ([DEC-039](decisions.md)). **Fonte:** [MVP](../MVP.md), [atores](actors-permissions.md), [jornadas](journeys.md), [requisitos](requirements.md), [estados](states.md), [cenários de aceite](acceptance.md) e [épico #1](https://github.com/intentzero/tredane/issues/1). **Mocks no repositório:** [docs/design](../design/README.md) guarda as fontes, os previews PNG, o índice de telas e os componentes; é a referência para implementação. **Protótipos navegáveis** (artefatos privados no claude.ai; precisam ser compartilhados pelo dono para outras pessoas abrirem):

- **Referência principal — celular (M-01 a M-08):** canvas “Tredane — UI/UX mobile first”, https://claude.ai/artifact/D3NALDhxo5n1jZj2fqpdka.
- **Ampliação para telas largas (≥ 1280 px):** canvas “Tredane — UI/UX do MVP”, https://claude.ai/artifact/6kzR7zL5q9hs2AcvTyYDNf.

Este documento descreve telas, componentes e estados visíveis que materializam as jornadas JRN-01 a JRN-07. Ele não cria regra de negócio nova: quando uma tela depende de decisão ainda aberta, o item fica marcado como **Em aberto** e a interface não deve presumir a resposta. Todos os nomes, telefones e horários de exemplo são fictícios.

## 1. Escopo e premissas

| Item | Estado | Observação |
| --- | --- | --- |
| Usuários do painel: atendente (ACT-02) e responsável (ACT-03), com as mesmas telas de atendimento | **Confirmado** | DEC-013, DEC-015, DEC-016. Não há tela de profissional nem de operador. |
| Contato (ACT-01) só interage pelo WhatsApp | **Confirmado** | O painel nunca expõe tela ao contato. |
| Três áreas principais: Conversas, Acompanhamento, Agenda | **Proposto** | Derivado do fluxo principal do MVP e do ADR-0003. |
| Na interface, o pipeline se chama **Acompanhamento** e a oportunidade aparece como **contato em andamento**; “pipeline” e “oportunidade” ficam só nos documentos e no código | **Confirmado** | DEC-045 (24/10/2026): muitas leitoras não sabem o que é pipeline. Validar o nome com a clínica piloto. |
| **Mobile first:** o celular é o alvo de base e precisa concluir todo o fluxo piloto (mensagem → resposta → etapa → agendamento); tablet e desktop são ampliações progressivas | **Confirmado** | DEC-039, pedido do responsável pelo produto em 23 de outubro de 2026. Substitui a proposta anterior deste documento de desktop como alvo principal. |
| Larguras de referência: 360–430 px (base), ≥ 768 px (tablet), ≥ 1280 px (desktop) | **Proposto** | **Em aberto:** modelos e sistemas dos aparelhos da clínica piloto (Q-UX-01). Bloqueia o aceite de usabilidade, não o desenvolvimento das telas. |
| Painel como aplicação web responsiva no navegador do celular, sem app nativo no MVP, instalável como PWA com notificações push de nova conversa | **Confirmado** | DEC-039, DEC-040. O push não traz o conteúdo da mensagem. No iPhone o push exige instalar o painel na tela inicial: o fluxo de instalação tem tela de orientação e escolha de avisos (M-14). Suporte em cada aparelho da clínica piloto: Q-UX-01. |
| Idioma pt-BR, fuso horário da clínica em todas as datas | **Proposto** | O fuso da clínica é parte das regras de agenda ainda em aberto (DEC-008). |
| Login pelo Clerk (código por e-mail) e seletor de clínica para contas com várias clínicas | **Confirmado** | DEC-007, REQ-005. TEL-08 (proposta), desenhada em M-09 e M-10. A tela de entrada final usa o componente do Clerk estilizado com a identidade do Tredane; M-09 mostra o comportamento esperado, não o componente real. |
| Configuração da clínica (serviços, profissionais, salas, disponibilidade, membros) e conexão do WhatsApp, só pelo responsável | **Confirmado** quanto ao papel; telas **propostas** (TEL-09, M-15 a M-26; suporte em TEL-10, M-27 a M-29) | DEC-007, DEC-009, JRN-08, REQ-052, REQ-051. Ficam numa área “Clínica” visível só ao responsável. |
| App de superadmin | **Fora desta spec** | DEC-012, [ADR-0006](../adr/0006-clerk-platform-admin.md), [identidade e administração](../architecture/identity-and-admin.md). App separado, com spec própria quando for desenhado. |
| Relatórios, campanhas, prontuário, pagamentos além do sinal por Pix (DEC-047), bot autônomo | **Fora do MVP** | Não aparecem na navegação, nem como item desabilitado. |

## 2. Princípios de experiência

1. **Estado real, nunca otimista disfarçado.** Uma ação mostra “salvando”/“enviando” até a confirmação do servidor. A interface não apresenta como persistido o que ainda não foi gravado (REQ-042, REQ-012).
2. **Mesma verdade em todas as visões.** Conversa, pipeline e agenda exibem o mesmo compromisso e a mesma etapa, com o mesmo texto de estado (JRN-03, AC-13).
3. **A IA sugere; a pessoa envia.** Toda saída de IA é marcada como sugestão e só chega ao contato pelo botão de envio do próprio usuário (REQ-022, ADR-0004).
4. **Falha visível e separada.** Falha de mensagem não se confunde com estado da agenda; falha da IA não bloqueia a resposta manual (REQ-033, AC-06, AC-10).
5. **Uma clínica por tela.** O nome da clínica ativa fica sempre visível; nenhuma lista, busca ou notificação mostra dado de outra clínica (REQ-001).
6. **Cor nunca é o único sinal.** Todo estado tem ícone e texto (seção 7).
7. **Celular primeiro.** Cada tela é desenhada a partir de 360 px com uma mão; colunas extras só aparecem quando há largura, sem esconder no celular uma ação disponível no desktop.

## 3. Arquitetura de informação

```
TEL-08 Entrar (e-mail → código) → seletor de clínica (só com mais de uma)
Cabeçalho global: [clínica ativa ▾ troca] · Conversas · Acompanhamento · Agenda · [Clínica: só responsável] · [indicador de conexão] · [usuário]
TEL-09 Clínica (só responsável): Serviços · Profissionais e salas · Horários e bloqueios · Equipe · WhatsApp
├── TEL-01 Conversas (lista + conversa aberta + painel do contato)
│     └── TEL-05 Agendar horário (painel lateral a partir da conversa)
├── TEL-03 Acompanhamento (pipeline, quadro por etapa)
│     └── abre a conversa vinculada em TEL-01
└── TEL-04 Agenda (dia por profissional / por sala)
      └── TEL-06 Detalhe do compromisso (cancelar, reagendar)
TEL-07 Estados globais: conexão, sincronização, acesso revogado, erro de carregamento
```

- **Proposto:** URLs estáveis por área e item (`/conversas/:id`, `/acompanhamento`, `/agenda?dia=`), para retomar o trabalho após recarregar. O ID na URL nunca concede acesso por si: um ID de outra clínica mostra o estado “Não encontrado” sem revelar se o item existe (REQ-001, AC-01).
- **Proposto:** contadores na navegação (ex.: conversas novas) vêm do estado canônico da clínica e são reconciliados na reconexão.

### 3.1 Padrões de layout mobile first

**Estado:** Proposto, decorrente de DEC-039.

| Largura | Navegação | Conversas | Acompanhamento | Agenda |
| --- | --- | --- | --- | --- |
| Base (360–767 px) | Barra inferior com Conversas, Acompanhamento e Agenda (e **Clínica**, só para o responsável); badge de novas conversas. | Lista em tela cheia → conversa em tela cheia (sem barra inferior) → “Detalhes” em tela própria. | Abas roláveis por etapa; cartões em lista; mover pelo botão **Mover** em folha inferior. | Lista cronológica do dia com filtros por profissional e sala; espaços livres com **Agendar**. |
| Tablet (≥ 768 px) | Barra lateral compacta. | Lista + conversa lado a lado; detalhes em gaveta. | Quadro com rolagem horizontal. | Grade com colunas por recurso. |
| Desktop (≥ 1280 px) | Cabeçalho superior. | Três colunas (lista, conversa, detalhes). | Quadro completo; arrastar e soltar além do menu “Mover para…”. | Grade completa e painel lateral de agendamento. |

Regras comuns:
- Alvos de toque ≥ 44 × 44 px; ações principais (Enviar, Agendar, Confirmar) ficam na zona inferior da tela, alcançáveis com o polegar.
- Ação principal fixa no rodapé em telas de formulário (Detalhes, Agendar), respeitando a área segura do aparelho.
- Folhas inferiores (bottom sheets) para escolhas curtas: mover etapa, transferir responsável, ações da conversa. Diálogos centrais só para confirmação destrutiva (cancelar compromisso) e acesso encerrado.
- O compositor acompanha o teclado virtual; abrir o teclado não cobre a última mensagem nem a sugestão da IA.
- Campos com fonte de 16 px para o navegador não aplicar zoom automático ao focar.
- Faixa de conexão (6.2) fica logo abaixo do cabeçalho em todas as larguras.
- Arrastar nunca é o único jeito de fazer algo.

## 4. Telas

As descrições abaixo partem da largura base; as variações de tablet e desktop seguem a tabela 3.1. Os artboards M-01 a M-08 do canvas mobile são a referência visual principal.

Cada tela lista jornada e requisitos de origem, conteúdo, ações, eventos em tempo real e estados de vazio/erro. As telas correspondem aos artboards do protótipo visual.

### TEL-01 — Conversas (caixa de entrada)

**Origem:** JRN-01, JRN-02, JRN-04; REQ-010, REQ-011, REQ-012, REQ-020, REQ-021, REQ-022. **Estado:** Proposto.

No celular, três telas encadeadas: lista (M-01) → conversa (M-02) → detalhes do contato e oportunidade (M-03), aberta ao tocar no nome no cabeçalho da conversa. No tablet, lista e conversa ficam lado a lado e os detalhes viram gaveta; no desktop, três colunas (lista 360 px, conversa fluida, detalhes 320 px).

**Lista de conversas**
- Item: nome do contato (ou telefone mascarado quando não houver nome), trecho da última mensagem, horário relativo, estado da conversa (Nova / Em atendimento / Encerrada), avatar ou iniciais do responsável atribuído, etapa da oportunidade.
- Filtros rápidos: **Todas**, **Novas**, **Minhas**, **Sem responsável**, **Encerradas**. Todas as conversas da clínica são visíveis aos dois perfis, inclusive as atribuídas a outra pessoa (DEC-015, AC-16).
- Busca por nome ou telefone, limitada à clínica ativa.
- Ordenação padrão: última interação, mais recente primeiro. **Proposto.**
- Nova mensagem recebida move o item para o topo, sem tirar o foco do usuário de onde ele está; se a lista estiver rolada, aparece o aviso “1 nova conversa” para voltar ao topo.

**Conversa aberta**
- Cabeçalho: contato, estado da conversa, responsável com ação **Assumir** (quando não é o usuário) ou **Transferir**, ação **Encerrar**. **Proposto (PR-7, 27/10/2026):** Assumir vira uma faixa abaixo do cabeçalho (“Ninguém está atendendo esta conversa.” + **Assumir**), Agendar fica como ícone no cabeçalho e **Encerrar conversa** fica no menu ⋮ com confirmação, para não competir com a resposta.
- **Agendar com «Por período» e Bloquear contato (Agendar: Proposto, 27/10/2026; Bloquear: Decidido, 28/10/2026):** a tela de agendamento (com conversa) tem o seletor **Horário exato | Por período**; «Por período» abre a reserva por bloco (dia, período, serviço, profissional, duração e horário livre dentro do período). No celular o menu ⋮ abre uma **folha inferior** (M-40: Ver detalhes, Reservar bloco, Transferir, Encerrar, Bloquear); **Transferir** lista os membros ativos da clínica (o cadastro de equipe só guarda papéis: a lista mostra «Responsável» e «Atendente», numerados quando há mais de um). No desktop é menu suspenso. O menu ⋮ **mantém «Reservar bloco»** (decisão do Paulo, coerente com o mock M-39; oculto com contato bloqueado), seguido de **Transferir** e **Encerrar conversa** e, em vermelho e separado, **Bloquear contato**, que abre um diálogo central de confirmação com motivo opcional (Mensagens ofensivas, Spam ou propaganda, Outro motivo; só a equipe vê). Efeito: o contato recebe `blocked_at`; mensagens novas do número são deduplicadas mas **não criam conversa nem mensagem** (auditado como `contact.ingest_suppressed_blocked`); o envio é recusado (`contact_blocked`); as conversas abertas são encerradas com a mensagem de sistema «{nome} bloqueou este contato»; histórico e compromissos continuam. Na conversa bloqueada o compositor dá lugar ao aviso «Contato bloqueado…» com **Desbloquear**; no painel do contato há a mesma ação. **Toda a equipe** (responsável e atendentes) pode bloquear e desbloquear (decidido, t1918s7703). **Decidido (Paulo, 28/10/2026):** (1) o bloqueio é **só interno** ao Tredane; não chama o bloqueio de usuários da API do WhatsApp; (2) **Pix pendente** (cobrança `awaiting_payment` dentro do prazo) **continua válido e não é cancelado**; o diálogo de confirmação avisa antes «Este contato tem um Pix pendente. O Pix continua válido e não será cancelado.» (flag `hasPendingPix` no GET do contato e `contactHasPendingPix` no detalhe da conversa); sem Pix pendente o diálogo não muda; (3) **atendente e responsável** podem bloquear e desbloquear. **Em aberto:** se a IA deve ignorar contatos bloqueados além de não receber mensagens.
- **Sugestão da IA e Pix pendente (Proposto de desenho; decisões Confirmadas em 28/10/2026):** o cartão da sugestão mostra o **texto completo** (rolagem interna em textos longos, tela cheia opcional) com **Enviar** (1 toque, por ação da atendente, DEC-062), **Editar**, **Gerar outra** e **Descartar**; o botão de enviar do campo fica desativado enquanto vazio. Um Pix pendente aparece numa faixa fixa abaixo da faixa de contexto («Aguardando Pix · vence às HH:MM — horário ainda não reservado»); **Detalhes** abre uma folha com valor, prazo, **Reenviar cobrança** e **Cancelar cobrança** (DEC-064). Desenho em canvas privado de design, ainda sem mock `M-xx` em `docs/design/`.
- Linha do tempo em ordem persistida: mensagens recebidas (esquerda), enviadas (direita, com estado de envio — seção 6.1), eventos de sistema centralizados (“Bruno assumiu a conversa”, “Etapa: Horário proposto”, “Compromisso confirmado — sex 14:00”). O histórico corresponde ao registro persistido após recarga ou reconexão (REQ-021).
- Mídia recebida não suportada ou indisponível aparece como bloco “Anexo não disponível” com motivo, nunca como mensagem vazia (JRN-01).
- Mensagem recebida cujo processamento falhou aparece como “Mensagem não processada — a equipe técnica foi avisada” somente se houver registro do evento; conteúdo não persistido não é exibido como íntegro (states.md).
- Compositor: campo de texto multilinha, botão **Enviar** (Ctrl/⌘ + Enter), botão **Sugerir resposta** (IA). Envio de anexo pela equipe: **Em aberto** (DEC-011).
- **Janela de 24 h (Confirmado, DEC-040):** quando a última mensagem do contato tem mais de 24 h, o campo de texto livre fica bloqueado com o aviso “Fora da janela de 24 h do WhatsApp” e o botão **Escolher modelo** abre a lista de modelos aprovados pela Meta (retomada de contato e confirmação de horário; lembrete é posterior), com prévia e preenchimento de variáveis. O envio de modelo tem os mesmos estados de envio (6.1). A sugestão da IA continua disponível, mas só pode ser enviada dentro da janela ou convertida em modelo. **Confirmado (24/10/2026):** modelos do piloto: retomada de contato e confirmação de horário; lembrete é posterior; a prévia mostra o aviso de custo. **Pendente:** texto final e aprovação na Meta (EP-T04). Desenhado em M-11 (janela fechada) e M-12 (escolha do modelo).

**Painel do contato e oportunidade**
- Dados do contato: nome, telefone mascarado por padrão. Campos adicionais: **Em aberto** (DEC-011, coleta mínima).
- Oportunidade: etapa atual (**Confirmado, DEC-061:** só leitura, muda sozinha; correção manual em «Corrigir etapa» no ⋮, e **Horário proposto** e **Perdido** só manuais; encerrar não a altera, DEC-065), responsável, último contato, próximo compromisso.
- Bloco **Resumo da IA** (seção 6.3).
- Compromissos do contato: próximo e anteriores, com estado. **Confirmado (DEC-063):** no desktop o painel é informativo e **Agendar** fica só no cabeçalho da conversa (abre TEL-05); no celular a mesma ação fica na faixa de contexto abaixo do cabeçalho.

**Tempo real:** conversa criada/atribuída/encerrada; mensagem recebida; mudança de estado de envio; etapa alterada; compromisso confirmado/cancelado (states.md, “Eventos de interface”).

**Vazios e erros:** sem conversas → “Nenhuma conversa ainda. Mensagens enviadas ao WhatsApp da clínica aparecem aqui.” Filtro sem resultado → “Nenhuma conversa neste filtro” com ação “Limpar filtro”. Falha ao carregar → mensagem com ação “Tentar de novo”, sem lista parcial apresentada como completa.

### TEL-02 — Disputa e transferência de responsável

**Origem:** JRN-02 (alternativas), REQ-020, AC-08. **Estado:** Proposto.

- **Assumir** fica em estado “Assumindo…” até a resposta. Se outra pessoa assumiu antes, o servidor decide e a interface mostra: “Bruno assumiu esta conversa antes de você.” com ação **Assumir mesmo assim**. Como os dois perfis podem atribuir e transferir (matriz de permissões), a ação é permitida e fica registrada no histórico como transferência.
- **Transferir** abre lista de membros da clínica ativa; nunca mostra membros de outra clínica.
- Reatribuição não altera o estado da conversa (states.md).

### TEL-03 — Acompanhamento (pipeline)

Nome na interface: **Acompanhamento** (DEC-045). Na barra inferior de quatro itens do responsável, o rótulo ocupa quase toda a largura do item em 390 px; **Confirmado (24/10/2026):** se o rótulo não couber na barra em 360 px, a barra usa “Acompanhar” (verbo curto) e o título da tela continua “Acompanhamento”. **Em aberto:** conferir em aparelho real de 360 px.

**Origem:** JRN-03, JRN-04; REQ-023. **Estado:** Proposto.

- Quadro com as etapas propostas: **Novo contato → Em atendimento → Horário proposto → Agendado → Concluído** e coluna **Perdido** separada visualmente à direita. As etapas vêm da configuração da clínica; a interface não fixa nomes no código de apresentação, para permitir etapas configuráveis depois (MVP).
- Cartão: nome do contato, responsável, último contato (relativo), próximo compromisso (ou “Sem horário marcado”), ação “Abrir conversa”, indicador de mensagem pendente/falha.
- No celular (M-05), uma etapa por vez em abas roláveis com contagem; o botão **Mover** abre uma folha inferior com as etapas. No desktop, arrastar entre colunas **ou** menu **Mover para…** (alternativa acessível por teclado). O cartão fica em estado “Movendo…” até confirmação; em falha, volta à coluna original com aviso.
- Mover para **Horário proposto** mostra a nota “Etapa da negociação — não reserva horário na agenda” (states.md).
- Mover para **Agendado** sem compromisso vinculado é **permitido** (Confirmado, DEC-040): o cartão exibe “Sem compromisso vinculado” e oferece **Agendar horário**; mudar etapa nunca cria compromisso.
- Filtros: responsável, “Minhas”, busca por nome. Relatórios e totais avançados ficam **Fora do MVP**.
- Clique no cartão abre a conversa vinculada (TEL-01).
- **Tempo real:** etapa alterada e responsável alterado movem o cartão nas outras sessões, com destaque breve (1,5 s) no cartão alterado; o cartão que o usuário está arrastando não é movido por evento remoto até soltar — após soltar, prevalece o estado do servidor.

### TEL-04 — Agenda

**Origem:** JRN-03, JRN-04, JRN-05; REQ-030, REQ-031, REQ-034. **Estado:** Proposto; regras de disponibilidade **Em aberto** (DEC-008).

- No celular (M-06), lista cronológica do dia: compromissos, espaços livres (com **Agendar**), bloqueios e fora do expediente, filtrável por profissional ou sala. A partir do tablet, visão **Dia** em grade com colunas por profissional e linhas de 15 min (granularidade de 15 min, **Confirmada** em DEC-008). Alternância **Por profissional / Por sala** mostra a mesma agenda pelo outro recurso, porque o horário ocupa os dois (DEC-014).
- Compromisso: horário, contato, serviço, sala/equipamento como etiqueta, estado (Confirmado / Cancelado / Concluído). Cancelados ficam ocultos por padrão com filtro “Mostrar cancelados”.
- Bloqueios e fora de expediente em hachura com rótulo (“Bloqueado”, “Fora do expediente”), não só cor.
- Navegação de dia (anterior/hoje/próximo) e seletor de data. **Visão semanal (Confirmado, DEC-040):** alternância Dia/Semana; no tablet e no desktop, grade de sete dias com os compromissos por dia; no celular, lista agrupada por dia, com filtros por profissional ou sala. Clicar num dia leva à visão do dia. Desenhada em M-13.
- **Dia no celular (Proposto, 28/10/2026):** cabeçalho único («Agenda» + data + Dia/Semana), faixa da semana com o **número de horários** de cada dia, e filtro por **quem atende**: rostos (iniciais) das profissionais ativas com a contagem do dia («Paula · 2»), **seleção múltipla**, linha de resumo («Dra. Paula e Lívia · 4 horários») e «Ver todos». A lista é cronológica: o cartão começa pelo **nome da cliente**, mostra serviço, fim e quem atende (inicial colorida), com a linha «Agora» no dia de hoje e a faixa «Hora a definir» para reservas por período. O botão **Agendar {dia}** fica na zona do polegar e abre o Agendar **já nesse dia** (`?date=`). A grade de horas segue no tablet e no desktop. **Ainda não implementado:** horários livres, bloqueios e fora do expediente na lista (a API da agenda ainda não os devolve), botão de ajustes (sala, livres, cancelados), folha do compromisso, Por sala no celular e o desktop por profissional/sala.
- **Sala com mais de um lugar (DEC-059, Proposto na tela):** na lista do dia, os compromissos que se sobrepõem na mesma sala compartilhada formam **um bloco por faixa** («Sala Bem-estar · 2/3», bolinhas de ocupação, as pessoas dentro e «1 lugar livre · Agendar»); lotada = «lotada · 3/3». Sala de 1 lugar não mostra «1/1». No **Agendar**, cada horário de sala compartilhada mostra os lugares livres («2 de 3», «último lugar»); lotado ou sem profissional livre não aparece. Os números são só de exibição (o servidor continua a decidir o conflito no pico de 15 min, bloco pendente não entra na contagem da tela).
- Clique em espaço livre abre TEL-05 com horário pré-preenchido; clique em compromisso abre TEL-06.
- **Tempo real:** compromisso confirmado/cancelado/reagendado aparece ou some nas outras sessões; se o usuário está com TEL-05 aberto e o horário escolhido é ocupado por evento remoto, o horário é marcado como indisponível imediatamente (antes mesmo de tentar confirmar).

### TEL-05 — Agendar horário

**Origem:** JRN-03; REQ-030, REQ-031, REQ-033. **Estado:** Proposto.

Tela única no celular (M-04, M-34 a M-38), cabeçalho com o contato real e **Voltar** para a origem (conversa, acompanhamento ou agenda). **Proposto** (redesenho de 27/10/2026, em staging).

1. **Serviço** — cartões com nome, duração e valor.
2. **Profissional** — botões, **Qualquer** primeiro.
3. **Dia** — grade de 5 dias e **Ver calendário** (60 dias, DEC-054 Confirmado). Dia sem horários mostra **Próximo livre** (busca no cliente, 14 dias, mesma escolha de profissional; não há endpoint próprio — DEC-055 Confirmado).
4. **Horário** — grade de 4 colunas separada em Manhã e Tarde; selecionado em destaque preenchido; sala só no rodapé e na revisão (DEC-056 Confirmado). Horários ocupados somem na hora por evento WebSocket, com polling de reserva (DEC-057 Confirmado).
5. **Rodapé fixo** — resumo e **Revisar e confirmar** (alvos ≥ 44 px).
6. **Revisão** (folha inferior, M-35) — paciente, serviço, profissional, quando, sala, valor; **Enviar confirmação pelo WhatsApp** com texto editável (ligado por padrão quando há conversa e a janela está aberta; fora da janela fica indisponível com explicação — DEC-053 Confirmado). Só disponível com conversa e janela de 24 h aberta; enviada depois de confirmar, pela mesma API do inbox.
7. **Sinal por Pix** (M-34, DEC-047/049) — valor, prazo (padrão 2 h, configurável pela clínica), **Enviar sinal** e **Confirmar sem sinal** com motivo em chips. O texto da cobrança Pix não é editável (a API não recebe texto).

Resultados:
- **Sucesso** (M-38): “Horário agendado”, estado do aviso (enviada / não enviada), **Voltar à conversa** e **Ver na agenda**. Falha no aviso não desfaz o compromisso (REQ-033).
- **Conflito** (M-36): “Esse horário acabou de ser ocupado. Nada foi reservado.” (role=alert, recebe foco); mantém serviço, profissional e dia, risca o horário perdido e destaca as alternativas mais próximas (REQ-031).
- **Erro de rede/servidor:** “Não foi possível confirmar. Nada foi reservado.” com **Tentar de novo** apenas quando o servidor garantir que nada foi gravado; caso contrário relê a agenda (ADR-0005).
- Sem configuração mínima: “A agenda desta clínica ainda não foi configurada” (REQ-052, AC-14).
- Controle de duração (variante a07, DEC-051 Confirmado): só em serviços marcados pela owner como «Duração ajustável ao agendar»; botões −/+ em passos de 15 min entre o mínimo e o máximo; a grade recalcula; buffer do serviço somado depois; preço e sinal não mudam; reagendar mantém a duração; agenda e compromisso mostram «duração ajustada». Oculto em serviços com sinal.
- Confirmar move a oportunidade para **Agendado** com evento no histórico (DEC-052 Confirmado).
- Texto da cobrança Pix fixo do servidor (DEC-058 Confirmado).

A IA não preenche nem confirma este painel no MVP (ADR-0004).

**Confirmado (27/10/2026, card t1868s7504):** DEC-051 a DEC-058 conforme a recomendação em [agendar-em-aberto.md](agendar-em-aberto.md).

### TEL-06 — Detalhe, cancelamento e reagendamento

**Origem:** JRN-05; REQ-032, REQ-033. **Estado:** Proposto.

- Detalhe: contato, serviço, horário, profissional, sala, estado, quem confirmou e quando, histórico de alterações, link para a conversa.
- **Cancelar:** confirmação em diálogo com motivo obrigatório escolhido de uma lista (DEC-008); o botão de confirmar fica desabilitado até escolher. Não há prazo mínimo, então nenhuma regra de prazo é exibida.
- **Reagendar** também pede o motivo antes de confirmar o novo horário.
- **Reagendar:** abre TEL-05 com dados preenchidos. O compromisso antigo continua confirmado até o novo ser confirmado; em conflito, a mensagem deixa claro: “O compromisso de sex 14:00 continua mantido.” (AC-10).
- Alterado por outra pessoa enquanto aberto: “Este compromisso foi alterado por Bruno às 10:42.” e o detalhe recarrega; a ação em curso é cancelada sem gravar.
- Comunicação ao contato é opcional e separada, igual a TEL-05.

### TEL-08 — Entrar e escolher a clínica

**Origem:** DEC-007; REQ-005; AC-17. **Estado:** Proposto.

- **Entrar:** fluxo do Clerk com código por e-mail: campo de e-mail → campo do código, com preenchimento automático no celular (`autocomplete="one-time-code"`) e reenvio. A mensagem de erro não revela se o e-mail tem conta. Textos e cores seguem a spec; o comportamento é o do Clerk.
- **Escolher clínica:** lista com nome de cada clínica e papel (Atendente/Responsável). Com uma só clínica, a tela é pulada.
- **Trocar de clínica:** tocar no nome da clínica no cabeçalho abre a mesma lista. Ao trocar, a tela mostra “Abrindo Clínica B…”, descarta os dados da anterior e reconecta o tempo real; texto não enviado no compositor é descartado com confirmação.
- Clínica removida do acesso some da lista; se era a ativa, aparece o estado “Acesso encerrado” (6.2).

### TEL-09 — Clínica (configuração, só o responsável)

**Origem:** DEC-007, DEC-008, DEC-009, DEC-012; REQ-004, REQ-051, REQ-052, REQ-071; JRN-08; AC-14. **Estado:** Proposto (telas M-15 a M-19). Visível apenas para o Responsável; o Atendente não vê a aba e, se abrir a URL, recebe “Você não tem acesso a esta área” sem dados (REQ-002).

**Início (M-15).** Faixa “Falta N passos para atender” com os itens pendentes e uma lista de áreas com o estado de cada uma (Pronto, Falta conectar). “Pronta para atender” exige: ao menos um serviço, um profissional, uma sala/equipamento, expediente e WhatsApp conectado (REQ-052, AC-14). **Decidido (Paulo, 28/10/2026):** sala/equipamento só é exigida quando algum serviço ativo pede sala, e então tem de existir uma sala ativa que o satisfaça; o expediente exigido é o de pelo menos um profissional ativo. Sem a configuração da agenda, M-04 mostra “A agenda desta clínica ainda não foi configurada”.

**Serviço (M-16).** Nome, duração e intervalo depois (múltiplos de 15 min, DEC-008), quem pode fazer, sala/equipamento exigido, preço opcional, **explicação para clientes** opcional (usada pela IA, DEC-046) e ativo/inativo. Um resumo mostra quanto tempo o serviço ocupa na agenda: duração + intervalo, bloqueando profissional e sala. Desativar um serviço não cancela compromissos já marcados. Nome, duração e preço também alimentam o contexto da IA (REQ-072).

**Horários e bloqueios (M-17).** Por profissional e por sala/equipamento: expediente semanal (faixas por dia) e bloqueios pontuais com data, horário opcional e motivo; sem recorrência no MVP (DEC-008). **Decidido (Paulo, 28/10/2026): salas e equipamentos não têm expediente.** Só o profissional tem expediente semanal; a sala fica livre sempre que não houver marcação (respeitando a capacidade) nem bloqueio. Em M-17 a sala mostra só os bloqueios (a edição de expediente fica escondida); janelas antigas de sala ficam gravadas mas deixam de contar, e o horário de funcionamento que a IA usa vem só dos profissionais. No serviço, o requisito de sala ganha a opção **«Qualquer sala livre»** (modo `any`: todas as salas/equipamentos ativos por nome, a primeira livre), além de categoria e sala específica (migração 0023). Criar um bloqueio sobre compromissos existentes lista os compromissos afetados e não os cancela sozinho; o responsável decide caso a caso (fluxo de cancelar ou reagendar com motivo, TEL-06).

**Profissionais e salas (M-20 a M-22).** Duas abas na mesma tela (M-20): Profissionais e Salas e equipamentos, cada uma com lista, estado (ativa/ativo) e botão de adicionar.
- *Profissional (M-21):* nome como aparece na agenda, serviços que faz e ativa/inativa. A lista de serviços é a mesma de “Quem pode fazer este serviço” (M-16): alterar em um lugar altera no outro. O expediente semanal é editado em M-17. A profissional não tem login nem convite (DEC-013). Desativar a retira de novos agendamentos e não cancela compromissos futuros (TEL-06).
- *Sala ou equipamento (M-22):* tipo (sala ou equipamento), nome, categoria (por exemplo, “Sala com laser”), disponibilidade semanal (M-17), serviços que o usam e ativa/inativa. Um serviço pode exigir uma categoria ou um recurso específico (DEC-014). Desativar o único recurso de uma categoria exigida por um serviço avisa que o serviço deixa de aceitar novos agendamentos.
- *Desativar, reativar e excluir (M-21/M-22):* o detalhe tem botão «Desativar» / «Reativar» (substitui a antiga caixa «ativa»). Se houver compromissos futuros, abre a lista e a equipe escolhe, por compromisso ou para todos: remanejar para outra profissional/sala ativa, livre no horário e compatível com o serviço (sugestão automática quando existe), ou manter e só bloquear novos agendamentos. O servidor revalida disponibilidade, grava auditoria e evento do compromisso; nada é cancelado e o paciente não é avisado automaticamente. A lista esconde inativos por padrão («Mostrar inativos»); o histórico é sempre mantido. Exclusão permanente só para itens que nunca tiveram compromisso, com confirmação; o servidor recusa nos demais casos.
- Regras: nomes únicos por tipo dentro da clínica; ao menos um profissional e um recurso ativos para a clínica ficar pronta (REQ-052); excluir definitivamente **não existe** no MVP, só desativar, para preservar o histórico de compromissos (**Proposto**).

**Equipe (M-18).** Membros com papel (Responsável, Atendente), convites pendentes e remoção de acesso. O responsável gerencia **somente atendentes** (DEC-020): responsáveis aparecem sem ação e são gerenciados pela equipe do Tredane. Convites por e-mail expiram em 7 dias; **Reenviar** gera novo link e invalida o anterior, com espera de 10 min e até 5 reenvios em 24 h (mostrada no botão desabilitado); qualquer responsável cancela um convite (DEC-021 a DEC-025). Remover um atendente encerra as sessões e conexões em tempo real dele naquela clínica (REQ-003). Suporte do Tredane: ver TEL-10. 

**WhatsApp (M-19, M-23 a M-25).** Quatro estados da conexão (DEC-009, REQ-051):
- *Não conectado (M-19):* explicação do Embedded Signup e botão **Conectar WhatsApp**, que abre a janela da Meta. Um número já ligado a outra clínica é recusado.
- *Conectado (M-23):* número, nome exibido, quem conectou e quando, hora da última mensagem recebida e lista de modelos de mensagem com estado (Aprovado, Em análise). Ações: **Trocar número** e **Desconectar**. Tokens e dados de acesso à conta Meta nunca aparecem.
- *Conexão interrompida (M-24):* faixa de alerta com o horário da queda, motivo em linguagem simples (autorização removida ou expirada), o que acontece enquanto estiver desconectado (envios aparecem como “Não enviada”, o histórico é mantido) e botão **Reconectar WhatsApp**. Todos os membros veem o aviso no topo do painel; só o Responsável reconecta. Ao reconectar, o painel confere o que foi enviado no período e nada é reenviado sem escolha humana (REQ-012, REQ-013).
- *Trocar número (M-25):* tela de confirmação com o que muda (conversas e dados ficam; o número antigo deixa de funcionar pelo Tredane; contatos precisam escrever ao número novo; modelos precisam de nova aprovação) e caixa de confirmação que habilita **Continuar para a Meta**. O número novo também não pode estar ligado a outra clínica.
- *Desconectar (M-26):* diálogo de confirmação aberto a partir de M-23, que explica que a clínica deixa de receber e enviar mensagens, que conversas, contatos e agenda são mantidos e que é preciso conectar de novo para voltar a atender. O botão **Desconectar** só habilita depois de o responsável digitar o nome da clínica; **Cancelar** volta a M-23. A desconexão é registrada na auditoria da clínica (**Proposto**).

**Proposta de simplificação da configuração da agenda (Proposto, 28/10/2026; análise das jornadas no canvas «Configuração da clínica — jornadas e proposta»; não substitui M-15 a M-22 até ser aprovada).** Problema: hoje a ordem do início (Serviços primeiro) contradiz a dependência real (o serviço exige profissionais e sala), cada profissional e cada sala tem expediente próprio (mudar o sábado obriga a editar todos), o bloqueio aceita uma data só, não existe bloqueio da clínica inteira e a página de serviço mistura 12 campos. Mudanças propostas:
- *Início:* quatro passos numerados na ordem **Horário da clínica → Salas → Profissionais → Serviços**; WhatsApp, Sinal por Pix, Sugestões com IA e Equipe num segundo grupo («Atendimento»).
- *Horário da clínica:* um expediente semanal único, com interruptor por dia e «copiar segunda para os dias úteis»; salas e profissionais **herdam** esse horário e só viram «horário próprio» por escolha explícita (a tela lista quem tem horário próprio).
- *Clínica fechada:* feriados e recessos como fechamento da clínica inteira, com período «de … até».
- *Folga ou férias:* um só formulário («Para»: pessoa, sala ou clínica inteira; período «de … até»; dia inteiro ou horas; motivo em chips) que substitui «Novo bloqueio» e «Verificar impacto»: o impacto aparece antes de salvar, com a lista dos horários marcados, que continuam marcados e ganham a ação «Remarcar» na Agenda.
- *Ficha da profissional:* nome, serviços que faz (chips), horário (igual ao da clínica ou próprio), folgas e férias e «Recebe novos agendamentos» na mesma tela; alterar os serviços aqui altera «Quem faz» do serviço (já previsto em M-21).
- *Ficha da sala:* nome, pessoas ao mesmo tempo (DEC-059), frase da confirmação, **serviços feitos ali** no lugar da «categoria» em texto livre, horário herdado e «Fechar esta sala».
- *Serviço:* essencial à vista (nome, duração, preço, quem faz); intervalo depois, onde acontece, duração ajustável (DEC-051), sinal por Pix e explicação para clientes ficam em «Mais opções», com resumo de uma linha. Sem códigos internos (REQ-…) nem «Desactivar» na interface.
- *Desktop:* menu de seções, lista e ficha lado a lado, sem trocar de tela.
- **Depende de decisão e de trabalho no servidor:** horário da clínica com herança; bloqueio da clínica inteira; bloqueio com período; substituir a categoria de sala por serviços vinculados (migração dos dados atuais; DEC-014 permite exigir categoria ou recurso). Não promover a Confirmado sem a decisão do responsável pelo produto.

**Em aberto:** categorias padrão de sala e equipamento da clínica piloto; limite de recursos por clínica; quais papéis podem trocar o número do WhatsApp depois de conectado (hoje só o Responsável); se o Responsável pode se rebaixar; textos finais do Embedded Signup, que dependem do registro do Tredane como Tech Provider; motivos de desconexão que a Meta informa de fato, para ajustar as mensagens de M-24.

### TEL-07 — Estados globais

**Origem:** JRN-07; REQ-003, REQ-041, REQ-042, AC-02, AC-11, AC-12. **Estado:** Proposto.

Ver seção 6.2.


### TEL-11 — Sinal por Pix

**Estado:** telas **propostas** sobre decisões **Confirmadas** (DEC-047, [sinal.md](sinal.md), REQ-076 a REQ-082).

- **Agendar (M-04, variante M-34):** com serviço que exige sinal, o rodapé mostra “Sinal de R$ X · horário não fica reservado até o pagamento” e o botão **Enviar sinal de R$ X**. Sem conta de recebimento, o botão fica desabilitado com o motivo.
- **Na conversa (M-31):** a mensagem de cobrança aparece como enviada, com um cartão interno do estado: **Aguardando sinal** (prazo restante, **Copiar Pix**, **Cancelar cobrança**), **Pago** (confirmado para o horário), **Expirada** (**Enviar novo sinal**), **Estorno solicitado/Devolvido/Estorno falhou**.
- **Pago sem horário (M-32):** faixa de alerta na conversa e no Acompanhamento, com **Escolher outro horário** e **Devolver sinal**.
- **Recebimento (M-33):** na área Clínica, só para a responsável: estado da conta conectada, **Conectar conta** e **Desconectar**, política de cancelamento do sinal.
- **Serviço (M-16):** “Exige sinal”, tipo (valor fixo ou % do preço) e resumo do valor.
- **Cancelar compromisso com sinal pago:** o diálogo de cancelamento ganha a escolha **Devolver sinal** ou **Reter sinal**, com a política da clínica.
- **Confirmado (24/10/2026):** o compromisso é confirmado sozinho ao receber o pagamento se o horário estiver livre; prazo padrão de 2 horas, ajustável em M-33; **Confirmar sem sinal** na tela Agendar, com motivo obrigatório.
- **Em aberto:** texto do modelo de WhatsApp com a cobrança.

### TEL-10 — Suporte do Tredane (aprovação por sessão)

**Estado:** telas **propostas** sobre decisões **Confirmadas** (DEC-029 a DEC-037, REQ-060 a REQ-066, AC-27 a AC-35). A equipe do Tredane só acessa conteúdo da clínica com um pedido aprovado por um responsável, por sessão de 30 minutos, sem prorrogação.

- **Aviso e entrada (M-18).** Pedido pendente aparece como faixa no topo de Equipe, em tempo real, e também por e-mail (a decisão é sempre no painel, após login). A faixa mostra o tempo restante até a expiração de 24 h.
- **Pedido (M-27).** Mostra quem pede, em nome de quem (usuário representado), motivo, o que poderá fazer e a duração. **Aprovar suporte** e **Rejeitar**; qualquer responsável decide e a primeira decisão vale. Pedido expirado não pode ser aprovado: exige novo pedido.
- **Sessão ativa (M-28).** Tempo restante, ator, usuário representado, aprovador e histórico. **Encerrar suporte agora** está disponível a qualquer responsável. Para continuar após 30 minutos, o Tredane faz novo pedido.
- **Aviso ao usuário representado (M-29).** Faixa em Conversas enquanto houver sessão ativa, com **Solicitar encerramento**; os responsáveis são avisados e decidem (DEC-036, DEC-037).
- **Tempo real:** início, fim, expiração e revogação chegam por evento; ao reconectar, a tela reconcilia com a API. Revogada a sessão, a conexão do suporte cai na hora.
- **Em aberto:** texto exato do e-mail e do que o pedido mostra como escopo (depende da lista de ações de diagnóstico, a definir com engenharia).

## 5. Componentes

| Componente | Uso | Regras |
| --- | --- | --- |
| Cabeçalho global | Todas as telas | Nome da clínica ativa, navegação, indicador de conexão, menu do usuário (sair). |
| Item de conversa | TEL-01 | Estado da conversa por rótulo; não lido em peso de fonte + marcador com texto acessível. |
| Balão de mensagem | TEL-01 | Direção, horário, estado de envio (6.1), autor da equipe em mensagens enviadas. |
| Evento de sistema | TEL-01, TEL-06 | Texto curto centralizado com autor e hora. |
| Bloco de sugestão da IA | TEL-01 | Seção 6.3. |
| Cartão de oportunidade | TEL-03 | Menu “Mover para…”, estados “Movendo…” e falha. |
| Bloco de compromisso | TEL-04 | Altura proporcional à duração; texto mínimo visível em 15 min: hora + contato. |
| Lista de horários | TEL-05 | Botões com hora e recursos; indisponível = removido da lista, não apenas acinzentado. |
| Faixa de conexão | Global | Seção 6.2. |
| Aviso transitório (toast) | Global | Duração 5 s, pausa ao foco/hover, nunca é o único registro de uma falha que exige ação. |

## 6. Estados críticos

### 6.1 Estado de envio de mensagem

| Estado (states.md) | Rótulo na interface | Ícone | Ação disponível |
| --- | --- | --- | --- |
| Pendente | “Enviando…” | relógio | — |
| Aceita pelo provedor | “Enviada” | 1 visto | — |
| Entregue | “Entregue” | 2 vistos | — |
| Lida | “Lida” | 2 vistos preenchidos | — |
| Falhou | “Não enviada” + motivo curto | alerta | **Tentar de novo** (cria nova tentativa registrada) |
| Resultado desconhecido | “Verificando envio…” | ponto de interrogação | Nenhuma nova tentativa até reconciliação (REQ-012, AC-07) |

- O rótulo textual acompanha o ícone ao menos no foco/hover e sempre para leitores de tela. Falhou e Resultado desconhecido têm o rótulo sempre visível.
- “Enviada” não significa “Entregue”; estados tardios não regridem o rótulo (states.md).
- **Em aberto:** quais estados exibir quando o provedor não enviar confirmação (states.md, questão 5).

### 6.2 Conexão em tempo real e acesso

| Estado | Gatilho | Interface |
| --- | --- | --- |
| Conectado | WebSocket ativo e estado reconciliado | Ponto discreto “Ao vivo” no cabeçalho; nenhuma faixa. |
| Reconectando | Queda da conexão ou hibernação sem retomada imediata | Após 3 s (**Proposto**, evita piscar em quedas curtas): faixa “Reconectando… as informações podem estar desatualizadas.” Ações continuam pela API; resultados ficam como “salvando” até resposta. |
| Sincronizando | Conexão retomada; nova leitura do estado canônico | Faixa “Atualizando…” até a releitura terminar; itens duplicados por eventos repetidos não aparecem (REQ-041, AC-11). |
| Desconectado prolongado | Falhas repetidas (limite **Proposto**: 60 s) | Faixa “Sem conexão em tempo real.” com ação **Atualizar agora**. |
| Acesso revogado | Associação ou sessão invalidada | Sobreposição bloqueante: “Seu acesso a esta clínica foi encerrado.” com **Entrar novamente**. Os dados da clínica são removidos da tela e da memória do cliente; nada continua visível atrás da sobreposição (REQ-003, AC-02). |
| Sessão expirada | Autenticação vencida | “Sua sessão expirou.” com **Entrar novamente**; texto em edição no compositor é preservado localmente apenas se a política de dados permitir (**Em aberto**, DEC-011). |

### 6.3 IA assistiva

**Origem:** REQ-022, REQ-072, ADR-0004, AC-06. **Estado:** Proposto; provedor (Claude via AI Gateway) e contexto **Confirmados** (DEC-011).

- **Sugerir resposta** é acionado pelo usuário; não há sugestão automática ao abrir a conversa nem a cada mensagem recebida (**Confirmado**, DEC-040: reduz custo e o envio de contexto à IA).
- **Só quando a cliente espera resposta (Decidido, Paulo, 28/10/2026):** o botão **Sugerir resposta** e qualquer rascunho automático só aparecem quando a **última mensagem relevante é da cliente**. Se a última é nossa (enviada pela clínica), ficam ocultos até a cliente escrever de novo. Mensagens de sistema e notas internas não contam ao determinar a última mensagem.
- A sugestão aparece acima do compositor, em bloco com borda tracejada e rótulo “Sugestão da IA — revise antes de enviar”, com: **Usar e editar** (copia para o compositor, editável), **Gerar outra**, **Descartar**. No celular, o botão de IA fica à esquerda do campo e o de enviar à direita, separados para evitar toque acidental. Não há botão de envio dentro do bloco; o único caminho até o contato é o botão **Enviar** do compositor.
- **Rascunho no compositor (Proposto, 27/10/2026):** o rascunho da IA ocupa a largura toda num cartão com borda roxa, não entre os botões laterais. Cabeçalho de uma linha («Rascunho da IA · revise antes de enviar») com ícones **Ver em tela cheia** e **Descartar**; o texto cresce até ~200 px e rola por dentro (~96 px com o teclado aberto); rodapé com **Outra**, **Nota** e **Enviar**. A **nota da IA para a atendente** fica recolhida e só abre ao tocar em **Nota** (não é enviada). **Tela cheia** mostra a nota no topo, o texto em 17 px e «Enviar para {nome}» no rodapé. O texto da IA vem em parágrafos curtos (no máximo 3, linha em branco entre eles, sem frases de preenchimento), definido no prompt (`src/ai/prompt.ts`). Referência visual: M-43.
- Mensagem enviada a partir de sugestão registra a origem (“Sugestão da IA, editada por Ana”) no histórico interno, não para o contato.
- **Resumo da IA** no painel do contato: gerado sob demanda, com horário de geração e aviso “Pode conter erros. Confira na conversa.”
- Falha ou indisponibilidade: “A sugestão não está disponível agora. Você pode responder normalmente.” O compositor continua ativo (AC-06).
- **Preço (Confirmado, DEC-046, REQ-073):** só o preço cadastrado; sem preço, a sugestão não informa valor e mostra “Serviço sem preço cadastrado. A IA não informou valor.”
- **Procedimento (Confirmado, DEC-046, REQ-075):** a sugestão explica o serviço só com a “Explicação para clientes” cadastrada e mostra “Fonte: explicação cadastrada pela clínica em …”; sem explicação, não descreve. Nunca promete resultado.
- **Pergunta clínica** (contraindicação, gravidez, medicamento, diagnóstico): aviso “Assunto clínico: encaminhe a uma profissional” e nenhuma resposta de mérito (**Confirmado**, DEC-046; antes Proposto, ADR-0004).
- **Mensagem ofensiva ou fora do assunto (Confirmado, DEC-046, REQ-074):** aviso à atendente (“Mensagem ofensiva. Você não precisa responder.” ou “Fora do assunto da clínica.”) e sugestão curta e cordial que recoloca o limite. Desenhado em M-30.
- **Em aberto:** critério de detecção dos três casos acima; depende de testes com o provedor e de exemplos fictícios da clínica piloto.
- **Agendamento pela IA (Decidido, 28/10/2026, DEC-060):** a IA marca sozinha **só** depois de a própria cliente confirmar explicitamente dia, horário e procedimento; faltando algum ou havendo ambiguidade, a sugestão pergunta e nada é marcado. Revalida pelo mesmo caminho das marcações manuais; serviço com sinal não é marcado (a atendente envia o Pix pelo Agendar). A agenda, o compromisso e a conversa mostram «Marcado pela IA»; a atendente cancela pelo fluxo normal. A IA continua sem enviar mensagens, cancelar ou remarcar (antes: «A IA não agenda, cancela nem muda etapa»).

## 7. Acessibilidade e legibilidade

**Estado:** Proposto, alvo WCAG 2.1 AA. Polimento de código (skip link, landmarks, diálogos React Aria DEC-048, rótulos/teclado/filtros) cobre o que é verificável em CI/jsdom+axe; **não** substitui aceite em aparelho.

- Contraste mínimo 4,5:1 para texto, 3:1 para ícones e bordas de controles (tokens + `check_contrast.py`; axe desliga contraste no jsdom).
- Estados com ícone + texto; nunca só cor (vermelho/verde em especial) — estados de envio falhou/desconhecido na conversa.
- Todas as ações disponíveis por teclado: navegação da lista, Enter abre, Esc fecha folhas/diálogos React Aria; mover cartão pelo menu “Mover para…”; escolher horário por botões; skip link «Saltar para o conteúdo».
- Alvos de toque ≥ 44 × 44 px em CSS (`--size-touch`); **Em aberto:** medição real em ≥360 px (UX-08 / Q-UX-01).
- Atualizações em tempo real anunciadas com `aria-live="polite"` somente para o que afeta o item em foco (nova mensagem na conversa aberta, mudança de conexão); mudanças em massa na lista não são lidas uma a uma.
- Foco nunca é roubado por evento remoto (UX-07); confirmações destrutivas focam a ação segura (Cancelar).
- Texto base 16 px no celular e no tablet; 14 px permitido apenas em listas densas do desktop.

## 8. Direção visual proposta

**Estado:** **Confirmado** ([DEC-041](decisions.md), 24/10/2026), exceto a biblioteca de componentes (**Proposto**). A fonte única dos valores é [docs/design/tokens.json](../design/tokens.json) (versão 0.3.0); **esta seção não repete os valores** para não haver versões concorrentes. Resumo da direção: Inter (400/500/600) em seis tamanhos (12, 14, 16, 18, 22, 26); 25 cores por papel; cinco raios (8, 12, 16, 20, pílula); espaçamento em múltiplos de 4 px; borda de controle com 3:1 sobre o fundo. Componentes e estados: [catálogo](../design/catalog/index.html) e [components.md](../design/components.md). Ícones: [icons.md](../design/icons.md). Base de componentes: [ADR-0013](../adr/0013-design-system-components.md).

## 9. Rastreabilidade

| Tela | Jornadas | Requisitos | Cenários |
| --- | --- | --- | --- |
| TEL-01 Conversas | JRN-01, JRN-02, JRN-04, JRN-06 | REQ-010, REQ-011, REQ-012, REQ-013, REQ-020, REQ-021, REQ-022 | AC-04, AC-06, AC-07, AC-16 |
| TEL-02 Responsável | JRN-02 | REQ-020 | AC-08 |
| TEL-03 Acompanhamento | JRN-03, JRN-04 | REQ-023 | AC-08, AC-16 |
| TEL-04 Agenda | JRN-03, JRN-04, JRN-05 | REQ-030, REQ-031, REQ-034 | AC-09, AC-13 |
| TEL-05 Agendar | JRN-03 | REQ-030, REQ-031, REQ-033, REQ-052 | AC-09, AC-14 |
| TEL-06 Compromisso | JRN-05 | REQ-032, REQ-033 | AC-10 |
| TEL-07 Estados globais | JRN-07 | REQ-001, REQ-003, REQ-040, REQ-041, REQ-042 | AC-01, AC-02, AC-11, AC-12 |
| TEL-08 Entrar e escolher clínica | JRN-07, JRN-08 | REQ-005 | AC-17 |
| §6.3 IA: preço, procedimento e mensagens ofensivas | JRN-02 | REQ-073, REQ-074, REQ-075 | AC-41, AC-42, AC-43 |
| TEL-11 Sinal por Pix | JRN-16 | REQ-076 a REQ-082 | AC-44 a AC-51 |
| TEL-10 Suporte do Tredane | JRN-08 | REQ-060 a REQ-066 | AC-27 a AC-35 |
| TEL-09 Clínica (configuração) | JRN-08 | REQ-002, REQ-003, REQ-004, REQ-051, REQ-052, REQ-071 | AC-03, AC-14, AC-38, AC-39, AC-40 |

Artboards do canvas mobile: M-01 e M-02 → TEL-01; M-03 → TEL-01 (detalhes); M-04 e M-35 a M-38 → TEL-05; M-05 → TEL-03 e TEL-02 (folha inferior); M-06 e M-13 → TEL-04; M-07 e M-08 → TEL-07; M-09 e M-10 → TEL-08; M-11 e M-12 → TEL-01 (janela de 24 h e modelos); M-14 → avisos e instalação (PWA); M-30 → IA em casos especiais (§6.3); M-40 a M-42 → TEL-01 (ações da conversa e bloqueio de contato; bloqueio Decidido em 28/10/2026); M-43 → §6.3 (rascunho em cartão, Proposto); M-31 a M-34 → TEL-11; M-27 a M-29 → TEL-10; M-15 a M-26 → TEL-09 (M-20 a M-22: cadastro de profissionais, salas e equipamentos; M-19 e M-23 a M-26: WhatsApp). As telas M-01 a M-14 mostram a visão do Atendente; o Responsável vê as mesmas telas com a aba Clínica na barra inferior (M-15 a M-19).

## 10. Critérios de aceite de UX

Complementam os [cenários de aceite](acceptance.md); IDs novos e estáveis.

- **UX-01 — Estado de envio legível.** Para cada estado da tabela 6.1, um usuário identifica o estado sem depender de cor e sem abrir detalhes; “Verificando envio…” não oferece nova tentativa. Requisitos: REQ-012.
- **UX-02 — Sugestão nunca enviada sozinha.** Em teste com leitor de tela e com mouse, não existe caminho de envio dentro do bloco de sugestão; o contato só recebe texto após **Enviar** no compositor. Requisitos: REQ-022.
- **UX-03 — Conflito sem perda de trabalho.** Ao receber conflito em TEL-05, serviço e profissional continuam selecionados e a lista de horários é atualizada em até uma releitura. Requisitos: REQ-031.
- **UX-04 — Faixa de conexão.** Em desconexão simulada de mais de 3 s, a faixa aparece; ao reconectar e reconciliar, some sem recarregar a página. Requisitos: REQ-042.
- **UX-05 — Revogação limpa a tela.** Após revogação, nenhum dado da clínica permanece visível ou acessível pelo histórico do navegador sem nova autenticação. Requisitos: REQ-003.
- **UX-06 — Teclado completo.** O fluxo mensagem recebida → resposta → mover etapa → agendar é concluído apenas com teclado. Requisitos: REQ-020, REQ-023, REQ-031.
- **UX-07 — Foco preservado.** Evento remoto em outra conversa ou cartão não muda o foco nem a rolagem do usuário. Requisitos: REQ-040.
- **UX-08 — Fluxo completo no celular.** Em um aparelho de 360 px de largura, um atendente conclui mensagem recebida → resposta → mudança de etapa → agendamento confirmado sem rolagem horizontal, sem zoom e com todos os alvos de toque ≥ 44 px. Requisitos: REQ-020, REQ-022, REQ-023, REQ-031; DEC-039.

## 11. Questões abertas de UX

| ID | Questão | Bloqueia | Decide |
| --- | --- | --- | --- |
| Q-UX-01 | Quais modelos de celular, sistemas e navegadores a equipe da clínica piloto usa, e quanto do atendimento acontece no computador? (A prioridade do celular já está decidida em DEC-039.) **Confirmado em código (sintético):** skip link, `main`/`nav`, traps de foco em folhas React Aria, filtros com `aria-pressed`, estados de envio com texto+ícone, testes axe/teclado em `panel.a11y.test.tsx`. **Em aberto:** Safari iPhone / Chrome Android / VoiceOver / TalkBack / teclado virtual / fluxo UX-08 em aparelho ≥360 px da clínica. | Aceite de usabilidade e lista de aparelhos de teste. | Responsável pelo produto + clínica piloto |
| Q-UX-02 | ~~Mover para “Agendado” sem compromisso~~ Resolvida: permitido, com aviso (DEC-040). | — | — |
| Q-UX-03 | ~~Granularidade da grade~~ e ~~visão semanal~~ Resolvidas: 15 min (DEC-008) e visão de dia e de semana (DEC-040). | — | — |
| Q-UX-04 | ~~Sugestão sob demanda ou automática~~ Resolvida: só sob demanda (DEC-040). | — | — |
| Q-UX-05 | ~~Notificação de nova conversa~~ Resolvida: push via PWA instalável (DEC-040). **Proposto em M-14:** avisos de nova conversa, conversa atribuída a mim e mensagem não enviada ligados por padrão, e resposta de contato desligada. **Em aberto:** confirmar esses padrões e definir horário de silêncio; lacuna encaminhada em [pilot-gates.md](pilot-gates.md) §7 (não fechada por #18). | Tela de preferências de notificação. | Responsável pelo produto |
| Q-UX-06 | ~~Janela de 24 h~~ Resolvida: texto livre bloqueado, envio por modelo aprovado (DEC-040). **Confirmado (24/10/2026):** o piloto cadastra dois modelos, retomada de contato e confirmação de horário; lembrete de consulta fica **posterior**. M-12 mostra aviso de categoria de cobrança da Meta antes do envio, com valores da tabela vigente (não fixos na spec). **Em aberto:** texto final dos modelos e aprovação na Meta; rascunhos em [whatsapp-templates-draft.md](whatsapp-templates-draft.md) (GATE-10). Cobrança Pix: TMPL-03 no mesmo ficheiro. | Envio real fora da janela. | Engenharia + responsável pelo produto (EP-T04) |
