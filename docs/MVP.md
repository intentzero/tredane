# Tredane — escopo inicial do MVP

**Estado:** proposta de produto e plano de implementação, 23 de outubro de 2026. Este documento distingue decisões confirmadas de propostas para a primeira entrega.

## Objetivo

Permitir que uma clínica de estética receba e acompanhe contatos pelo WhatsApp, organize oportunidades em um pipeline, marque horários em uma agenda própria e use IA para apoiar a equipe de atendimento. A primeira entrega deve provar o fluxo completo com uma clínica piloto antes de ampliar automações.

## Decisões confirmadas

- Produto SaaS multi-tenant para clínicas de estética.
- Canais e módulos previstos: WhatsApp, IA, agenda e pipeline comercial.
- Stack definida: Cloudflare Workers, D1, Queues, R2 e Workflows; React, Hono e Drizzle.
- Agenda própria do Tredane no primeiro MVP.
- Integração com a API oficial do WhatsApp Business.
- Aplicação reativa, com atualizações em tempo real por WebSockets com hibernação em Durable Objects.
- Avaliar um Durable Object por clínica como fronteira de coordenação e isolamento do estado em tempo real.
- Somente atendente e responsável pela clínica acessam o painel no primeiro MVP; profissional é recurso de agenda, sem login.
- Um horário considera profissional e sala/equipamento necessários ao serviço.

## Documentos de definição

