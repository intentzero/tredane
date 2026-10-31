# Índice de telas (mocks mobile)

Cada linha liga um mock a sua especificação. **A especificação manda:** em caso de divergência entre mock e [UI/UX](../product/ux-ui.md), [requisitos](../product/requirements.md) ou [decisões](../product/decisions.md), siga o texto e registre a divergência (ver [README](README.md#divergências-conhecidas-entre-mocks-e-especificação)). Nome do arquivo = `mobile/<Arquivo>.dc.html`; preview = `mobile/previews/<ID>-<Arquivo>.png`. Todos os dados são fictícios.

**Estado dos mocks:** todos **Proposto**. “Interativo” = o mock tem alguma interação de protótipo (alternar passo ou aba); as demais telas são estáticas e mostram um único estado.

## Fluxo principal

| ID | Arquivo | Tela da spec | Jornadas · Requisitos · Cenários | Mostra | Navega para |
| --- | --- | --- | --- | --- | --- |
| M-01 | `Main` | TEL-01 lista | JRN-01, JRN-02, JRN-04 · REQ-010, REQ-020 · AC-04, AC-16 | Filtros (Todas, Novas, Minhas, Sem responsável, Encerradas), busca, item com estado da conversa, responsável e etapa, item com “Resposta não enviada”, badge de nova conversa na barra | M-02, M-05, M-06 |
| M-54 | `ConversasListaProposta` | TEL-01 lista (**Confirmado**, Paulo 31/10/2026, Opção A) | JRN-01 · REQ-010 · AC-04 | Shell intacto (marca, clínica, Ao vivo, avisos, conta, 4 abas do Responsável); busca sunken; chips com contador; **lista contínua full-bleed** (sem cartão flutuante), densidade v0.4.0. Implementado em `panel.css`. Referência visual da lista no celular (M-01 permanece no canvas) | M-02 |
| M-02 | `Conversa` | TEL-01 conversa | JRN-02 · REQ-012, REQ-021, REQ-022 · AC-06 | **Redesenhada (Proposto, 28/10/2026; DEC-062 a DEC-066).** Cabeçalho com 3 alvos (voltar, contato com estado e responsável, ⋮); faixa de contexto com a **etapa só para leitura** (muda sozinha) e **Agendar**; histórico com estados de envio e evento de sistema; cartão da sugestão da IA com o texto completo e **Enviar** (1 toque), Editar, Gerar outra e Descartar; campo com seta desativada enquanto vazio. Menu ⋮ → folha inferior M-40 | M-01, M-03, M-40 |
| M-03 | `Contato` | TEL-01 detalhes | JRN-02, JRN-03 · REQ-023 · AC-08 | Etapa da oportunidade (seletor), aviso “não reserva horário”, resumo da IA, compromissos, botão fixo **Agendar horário** | M-02, M-04 |
| M-04 | `Agendar` | TEL-05 | JRN-03 · REQ-030, REQ-031, REQ-033 · AC-09, AC-10 | Cabeçalho com contato real, serviços em cartões, profissionais em botões («Qualquer» primeiro), 5 dias com **Ver calendário**, horários em grade de 4 colunas (Manhã/Tarde), duração fixa do procedimento, sem botões −/+ (DEC-076, 29/10/2026); com variantes, escolha de uma ou mais antes da grade, título com o plural do tipo e a soma no horário (DEC-078, DEC-079, 30/10/2026), rodapé fixo com resumo e **Revisar e confirmar** (Proposto) | M-03, M-35 No desktop (DEC-074, Confirmado) o mesmo fluxo abre como painel de 420 px ao lado da conversa; o mock continua sendo a referência do conteúdo. |
| M-05 | `Pipeline` | TEL-03, TEL-02 | JRN-03, JRN-04 · REQ-023 · AC-08 | Título e aba **Acompanhamento** (DEC-045; o arquivo mantém o nome); abas por etapa com contagem, cabeçalho «N nesta etapa · M em andamento», cartões com «Sem horário marcado» e botão **Abrir conversa** (27/10/2026); **folha inferior “Mover para…”** aberta, com aviso de que “Horário proposto” não reserva e de que “Agendado” sem compromisso é permitido | M-02, M-01, M-06 |
| M-06 | `Agenda` | TEL-04 (dia) | JRN-03, JRN-04 · REQ-034 · AC-09, AC-13 | Lista do dia por horário, compromisso destacado como alterado por outra sessão, espaço livre com **Agendar**, bloqueio e fora do expediente | M-04, M-01, M-05 |
| M-07 | `Reconectando` | TEL-07, 6.1, 6.2 | JRN-06, JRN-07 · REQ-012, REQ-042 · AC-07, AC-11 | Faixa **Reconectando**, os seis estados de envio (Enviando, Enviada, Entregue, Lida, Não enviada + Tentar de novo, Verificando envio), IA indisponível | M-01 |
| M-08 | `Revogado` | TEL-07, 6.2 | JRN-07 · REQ-003 · AC-02 | “Seu acesso a esta clínica foi encerrado” em tela cheia, **Entrar novamente** | — |

## Entrada, clínicas, WhatsApp e avisos

| ID | Arquivo | Tela da spec | Jornadas · Requisitos · Cenários | Mostra | Navega para |
| --- | --- | --- | --- | --- | --- |
| M-09 | `Entrar` (interativo) | TEL-08 | JRN-07, JRN-08 · REQ-005 · AC-17 | **Confirmado (Paulo 31/10/2026, «Faz»):** marca horizontal centrada (hero), formulário e «Sem convite?» num único bloco vertical centrado sobre fundo `surface.app` com mancha `primary.tint`. Passo e-mail → código (`autocomplete="one-time-code"`). Tela real: Clerk estilizado (`ClerkLogin`); synthetic alinhado. Desktop: `desktop/Entrar.dc.html` (coluna ~400 px) | M-10 |
| M-10 | `Clinicas` | TEL-08 | JRN-07 · REQ-005 · AC-17 | Escolha da clínica com papel em cada uma; aparece só com mais de uma clínica | M-01 |
| M-11 | `JanelaFechada` | TEL-01, DEC-040 | JRN-02 · REQ-012 | Fora da janela de 24 h: texto livre **bloqueado**, aviso, **Escolher modelo** | M-12 |
| M-12 | `Modelos` | TEL-01, DEC-040 | JRN-02 · REQ-012 | Lista de modelos aprovados, campos a preencher, prévia não editável, aviso de custo, **Enviar modelo** | M-11 |
| M-13 | `Semana` | TEL-04 (semana) | JRN-04 · REQ-034 | Alternador Dia/Semana, lista agrupada por dia, dia com bloqueio, dia atual destacado | M-06 |
| M-14 | `Instalar` | PWA e avisos, DEC-040 | — · Q-UX-05 | Passo a passo de instalação no iPhone, quatro avisos configuráveis, **Ativar avisos** | M-01 |

## Área Clínica (só o responsável)

| ID | Arquivo | Tela da spec | Jornadas · Requisitos · Cenários | Mostra | Navega para |
| --- | --- | --- | --- | --- | --- |
| M-15 | `Clinica` | TEL-09 início | JRN-08 · REQ-052 · AC-14 | Faixa “Falta 1 passo para atender”, lista de áreas com estado (Pronto, Falta conectar), barra inferior com 4 abas; cartões **Sugestões com IA** e **Limites das automações** (owner; valores Confirmados Paulo 29/10/2026) | M-16, M-20, M-17, M-18, M-19, M-33 |
| M-16 | `Servico` | TEL-09 serviço | JRN-08 · REQ-052, REQ-075, REQ-096 · AC-38, AC-43, AC-70 · DEC-084 | Nome, formato, duração e preço; chips «Quem faz» e «Onde acontece» (obrigatório à vista, DEC-082); resumo «Como fica na agenda»; linhas Intervalo, Para quem, Sinal Pix, Tempo (→ M-53), Dias e horas, Explicação IA; variantes/combos (DEC-078–080) | M-15, M-53 |
| M-52 | `Conferir` | TEL-09 Conferir (DEC-085) | JRN-08 · REQ-052 · DEC-042, DEC-085 | Só leitura no início da Clínica: por serviço, quem faz, onde, quando, motivo se incompleto (do servidor), atalho à ficha, próximo horário se pronto | M-15, M-16, M-21, M-22 |
| M-53 | `TempoServico` | TEL-09 Tempo (DEC-084) | JRN-08 · DEC-077, DEC-084 | Folha Tempo: Céu e Temperatura (Tanto faz / Sol / Chuva; Acima/Abaixo + °C); sem percentagem de chuva | M-16 |
| M-17 | `Horarios` | TEL-09 horários | JRN-08 · REQ-030 · AC-38 | **Proposto, implementado em #224 (celular e desktop):** resumo («Aberta agora»), sete dias com editor único, folgas e fechamentos na mesma página com confirmação ao remover, barra de salvar condicional, «Quem fica fora» em multi-seleção e motivo em dropdown (um bloqueio por pessoa), aviso sobre compromissos existentes. Mocks: `mobile/Horarios.dc.html` (visão geral) e `desktop/Horarios.dc.html` (moldura #211 com painel #212) | M-15, M-49, M-50 |
| M-18 | `Equipe` | TEL-09 equipe | JRN-08 · REQ-002, REQ-003, REQ-004 · AC-02, AC-03 | Membros e papéis (responsáveis só leitura), convites pendentes (reenviar com espera, cancelar), faixa de pedido de suporte, “Suporte do Tredane”, **Convidar atendente** | M-15, M-27, M-28 |
| M-19 | `ConectarWhatsapp` | TEL-09 WhatsApp | JRN-08 · REQ-051 | **Não conectado**, passos do Embedded Signup, **Conectar WhatsApp**, **Pedir ajuda** | M-15 |
| M-20 | `Recursos` (interativo) | TEL-09 recursos | JRN-08 · REQ-052 · AC-38 | Abas Profissionais e Salas; listas com estado; botões de adicionar. **Proposto (#226):** cabeçalho comum com contagem, chave «Mostrar inativas» e «Adicionar» no topo; linha com serviços e expediente de hoje (Profissionais) ou capacidade e uso (Salas); selos só nas exceções («Inativa», «Falta horário»). O mock mobile (`Recursos`) já segue isso; a lista de Serviços ainda não tem mock próprio (a referência é o código e a spec). No desktop (≥ 1280 px) a Clínica usa coluna de contexto com grupos e selo «N pendência(s)» (#226; sem mock de desktop no repositório) | M-21, M-22, M-15 |
| M-21 | `Profissional` | TEL-09 recursos | JRN-08 · REQ-052 · AC-38 · DEC-083 | Nome, serviços em chips, horário, folgas; barra de rascunho «N alterações · Descartar · Salvar» com efeito noutras fichas; diálogo ao fechar com alterações; sem sala na ficha (DEC-082); sem login | M-20, M-17 |
| M-22 | `Sala` | TEL-09 recursos | JRN-08 · REQ-052 · AC-38 · DEC-083, DEC-084 | Tipo segmentado; capacidade −/+ 1–50; modos em cartões; «Mesmo sexo» só se capacidade > 1; frase WhatsApp e manutenção em «Mais»; serviços feitos aqui com aviso; barra de rascunho e diálogo ao fechar | M-20 |
| M-23 | `WhatsappConectado` | TEL-09 WhatsApp | REQ-051 · AC-40 | **Conectado**, número, quem conectou, última mensagem, modelos e estado, Trocar número, Desconectar | M-25, M-26, M-15 |
| M-24 | `WhatsappInterrompido` | TEL-09 WhatsApp | REQ-012, REQ-013, REQ-051 · AC-39 | **Conexão interrompida**, motivo, o que acontece enquanto estiver desconectado, **Reconectar** | M-15 |
| M-44 | `ClinicaSemana` · `HorarioSemana` · `PessoaAbas` (interativos) | TEL-09 redesenho integrado (**Proposto**) | JRN-08 · REQ-030, REQ-052 · AC-38 | Resumo com a semana em barras; Horário com Semana (faixas por dia, pessoas por cor) e Calendário (folgas e fechamentos numa lista só); ficha da pessoa em abas Serviços · Horário · Folgas. Desktop: `desktop/ClinicaEspaco`, `desktop/ClinicaCalendario` | M-15, M-17, M-21 |
| M-25 | `WhatsappTrocar` | TEL-09 WhatsApp | REQ-050, REQ-051 · AC-40 | O que muda, caixa de confirmação, botão **Continuar para a Meta** desabilitado até marcar | M-23 |
| M-26 | `WhatsappDesconectar` | TEL-09 WhatsApp | REQ-051 | Diálogo de confirmação: digitar o nome da clínica para habilitar **Desconectar** | M-23 |
| M-27 | `SuportePedido` | TEL-10 | REQ-060 · AC-27, AC-28, AC-29 | Pedido pendente: quem pede, em nome de quem, motivo, o que poderá, expiração (até 24 h), **Aprovar suporte** / **Rejeitar** | M-18, M-28 |
| M-28 | `SuporteAtivo` | TEL-10 | REQ-061, REQ-062, REQ-063, REQ-064 · AC-30, AC-31, AC-32, AC-33, AC-34 | Sessão ativa de 30 min: restante, ator, usuário representado, aprovador, histórico, **Encerrar suporte agora** | M-18 |
| M-29 | `SuporteAviso` | TEL-10 | REQ-065, REQ-066 · AC-34, AC-35 | Aviso ao usuário representado (faixa em Conversas) com **Solicitar encerramento** | — |
| M-30 | `IaCasos` | §6.3 IA | JRN-02 · REQ-073, REQ-074, REQ-075 · AC-41, AC-42, AC-43 | Referência de três estados do bloco de IA: serviço sem preço, mensagem ofensiva, procedimento com explicação da clínica e assunto clínico | M-02 |
| M-31 | `SinalConversa` | TEL-11 | JRN-16 · REQ-078, REQ-081, REQ-082 · AC-46, AC-49, AC-50 | Mensagem de cobrança enviada, cartão **Aguardando sinal** (horário, prazo, recebe na conta da clínica, aviso de horário não reservado), **Copiar Pix**, **Cancelar cobrança**; demais estados do cartão | M-02, M-32 |
| M-32 | `SinalSemHorario` | TEL-11 | JRN-16 · REQ-079, REQ-080 · AC-47, AC-48 | Alerta **Sinal pago, mas o horário foi ocupado**, próximos horários, **Confirmar com o sinal pago**, **Devolver sinal** | M-02 |
| M-33 | `Recebimento` | TEL-11 | JRN-16 · REQ-076, REQ-077 · AC-44, AC-45 | Conta da clínica conectada (Woovi / OpenPix, DEC-049), política de cancelamento do sinal, prazo para pagar (padrão 2 horas), serviços com sinal; só responsável | M-15 |
| M-34 | `AgendarSinal` | TEL-11 | JRN-16 · REQ-078 · AC-46, AC-51 | Variante de M-04 com serviço que exige sinal: aviso de valor e de horário não reservado, folha com valor, prazo (padrão 2 h, configurável), **Enviar sinal** e **Confirmar sem sinal** com motivo em chips (Paciente frequente, Pagará na clínica, Outro) | M-31, M-02 |
| M-35 | `AgendarRevisao` | TEL-05 | JRN-03 · REQ-033 · DEC-061 | Folha inferior **Enviar proposta** (paciente, serviço, profissional, quando, sala, valor): com conversa, envia proposta versionada com botões Confirmar / Alterar detalhes (não marca nem muda etapa — DEC-061, Confirmado Paulo 31/10/2026); sem conversa mantém confirmar sem WhatsApp; layout com padding do cartão, secção WhatsApp e CTA «Enviar proposta» | M-04, M-38 |
| M-36 | `AgendarConflito` | TEL-05 | JRN-03 · REQ-031 · AC-10 | Alerta «Nada foi reservado», escolhas mantidas, horário perdido riscado e alternativas próximas destacadas | M-04 |
| M-37 | `AgendarSemHorarios` | TEL-05 | JRN-03 · REQ-030 | Dia sem horários com **Próximo livre** (busca no cliente, 14 dias; DEC-055 Confirmado) | M-04 |
| M-38 | `AgendarSucesso` | TEL-05 | JRN-03 · REQ-033 | Horário agendado, estado do aviso WhatsApp, **Voltar à conversa** e **Ver na agenda** | M-02, M-06 |
| M-39 | `ReservarBloco` | TEL-01 conversa (menu ⋮) | JRN-03 · REQ-030, REQ-033 | Folha «Reservar bloco»: chips de dia como no Agendar (o painel acrescenta «Outro dia» para datas além dos 5 chips), período, resumo «Atendimento» com **Alterar**, duração com chips e **Outra** (passo de 15 min só depois), horários, **Avisar a paciente pelo WhatsApp** (ligado por padrão na janela de 24 h; desligado reserva sem mensagem) e **Reservar horário**. Estado inicial: hoje, ou amanhã depois das 18h (Proposto; bloco ocupa a duração escolhida, decisão de 27/10/2026) | M-02, M-06 |
| M-40 | `AcoesConversa` | TEL-01 conversa (menu ⋮) | JRN-02 · REQ-020 | Folha histórica (Resumo + Bloquear no ⋮). **Substituída por M-55** (Confirmado Paulo 31/10/2026, Opção A) | M-02, M-55 |
| M-55 | `AcoesConversaProposta` | TEL-01 conversa (menu ⋮) | JRN-02 · REQ-020 | Folha ⋮ **só conversa/pipeline**: Ver contato, Reservar bloco, Marcar «Horário proposto», Marcar como perdida, Transferir, Encerrar. Sem Resumo da IA nem Bloquear (ficam em Detalhes / Contato). **Confirmado** (Paulo 31/10/2026, Opção A); implementado no painel | M-02, M-03, M-41 |
| M-56 | `Aparencia` | Menu da conta → Aparência (**Confirmado**, DEC-098; implementado como seção do menu) | DEC-098 | Seletor de três opções (Sistema padrão, Claro, Escuro), texto de ajuda e prévia (linha de conversa e bloco de IA). Mock em tema claro com «Sistema» selecionado; o tema escuro vem de `tokens.json` `colorDark`. Escolha só no aparelho. Estados que faltam no mock: tema escuro aplicado, sistema mudando em tempo real, armazenamento indisponível (cai em Sistema) | M-02 |
| M-57 | `AgendaSemanaCartoes` | TEL-04 semana no celular (**Proposto**) | JRN-03 · REQ-030 | Cartões por dia: data, «N horários» e total de livres, barra de ocupação por profissional, hoje aberto; «Abrir o dia». **Implementado em #379** só o cartão, a contagem e «Abrir o dia»; barra e livres dependem da API (sessão `agenda-livres`) | M-06, M-13 |
| M-58 | `CompromissoCancelarSinal` | TEL-06 compromisso (**Proposto**) | JRN-04 · REQ-034 · DEC-047 | Folha com status, sinal pago, valor e falta; **Abrir conversa** como ação principal (implementado em #379); passo «Cancelar» com cartões de rádio Devolver / Ficar com o sinal e aviso à cliente. Os cartões de rádio **não** estão implementados (hoje é seletor) e dependem da política de sinal | M-06 |
| M-59 | `AgendaDiaVazio` | TEL-04 dia sem horários (**Proposto**) | JRN-03 · REQ-030 | Dia vazio com expediente e três primeiros horários livres que abrem o Agendar; «Agendar {dia}» e «Ir para hoje». **Não implementado:** depende de livres na API e muda o teste que hoje proíbe faixa no dia vazio | M-04, M-06 |
| M-60 | `ClinicaPassoAgora` | TEL-09 início, clínica a configurar (**Proposto**) | JRN-08 · REQ-052 · AC-14 | Um único «próximo passo» com um botão; «O caminho» com 5 passos (Horário, Salas, Profissionais, Serviços, WhatsApp), cada um com a razão da ordem e se pode ser pulado; Pix e IA só em «Depois, se quiser» | M-61 |
| M-61 | `ClinicaPronta` | TEL-09 início, clínica pronta (**Proposto**) | JRN-08 · REQ-052 · AC-14 | Selo «Pronta para atender»; alerta só quando há serviço sem profissional (substitui a entrada «Conferir»); áreas agrupadas por pergunta: Quando atende · Quem, o quê e onde · Como fala com as clientes | M-62, M-52 |
| M-62 | `ClinicaAssistente` | TEL-09 Assistente e automações (**Proposto**) | JRN-08 · REQ-052 · DEC-042, DEC-089 | IA, nome e género do atendente, endereço e regras, e proteções numa tela própria; limites recomendados ligados por padrão, os 9 números atrás de «Personalizar» | M-61 |
| M-41 | `BloquearContato` | TEL-01 conversa | JRN-02 | Diálogo central de confirmação: o que acontece (mensagens novas não aparecem, ninguém responde, conversa encerrada; histórico e horários ficam), motivo opcional (só a equipe vê), **Bloquear contato** e **Cancelar**. **Proposto** (27/10/2026) | M-40, M-42 |
| M-42 | `ContatoBloqueado` | TEL-01 conversa | JRN-02 | Conversa de contato bloqueado: cabeçalho «Bloqueado por Ana · hoje, 19:20», evento «Ana bloqueou este contato» e, no lugar do compositor, aviso com **Desbloquear**. **Proposto** (27/10/2026) | M-41, M-02 |
| M-43 | `RascunhoCartao` | §6.3 IA | JRN-02 · REQ-022 | Rascunho da IA no compositor como cartão de largura total: cabeçalho «Rascunho da IA · revise antes de enviar» com tela cheia e descartar, texto em parágrafos curtos, rodapé **Outra**, **Nota** (recolhida) e **Enviar**. **Proposto** (27/10/2026) | M-02, M-30 |
| M-45 | `ConversaSemResponsavel` | TEL-01 / TEL-02 | JRN-02 · REQ-020 | Conversa nova sem responsável: o botão **Assumir e responder** ocupa o lugar do campo, que aparece apagado. **Proposto** (28/10/2026) | M-02 |
| M-46 | `ConversaAguardandoPix` | TEL-01 / TEL-05 | JRN-16 · DEC-047 | Faixa «Aguardando Pix · vence às HH:MM — horário ainda não reservado» com **Detalhes**; cobrança como cartão próprio na conversa. **Proposto** (28/10/2026) | M-47 |
| M-47 | `PixDetalhes` | TEL-01 / TEL-05 | JRN-16 · DEC-065 | Folha do Pix pendente: valor, estado, cliente, serviço, horário e prazo, aviso de que o horário não está reservado, **Reenviar cobrança** e **Cancelar cobrança**. **Proposto** (28/10/2026) | M-46 |
| M-48 | `ConversaSugestaoLonga` | §6.3 IA | JRN-02 · REQ-022 · DEC-063 | Sugestão longa da IA: texto completo com rolagem interna (máx. 150 px), degradê no fundo e botão **Tela cheia**; Enviar, Editar, Gerar outra e Descartar ficam sempre visíveis. **Proposto** (28/10/2026) | M-02, M-43 |
| M-49 | `HorarioEditarDia` | TEL-09 horários (**Proposto**) | JRN-08 · REQ-030 · AC-38 | Folha «Quarta»: aberto/fechado, faixas com intervalo, «Usar este horário também em» (chips de dias), quem atende neste dia, **Aplicar a N dias** (só altera o rascunho) | M-17 |
| M-50 | `HorarioNovaFolga` | TEL-09 horários (**Proposto**) | JRN-08 · REQ-030 · AC-38 | Folha «Folga ou fechamento»: «Quem fica fora» em multi-seleção, motivo em dropdown (único para todos), período, dia inteiro, aviso de compromissos afetados por pessoa, **Salvar para N pessoas** | M-17, M-51 |
| M-51 | `HorarioNovaFolgaQuem` | TEL-09 horários (**Proposto**) | JRN-08 · REQ-030 | Lista de «Quem fica fora» aberta (`aria-multiselectable`): Clínica inteira exclusiva, pessoas com cor e ponto, «N selecionadas», **Concluir** | M-50 |

## Estados que a UI real precisa ter e os mocks mostram em uma tela só

Cada tela abaixo aparece com **um** estado. Implemente todos:

| Tela | Estados a cobrir além do mostrado |
| --- | --- |
| Toda lista (M-01, M-05, M-06, M-13, M-20) | Carregando (esqueleto), vazio (texto da spec §4), erro com **Tentar de novo**, sem resultado de filtro |
| M-02 | Mensagem recebida com anexo não disponível, falha de processamento, conversa encerrada, conversa de outra pessoa, composição de texto em edição |
| M-04 | Sem horários livres, sem configuração (“A agenda desta clínica ainda não foi configurada”), erro de rede com resultado incerto (reler a agenda antes de tentar de novo), sucesso |
| M-05 | Cartão “Movendo…”, falha ao mover (volta à coluna e avisa), cartão atualizado por outra sessão (destaque 1,5 s) |
| M-09 | Código incorreto/expirado, reenvio, e-mail sem convite (sem revelar se há conta) |
| M-10 | Clínica sem acesso (removida do seletor), troca de clínica em andamento |
| M-15 | Clínica pronta (sem a faixa de pendência), vários passos pendentes |
| M-16, M-21, M-22 | Erros de validação por campo, nome duplicado, salvando, salvo |
| M-18 | Acesso de suporte ativo (com tempo restante e **Encerrar**), tentativa de remover o último responsável (recusada) |
| M-19, M-23, M-24 | Alternam conforme o estado real da conexão; uma única rota no app |
| M-14 | Permissão de notificação negada, navegador sem suporte a push, app já instalado |

## Navegação entre abas e permissões

- Barra inferior / rail: **Conversas · Acompanhar · Agenda · Clientes** para todos; **Clínica** só para o Responsável (Opção C Confirmada, Paulo 31/10/2026). Owner = 5 itens; attendant = 4. Os mocks M-01 a M-14 antigos mostram 3 abas do Atendente; M-15 mostrava 4 do Responsável — actualizados pela área Clientes (TEL-12).
- A aba Clínica e as rotas M-15 a M-26 respondem “Você não tem acesso a esta área” para o Atendente, sem dados, e a API nega a ação (REQ-002). Esconder a aba não substitui a autorização no servidor.

## Desktop (Proposto, sem mock `M-xx`)

A moldura do desktop (≥ 1280 px), o painel de detalhe deslizante, o seletor de clínica, o logotipo no painel e o quadro do Acompanhar em largura total foram desenhados em canvases privados de design e decididos em [DEC-068 a DEC-072](../product/decisions.md); a implementação está no épico [#207](https://github.com/intentzero/tredane/issues/207). Os mocks `M-xx` acima continuam sendo do celular; o aceite de usabilidade em aparelho real segue em Q-UX-01. Pendências do épico em [#232](https://github.com/intentzero/tredane/issues/232).

| Ficheiro | Tela | O que mostra | Estado |
| --- | --- | --- | --- |
| `desktop/ConversasDesktopProposta.dc.html` | TEL-01 lista + empty | Rail DEC-068, lista 440–520 px (30vw; revisto 31/10/2026, mock ainda mostra 400 px; busca sunken, chips Todas/Novas/Minhas/Sem responsável, linhas densas com Em atendimento / Precisa de alguém), empty centrado «Escolha uma conversa» — sem card promo | **Confirmado** (Paulo 31/10/2026, Opção A); implementado no painel |
| `desktop/ConversasDesktopPropostaThread.dc.html` | TEL-01 thread | Mesma moldura com Juliana aberta: cabeçalho, bolhas, sugestão IA e compositor; linha activa na lista | **Confirmado** (Paulo 31/10/2026, Opção A); implementado no painel |
| `desktop/ConversasControlesMenu.dc.html` | TEL-01 thread · ⋮ | Header Agendar + Contato + menu ⋮ só com acções de conversa/pipeline (sem Resumo da IA nem Bloquear) | **Confirmado** (Paulo 31/10/2026, Opção A); implementado |
| `desktop/ConversasControlesContato.dc.html` | TEL-01 thread · Contato | Sidepane 380 px: dados, Resumo da IA, Acompanhamento, conversas, Bloquear, zona de risco (únicas entradas de Resumo e Bloquear) | **Confirmado** (Paulo 31/10/2026, Opção A); implementado |
| `desktop/AgendaSemana.dc.html` | TEL-04 semana | Grade de sete dias, horários simultâneos lado a lado, filtro por profissional, fim de semana hachurado e linha «Agora» (**Proposto**) |
| `desktop/ClientesLista.dc.html` | TEL-12 lista | Rail com item Clientes; lista ~400 px (busca, filtros Todas/Com horário/Bloqueadas); ficha resumida ao lado | **Confirmado** (Opção C, Paulo 31/10/2026); fase 1 implementada |
| `desktop/ClientesFicha.dc.html` | TEL-12 ficha | Ficha completa partilhada com Contato: dados, horários, conversas, Resumo da IA, Bloquear; sem sexo | **Confirmado** (Opção C, Paulo 31/10/2026); fase 1 implementada |

`desktop/Main.dc.html` permanece como exploração antiga (três colunas); a referência visual do desktop de Conversas são os mocks `ConversasDesktopProposta*`. Os mocks `ConversasControles*` documentam a Opção A Confirmada do header/menu/sidepane. Os mocks `Clientes*` documentam a Opção C (directório + ficha partilhada).
