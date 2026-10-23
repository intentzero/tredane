# Tredane — escopo inicial do MVP

**Estado:** proposta de produto e plano de implementação, 23 de outubro de 2026, atualizada com a sessão de decisões do mesmo dia ([decisões](product/decisions.md)). Este documento distingue decisões confirmadas de propostas para a primeira entrega.

## Objetivo

Permitir que uma clínica de estética receba e acompanhe contatos pelo WhatsApp, organize oportunidades em um pipeline, marque horários em uma agenda própria e use IA para apoiar a equipe de atendimento. A primeira entrega deve provar o fluxo completo com uma clínica piloto antes de ampliar automações.

## Decisões confirmadas

- Produto SaaS multi-tenant para clínicas de estética.
- Canais e módulos previstos: WhatsApp, IA, agenda e pipeline comercial.
- Stack definida: Cloudflare Workers, D1, Queues, R2 e Workflows; React, Hono e Drizzle.
- Agenda própria do Tredane no primeiro MVP.
- Integração com a API oficial do WhatsApp Business.
- Aplicação reativa, com atualizações em tempo real por WebSockets com hibernação em Durable Objects.
- Um Durable Object por clínica coordena conexões WebSocket e eventos (DEC-005).
- Um D1 dedicado por clínica para os dados de negócio e um D1 central de controle para identidade, associações, clínicas e roteamento; R2 privado com prefixo por clínica (DEC-010, [ADR-0002](adr/0002-d1-topology.md)).
- Somente atendente e responsável pela clínica acessam o painel da clínica no primeiro MVP; profissional é recurso de agenda, sem login. A equipe do Tredane usa um app separado de superadmin, identificado pelo metadado privado `superadmin: true` do Clerk, sem acesso a conteúdo de clínica salvo concessão temporária do responsável (DEC-012, DEC-013, [ADR-0006](adr/0006-superadmin-control-plane.md)).
- Autenticação pelo Clerk para todos (código por e-mail); uma conta pode pertencer a várias clínicas e escolhe a clínica ativa num seletor; vínculos e papéis ficam no D1 central (DEC-007).
- Só o responsável administra membros e configurações da clínica (serviços, profissionais, salas/equipamentos, disponibilidade) (DEC-007).
- Atendente vê todas as conversas da própria clínica; responsável pode fazer tudo que o atendente faz, inclusive responder pelo WhatsApp e operar agendamentos.
- Um horário considera profissional e sala/equipamento necessários ao serviço. Cada serviço tem duração fixa mais um intervalo após o atendimento que ocupa a sala/equipamento e o profissional; expediente semanal e bloqueios pontuais, fuso por clínica e grade de 15 min; cancelar ou reagendar não tem prazo mínimo e exige motivo; “Horário proposto” não reserva horário (DEC-008).
- WhatsApp: o Tredane atua como Tech Provider na Meta e o responsável conecta a conta da clínica pelo Embedded Signup, com apoio da equipe do Tredane no piloto (DEC-009).
- IA: Claude via Cloudflare AI Gateway, com contexto limitado às mensagens recentes, primeiro nome, catálogo de serviços e etapa; dados guardados enquanto a clínica for cliente, exclusão de contato pelo responsável e exclusão total até 30 dias após o encerramento (DEC-011).
- Interface mobile first: o fluxo piloto completo funciona no celular; tablet e desktop são ampliações ([DEC-017](product/decisions.md), [UI/UX](product/ux-ui.md)). Painel instalável como PWA com push de nova conversa; sugestão da IA só sob demanda; fora da janela de 24 h do WhatsApp o envio é por modelo aprovado; agenda com visão de dia e de semana (DEC-018).

## Documentos de definição

