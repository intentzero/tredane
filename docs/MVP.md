# Tredane — escopo inicial do MVP

**Estado:** proposta de produto e plano de implementação, 23 de outubro de 2026. Este documento distingue decisões confirmadas de propostas para a primeira entrega.

## Objetivo

Permitir que uma clínica de estética receba e acompanhe contatos pelo WhatsApp, organize oportunidades em um pipeline, marque horários em uma agenda própria e use IA para apoiar a equipe de atendimento. A primeira entrega deve provar o fluxo completo com uma clínica piloto antes de ampliar automações.

## Decisões confirmadas

- Produto SaaS multi-tenant para clínicas de estética.
- Canais e módulos previstos: WhatsApp, IA, agenda e pipeline comercial.
- Stack definida: Cloudflare Workers, D1, Queues, R2 e Workflows; React, Hono e Drizzle.
- Agenda própria do Tredane no primeiro MVP. Regras confirmadas (DEC-008): duração fixa por serviço mais intervalo que ocupa sala/equipamento e profissional; expediente semanal e bloqueios pontuais; fuso por clínica; grade de 15 min; cancelamento e reagendamento sem prazo mínimo, com motivo obrigatório; “Horário proposto” não reserva horário.
- WhatsApp: o Tredane atua como Tech Provider na Meta e o responsável (owner) conecta a conta da clínica pelo Embedded Signup, com apoio do Tredane no piloto (DEC-009).
- IA: Claude via Cloudflare AI Gateway, com contexto limitado às mensagens recentes, primeiro nome, catálogo de serviços e etapa; dados guardados enquanto a clínica for cliente, exclusão de contato pelo responsável e exclusão total até 30 dias após o encerramento (DEC-011).
- Só o responsável configura serviços, profissionais, salas/equipamentos, disponibilidade e o número de WhatsApp (DEC-042).
- Interface mobile first (DEC-039); decisões de UX: “Agendado” sem compromisso com aviso, IA só sob demanda, push via PWA, envio por modelo fora da janela de 24 h do WhatsApp e agenda de dia e semana (DEC-040).
- Design system do painel aprovado (DEC-041): paleta, tipografia, escalas, componentes e ícones Lucide em [docs/design](design/README.md); biblioteca de componentes a decidir por prova de conceito na F0 ([ADR-0013](adr/0013-design-system-components.md)); modo escuro fora do MVP.
- Integração com a API oficial do WhatsApp Business.
- Aplicação reativa, com atualizações em tempo real por WebSockets com hibernação em Durable Objects.
- **DEC-038:** um Durable Object por clínica, com SQLite nativo para dados operacionais e coordenação/WebSockets. D1 central mantém tenants, memberships, convites e suporte; R2 privado mantém anexos. Ver [ADR-0012](adr/0012-clinic-durable-object-sqlite.md).
- Somente atendente e responsável pela clínica acessam o painel no primeiro MVP; profissional é recurso de agenda, sem login.
- Atendente vê todas as conversas da própria clínica; responsável pode fazer tudo que o atendente faz, inclusive responder pelo WhatsApp e operar agendamentos.
- **Gestão de membros (opção B confirmada):** superadmin cria tenant e define o primeiro owner; owner pode convidar e remover somente attendants do seu tenant. Apenas superadmin cria/promove/substitui/remove owners. Memberships do mesmo usuário noutros tenants são independentes.
- **Revogação por tenant (DEC-026 confirmada):** ao remover um attendant de A, bloquear imediatamente novas APIs, eventos e WebSockets de A; informar a perda de acesso no painel, sem encerrar a sessão Clerk nem interromper memberships válidos em B. Sessões de suporte que representem esse attendant em A também perdem autorização.
- Um horário considera profissional e sala/equipamento necessários ao serviço.
- Identidade e sessões no Clerk, **sem Clerk Organizations**; um usuário pode integrar vários tenants via memberships no D1, com papéis distintos.
- Acesso global à Platform Admin por `privateMetadata.superadmin === true` (booleano exato) verificado pelo backend; a app permite criar, editar, suspender e iniciar exclusão lógica de tenants.
- Superadmin pode **solicitar** impersonação para um membro do tenant. Cada sessão exige **aprovação expressa de owner ativo do tenant (DEC-029)** antes de acesso clínico. Sessões temporárias mantêm motivo, papel do alvo, escopo e auditoria de actor + subject + owner aprovador. A impersonação usa **sessão própria do Tredane no D1**, sem Clerk impersonation ou actor tokens; handoff seguro, retenção e políticas de mutação serão definidos na F1; MFA não integra o MVP.

