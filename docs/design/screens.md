# Índice de telas (mocks mobile)

Cada linha liga um mock a sua especificação. **A especificação manda:** em caso de divergência entre mock e [UI/UX](../product/ux-ui.md), [requisitos](../product/requirements.md) ou [decisões](../product/decisions.md), siga o texto e registre a divergência (ver [README](README.md#divergências-conhecidas-entre-mocks-e-especificação)). Nome do arquivo = `mobile/<Arquivo>.dc.html`; preview = `mobile/previews/<ID>-<Arquivo>.png`. Todos os dados são fictícios.

**Estado dos mocks:** todos **Proposto**. “Interativo” = o mock tem alguma interação de protótipo (alternar passo ou aba); as demais telas são estáticas e mostram um único estado.

## Fluxo principal

| ID | Arquivo | Tela da spec | Jornadas · Requisitos · Cenários | Mostra | Navega para |
| --- | --- | --- | --- | --- | --- |
| M-01 | `Main` | TEL-01 lista | JRN-01, JRN-02, JRN-04 · REQ-010, REQ-020 · AC-04, AC-16 | Filtros (Todas, Novas, Minhas, Sem responsável, Encerradas), busca, item com estado da conversa, responsável e etapa, item com “Resposta não enviada”, badge de nova conversa na barra | M-02, M-05, M-06 |
| M-02 | `Conversa` | TEL-01 conversa | JRN-02 · REQ-012, REQ-021, REQ-022 · AC-06 | Histórico com estados de envio, evento de sistema, bloco de sugestão da IA (Usar e editar, Gerar outra, Descartar), compositor com botão de IA e enviar; cabeçalho com botão **Agendar** (ícone + texto) e menu ⋮ com «Reservar bloco» e, separada por divisor, «Encerrar conversa» (27/10/2026) | M-01, M-03 |
| M-03 | `Contato` | TEL-01 detalhes | JRN-02, JRN-03 · REQ-023 · AC-08 | Etapa da oportunidade (seletor), aviso “não reserva horário”, resumo da IA, compromissos, botão fixo **Agendar horário** | M-02, M-04 |
| M-04 | `Agendar` | TEL-05 | JRN-03 · REQ-030, REQ-031, REQ-033 · AC-09, AC-10 | Cabeçalho com contato real, serviços em cartões, profissionais em botões («Qualquer» primeiro), 5 dias com **Ver calendário**, horários em grade de 4 colunas (Manhã/Tarde), controle de duração −/+ em passos de 15 min só em serviços com «Duração ajustável» (DEC-051 Confirmado), rodapé fixo com resumo e **Revisar e confirmar** (Proposto) | M-03, M-35 |
| M-05 | `Pipeline` | TEL-03, TEL-02 | JRN-03, JRN-04 · REQ-023 · AC-08 | Título e aba **Acompanhamento** (DEC-045; o arquivo mantém o nome); abas por etapa com contagem, cabeçalho «N nesta etapa · M em andamento», cartões com «Sem horário marcado» e botão **Abrir conversa** (27/10/2026); **folha inferior “Mover para…”** aberta, com aviso de que “Horário proposto” não reserva e de que “Agendado” sem compromisso é permitido | M-02, M-01, M-06 |
| M-06 | `Agenda` | TEL-04 (dia) | JRN-03, JRN-04 · REQ-034 · AC-09, AC-13 | Lista do dia por horário, compromisso destacado como alterado por outra sessão, espaço livre com **Agendar**, bloqueio e fora do expediente | M-04, M-01, M-05 |
| M-07 | `Reconectando` | TEL-07, 6.1, 6.2 | JRN-06, JRN-07 · REQ-012, REQ-042 · AC-07, AC-11 | Faixa **Reconectando**, os seis estados de envio (Enviando, Enviada, Entregue, Lida, Não enviada + Tentar de novo, Verificando envio), IA indisponível | M-01 |
| M-08 | `Revogado` | TEL-07, 6.2 | JRN-07 · REQ-003 · AC-02 | “Seu acesso a esta clínica foi encerrado” em tela cheia, **Entrar novamente** | — |

## Entrada, clínicas, WhatsApp e avisos

| ID | Arquivo | Tela da spec | Jornadas · Requisitos · Cenários | Mostra | Navega para |
| --- | --- | --- | --- | --- | --- |
| M-09 | `Entrar` (interativo) | TEL-08 | JRN-07, JRN-08 · REQ-005 · AC-17 | Passo e-mail → passo código de 6 dígitos (`autocomplete="one-time-code"`). **Mock do comportamento:** a tela real é o componente do Clerk estilizado | M-10 |
| M-10 | `Clinicas` | TEL-08 | JRN-07 · REQ-005 · AC-17 | Escolha da clínica com papel em cada uma; aparece só com mais de uma clínica | M-01 |
| M-11 | `JanelaFechada` | TEL-01, DEC-040 | JRN-02 · REQ-012 | Fora da janela de 24 h: texto livre **bloqueado**, aviso, **Escolher modelo** | M-12 |
| M-12 | `Modelos` | TEL-01, DEC-040 | JRN-02 · REQ-012 | Lista de modelos aprovados, campos a preencher, prévia não editável, aviso de custo, **Enviar modelo** | M-11 |
| M-13 | `Semana` | TEL-04 (semana) | JRN-04 · REQ-034 | Alternador Dia/Semana, lista agrupada por dia, dia com bloqueio, dia atual destacado | M-06 |
| M-14 | `Instalar` | PWA e avisos, DEC-040 | — · Q-UX-05 | Passo a passo de instalação no iPhone, quatro avisos configuráveis, **Ativar avisos** | M-01 |

## Área Clínica (só o responsável)

| ID | Arquivo | Tela da spec | Jornadas · Requisitos · Cenários | Mostra | Navega para |
| --- | --- | --- | --- | --- | --- |
| M-15 | `Clinica` | TEL-09 início | JRN-08 · REQ-052 · AC-14 | Faixa “Falta 1 passo para atender”, lista de áreas com estado (Pronto, Falta conectar), barra inferior com 4 abas | M-16, M-20, M-17, M-18, M-19, M-33 |
| M-16 | `Servico` | TEL-09 serviço | JRN-08 · REQ-052, REQ-075 · AC-38, AC-43 | Nome, duração, intervalo depois, resumo “Ocupa 75 min”, quem pode fazer, recurso exigido, preço opcional, explicação para clientes (usada pela IA, REQ-075), ativo | M-15 |
| M-17 | `Horarios` | TEL-09 horários | JRN-08 · REQ-030 · AC-38 | Abas por profissional e recurso, expediente semanal, bloqueios pontuais, aviso sobre compromissos existentes, **Novo bloqueio** | M-15 |
| M-18 | `Equipe` | TEL-09 equipe | JRN-08 · REQ-002, REQ-003, REQ-004 · AC-02, AC-03 | Membros e papéis (responsáveis só leitura), convites pendentes (reenviar com espera, cancelar), faixa de pedido de suporte, “Suporte do Tredane”, **Convidar atendente** | M-15, M-27, M-28 |
| M-19 | `ConectarWhatsapp` | TEL-09 WhatsApp | JRN-08 · REQ-051 | **Não conectado**, passos do Embedded Signup, **Conectar WhatsApp**, **Pedir ajuda** | M-15 |
| M-20 | `Recursos` (interativo) | TEL-09 recursos | JRN-08 · REQ-052 · AC-38 | Abas Profissionais e Salas; listas com estado; botões de adicionar | M-21, M-22, M-15 |
| M-21 | `Profissional` | TEL-09 recursos | JRN-08 · REQ-052 · AC-38 | Nome, serviços que faz, expediente (atalho), ativa, aviso de compromissos futuros ao desativar; sem login | M-20, M-17 |
| M-22 | `Sala` | TEL-09 recursos | JRN-08 · REQ-052 · AC-38 | Tipo (sala/equipamento), nome, categoria, disponibilidade (atalho), serviços que usam, ativa, aviso de serviço sem recurso | M-20, M-17 |
| M-23 | `WhatsappConectado` | TEL-09 WhatsApp | REQ-051 · AC-40 | **Conectado**, número, quem conectou, última mensagem, modelos e estado, Trocar número, Desconectar | M-25, M-26, M-15 |
| M-24 | `WhatsappInterrompido` | TEL-09 WhatsApp | REQ-012, REQ-013, REQ-051 · AC-39 | **Conexão interrompida**, motivo, o que acontece enquanto estiver desconectado, **Reconectar** | M-15 |
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
| M-35 | `AgendarRevisao` | TEL-05 | JRN-03 · REQ-033 | Folha inferior de revisão (paciente, serviço, profissional, quando, sala, valor), aviso WhatsApp opcional com texto editável (ligado por padrão com conversa e janela de 24 h aberta; fora dela indisponível com explicação — DEC-053 Confirmado) | M-04, M-38 |
| M-36 | `AgendarConflito` | TEL-05 | JRN-03 · REQ-031 · AC-10 | Alerta «Nada foi reservado», escolhas mantidas, horário perdido riscado e alternativas próximas destacadas | M-04 |
| M-37 | `AgendarSemHorarios` | TEL-05 | JRN-03 · REQ-030 | Dia sem horários com **Próximo livre** (busca no cliente, 14 dias; DEC-055 Confirmado) | M-04 |
| M-38 | `AgendarSucesso` | TEL-05 | JRN-03 · REQ-033 | Horário agendado, estado do aviso WhatsApp, **Voltar à conversa** e **Ver na agenda** | M-02, M-06 |

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

- Barra inferior: **Conversas · Pipeline · Agenda** para todos; **Clínica** só para o Responsável. Os mocks M-01 a M-14 mostram a visão do Atendente (3 abas); M-15 mostra a do Responsável (4 abas).
- A aba Clínica e as rotas M-15 a M-26 respondem “Você não tem acesso a esta área” para o Atendente, sem dados, e a API nega a ação (REQ-002). Esconder a aba não substitui a autorização no servidor.