O [épico #1](https://github.com/intentzero/tredane/issues/1) acompanha a definição. Os documentos abaixo detalham propostas e decisões sem substituir este resumo:

- [Atores e permissões](product/actors-permissions.md)
- [Jornadas](product/journeys.md)
- [Requisitos e critérios de aceite](product/requirements.md)
- [Decisões e questões abertas](product/decisions.md)
- [Estados e eventos propostos](product/states.md)
- [Cenários de aceite](product/acceptance.md)

## Recorte proposto para a primeira entrega

**Usuários:** atendente e responsável da clínica. O contato interage pelo WhatsApp; não precisa de conta no Tredane. Profissional e operador da plataforma não têm perfil de acesso ao painel no primeiro MVP.

**Fluxo principal:**

1. Uma mensagem chega ao número de WhatsApp da clínica.
2. O Tredane identifica a clínica e cria ou atualiza o contato e a conversa, sem duplicar mensagens repetidas pelo provedor.
3. A conversa aparece em uma caixa de entrada, associada a uma oportunidade no pipeline.
4. A equipe responde, altera a etapa da oportunidade e pode consultar uma sugestão de resposta gerada por IA.
5. A equipe consulta a disponibilidade e confirma um agendamento na agenda própria.
6. A oportunidade e a conversa mostram o agendamento e o histórico de ações.
7. Mudanças de mensagens, pipeline e agenda chegam às sessões abertas da mesma clínica sem atualização manual da página.

**Etapas iniciais propostas para o pipeline:** novo contato, em atendimento, horário proposto, agendado, concluído e perdido. As etapas devem ser configuráveis por clínica após validar o fluxo piloto; até lá, evitar automações dependentes de nomes fixos.

**Papel da IA no MVP:** sugerir respostas para revisão por uma pessoa e resumir a conversa para a equipe. Mensagens geradas pela IA só são enviadas após ação explícita do atendente. Respostas automáticas e ações autônomas ficam para uma etapa posterior, com regras de confiança, limites e transferência para humano.

## Requisitos de aceite

- Uma clínica não consegue ler ou alterar contatos, mensagens, oportunidades, agenda ou arquivos de outra clínica, inclusive ao manipular IDs diretamente na API.
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

- **React:** painel da equipe, com caixa de entrada, pipeline e agenda.
- **Worker com Hono:** API, autenticação/autorização, webhooks e regras de negócio.
- **D1 com Drizzle:** clínicas, membros, contatos, conversas, mensagens, oportunidades, recursos e agendamentos. Toda operação de negócio usa o tenant derivado da identidade autenticada ou da integração verificada, nunca de um ID livre fornecido pelo cliente.
- **Durable Objects:** proposta de uma instância por clínica para conexões WebSocket, distribuição de eventos e coordenação local. A instância usa armazenamento próprio apenas para estado que precise sobreviver à hibernação; o sistema de registro das entidades de negócio continua no D1. O Worker valida a identidade e a associação à clínica antes de rotear a conexão ao objeto correspondente.
- **Queues:** processamento de eventos recebidos e envio assíncrono, com idempotência e tratamento de falhas.
- **R2:** anexos, com acesso autorizado por clínica e sem URLs públicas permanentes.
- **Workflows:** processos de múltiplas etapas, como lembretes e acompanhamentos, quando esses fluxos forem definidos. O fluxo principal não deve depender de um workflow apenas para persistir uma mensagem.

**Limite do isolamento:** um Durable Object por clínica separa seu estado e suas conexões, mas não separa automaticamente os dados em um D1 compartilhado ou os arquivos em R2. O MVP deve aplicar escopo por clínica em toda consulta e mutação, chaves/rotas de arquivo específicas por clínica e testes de acesso cruzado. Antes do piloto, reavaliar se o volume e os requisitos de isolamento pedem um D1 por clínica.

**Sincronização da interface:** persistir a alteração antes de publicar o evento ao Durable Object; enviar aos clientes apenas eventos da clínica autorizada. O React mantém um estado local atualizado por eventos, mas refaz a leitura do estado canônico ao conectar ou reconectar. Metadados mínimos da conexão devem sobreviver à hibernação; dados críticos não podem depender da memória do objeto. A API de hibernação da Cloudflare permite manter os WebSockets conectados enquanto o objeto sai da memória.

O número e a conta de WhatsApp de cada clínica, o mecanismo de autenticação, o provedor de IA e a política de retenção ainda precisam ser definidos antes de integrar serviços reais. Credenciais e tokens nunca entram no repositório.

## Sequência de implementação

1. **Base do projeto:** estrutura de frontend e API, ambiente local, migrações, validação, observabilidade básica e CI.
2. **Isolamento multi-tenant:** autenticação, associação de usuários à clínica, permissões, roteamento ao Durable Object da clínica e testes de acesso cruzado.
3. **Atendimento e pipeline:** contatos, oportunidades, caixa de entrada e ações da equipe com dados de teste; atualização reativa entre duas sessões da mesma clínica.
4. **WhatsApp oficial:** verificação de webhook, recebimento, idempotência, envio, estados de entrega e tratamento de falhas.
5. **Agenda própria:** recursos, disponibilidade, confirmação, cancelamento e prevenção de conflitos.
6. **IA assistiva:** sugestões e resumos revisados por humano, com registro da origem e avaliação no piloto.
7. **Piloto:** validar o fluxo completo com uma clínica e ajustar etapas, campos, permissões e automações com base no uso real.

## Fora do primeiro MVP

Prontuário ou registro clínico, pagamentos, estoque, integração com agendas externas, campanhas em massa, bot que responde ou agenda sozinho, relatórios avançados e painéis para profissional ou operador da plataforma. Esses itens podem entrar no backlog após validação do atendimento e agendamento.

## Decisões pendentes antes de integrar serviços reais

1. Como cada clínica conectará seu número à API oficial do WhatsApp Business e quem administrará essa conta.
2. Quais serviços, durações, buffers, bloqueios e regras de disponibilidade a clínica piloto precisa para profissional e sala/equipamento.
3. Quais permissões exatas terão atendente e responsável, e qual provedor de identidade será usado.
4. Qual provedor de identidade e qual provedor de IA serão usados.
5. Quais dados pessoais são necessários, por quanto tempo serão guardados e como a clínica atenderá pedidos de acesso ou exclusão.
6. Se o D1 compartilhado com escopo rigoroso por clínica atende ao piloto ou se alguma categoria de dados exige banco separado por clínica.

Estas pendências não bloqueiam a estrutura inicial nem a implementação do fluxo com dados de teste. Bloqueiam a conexão de números reais, o tratamento de dados reais e automações de envio.

## Referências técnicas

- [Cloudflare: WebSockets com hibernação em Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).
- [Cloudflare: armazenamento privado de cada Durable Object](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).
- [Cloudflare: opções de isolamento de dados para SaaS](https://developers.cloudflare.com/use-cases/saas/data-isolation/).