**Convites de atendentes (opção A, DEC-021):** o `owner` envia convite por e-mail para o seu tenant, com link de uso único. A pessoa pode criar conta Clerk ou entrar na conta existente, mesmo que já esteja associada a outras clínicas. A aceitação exige e-mail verificado correspondente e concede apenas membership `attendant` no tenant convidante. Convites e aceites ficam no D1; **valem 7 dias desde a emissão (DEC-022)**, sem extensão por login ou abertura do link. **Reenvio confirmado (DEC-023):** novo link válido por 7 dias e invalidação imediata do anterior. **Limites DEC-024:** intervalo mínimo de 10 minutos entre reenvios e no máximo 5 por janela móvel de 24 horas, por tenant/e-mail; tentativa bloqueada não invalida link atual. **Cancelamento DEC-025:** qualquer owner da clínica cancela convite pendente dela, ainda que outro owner o tenha emitido; o link fica inválido imediatamente e há auditoria, sem afetar memberships existentes.

**DEC-029 — Aprovação por sessão de suporte:** owner ativo da clínica aprova/rejeita cada solicitação do superadmin, vinculada a actor/subject/tenant/motivo/escopo; nenhum acesso clínico é liberado por pedido pendente. Aprovação não é permanente. DEC-030 fixa pedido em tempo real no painel dos owners e aviso por e-mail, com decisão sempre dentro do Tredane após login Clerk. Prazo do pedido fixado em **24 horas** (DEC-031) desde a criação, com sessão aprovada de 30 minutos (DEC-032). [ADR-0011](adr/0011-owner-approval-for-support.md).

**Prazo dos pedidos de suporte (DEC-031):** o owner tem até 24 horas desde a emissão para aprovar ou rejeitar a solicitação pendente. Depois do prazo, o backend bloqueia a aprovação e exige novo pedido, mesmo que o e-mail seja lido depois. A sessão aprovada dentro da janela tem TTL de 30 minutos (DEC-032). [ADR-0011](adr/0011-owner-approval-for-support.md).

**DEC-032 — 30 minutos de suporte:** após aprovação, sessão própria do superadmin dura no máximo 30 minutos desde ativação. Vencimento e encerramento antecipado bloqueiam HTTP/WebSocket do suporte; a sessão Clerk normal permanece. Handoff, uso, refresh e reconexão não prolongam o prazo. Pedido pendente continua a ter 24 horas (DEC-031); continuação requer novo pedido e aprovação (DEC-033). [ADR-0007](adr/0007-support-impersonation.md).

**DEC-033 — Sem extensão:** depois de 30 minutos, o superadmin que necessitar de mais tempo abre **nova solicitação** e espera **nova aprovação de owner ativo da clínica** antes de ganhar outra sessão de 30 minutos. A sessão anterior não é renovada, e suas credenciais ou aprovação não podem ser reutilizadas. [ADR-0011](adr/0011-owner-approval-for-support.md).

**DEC-034 — Encerramento de suporte ativo:** qualquer owner ativo da clínica pode interromper uma sessão de suporte, mesmo que outro owner a tenha aprovado; superadmin actor pode terminar a sua própria. A transição auditada no D1 bloqueia HTTP, WebSocket e credenciais daquele suporte imediatamente, preservando memberships e Clerk. Voltar a trabalhar exige novo pedido/owner (DEC-033). [ADR-0011](adr/0011-owner-approval-for-support.md).

**Avisos de início e término (DEC-035):** quando sessão aprovada realmente começa, owners ativos da clínica recebem **e-mail de início** e acompanham estado/tempo restante no painel. Ao terminar por expiração ou encerramento antecipado, o painel e a auditoria são atualizados em tempo real, **sem e-mail de encerramento**. E-mail não autoriza acesso nem contém dados clínicos/credenciais e sua falha não bloqueia sessão. [ADR-0011](adr/0011-owner-approval-for-support.md).

**Visibilidade do suporte (DEC-036):** todos os owners acompanham sessões ativas no painel e o **utilizador representado** vê aviso contextual de suporte na sua própria Clinic App enquanto o superadmin atua no seu contexto. Outros attendants não são notificados; não há login Clerk em nome do utilizador nem novos privilégios. Ao terminar a sessão, o aviso é atualizado/removido, inclusive após reconexão. E-mail de início continua apenas para owners (DEC-035). [ADR-0011](adr/0011-owner-approval-for-support.md).

