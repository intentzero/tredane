# Tredane

SaaS multi-tenant de atendimento para clínicas de estética. O produto reunirá conversas pelo WhatsApp, pipeline comercial, agenda e assistência por IA para a equipe, com atualizações em tempo real.

## Estado do projeto

O projeto está na definição do MVP. A primeira entrega proposta acompanha um contato desde a mensagem recebida pelo WhatsApp até o agendamento confirmado pela clínica. A IA começa sugerindo respostas e resumos para revisão humana.

O [escopo inicial do MVP](docs/MVP.md) registra o fluxo, os critérios de aceite, a sequência de implementação e as decisões pendentes.

## Decisões técnicas

- Interface: React.
- API: Hono em Cloudflare Workers.
- Dados relacionais: D1 com Drizzle.
- Processamento assíncrono: Cloudflare Queues.
- Arquivos: R2.
- Processos de múltiplas etapas: Cloudflare Workflows.
- Coordenação por clínica e WebSockets com hibernação: um Durable Object por clínica.
- Dados: um D1 por clínica e um D1 central de controle (identidade, associações, roteamento).
- Autenticação pelo Clerk (código por e-mail); uma conta pode acessar várias clínicas, com vínculos no D1 central.
- IA: Claude via Cloudflare AI Gateway, sempre com revisão humana.
- App separado de superadmin para a equipe do Tredane.
- Agenda própria do Tredane no primeiro MVP.
- Interface mobile first.
- WhatsApp pela API oficial do WhatsApp Business.

## Documentação de engenharia

- [Arquitetura e fluxos técnicos](docs/architecture/overview.md)
- [Modelo lógico de dados D1](docs/architecture/data-model.md)
- [ADRs — decisões arquiteturais](docs/adr/0001-cloudflare-native.md) (ver também [topologia D1](docs/adr/0002-d1-topology.md), [tempo real](docs/adr/0003-durable-objects-realtime.md), [IA assistiva](docs/adr/0004-ai-human-in-loop.md), [concorrência da agenda](docs/adr/0005-d1-booking-consistency.md) e [app de superadmin](docs/adr/0006-superadmin-control-plane.md))
- [Plano de implementação por fatias](docs/implementation/plan.md)

Os ADRs identificam decisões aceitas, propostas técnicas e temas ainda em aberto. Nenhum módulo de aplicação foi implementado apenas por adicionar esta documentação.

## Próximo marco

Preparar a estrutura de frontend e API, migrações, ambiente local e CI. Em seguida, implementar o isolamento entre clínicas, o fluxo principal e a atualização reativa entre sessões com dados de teste antes de conectar serviços reais.
