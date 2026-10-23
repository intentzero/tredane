# Especificação de UI/UX do painel — MVP

**Estado:** proposta de design para revisão pelo responsável pelo produto, 23 de outubro de 2026; abordagem **mobile first** confirmada na mesma data ([DEC-017](decisions.md)). **Fonte:** [MVP](../MVP.md), [atores](actors-permissions.md), [jornadas](journeys.md), [requisitos](requirements.md), [estados](states.md), [cenários de aceite](acceptance.md) e [épico #1](https://github.com/intentzero/tredane/issues/1). **Protótipos visuais** (artefatos privados no claude.ai; precisam ser compartilhados pelo dono para outras pessoas abrirem):

- **Referência principal — celular (M-01 a M-08):** canvas “Tredane — UI/UX mobile first”, https://claude.ai/artifact/D3NALDhxo5n1jZj2fqpdka.
- **Ampliação para telas largas (≥ 1280 px):** canvas “Tredane — UI/UX do MVP”, https://claude.ai/artifact/6kzR7zL5q9hs2AcvTyYDNf.

Este documento descreve telas, componentes e estados visíveis que materializam as jornadas JRN-01 a JRN-07. Ele não cria regra de negócio nova: quando uma tela depende de decisão ainda aberta, o item fica marcado como **Em aberto** e a interface não deve presumir a resposta. Todos os nomes, telefones e horários de exemplo são fictícios.

## 1. Escopo e premissas

| Item | Estado | Observação |
| --- | --- | --- |
| Usuários do painel: atendente (ACT-02) e responsável (ACT-03), com as mesmas telas de atendimento | **Confirmado** | DEC-013, DEC-015, DEC-016. Não há tela de profissional nem de operador. |
| Contato (ACT-01) só interage pelo WhatsApp | **Confirmado** | O painel nunca expõe tela ao contato. |
| Três áreas principais: Conversas, Pipeline, Agenda | **Proposto** | Derivado do fluxo principal do MVP e do ADR-0003. |
| **Mobile first:** o celular é o alvo de base e precisa concluir todo o fluxo piloto (mensagem → resposta → etapa → agendamento); tablet e desktop são ampliações progressivas | **Confirmado** | DEC-017, pedido do responsável pelo produto em 23 de outubro de 2026. Substitui a proposta anterior deste documento de desktop como alvo principal. |
| Larguras de referência: 360–430 px (base), ≥ 768 px (tablet), ≥ 1280 px (desktop) | **Proposto** | **Em aberto:** modelos e sistemas dos aparelhos da clínica piloto (Q-UX-01). Bloqueia o aceite de usabilidade, não o desenvolvimento das telas. |
| Painel como aplicação web responsiva no navegador do celular, sem app nativo no MVP, instalável como PWA com notificações push de nova conversa | **Confirmado** | DEC-017, DEC-018. O push não traz o conteúdo da mensagem. No iPhone o push exige instalar o painel na tela inicial: o fluxo de instalação precisa de uma tela de orientação (a desenhar). Suporte em cada aparelho da clínica piloto: Q-UX-01. |
| Idioma pt-BR, fuso horário da clínica em todas as datas | **Proposto** | O fuso da clínica é parte das regras de agenda ainda em aberto (DEC-008). |
| Login pelo Clerk (código por e-mail) e seletor de clínica para contas com várias clínicas | **Confirmado** | DEC-007, REQ-005, REQ-006. TEL-08 (proposta); ainda não desenhada no canvas. A tela de entrada usa o componente do Clerk estilizado com a identidade do Tredane. |
| Configuração da clínica (serviços, profissionais, salas, disponibilidade, membros) e conexão do WhatsApp, só pelo responsável | **Confirmado** quanto ao papel; telas **a desenhar** | DEC-007, DEC-009, JRN-08, REQ-052, REQ-051. Ficam numa área “Clínica” visível só ao responsável. |
| App de superadmin | **Fora desta spec** | DEC-012, [ADR-0006](../adr/0006-superadmin-control-plane.md). App separado, com spec própria quando for desenhado. |
| Relatórios, campanhas, prontuário, pagamentos, bot autônomo | **Fora do MVP** | Não aparecem na navegação, nem como item desabilitado. |

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
Cabeçalho global: [clínica ativa ▾ troca] · Conversas · Pipeline · Agenda · [Clínica: só responsável] · [indicador de conexão] · [usuário]
├── TEL-01 Conversas (lista + conversa aberta + painel do contato)
│     └── TEL-05 Agendar horário (painel lateral a partir da conversa)
├── TEL-03 Pipeline (quadro por etapa)
│     └── abre a conversa vinculada em TEL-01
└── TEL-04 Agenda (dia por profissional / por sala)
      └── TEL-06 Detalhe do compromisso (cancelar, reagendar)
TEL-07 Estados globais: conexão, sincronização, acesso revogado, erro de carregamento
```

- **Proposto:** URLs estáveis por área e item (`/conversas/:id`, `/pipeline`, `/agenda?dia=`), para retomar o trabalho após recarregar. O ID na URL nunca concede acesso por si: um ID de outra clínica mostra o estado “Não encontrado” sem revelar se o item existe (REQ-001, AC-01).
- **Proposto:** contadores na navegação (ex.: conversas novas) vêm do estado canônico da clínica e são reconciliados na reconexão.

### 3.1 Padrões de layout mobile first

**Estado:** Proposto, decorrente de DEC-017.

| Largura | Navegação | Conversas | Pipeline | Agenda |
| --- | --- | --- | --- | --- |
| Base (360–767 px) | Barra inferior com Conversas, Pipeline e Agenda; badge de novas conversas. | Lista em tela cheia → conversa em tela cheia (sem barra inferior) → “Detalhes” em tela própria. | Abas roláveis por etapa; cartões em lista; mover pelo botão **Mover** em folha inferior. | Lista cronológica do dia com filtros por profissional e sala; espaços livres com **Agendar**. |
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
- Cabeçalho: contato, estado da conversa, responsável com ação **Assumir** (quando não é o usuário) ou **Transferir**, ação **Encerrar**.
- Linha do tempo em ordem persistida: mensagens recebidas (esquerda), enviadas (direita, com estado de envio — seção 6.1), eventos de sistema centralizados (“Bruno assumiu a conversa”, “Etapa: Horário proposto”, “Compromisso confirmado — sex 14:00”). O histórico corresponde ao registro persistido após recarga ou reconexão (REQ-021).
- Mídia recebida não suportada ou indisponível aparece como bloco “Anexo não disponível” com motivo, nunca como mensagem vazia (JRN-01).
- Mensagem recebida cujo processamento falhou aparece como “Mensagem não processada — a equipe técnica foi avisada” somente se houver registro do evento; conteúdo não persistido não é exibido como íntegro (states.md).
- Compositor: campo de texto multilinha, botão **Enviar** (Ctrl/⌘ + Enter), botão **Sugerir resposta** (IA). Envio de anexo pela equipe: **Em aberto** (DEC-011).
- **Janela de 24 h (Confirmado, DEC-018):** quando a última mensagem do contato tem mais de 24 h, o campo de texto livre fica bloqueado com o aviso “Fora da janela de 24 h do WhatsApp” e o botão **Escolher modelo** abre a lista de modelos aprovados pela Meta (retomada de contato, lembrete e confirmação de horário), com prévia e preenchimento de variáveis. O envio de modelo tem os mesmos estados de envio (6.1). A sugestão da IA continua disponível, mas só pode ser enviada dentro da janela ou convertida em modelo. **Pendente:** quais modelos cadastrar e custo por modelo (EP-T04). Esse estado ainda não está desenhado no canvas.

**Painel do contato e oportunidade**
- Dados do contato: nome, telefone mascarado por padrão. Campos adicionais: **Em aberto** (DEC-011, coleta mínima).
- Oportunidade: etapa atual com seletor, responsável, último contato, próximo compromisso.
- Bloco **Resumo da IA** (seção 6.3).
- Compromissos do contato: próximo e anteriores, com estado. Ação **Agendar horário** abre TEL-05.

**Tempo real:** conversa criada/atribuída/encerrada; mensagem recebida; mudança de estado de envio; etapa alterada; compromisso confirmado/cancelado (states.md, “Eventos de interface”).

**Vazios e erros:** sem conversas → “Nenhuma conversa ainda. Mensagens enviadas ao WhatsApp da clínica aparecem aqui.” Filtro sem resultado → “Nenhuma conversa neste filtro” com ação “Limpar filtro”. Falha ao carregar → mensagem com ação “Tentar de novo”, sem lista parcial apresentada como completa.

### TEL-02 — Disputa e transferência de responsável

**Origem:** JRN-02 (alternativas), REQ-020, AC-08. **Estado:** Proposto.

- **Assumir** fica em estado “Assumindo…” até a resposta. Se outra pessoa assumiu antes, o servidor decide e a interface mostra: “Bruno assumiu esta conversa antes de você.” com ação **Assumir mesmo assim**. Como os dois perfis podem atribuir e transferir (matriz de permissões), a ação é permitida e fica registrada no histórico como transferência.
- **Transferir** abre lista de membros da clínica ativa; nunca mostra membros de outra clínica.
- Reatribuição não altera o estado da conversa (states.md).

### TEL-03 — Pipeline

**Origem:** JRN-03, JRN-04; REQ-023. **Estado:** Proposto.

- Quadro com as etapas propostas: **Novo contato → Em atendimento → Horário proposto → Agendado → Concluído** e coluna **Perdido** separada visualmente à direita. As etapas vêm da configuração da clínica; a interface não fixa nomes no código de apresentação, para permitir etapas configuráveis depois (MVP).
- Cartão: nome do contato, responsável, último contato (relativo), próximo compromisso (ou “Sem compromisso”), indicador de mensagem pendente/falha.
- No celular (M-05), uma etapa por vez em abas roláveis com contagem; o botão **Mover** abre uma folha inferior com as etapas. No desktop, arrastar entre colunas **ou** menu **Mover para…** (alternativa acessível por teclado). O cartão fica em estado “Movendo…” até confirmação; em falha, volta à coluna original com aviso.
- Mover para **Horário proposto** mostra a nota “Etapa da negociação — não reserva horário na agenda” (states.md).
- Mover para **Agendado** sem compromisso vinculado é **permitido** (Confirmado, DEC-018): o cartão exibe “Sem compromisso vinculado” e oferece **Agendar horário**; mudar etapa nunca cria compromisso.
- Filtros: responsável, “Minhas”, busca por nome. Relatórios e totais avançados ficam **Fora do MVP**.
- Clique no cartão abre a conversa vinculada (TEL-01).
- **Tempo real:** etapa alterada e responsável alterado movem o cartão nas outras sessões, com destaque breve (1,5 s) no cartão alterado; o cartão que o usuário está arrastando não é movido por evento remoto até soltar — após soltar, prevalece o estado do servidor.

### TEL-04 — Agenda

**Origem:** JRN-03, JRN-04, JRN-05; REQ-030, REQ-031, REQ-034. **Estado:** Proposto; regras de disponibilidade **Em aberto** (DEC-008).

- No celular (M-06), lista cronológica do dia: compromissos, espaços livres (com **Agendar**), bloqueios e fora do expediente, filtrável por profissional ou sala. A partir do tablet, visão **Dia** em grade com colunas por profissional e linhas de 15 min (granularidade de 15 min, **Confirmada** em DEC-008). Alternância **Por profissional / Por sala** mostra a mesma agenda pelo outro recurso, porque o horário ocupa os dois (DEC-014).
- Compromisso: horário, contato, serviço, sala/equipamento como etiqueta, estado (Confirmado / Cancelado / Concluído). Cancelados ficam ocultos por padrão com filtro “Mostrar cancelados”.
- Bloqueios e fora de expediente em hachura com rótulo (“Bloqueado”, “Fora do expediente”), não só cor.
- Navegação de dia (anterior/hoje/próximo) e seletor de data. **Visão semanal (Confirmado, DEC-018):** alternância Dia/Semana; no tablet e no desktop, grade de sete dias com os compromissos por dia; no celular, lista agrupada por dia, com filtros por profissional ou sala. Clicar num dia leva à visão do dia. A visão semanal ainda não está desenhada no canvas.
- Clique em espaço livre abre TEL-05 com horário pré-preenchido; clique em compromisso abre TEL-06.
- **Tempo real:** compromisso confirmado/cancelado/reagendado aparece ou some nas outras sessões; se o usuário está com TEL-05 aberto e o horário escolhido é ocupado por evento remoto, o horário é marcado como indisponível imediatamente (antes mesmo de tentar confirmar).

### TEL-05 — Agendar horário

**Origem:** JRN-03; REQ-030, REQ-031, REQ-033. **Estado:** Proposto.

Tela cheia no celular (M-04), com o botão **Confirmar** fixo no rodapé mostrando dia e hora escolhidos; painel lateral no desktop. Abre da conversa, do cartão do pipeline ou de um espaço da agenda, sempre ligado a um contato e a uma oportunidade. No celular, o dia é escolhido numa faixa horizontal de datas.

1. **Serviço** — seleção; exibe duração e recursos exigidos (“60 min · profissional + sala com laser”). Serviços e durações vêm da configuração da clínica (**Em aberto**, REQ-052).
2. **Profissional** — “Qualquer disponível” ou um nome.
3. **Data e horários disponíveis** — somente intervalos em que profissional **e** sala/equipamento exigidos estão livres (AC-09). Cada horário mostra o recurso que será usado.
4. **Revisão** — contato, serviço, data/hora, profissional, sala; opção **Enviar confirmação ao contato pelo WhatsApp** com prévia editável do texto.
5. **Confirmar agendamento** → estado “Confirmando…”.

Resultados:
- **Sucesso:** “Compromisso confirmado.” Conversa, pipeline e agenda passam a mostrar o compromisso. Se a mensagem de confirmação foi pedida, ela aparece na conversa com o próprio estado de envio; falha nesse envio aparece na mensagem, não no compromisso (REQ-033).
- **Conflito:** “Esse horário acabou de ser ocupado (Sala 2). Escolha outro horário.” O painel mantém serviço e profissional selecionados, atualiza a lista de horários e não cria reserva (REQ-031).
- **Erro de rede/servidor:** “Não foi possível confirmar. Nada foi reservado.” com **Tentar de novo** — somente quando o servidor garantir que nada foi gravado; caso o resultado seja incerto, a interface relê a agenda antes de permitir nova tentativa. **Proposto**, depende do contrato da API (ADR-0005).
- Sem configuração mínima de serviços/recursos: painel mostra “A agenda desta clínica ainda não foi configurada” e não oferece horários (REQ-052, AC-14).

A IA não preenche nem confirma este painel no MVP (ADR-0004).

### TEL-06 — Detalhe, cancelamento e reagendamento

**Origem:** JRN-05; REQ-032, REQ-033. **Estado:** Proposto.

- Detalhe: contato, serviço, horário, profissional, sala, estado, quem confirmou e quando, histórico de alterações, link para a conversa.
- **Cancelar:** confirmação em diálogo com motivo obrigatório escolhido de uma lista (DEC-008); o botão de confirmar fica desabilitado até escolher. Não há prazo mínimo, então nenhuma regra de prazo é exibida.
- **Reagendar** também pede o motivo antes de confirmar o novo horário.
- **Reagendar:** abre TEL-05 com dados preenchidos. O compromisso antigo continua confirmado até o novo ser confirmado; em conflito, a mensagem deixa claro: “O compromisso de sex 14:00 continua mantido.” (AC-10).
- Alterado por outra pessoa enquanto aberto: “Este compromisso foi alterado por Bruno às 10:42.” e o detalhe recarrega; a ação em curso é cancelada sem gravar.
- Comunicação ao contato é opcional e separada, igual a TEL-05.

### TEL-08 — Entrar e escolher a clínica

**Origem:** DEC-007; REQ-005, REQ-006; AC-17. **Estado:** Proposto.

- **Entrar:** fluxo do Clerk com código por e-mail: campo de e-mail → campo do código, com preenchimento automático no celular (`autocomplete="one-time-code"`) e reenvio. A mensagem de erro não revela se o e-mail tem conta. Textos e cores seguem a spec; o comportamento é o do Clerk.
- **Escolher clínica:** lista com nome de cada clínica e papel (Atendente/Responsável). Com uma só clínica, a tela é pulada.
- **Trocar de clínica:** tocar no nome da clínica no cabeçalho abre a mesma lista. Ao trocar, a tela mostra “Abrindo Clínica B…”, descarta os dados da anterior e reconecta o tempo real; texto não enviado no compositor é descartado com confirmação.
- Clínica removida do acesso some da lista; se era a ativa, aparece o estado “Acesso encerrado” (6.2).

### TEL-07 — Estados globais

**Origem:** JRN-07; REQ-003, REQ-041, REQ-042, AC-02, AC-11, AC-12. **Estado:** Proposto.

Ver seção 6.2.

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

**Origem:** REQ-022, REQ-060, ADR-0004, AC-06. **Estado:** Proposto; provedor (Claude via AI Gateway) e contexto **Confirmados** (DEC-011).

- **Sugerir resposta** é acionado pelo usuário; não há sugestão automática ao abrir a conversa nem a cada mensagem recebida (**Confirmado**, DEC-018: reduz custo e o envio de contexto à IA).
- A sugestão aparece acima do compositor, em bloco com borda tracejada e rótulo “Sugestão da IA — revise antes de enviar”, com: **Usar e editar** (copia para o compositor, editável), **Gerar outra**, **Descartar**. No celular, o botão de IA fica à esquerda do campo e o de enviar à direita, separados para evitar toque acidental. Não há botão de envio dentro do bloco; o único caminho até o contato é o botão **Enviar** do compositor.
- Mensagem enviada a partir de sugestão registra a origem (“Sugestão da IA, editada por Ana”) no histórico interno, não para o contato.
- **Resumo da IA** no painel do contato: gerado sob demanda, com horário de geração e aviso “Pode conter erros. Confira na conversa.”
- Falha ou indisponibilidade: “A sugestão não está disponível agora. Você pode responder normalmente.” O compositor continua ativo (AC-06).
- Pergunta clínica (contraindicação, diagnóstico): **Proposto** — a sugestão traz o aviso “Assunto clínico: encaminhe a um profissional” e não responde o mérito (ADR-0004). Critério de detecção depende do provedor.
- A IA não agenda, cancela nem muda etapa (Fora do MVP).

## 7. Acessibilidade e legibilidade

**Estado:** Proposto, alvo WCAG 2.1 AA.

- Contraste mínimo 4,5:1 para texto, 3:1 para ícones e bordas de controles.
- Estados com ícone + texto; nunca só cor (vermelho/verde em especial).
- Todas as ações disponíveis por teclado: navegação da lista com setas, Enter abre, Esc fecha painéis; mover cartão pelo menu “Mover para…”; escolher horário por botões.
- Alvos de toque ≥ 44 × 44 px em tablet e celular.
- Atualizações em tempo real anunciadas com `aria-live="polite"` somente para o que afeta o item em foco (nova mensagem na conversa aberta, mudança de conexão); mudanças em massa na lista não são lidas uma a uma.
- Foco nunca é roubado por evento remoto.
- Texto base 16 px no celular e no tablet; 14 px permitido apenas em listas densas do desktop.

## 8. Direção visual proposta

**Estado:** Proposto. Não há design system definido; os valores abaixo são o ponto de partida do protótipo e podem ser trocados sem mudar a especificação funcional.

| Token | Valor | Uso |
| --- | --- | --- |
| `--bg` | `#F6F6F4` | Fundo do app |
| `--surface` | `#FFFFFF` | Painéis, cartões |
| `--ink` | `#1C1E21` | Texto principal |
| `--muted` | `#5B616B` | Texto secundário (≥ 4,5:1 sobre branco) |
| `--line` | `#E2E3E5` | Divisórias |
| `--accent` | `#2F5BD3` | Ação primária, foco |
| `--ai` | `#6B3FD4` | Marcação de conteúdo de IA |
| `--ok` | `#1F7A4D` | Confirmado, entregue |
| `--warn` | `#8F5600` | Verificando, reconectando |
| `--danger` | `#B42318` | Falha, conflito |

Tipografia: Inter (400/500/600), escala 12/14/16/20/24. Raio 8 px em cartões, 6 px em controles. Espaçamento em múltiplos de 4 px.

## 9. Rastreabilidade

| Tela | Jornadas | Requisitos | Cenários |
| --- | --- | --- | --- |
| TEL-01 Conversas | JRN-01, JRN-02, JRN-04, JRN-06 | REQ-010, REQ-011, REQ-012, REQ-013, REQ-020, REQ-021, REQ-022 | AC-04, AC-06, AC-07, AC-16 |
| TEL-02 Responsável | JRN-02 | REQ-020 | AC-08 |
| TEL-03 Pipeline | JRN-03, JRN-04 | REQ-023 | AC-08, AC-16 |
| TEL-04 Agenda | JRN-03, JRN-04, JRN-05 | REQ-030, REQ-031, REQ-034 | AC-09, AC-13 |
| TEL-05 Agendar | JRN-03 | REQ-030, REQ-031, REQ-033, REQ-052 | AC-09, AC-14 |
| TEL-06 Compromisso | JRN-05 | REQ-032, REQ-033 | AC-10 |
| TEL-07 Estados globais | JRN-07 | REQ-001, REQ-003, REQ-040, REQ-041, REQ-042 | AC-01, AC-02, AC-11, AC-12 |
| TEL-08 Entrar e escolher clínica | JRN-07, JRN-08 | REQ-005, REQ-006 | AC-17 |

Artboards do canvas mobile: M-01 e M-02 → TEL-01; M-03 → TEL-01 (detalhes); M-04 → TEL-05; M-05 → TEL-03 e TEL-02 (folha inferior); M-06 → TEL-04; M-07 e M-08 → TEL-07.

## 10. Critérios de aceite de UX

Complementam os [cenários de aceite](acceptance.md); IDs novos e estáveis.

- **UX-01 — Estado de envio legível.** Para cada estado da tabela 6.1, um usuário identifica o estado sem depender de cor e sem abrir detalhes; “Verificando envio…” não oferece nova tentativa. Requisitos: REQ-012.
- **UX-02 — Sugestão nunca enviada sozinha.** Em teste com leitor de tela e com mouse, não existe caminho de envio dentro do bloco de sugestão; o contato só recebe texto após **Enviar** no compositor. Requisitos: REQ-022.
- **UX-03 — Conflito sem perda de trabalho.** Ao receber conflito em TEL-05, serviço e profissional continuam selecionados e a lista de horários é atualizada em até uma releitura. Requisitos: REQ-031.
- **UX-04 — Faixa de conexão.** Em desconexão simulada de mais de 3 s, a faixa aparece; ao reconectar e reconciliar, some sem recarregar a página. Requisitos: REQ-042.
- **UX-05 — Revogação limpa a tela.** Após revogação, nenhum dado da clínica permanece visível ou acessível pelo histórico do navegador sem nova autenticação. Requisitos: REQ-003.
- **UX-06 — Teclado completo.** O fluxo mensagem recebida → resposta → mover etapa → agendar é concluído apenas com teclado. Requisitos: REQ-020, REQ-023, REQ-031.
- **UX-07 — Foco preservado.** Evento remoto em outra conversa ou cartão não muda o foco nem a rolagem do usuário. Requisitos: REQ-040.
- **UX-08 — Fluxo completo no celular.** Em um aparelho de 360 px de largura, um atendente conclui mensagem recebida → resposta → mudança de etapa → agendamento confirmado sem rolagem horizontal, sem zoom e com todos os alvos de toque ≥ 44 px. Requisitos: REQ-020, REQ-022, REQ-023, REQ-031; DEC-017.

## 11. Questões abertas de UX

| ID | Questão | Bloqueia | Decide |
| --- | --- | --- | --- |
| Q-UX-01 | Quais modelos de celular, sistemas e navegadores a equipe da clínica piloto usa, e quanto do atendimento acontece no computador? (A prioridade do celular já está decidida em DEC-017.) | Aceite de usabilidade e lista de aparelhos de teste. | Responsável pelo produto + clínica piloto |
| Q-UX-02 | ~~Mover para “Agendado” sem compromisso~~ Resolvida: permitido, com aviso (DEC-018). | — | — |
| Q-UX-03 | ~~Granularidade da grade~~ e ~~visão semanal~~ Resolvidas: 15 min (DEC-008) e visão de dia e de semana (DEC-018). | — | — |
| Q-UX-04 | ~~Sugestão sob demanda ou automática~~ Resolvida: só sob demanda (DEC-018). | — | — |
| Q-UX-05 | ~~Notificação de nova conversa~~ Resolvida: push via PWA instalável (DEC-018). **Em aberto:** quais eventos notificam além de nova conversa (atribuída a mim, envio falhou) e horário de silêncio. | Tela de preferências de notificação. | Responsável pelo produto |
| Q-UX-06 | ~~Janela de 24 h~~ Resolvida: texto livre bloqueado, envio por modelo aprovado (DEC-018). **Em aberto:** quais modelos cadastrar e o custo por modelo. | Envio real fora da janela. | Engenharia + responsável pelo produto (EP-T04) |