**Pedido de encerramento pelo utilizador representado (DEC-037):** enquanto o aviso contextual estiver ativo, o subject pode selecionar **Solicitar encerramento**; owners ativos da clínica veem a solicitação no painel e decidem encerrar ou manter, com auditoria. A solicitação **não interrompe automaticamente** nem prolonga a sessão, que permanece limitada aos 30 minutos originais (DEC-032); o subject não ganha poder de revogação (DEC-034). Prazo máximo de resposta dos owners ainda em aberto. [ADR-0011](adr/0011-owner-approval-for-support.md).

**Notificação de suporte (DEC-030):** owners ativos da clínica recebem o pedido no painel em tempo real e aviso por e-mail, com link para abrir solicitação no Tredane. Aprovar/Rejeitar só dentro da Clinic App com Clerk login e membership owner validada pelo backend; clicar no e-mail não concede acesso nem aprova. [ADR-0011](adr/0011-owner-approval-for-support.md).

**Sem MFA no MVP (DEC-028):** nenhuma role exige MFA, incluindo superadmin e owner. Sessões continuam no Clerk; o Worker valida `privateMetadata.superadmin === true`, memberships/roles por tenant no D1 e sessões próprias de suporte. Não implementar desafio, guardas ou step-up MFA nesta fase. DEC-027 substituída; rever MFA apenas depois do MVP. [ADR-0010](adr/0010-role-scoped-mfa.md).

## Documentos de definição