O [épico #1](https://github.com/intentzero/tredane/issues/1) acompanha a definição. Os documentos abaixo detalham propostas e decisões sem substituir este resumo:

- [Atores e permissões](product/actors-permissions.md)
- [Jornadas](product/journeys.md)
- [Requisitos e critérios de aceite](product/requirements.md)
- [Decisões e questões abertas](product/decisions.md)
- [Estados e eventos propostos](product/states.md)
- [Cenários de aceite](product/acceptance.md)
- [Fronteira de dados entre clínicas](product/tenant-boundaries.md)
- [Especificação de UI/UX do painel](product/ux-ui.md) (mobile first confirmado; telas, estados visíveis e critérios de UX propostos)

## Documentação de arquitetura e execução

- [Arquitetura de referência](architecture/overview.md) e [modelo lógico D1](architecture/data-model.md).
- ADRs: [Cloudflare-native](adr/0001-cloudflare-native.md), [topologia D1](adr/0002-d1-topology.md), [Durable Objects e tempo real](adr/0003-durable-objects-realtime.md), [IA com revisão humana](adr/0004-ai-human-in-loop.md), [consistência da agenda](adr/0005-d1-booking-consistency.md) e [app de superadmin](adr/0006-superadmin-control-plane.md).
- [Plano de implementação proposto](implementation/plan.md).

Os ADRs registram as decisões de 23/10/2026, mas ainda há pendências técnicas e jurídicas: o mecanismo para o Worker abrir o D1 de cada clínica, o acesso do superadmin a conteúdo e a revisão LGPD antes de dados reais.

## Recorte proposto para a primeira entrega

**Usuários:** atendente e responsável da clínica. Ambos veem todas as conversas da própria clínica e podem conduzir atendimento e agendamentos; o responsável pode executar todas as ações do atendente. O contato interage pelo WhatsApp; não precisa de conta no Tredane. Profissional não tem acesso. A equipe do Tredane não acessa o painel da clínica; usa o app de superadmin para criar e ativar clínicas e dar suporte técnico.

**Fluxo principal:**

1. Uma mensagem chega ao número de WhatsApp da clínica.
2. O Tredane identifica a clínica e cria ou atualiza o contato e a conversa, sem duplicar mensagens repetidas pelo provedor.
3. A conversa aparece em uma caixa de entrada, associada a uma oportunidade no pipeline.
4. A equipe responde, altera a etapa da oportunidade e pode consultar uma sugestão de resposta gerada por IA.
5. A equipe consulta a disponibilidade e confirma um agendamento na agenda própria.
6. A oportunidade e a conversa mostram o agendamento e o histórico de ações.
7. Mudanças de mensagens, pipeline e agenda chegam às sessões abertas da mesma clínica sem atualização manual da página.

**Etapas iniciais propostas para o pipeline:** novo contato, em atendimento, horário proposto, agendado, concluído e perdido. As etapas devem ser configuráveis por clínica após validar o fluxo piloto; até lá, evitar automações dependentes de nomes fixos.

**Papel da IA no MVP:** sugerir respostas para revisão por uma pessoa e resumir a conversa para a equipe. Mensagens sugeridas pela IA só são enviadas após ação explícita do atendente ou do responsável. Respostas automáticas e ações autônomas ficam para uma etapa posterior, com regras de confiança, limites e transferência para humano. Provedor e contexto permitido: DEC-011.

## Requisitos de aceite

- Uma clínica não consegue ler ou alterar contatos, mensagens, oportunidades, agenda ou arquivos de outra clínica, inclusive ao manipular IDs diretamente na API.
- Atendente e responsável veem todas as conversas da própria clínica e podem responder, mover oportunidades e operar agendamentos, sempre dentro dela.
- Uma conexão WebSocket só recebe eventos da clínica autorizada. Troca de clínica ou de permissão exige nova autorização; uma conexão antiga não continua acessando dados após revogação.
- Cada mensagem recebida ou enviada tem origem, horário, estado e identificador externo quando houver. Reentrega de webhook não cria mensagem duplicada.
- Uma conversa mantém o vínculo com o contato, a oportunidade e o responsável; a equipe consegue encontrá-la e continuar o atendimento.
- O pipeline mostra etapa, responsável, último contato e próximo compromisso; alterações relevantes ficam registradas.
- A agenda impede dois agendamentos confirmados no mesmo intervalo quando compartilham o profissional ou a sala/equipamento exigidos. Duração e intervalo vêm do serviço; as jornadas e os serviços reais serão carregados com a clínica piloto.
- O envio de mensagem apresenta sucesso ou falha observável para a equipe; falhas transitórias podem ser processadas novamente sem envio duplicado.
- A sugestão de IA é identificada como sugestão, pode ser editada e não é enviada sem revisão humana.
- O piloto demonstra, em ambiente de teste, o fluxo completo de mensagem recebida até agendamento confirmado.
- Após desconexão ou hibernação do Durable Object, o painel reconcilia seu estado com a API; eventos perdidos não deixam a interface permanentemente desatualizada.

## Arquitetura inicial proposta

- **React:** painel da equipe, responsivo e mobile first, com caixa de entrada, pipeline e agenda.
- **Worker com Hono:** API, autenticação/autorização, webhooks e regras de negócio.
- **D1 com Drizzle:** D1 central de controle com usuários, sessões, associações, clínicas, mapa clínica → banco e roteamento de números; um D1 por clínica com contatos, conversas, mensagens, oportunidades, recursos e agendamentos. Toda operação de negócio usa a clínica derivada da identidade autenticada ou da integração verificada, nunca de um ID livre fornecido pelo cliente, e abre somente o banco dessa clínica.
- **Durable Objects:** uma instância por clínica para conexões WebSocket, distribuição de eventos e coordenação local. A instância usa armazenamento próprio apenas para estado que precise sobreviver à hibernação; o sistema de registro das entidades de negócio continua no D1. O Worker valida a identidade e a associação à clínica antes de rotear a conexão ao objeto correspondente.
- **Queues:** processamento de eventos recebidos e envio assíncrono, com idempotência e tratamento de falhas.
- **R2:** anexos, com acesso autorizado por clínica e sem URLs públicas permanentes.
- **App de superadmin:** app separado para a equipe do Tredane criar clínicas, provisionar o D1 da clínica, convidar o responsável e acompanhar ativação e saúde técnica, sem acesso implícito a conteúdo.
- **IA:** Claude via Cloudflare AI Gateway, atrás do adaptador de provedor do ADR-0004.
- **Workflows:** processos de múltiplas etapas, como lembretes e acompanhamentos, quando esses fluxos forem definidos. O fluxo principal não deve depender de um workflow apenas para persistir uma mensagem.

**Limite do isolamento:** o Durable Object e o D1 de cada clínica separam conexões e dados de negócio, mas o D1 central, as Queues, o R2 e os Workflows continuam compartilhados. O MVP deve resolver a clínica antes de abrir qualquer banco, manter o contexto de tenant em filas e workflows, usar prefixos de arquivo por clínica e testar acesso cruzado em todos esses pontos.

**Sincronização da interface:** persistir a alteração antes de publicar o evento ao Durable Object; enviar aos clientes apenas eventos da clínica autorizada. O React mantém um estado local atualizado por eventos, mas refaz a leitura do estado canônico ao conectar ou reconectar. Metadados mínimos da conexão devem sobreviver à hibernação; dados críticos não podem depender da memória do objeto. A API de hibernação da Cloudflare permite manter os WebSockets conectados enquanto o objeto sai da memória.

Antes de integrar serviços reais ainda faltam: a verificação do Tredane como Tech Provider na Meta, a configuração do AI Gateway sem registro de conteúdo e a revisão jurídica da retenção. Credenciais e tokens nunca entram no repositório.

## Sequência de implementação

1. **Base do projeto:** estrutura de frontend e API, ambiente local, migrações, validação, observabilidade básica e CI.
2. **Isolamento multi-tenant:** integração com o Clerk, D1 central, seletor de clínica, provisionamento do D1 por clínica (prova de conceito do roteamento), permissões, roteamento ao Durable Object da clínica, app de superadmin mínimo e testes de acesso cruzado.
3. **Atendimento e pipeline:** contatos, oportunidades, caixa de entrada e ações da equipe com dados de teste; atualização reativa entre duas sessões da mesma clínica.
4. **WhatsApp oficial:** verificação de webhook, recebimento, idempotência, envio, estados de entrega e tratamento de falhas.
5. **Agenda própria:** recursos, disponibilidade, confirmação, cancelamento e prevenção de conflitos.
6. **IA assistiva:** sugestões e resumos revisados por humano, com registro da origem e avaliação no piloto.
7. **Piloto:** validar o fluxo completo com uma clínica e ajustar etapas, campos, permissões e automações com base no uso real.

## Fora do primeiro MVP

Prontuário ou registro clínico, pagamentos, estoque, integração com agendas externas, campanhas em massa, bot que responde ou agenda sozinho, relatórios avançados e painel para profissional. Esses itens podem entrar no backlog após validação do atendimento e agendamento.

## Decisões pendentes antes de integrar serviços reais

1. Medições da F1 do D1 por clínica: limite de bindings, tempo de ativação e testes de acesso cruzado; o piloto usa bindings gerados no deploy ([ADR-0002](adr/0002-d1-topology.md)).
2. Custo, plano e residência dos dados de identidade do Clerk ([DEC-007](product/decisions.md)). O superadmin não exige segundo fator, risco aceito em [ADR-0006](adr/0006-superadmin-control-plane.md).
3. Revisão jurídica (LGPD) da retenção e exclusão, AI Gateway sem registro de conteúdo e não retenção pelo provedor de IA (DEC-011).
4. Verificação do Tredane como Tech Provider na Meta, custos, modelos de mensagem e janela de 24 h (DEC-009).
5. Aparelhos da clínica piloto ([Q-UX-01](product/ux-ui.md#11-questões-abertas-de-ux)) e modelos de mensagem do WhatsApp a cadastrar.

Estas pendências não bloqueiam a estrutura inicial nem a implementação do fluxo com dados de teste, exceto o item 1, que precisa de prova de conceito no início da fatia de isolamento. Bloqueiam a conexão de números reais, o tratamento de dados reais e automações de envio.

## Referências técnicas

- [Cloudflare: WebSockets com hibernação em Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).
- [Cloudflare: armazenamento privado de cada Durable Object](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).
- [Cloudflare: opções de isolamento de dados para SaaS](https://developers.cloudflare.com/use-cases/saas/data-isolation/).
