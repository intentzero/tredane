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
- Coordenação por clínica e WebSockets com hibernação: Cloudflare Durable Objects.
- Agenda própria do Tredane no primeiro MVP.
- WhatsApp pela API oficial do WhatsApp Business.

## Documentação de engenharia

- [Arquitetura e fluxos técnicos](docs/architecture/overview.md)
- [Modelo lógico de dados D1](docs/architecture/data-model.md)
- [ADRs — decisões arquiteturais](docs/adr/0001-cloudflare-native.md) (ver também [topologia D1](docs/adr/0002-d1-topology.md), [tempo real](docs/adr/0003-durable-objects-realtime.md), [IA assistiva](docs/adr/0004-ai-human-in-loop.md) e [concorrência da agenda](docs/adr/0005-d1-booking-consistency.md))
- [Plano de implementação por fatias](docs/implementation/plan.md)

Os ADRs identificam decisões aceitas, propostas técnicas e temas ainda em aberto. Nenhum módulo de aplicação foi implementado apenas por adicionar esta documentação.

## Identidade, Platform Admin e suporte

A identidade é feita com **Clerk sem Organizations**. Os vínculos de usuários com várias clínicas e papéis por tenant são guardados no D1. A aplicação interna Platform Admin usa a flag **`privateMetadata.superadmin === true`**, lida e validada no backend, para gerir o ciclo de vida de tenants. Uma função de impersonação de suporte permitirá agir no contexto de um usuário do tenant com auditoria de ator e alvo, duração limitada e sem acesso irrestrito; seu mecanismo final (Clerk actor tokens vs sessão própria) está em aberto.

Ver [ADR-0006](docs/adr/0006-clerk-platform-admin.md), [ADR-0007](docs/adr/0007-support-impersonation.md) e [contratos de identidade e administração](docs/architecture/identity-and-admin.md).

## Próximo marco

Preparar a estrutura de frontend e API, migrações, ambiente local e CI. Em seguida, implementar o isolamento entre clínicas, o fluxo principal e a atualização reativa entre sessões com dados de teste antes de conectar serviços reais.