O [épico #1](https://github.com/intentzero/tredane/issues/1) acompanha a definição. Os documentos abaixo detalham propostas e decisões sem substituir este resumo:

- [Conceito da landing page](product/landing-page-concept.md) — comunicação proposta, sem alterar o escopo ou indicar produto já disponível.
- [Atores e permissões](product/actors-permissions.md)
- [Jornadas](product/journeys.md)
- [Requisitos e critérios de aceite](product/requirements.md)
- [Decisões e questões abertas](product/decisions.md)
- [Estados e eventos propostos](product/states.md)
- [Cenários de aceite](product/acceptance.md)
- [Fronteira de dados entre clínicas](product/tenant-boundaries.md)
- [Especificação de UI/UX do painel](product/ux-ui.md) (telas, estados visíveis e critérios de UX)
- [Mocks e guia de implementação da interface](design/README.md): 29 telas mobile, componentes, tokens e previews
- [Registro de hipóteses a validar](product/validation-register.md) e [auditoria do Issue #1 (23/10/2026)](product/definition-audit-2026-10-23.md) — acompanhamento, não decisões novas.

## Documentação de arquitetura e execução

- [Arquitetura de referência](architecture/overview.md) e [modelo lógico D1 central/SQLite por clínica](architecture/data-model.md).
- ADRs: [Cloudflare-native](adr/0001-cloudflare-native.md), [topologia D1](adr/0002-d1-topology.md), [Durable Objects e tempo real](adr/0003-durable-objects-realtime.md), [IA com revisão humana](adr/0004-ai-human-in-loop.md) e [consistência da agenda](adr/0005-d1-booking-consistency.md).
- [Plano de implementação proposto](implementation/plan.md).
- [ADR Clerk e Platform Admin](adr/0006-clerk-platform-admin.md), [ADR Impersonação de suporte](adr/0007-support-impersonation.md) e [contratos de identidade/admin](architecture/identity-and-admin.md).

Clerk, ausência de Organizations, multi-membership e Platform Admin ficam agora **confirmados**. Topologia resolvida por DEC-038; continuam em aberto: protocolo de revogação D1/DO, migrações/recuperação por clínica, fluxo de ligação do WhatsApp, política de dados reais, proteção do handoff e capacidades de manutenção das sessões próprias de suporte. Plano, custo e residência do Clerk: tratados como pré-condição de go-live (DEC-043).

## Recorte proposto para a primeira entrega

**Usuários da Clinic App:** atendente e responsável da clínica. Ambos veem todas as conversas da clínica a que estão associados; um usuário pode ter vários memberships com papéis distintos, selecionando um tenant por contexto/aba. O contato interage pelo WhatsApp; não precisa de conta Tredane. Profissional não tem login no MVP.

**Platform Admin App (novo recorte interno):** superadmin confirmado no backend via `privateMetadata.superadmin === true` pode gerir ciclo de vida de tenants e iniciar sessão de suporte/impersonação como usuário autorizado de um tenant. A impersonação é sempre atribuída ao ator real, limitada pelo papel do alvo e pela política de suporte; não cria privilégio irrestrito de leitura de conteúdos.

**Fluxo principal:**

1. Uma mensagem chega ao número de WhatsApp da clínica.
2. O Tredane identifica a clínica e cria ou atualiza o contato e a conversa, sem duplicar mensagens repetidas pelo provedor.
3. A conversa aparece em uma caixa de entrada, associada a uma oportunidade no pipeline.
4. A equipe responde, altera a etapa da oportunidade e pode consultar uma sugestão de resposta gerada por IA.
5. A equipe consulta a disponibilidade e confirma um agendamento na agenda própria.
6. A oportunidade e a conversa mostram o agendamento e o histórico de ações.
7. Mudanças de mensagens, pipeline e agenda chegam às sessões abertas da mesma clínica sem atualização manual da página.

**Etapas iniciais propostas para o pipeline:** novo contato, em atendimento, horário proposto, agendado, concluído e perdido. As etapas devem ser configuráveis por clínica após validar o fluxo piloto; até lá, evitar automações dependentes de nomes fixos.

**Papel da IA no MVP:** sugerir respostas para revisão por uma pessoa e resumir a conversa para a equipe. Mensagens sugeridas pela IA só são enviadas após ação explícita do atendente ou do responsável. Respostas automáticas e ações autônomas ficam para uma etapa posterior, com regras de confiança, limites e transferência para humano.

## Requisitos de aceite

- Uma clínica não consegue ler ou alterar contatos, mensagens, oportunidades, agenda ou arquivos de outra clínica, inclusive ao manipular IDs diretamente na API.
- Atendente e responsável veem todas as conversas da própria clínica e podem responder, mover oportunidades e operar agendamentos, sempre dentro dela.
- Uma conexão WebSocket só recebe eventos da clínica autorizada. Troca de clínica ou de permissão exige nova autorização; uma conexão antiga não continua acessando dados após revogação.
- Cada mensagem recebida ou enviada tem origem, horário, estado e identificador externo quando houver. Reentrega de webhook não cria mensagem duplicada.
- Uma conversa mantém o vínculo com o contato, a oportunidade e o responsável; a equipe consegue encontrá-la e continuar o atendimento.
- O pipeline mostra etapa, responsável, último contato e próximo compromisso; alterações relevantes ficam registradas.
- A agenda impede dois agendamentos confirmados no mesmo intervalo quando compartilham o profissional ou a sala/equipamento exigidos. Durações, buffers e regras de disponibilidade serão validados com a clínica piloto.
- O envio de mensagem apresenta sucesso ou falha observável para a equipe; falhas transitórias podem ser processadas novamente sem envio duplicado.
- A sugestão de IA é identificada como sugestão, pode ser editada e não é enviada sem revisão humana.
- O piloto demonstra, em ambiente de teste, o fluxo completo de mensagem recebida até agendamento confirmado.
- Após desconexão ou hibernação do Durable Object, o painel reconcilia seu estado com a API; eventos perdidos não deixam a interface permanentemente desatualizada.

## Arquitetura inicial proposta

- **React:** Clinic App (Inbox, pipeline, agenda) e Platform Admin App interna, com fronteiras de autorização separadas.
- **Clerk:** autenticação e sessões de usuários, `privateMetadata.superadmin` com verificação no backend, **sem Organizations**.
- **Worker com Hono:** API, verificação da sessão Clerk, autorização por membership no D1, operações de Platform Admin e regras de negócio.
- **D1 central:** clínicas, memberships N:N, convites, pedidos/sessões de suporte e auditoria administrativa. Clerk permanece identidade. Drizzle/adaptadores seguem o backend escolhido; não converter o scaffold D1 em persistência operacional definitiva.
- **Durable Object + SQLite por clínica (DEC-038):** dados operacionais de contatos, conversas, mensagens, oportunidades, serviços, recursos, agenda, histórico e outbox persistem no SQLite privado do DO, que coordena operações e WebSockets. Worker valida identidade/integração e autorização antes de rotear; DO verifica coerência do contexto. Memória não é fonte de verdade. Transações locais não incluem chamadas externas.
- **Queues:** processamento de eventos recebidos e envio assíncrono, com idempotência e tratamento de falhas.
- **R2:** anexos, com acesso autorizado por clínica e sem URLs públicas permanentes.
- **Workflows:** processos de múltiplas etapas, como lembretes e acompanhamentos, quando esses fluxos forem definidos. O fluxo principal não deve depender de um workflow apenas para persistir uma mensagem.

**Limite do isolamento:** SQLite por DO separa os dados operacionais de cada clínica; roteamento, autorização, D1 central, filas, suporte e R2 continuam exigindo isolamento/testes. Revogação D1/DO, migrações versionadas por instância, capacidade e recuperação com reconciliação de efeitos externos são gates de implementação. Ver [ADR-0012](adr/0012-clinic-durable-object-sqlite.md).

**Sincronização da interface:** persistir a alteração antes de publicar o evento ao Durable Object; enviar aos clientes apenas eventos da clínica autorizada. O React mantém um estado local atualizado por eventos, mas refaz a leitura do estado canônico ao conectar ou reconectar. Metadados mínimos da conexão devem sobreviver à hibernação; dados críticos não podem depender da memória do objeto. A API de hibernação da Cloudflare permite manter os WebSockets conectados enquanto o objeto sai da memória.

O número e a conta de WhatsApp de cada clínica, a implementação técnica da revogação por tenant, o protocolo seguro de handoff e revogação das sessões próprias de suporte, o provedor de IA e a política de retenção ainda precisam ser definidos antes de integrar serviços reais. Credenciais e tokens nunca entram no repositório.

## Estado da execução

O scaffold técnico da fase F0 existe como checkpoint anterior à DEC-038: React/Vite, Hono/Worker, esquema mínimo D1/Drizzle, migração local, fixtures fictícias, testes e CI. A definição de produto mantém-se em revisão; o scaffold não altera requisitos nem autoriza dados reais. Ver [F0](implementation/f0.md).

## Sequência de implementação

1. **Base do projeto:** estrutura de frontend e API, ambiente local, migrações, validação, observabilidade básica e CI.
2. **Isolamento multi-tenant:** autenticação, associação de usuários à clínica, permissões, roteamento ao Durable Object da clínica e testes de acesso cruzado.
3. **Atendimento e pipeline:** contatos, oportunidades, caixa de entrada e ações da equipe com dados de teste; atualização reativa entre duas sessões da mesma clínica.
4. **WhatsApp oficial:** verificação de webhook, recebimento, idempotência, envio, estados de entrega e tratamento de falhas.
5. **Agenda própria:** recursos, disponibilidade, confirmação, cancelamento e prevenção de conflitos.
6. **IA assistiva:** sugestões e resumos revisados por humano, com registro da origem e avaliação no piloto.
7. **Piloto:** validar o fluxo completo com uma clínica e ajustar etapas, campos, permissões e automações com base no uso real.

## Fora do primeiro MVP

Prontuário ou registro clínico, pagamentos, estoque, integração com agendas externas, campanhas em massa, bot que responde ou agenda sozinho, relatórios avançados e painel de profissional. **A Platform Admin interna passa a integrar o escopo**, sem acesso operacional irrestrito aos dados clínicos. Esses itens podem entrar no backlog após validação do atendimento e agendamento.

## Decisões pendentes antes de integrar serviços reais

1. Registro do Tredane como Tech Provider na Meta, custos e modelos de mensagem do WhatsApp (fluxo definido em DEC-009). Bloqueio atual: o Tredane não tem CNPJ para a verificação do negócio na Meta (VAL-13).
2. Valores reais de serviços, durações e jornadas da clínica piloto (regras definidas em DEC-008).
3. Definido: Clerk sem Organizations, memberships N:N e opção B para gestão de membros (owner gere attendants; superadmin gere owners). Revogação por tenant definida em DEC-026; em aberto o mecanismo técnico e testes de propagação WebSocket, integrações e medidas adicionais de antiabuso; MFA fora do MVP (DEC-028).
4. Revisão jurídica e AI Gateway sem registro de conteúdo (provedor definido em DEC-011); como definir controles de acesso, auditoria e aprovação da sessão de suporte implementada no Tredane?
5. Revisão jurídica (LGPD) da retenção e exclusão definidas em DEC-011 (REQ-071). Dossiê para o advogado: [legal-review-brief.md](product/legal-review-brief.md).
6. Topologia já definida em DEC-038: validar implementação, migrações, capacidade, recuperação e revogação entre D1 central e SQLite/DO por clínica antes de dados reais.

Estas pendências não bloqueiam a estrutura inicial nem a implementação do fluxo com dados de teste. Bloqueiam a conexão de números reais, o tratamento de dados reais e automações de envio.

## Referências técnicas

- [Cloudflare: WebSockets com hibernação em Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).
- [Cloudflare: armazenamento privado de cada Durable Object](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).
- [Cloudflare: opções de isolamento de dados para SaaS](https://developers.cloudflare.com/use-cases/saas/data-isolation/).
