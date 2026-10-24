# Tredane

SaaS multi-tenant de atendimento para clínicas de estética. O produto reunirá conversas pelo WhatsApp, pipeline comercial, agenda e assistência por IA para a equipe, com atualizações em tempo real.

## Estado do projeto

O projeto está na definição do MVP. A primeira entrega proposta acompanha um contato desde a mensagem recebida pelo WhatsApp até o agendamento confirmado pela clínica. A IA começa sugerindo respostas e resumos para revisão humana.

O [escopo inicial do MVP](docs/MVP.md) registra o fluxo, os critérios de aceite, a sequência de implementação e as decisões pendentes.

## Decisões técnicas

- Interface: React.
- API: Hono em Cloudflare Workers.
- Dados: D1 central administrativo e SQLite nativo por DO/clínica para operação (DEC-038); migrações/adaptadores separados por backend.
- Processamento assíncrono: Cloudflare Queues.
- Arquivos: R2.
- Processos de múltiplas etapas: Cloudflare Workflows.
- Coordenação por clínica e WebSockets com hibernação: Cloudflare Durable Objects.
- Agenda própria do Tredane no primeiro MVP.
- WhatsApp pela API oficial do WhatsApp Business.

## Conceito da landing page

- [Conceito, mensagem, estrutura e direção visual](docs/product/landing-page-concept.md) — proposta documentada; CTA do piloto e execução visual ainda por fechar.

## Documentação de engenharia

- [Arquitetura e fluxos técnicos](docs/architecture/overview.md)
- [Modelo lógico D1 central/SQLite por clínica](docs/architecture/data-model.md)
- [ADRs — decisões arquiteturais](docs/adr/0001-cloudflare-native.md) (ver também [topologia D1](docs/adr/0002-d1-topology.md), [tempo real](docs/adr/0003-durable-objects-realtime.md), [IA assistiva](docs/adr/0004-ai-human-in-loop.md) e [concorrência da agenda](docs/adr/0005-d1-booking-consistency.md))
- [Plano de implementação por fatias](docs/implementation/plan.md)

Os ADRs identificam decisões aceitas, propostas técnicas e temas ainda em aberto. Nenhum módulo de aplicação foi implementado apenas por adicionar esta documentação.

## Executar a F0 localmente

A base da aplicação React + Hono + Worker está na branch de implementação da F0. Apenas dados fictícios são permitidos nesta fase.

```bash
npm install
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

Abra `http://localhost:5173` e consulte `/api/health`. Para validar: `npm run typecheck`, `npm run lint`, `npm test` e `npm run build`. O `database_id` em `wrangler.jsonc` é um placeholder **local**: antes de qualquer deploy é obrigatório criar um D1 real e configurar ambientes e permissões. Não usar dados reais na F0.

A [documentação de execução e limitações da F0](docs/implementation/f0.md) detalha as escolhas, migrações e o que ainda depende de revisão humana.

## Identidade, Platform Admin e suporte

A identidade é feita com **Clerk sem Organizations**. Os vínculos de usuários com várias clínicas e papéis por tenant são guardados no D1. A aplicação interna Platform Admin usa a flag **`privateMetadata.superadmin === true`**, lida e validada no backend, para gerir o ciclo de vida de tenants. A impersonação de suporte usa sessões próprias emitidas pelo Tredane, com actor e subject distintos, tenant único e auditoria, sem usar funcionalidade de impersonação do provedor de identidade.

Ver [ADR-0006](docs/adr/0006-clerk-platform-admin.md), [ADR-0007](docs/adr/0007-support-impersonation.md) e [contratos de identidade e administração](docs/architecture/identity-and-admin.md).

## Acompanhamento da definição do MVP

A [auditoria do Issue #1](docs/product/definition-audit-2026-10-23.md) distingue documentação já entregue de decisões pendentes. O [registro de validação](docs/product/validation-register.md) identifica hipóteses a confirmar com o responsável pelo produto e a clínica piloto.

## Próximo marco

Preparar a estrutura de frontend e API, migrações, ambiente local e CI. Em seguida, implementar o isolamento entre clínicas, o fluxo principal e a atualização reativa entre sessões com dados de teste antes de conectar serviços reais.


## Persistência por clínica — DEC-038

Confirmado: um Durable Object com SQLite nativo por clínica para dados operacionais e WebSockets; D1 central para tenants, memberships, convites e suporte; R2 privado para anexos. [ADR-0012](docs/adr/0012-clinic-durable-object-sqlite.md) registra alternativas, consequências e trabalho pendente. O scaffold F0 ainda não implementa essa evolução.
