# Suporte com leitura de conversas — base legal e retenção (rascunho)

**Estado:** **Proposto — rascunho para o Paulo definir e documentar** (17/11/2026). **Não é parecer jurídico nem decisão.** Tudo o que é qualificação jurídica (controlador, operador, base legal, dado sensível, prazos) é **hipótese** a confirmar com o advogado do [dossiê LGPD](legal-review-brief.md), perguntas 1, 2, 7 e 11. Cobre o requisito que o [ADR-0017](../adr/0017-sessao-suporte-na-clinic-app.md) e a DEC-195 impõem antes de ligar `SUPPORT_SESSIONS_ENABLED` em produção (VAL-09, #43). Os campos **[DECIDIR]** são o que falta.

## 1. O que o suporte passa a poder fazer (factos do código, #853)

| Facto | Detalhe |
| --- | --- |
| Quem | Superadmin do Tredane (flag verificada no backend a cada pedido), só **com sessão aprovada por uma owner** da clínica (DEC-029). |
| O que lê | Conversas da clínica: lista, mensagens (texto), contatos. **Só leitura.** Pipeline, agenda, configuração, anexos e imagens ficam bloqueados. |
| Em nome de quem | De um membro ativo da clínica (o «subject»), escolhido no pedido; o papel é o dele, nunca mais. |
| Duração | 30 minutos, sem prorrogação (DEC-033). Pedido válido 24 h. |
| Telefone | Só os 4 últimos dígitos (Q-SUP-05, Paulo 17/11/2026). **Limite:** números escritos dentro do texto das mensagens **não** são mascarados. |
| Tempo real | A ligação de suporte recebe só sinais sem conteúdo; o texto vem pelas rotas HTTP já mascaradas. |
| Quem é avisado | Owners ativas por e-mail ao iniciar (DEC-035); owners e subject em tempo real; o subject pode pedir o fim e a owner decide (DEC-036, DEC-037). Qualquer owner pode encerrar a qualquer momento. |
| Fica registado | `central_audit_events`: pedido, aprovação, ativação, encerramento, e cada leitura (`support.access`, agregada por sessão, rota e minuto) e cada tentativa bloqueada (`support.access.denied`). O registo tem **a rota e o método**, não o conteúdo lido. |

**Lacuna a decidir:** o registo de leitura diz *que rota* foi lida, **não qual conversa nem qual contato**. Para responder a um titular («quem viu as minhas mensagens?») ou a um incidente, isso pode ser insuficiente. [DECIDIR] registar também o id da conversa/contato lido (sem texto) — é uma mudança pequena em `recordSupportAccess`, mas muda a agregação por minuto.

## 2. Papéis e base legal (hipóteses)

| Tratamento | Papel do Tredane | Base legal candidata (LGPD) | A confirmar |
| --- | --- | --- | --- |
| Ler conversas para diagnosticar um problema que a clínica reportou, com aprovação da owner | **Operador** da clínica (controladora) | Execução do contrato com a clínica (art. 7º, V) e **instrução documentada da clínica**, dada por sessão pela owner (o ato de aprovar) | Se a aprovação por sessão basta como instrução, ou se o contrato de tratamento de dados tem de a prever |
| Registos de acesso do suporte (quem, quando, rota) | Controlador dos registos de auditoria da própria plataforma | Legítimo interesse (art. 7º, IX) em segurança e prestação de contas; obrigação de segurança (art. 46) | Prazo de guarda (secção 3) |
| E-mail às owners ao iniciar a sessão | Controlador dos dados das owners | Execução do contrato | — |

**Sensibilidade:** mensagens de clínicas de estética podem mencionar procedimentos ou condições de saúde. Se forem **dado sensível** (art. 11), a base «execução de contrato» pode não bastar e o fundamento muda (por exemplo, tutela da saúde ou consentimento). Esta é a pergunta 2 do dossiê e **decide a base legal de todo o suporte**. [DECIDIR com o advogado]

**Princípios a refletir (art. 6º):** finalidade (só diagnóstico pedido pela clínica), necessidade (leitura só, telefone cortado, 30 min), transparência (aviso à owner e ao subject, banner permanente) e prevenção (três camadas de segurança do ADR-0017).

## 3. Retenção proposta

Hoje **nada purga** `central_audit_events` nem as tabelas de suporte: a retenção é indefinida por omissão. O quadro abaixo é uma **proposta** a fixar.

| Dado | Onde | Proposta | Porquê / a decidir |
| --- | --- | --- | --- |
| Pedidos, sessões e pedidos de término | D1 (`support_*`) | **[DECIDIR]** sugestão: 5 anos desde o fim da sessão | Contém ator, subject, motivo (texto livre), horas. Sem conteúdo clínico. Prazo comum para prestar contas; confirmar com o advogado (pergunta 11). |
| Leituras e tentativas bloqueadas (`support.access*`) | D1 (`central_audit_events`) | **[DECIDIR]** sugestão: igual aos pedidos, 5 anos | Prova de quem viu o quê. Mais curto reduz risco, mais longo ajuda em incidentes. |
| Hash do token da sessão | D1 (`support_sessions.token_hash`) | Pode ser apagado ao fim da sessão (já inútil depois de encerrada) | Proposta nova; hoje fica. |
| Cookie `tredane_support` | Navegador do superadmin | Dura no máximo a sessão (≤ 30 min); apagado ao encerrar | Já implementado. |
| Conteúdo lido | — | **Não é copiado nem guardado** pelo suporte | Só passa pela resposta HTTP; a captura de ecrã por quem usa é risco humano a cobrir na política interna (secção 5). |
| E-mails de aviso às owners | Provedor de e-mail | Conforme o provedor; sem conteúdo clínico | Confirmar no DPA do provedor. |
| Amostras de revisão da IA (outro fluxo) | D1 | 30 dias (DEC-193) | Já decidido, fora deste documento. |

**Exclusão e direitos do titular:** a exclusão de um contato pela clínica (DEC-099) apaga mensagens e anexos; os registos de suporte **não contêm** o texto, apenas ids e rotas, por isso permanecem sem dado pessoal da cliente final além do que o id possa identificar. [DECIDIR] como responder a um pedido de acesso do titular sobre acessos de suporte (pela clínica, com extrato do Tredane).

## 4. O que a clínica e as pessoas veem

- **Contrato / termos:** [DECIDIR] cláusula que descreve o suporte com leitura, por sessão aprovada, 30 min, só leitura, registado. Sem ela, a aprovação da owner pode ser vista como insuficiente.
- **Aviso à owner** (já existe): e-mail ao iniciar; o pedido mostra quem pede, em nome de quem e o motivo. Texto exato revisto antes de produção (item em aberto da TEL-10).
- **Aviso ao subject** (já existe): faixa «suporte em curso» com «Solicitar encerramento».
- **Política de privacidade:** [DECIDIR] mencionar o acesso de suporte e o prazo de guarda dos registos.

## 5. Política interna para quem opera o suporte

[DECIDIR] regras escritas para quem usa a vista de suporte (hoje, o Paulo e quem ele autorizar):
- só entrar com pedido ligado a um problema real reportado; motivo escrito de forma útil (fica na auditoria);
- não copiar, fotografar ou exportar conversas; não partilhar o que leu;
- encerrar a sessão logo que o diagnóstico acabe;
- reportar de imediato qualquer acesso indevido (plano de incidente: prazo e responsável pela ANPD, pergunta 9 do dossiê).

## 6. Decisões pedidas ao Paulo

| # | Decisão | Sugestão |
| --- | --- | --- |
| 1 | Qualificação: Tredane operador; aprovação da owner por sessão como instrução | Sim, a validar no contrato |
| 2 | Mensagens tratadas como possível dado sensível | Sim, por prudência, até o advogado dizer o contrário |
| 3 | Prazo de guarda dos registos de suporte e de leitura | 5 anos |
| 4 | Registar também o id da conversa/contato lido | Sim (pequena alteração de código, a abrir como issue) |
| 5 | Apagar o hash do token ao fim da sessão | Sim |
| 6 | Cláusula de contrato e texto da política de privacidade | Redigir com o advogado |
| 7 | Política interna da secção 5 | Adotar como está |

## 7. Ligação aos outros documentos

[ADR-0017](../adr/0017-sessao-suporte-na-clinic-app.md) (requisito para ligar em produção) · DEC-029 a DEC-037, DEC-195 · [legal-review-brief.md](legal-review-brief.md) (perguntas 1, 2, 7, 9, 11) · [validation-register.md](validation-register.md) VAL-09 · REQ-071, REQ-072. Ao decidir, promover cada linha da secção 6 a **Confirmado**, atualizar o ADR-0017 e a DEC-195, e fechar a parte de suporte do VAL-09.
