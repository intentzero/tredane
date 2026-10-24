# Jornadas do MVP

**Estado:** proposta para validação. **Fonte:** [MVP](../MVP.md), [atores](actors-permissions.md) e [épico #1](https://github.com/intentzero/tredane/issues/1). As jornadas descrevem comportamentos desejados, não telas finais nem integração já construída. Os critérios verificáveis estão em [requisitos](requirements.md).

## JRN-01 — Primeiro contato pelo WhatsApp

- **Ator e objetivo:** ACT-01 inicia uma conversa; ACT-02 precisa recebê-la com contexto suficiente para atender.
- **Gatilho e pré-condições:** o contato envia mensagem a um número conectado à clínica; a integração está ativa e a origem do webhook é validada.
- **Fluxo principal:** (1) o Tredane associa o número à clínica; (2) identifica ou cria o contato; (3) registra a mensagem na conversa; (4) cria ou associa a oportunidade; (5) coloca a conversa na caixa de entrada; (6) publica um evento apenas para sessões autorizadas daquela clínica.
- **Alternativas:** mensagem repetida não gera duplicata; mídia não suportada ou indisponível aparece com estado/erro observável; falha transitória no processamento não perde a mensagem sem sinalização e possibilidade de reprocessamento.
- **Resultado, superfícies e dados:** conversa e oportunidade visíveis no painel; contato, mensagem, estado de recebimento e identificador externo registrados. Nenhuma clínica diferente recebe o evento.
- **Requisitos:** REQ-010, REQ-011, REQ-012, REQ-040, REQ-050.

## JRN-02 — Atendimento humano com apoio de IA

- **Ator e objetivo:** ACT-02 ou ACT-03 assume a conversa, entende o pedido e responde. Ambos veem todas as conversas da própria clínica.
- **Gatilho e pré-condições:** há conversa recebida e membro autorizado na clínica.
- **Fluxo principal:** (1) atendente ou responsável abre e assume a conversa; (2) lê mensagens e histórico disponível; (3) pede sugestão ou resumo à IA; (4) revisa e, se quiser, edita o texto; (5) envia a resposta; (6) o painel mostra tentativa e estado de envio; (7) a outra sessão autorizada vê a mudança.
- **Alternativas:** atendente ignora a sugestão; provedor de IA falha e a resposta manual continua possível; envio falha ou fica com resultado desconhecido e o painel não apresenta sucesso falso; conversa é transferida para outro membro; duas pessoas tentam assumir ao mesmo tempo e o estado final fica claro.
- **Resultado, superfícies e dados:** caixa de entrada atualizada com responsável, histórico, origem da sugestão e estado da mensagem. Texto não revisado não é enviado automaticamente.
- **Requisitos:** REQ-020, REQ-021, REQ-022, REQ-041, REQ-060.

## JRN-03 — Oportunidade até horário confirmado

- **Ator e objetivo:** ACT-02 ou ACT-03 transforma uma conversa em agendamento; ACT-01 recebe confirmação pelo WhatsApp quando o envio estiver disponível.
- **Gatilho e pré-condições:** contato quer marcar horário; serviço, duração, disponibilidade, profissional e sala/equipamento necessários estão definidos para a clínica.
- **Fluxo principal:** (1) membro autorizado atualiza a etapa da oportunidade; (2) consulta horários disponíveis; (3) seleciona serviço, recurso e horário; (4) confirma o agendamento; (5) conversa, pipeline e agenda exibem o mesmo compromisso; (6) sessões da clínica recebem evento de atualização.
- **Alternativas:** intervalo ficou ocupado antes da confirmação; recurso está indisponível; contato não aceita o horário proposto; envio da confirmação falha sem desfazer um agendamento já confirmado. A equipe vê o estado correto em cada caso.
- **Resultado, superfícies e dados:** agendamento confirmado com vínculo ao contato e à oportunidade, sem conflito de recursos; registro de quem confirmou e quando.
- **Requisitos:** REQ-030, REQ-031, REQ-032, REQ-033, REQ-040.

## JRN-04 — Acompanhamento pela clínica

- **Ator e objetivo:** ACT-03 acompanha todas as conversas, oportunidades e agenda da própria clínica e pode realizar todas as ações de atendimento de ACT-02. Gestão de attendants pelo owner foi confirmada; gestão de owners pertence ao superadmin e integrações dependem de decisão.
- **Gatilho e pré-condições:** responsável autenticado e associado à clínica.
- **Fluxo principal:** (1) abre a visão de atendimento/pipeline/agenda; (2) filtra ou localiza um contato; (3) consulta estado atual, responsável e próximo compromisso; (4) vê mudanças feitas em outra sessão sem recarregar a página.
- **Alternativas:** não há dados; membro foi removido; conexão em tempo real caiu e a interface precisa reconciliar com a API antes de mostrar estado atual.
- **Resultado, superfícies e dados:** visão consistente apenas da própria clínica. Relatórios avançados não são exigência deste MVP.
- **Requisitos:** REQ-001, REQ-023, REQ-034, REQ-040, REQ-042.

## JRN-05 — Cancelamento ou reagendamento

- **Ator e objetivo:** ACT-01 solicita mudança pelo WhatsApp; ACT-02 ou ACT-03 resolve o compromisso.
- **Gatilho e pré-condições:** existe agendamento; a clínica define quem pode alterá-lo e quais recursos ficam livres após cancelamento.
- **Fluxo principal:** (1) equipe encontra o compromisso na conversa ou agenda; (2) registra motivo, se necessário; (3) cancela ou procura novo horário; (4) confirma a mudança; (5) agenda, pipeline e conversa passam a refletir o novo estado; (6) sessões autorizadas recebem a atualização.
- **Alternativas:** novo horário entrou em conflito; compromisso já foi alterado por outra pessoa; comunicação da mudança ao contato falhou. O sistema preserva o estado confirmado e informa a falha de mensagem separadamente.
- **Resultado, superfícies e dados:** histórico do compromisso e disponibilidade coerentes. Política de prazo de cancelamento é **Em aberto** e não deve ser inventada.
- **Requisitos:** REQ-031, REQ-032, REQ-033, REQ-040.

## JRN-06 — Falhas de integração e processamento

- **Ator e objetivo:** ACT-02/ACT-03 entende o que falhou e consegue retomar o atendimento sem duplicar ações.
- **Gatilho e pré-condições:** webhook repetido, falha no provedor, fila reprocessada ou resposta de envio pendente.
- **Fluxo principal:** (1) o evento entra com identificador e tenant verificados; (2) o processamento tenta persistir ou enviar; (3) estado e falha ficam observáveis; (4) reprocessamento de entrada mantém uma única mensagem lógica; (5) uma tentativa de envio com resultado desconhecido aguarda reconciliação antes de nova tentativa; (6) a equipe vê o estado conhecido na conversa.
- **Alternativas:** origem não verificada é rejeitada; associação do número à clínica não existe; falha permanente exige intervenção; estado de entrega chega depois da tentativa de envio.
- **Resultado, superfícies e dados:** histórico sem duplicatas e sem sucesso falso. Alertas operacionais e política de retentativa ainda precisam de detalhe técnico.
- **Requisitos:** REQ-011, REQ-012, REQ-013, REQ-050, REQ-070.

## JRN-07 — Tempo real, reconexão e revogação

- **Ator e objetivo:** ACT-02/ACT-03 vê alterações recentes sem atualizar a página e perde acesso ao sair da clínica.
- **Gatilho e pré-condições:** duas sessões autorizadas da mesma clínica e uma sessão de outra clínica estão abertas.
- **Fluxo principal:** (1) uma sessão altera conversa, oportunidade ou agenda; (2) o servidor persiste a mudança; (3) apenas sessões da clínica autorizada recebem o evento; (4) as interfaces atualizam a visão; (5) após reconexão, consultam o estado canônico e corrigem lacunas.
- **Alternativas:** Durable Object hiberna e retoma; evento é perdido ou chega duplicado; membership A é revogado e sua conexão antiga deixa de receber dados, inclusive após reconexão/hibernação. A sessão Clerk e memberships noutros tenants, como B, continuam válidos (DEC-026). Uma sessão de suporte própria que dependa do subject em A também deixa de ser autorizada.
- **Resultado, superfícies e dados:** as sessões da mesma clínica convergem para o estado persistido, sem vazamento para outra clínica. O mecanismo exato de invalidação de conexão ainda é decisão técnica.
- **Requisitos:** REQ-001, REQ-002, REQ-003, REQ-040, REQ-041, REQ-042.

## JRN-08 — Ativação de uma clínica (pendente)

- **Estado:** Confirmado: superadmin cria tenant e associa primeiro owner; owner convida/remove attendants, nunca cria/promove owners. **Em aberto:** fluxo técnico de convite, disponibilidade de serviços e profissionais, e responsabilidade pela conexão da conta WhatsApp. Não confundir a delegação confirmada com onboarding integralmente definido.
- **Requisitos relacionados:** REQ-004, REQ-051, REQ-052.

## JRN-12 — Owner convida/remove attendant

- **Ator:** owner ativo em tenant A, com autenticação Clerk e membership D1.
- **Fluxo confirmado:** owner em A convida pessoa como attendant apenas em A; após aceite, membership é ativado em A. Ao remover, acesso a A é revogado **imediatamente** (API e WebSocket), com auditoria e aviso na aba A; a sessão Clerk permanece válida e quaisquer memberships em B mantêm acesso (DEC-026).
- **Erros:** owner tenta alterar owners ou membro de B sem permissão => negar; attendant tenta gerir membros => negar; convite inválido não concede membership.
- **Em aberto:** emissão, posse do email, aceite e expiração de convite, revogação imediata dos WebSockets.
- **Requisitos:** REQ-001/002/003/004/005.

## JRN-14 — Cancelar convite pendente da clínica

- **Confirmado (DEC-025):** qualquer owner ativo de A pode cancelar convite pendente de A, independente do emissor. Backend invalida o link imediatamente por transição atómica no D1 e audita actor/tenant/convite. Nenhum membership é alterado.
- **Alternativas:** convite aceite não é cancelável para revogar acesso; owner só de B e attendant não podem cancelar A. Aceite simultâneo ao cancelamento tem somente um resultado final válido.
- **Requisitos:** REQ-004/008; [AC-23](acceptance.md).

## JRN-13 — Aceitar convite de e-mail para tenant

- **Estado:** convite por e-mail (DEC-021), validade de 7 dias (DEC-022), reenvio com novo link (DEC-023) e limite de 10 minutos / 5 reenvios por 24 horas por tenant/e-mail (DEC-024) confirmados.
- **Ator/objetivo:** futuro attendant recebe e-mail de convite de owner para a clínica A.
- **Fluxo:** owner de A informa e-mail → Tredane regista convite de uso único no D1 e entrega link por e-mail → destinatário autentica-se no Clerk, criando conta se necessário → backend confirma que o e-mail convidado está verificado na identidade Clerk → consume o convite atomicamente e cria membership attendant somente em A.
- **Alternativas:** já pertencer a B não modifica B; endereço não verificado, token usado/expirado/revogado ou substituído por reenvio e tentativa de mudar role/tenant falham sem criar vínculo. Reenvio autorizado emite novo link por 7 dias e invalida imediatamente o anterior, desde que respeite 10 minutos entre reenvios e máximo 5 numa janela móvel de 24 horas por tenant/e-mail. Pedido bloqueado não altera o link vigente.
- **Requisitos:** REQ-004/005/008.

## JRN-09 — Alternar entre tenants

- **Estado:** Confirmado o suporte a memberships em várias clínicas; experiência proposta.
- **Ator e objetivo:** atendente/responsável com conta Clerk membro das clínicas A e B opera cada uma conforme role própria.
- **Pré-condições:** login Clerk e memberships ativos em D1.
- **Fluxo:** listar tenants associados → selecionar A na aba 1 → abrir B na aba 2 → a API valida membership e role por pedido → cada WebSocket recebe eventos apenas do seu tenant.
- **Alternativas:** revogação de A nega A mas preserva B; URL adulterada não concede acesso.
- **Requisitos:** REQ-001/002/003/005/040.

## JRN-10 — Criar e gerir tenant na Platform Admin

- **Estado:** Confirmada a capacidade; detalhes de interface propostos.
- **Ator e objetivo:** superadmin gere ciclo de vida da clínica.
- **Pré-condições:** sessão Clerk válida e flag `privateMetadata.superadmin === true` confirmada no backend.
- **Fluxo:** entrar em Admin → listar tenants → criar/editar ou suspender/reactivar tenant → persistir D1 + evento de auditoria → confirmar resultado.
- **Alternativas:** sem flag estritamente booleana => negar; tentativa de deletar inicia exclusão lógica com confirmação reforçada; operação falha sem criação parcial.
- **Requisitos:** REQ-004/006.

## JRN-11 — Entrar no contexto de usuário de tenant para suporte

- **Estado:** Confirmada a impersonação implementada **pelo Tredane**, com controles finais em revisão.
- **Ator e objetivo:** superadmin reproduz problema ou executa manutenção como membro selecionado da clínica.
- **Pré-condições:** Clerk mantém sessão do actor; superadmin válido; tenant e membership do subject ativos.
- **Fluxo (DEC-029/030):** selecionar tenant/subject e motivo → backend cria pedido `pending` sem acesso clínico → painel dos owners ativos daquele tenant recebe evento em tempo real e e-mail informativo é enviado com link para abrir pedido → owner autenticado pelo Clerk aprova/rejeita **no painel** → somente após aprovação ativa sessão própria do Tredane com handoff à Clinic App e banner permanente → validar actor, subject, aprovação, role e TTL → auditar também owner aprovador → encerrar/revogar.
- **Alternativas (DEC-031):** pedido pendente expira automaticamente após 24 horas da criação; owner não pode aprovar em/apos `expires_at`, mesmo se e-mail chegou atrasado, e novo pedido será necessário. A sessão ativada dura 30 minutos (DEC-032), continuação por novo pedido e aprovação (DEC-033). E-mail perdido/duplicado/atrasado não aprova e não impede a decisão pelo painel; link não autoriza acesso por si; dois owners decidindo têm somente uma transição vencedora. Pendência, rejeição, ausência/expiração/revogação de aprovação negam acesso; owner de outra clínica não pode aprovar. Limite/expiração, alteração do subject/tenant, revogação da flag ou falha Clerk/D1 negam acesso; ações proibidas continuam negadas.
- **Resultado:** manutenção rastreável, sem substituir a identidade real do actor nem usar impersonação do Clerk.
- **Requisitos:** REQ-003/005/006/007/040.

## DEC-032 — Sessão de suporte de 30 minutos

A solicitação pendente dura até 24 horas (DEC-031) para o owner aprovar; quando aprovada, a sessão própria de suporte é ativada por **30 minutos** a partir da ativação no servidor. O painel mostra a validade e permite encerramento antecipado pelo superadmin. Após expirar, a Clinic App perde autorização de suporte, API e WebSockets param, e a sessão Clerk continua ativa. Atividade, login, refresh e reconexão não renovam o prazo. DEC-033 exige novo pedido e nova aprovação, sem extensão.

## DEC-033 — Solicitar novo suporte após encerramento

- Após os 30 minutos ou encerramento antecipado, o superadmin **não pode estender** a sessão; precisa abrir **novo pedido**, receber **nova aprovação de owner** e só então ativar outra sessão de 30 minutos.
- O pedido novo vale até 24 horas; a autorização e os cookies da sessão encerrada permanecem inválidos. Cada pedido e sessão têm auditoria própria.

## DEC-034 — Encerramento por qualquer owner do tenant

- Owner ativo vê sessões de suporte em curso no seu tenant e pode escolher **Encerrar suporte** mesmo que outro owner tenha aprovado. O superadmin actor também pode encerrar sua própria sessão.
- O backend invalida a sessão de suporte de maneira atómica e auditada no D1; nenhuma API ou WebSocket desse contexto volta a entregar dados. O painel apresenta a sessão como encerrada.
- Atendente/owner de outro tenant não conseguem encerrar A. A ação não remove memberships nem encerra a sessão Clerk. Para voltar a prestar suporte, seguir novo pedido e aprovação (DEC-033).

## DEC-035 — Owners acompanham o ciclo do suporte

- Ao ativar a sessão após aprovação (não apenas criar pedido), o Tredane publica o início no painel dos owners vigentes da clínica e envia **um e-mail informativo de início** por owner; o e-mail não concede acesso.
- Enquanto a sessão estiver ativa, o painel mostra superadmin actor, duração restante, estado e Encerrar suporte. Se terminar por expiração, pelo actor ou pelo owner, owners veem atualização **em tempo real no painel** e podem consultar auditoria, **sem e-mail de encerramento**.
- Falhas de entrega não bloqueiam suporte nem conferem permissões; ao voltar online, o painel reconcilia estado persistido. Isolamento por tenant e ausência de dados clínicos no e-mail são obrigatórios.

## DEC-036 — Utilizador representado vê aviso de suporte em sua conta

- Quando sessão aprovada entra em `active`, todos os owners ativos acompanham o suporte no painel e o **subject recebe aviso contextual na sua sessão normal da Clinic App**, indicando suporte no seu contexto de tenant. Não simular login Clerk na identidade do subject e não mostrar a outros attendants.
- Após os 30 minutos, revogação por owner ou término voluntário do superadmin, o aviso de suporte ativo deixa de aparecer ao subject. Se offline, ao regressar a Clinic App consulta estado vigente; eventos WebSocket são filtrados por subject + tenant.
- O aviso do subject não permite aprovar nem encerrar sessão (DEC-034). A política de e-mail da DEC-035 continua destinada a owners, sem e-mail adicional ao subject.

## DEC-037 — Subject solicita encerramento do suporte

- Enquanto o aviso contextual de suporte está ativo na própria clínica, o subject pode escolher **Solicitar encerramento**. O pedido é ligado à sessão e auditado, e todos os owners ativos daquele tenant veem-no em tempo real no painel.
- Owner decide **Encerrar suporte** (revogação imediata conforme DEC-034) ou **Manter suporte**, com auditoria. Subject recebe atualização; outros attendants não veem nem podem emitir o pedido.
- Na ausência de decisão, a sessão de 30 minutos **continua** até revogação manual ou expiração natural; pedido não estende nem pausa o TTL. O prazo máximo de resposta dos owners será decidido separadamente. Estado persiste para reconexões e pedido aberto fecha ao terminar a sessão.

## JRN-15 — Sessão Clerk sem MFA no MVP

- **Confirmado (DEC-028):** sem MFA para superadmin, owner e attendant. A decisão antiga DEC-027 está substituída.
- **Fluxo:** login Clerk → selecionar clínica A (owner) ou B (attendant) → backend confere role/membership D1 e tenant em cada pedido → utilizar funções autorizadas sem desafio MFA.
- **Alternativas:** sessão ausente, role insuficiente ou flag privada superadmin inválida negam acesso. Suporte próprio ainda exige motivo, TTL, auditoria dupla, sessão segura e autorização do subject.
- **Requisitos:** REQ-001/002/005/006/007; REQ-009 adiado.

## Validação necessária

Revisar as jornadas com o responsável pelo produto e uma clínica piloto, em especial: permissões administrativas, durações e regras de disponibilidade dos recursos, cancelamento, confirmação ao contato e ativação do WhatsApp. Registrar as respostas em [decisões](decisions.md) e ajustar os requisitos ligados às jornadas afetadas.
