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
- [Mocks e guia de implementação da interface](docs/design/README.md)
- [Landing page do piloto](docs/product/landing.md): site Astro separado em `site/` (`cd site && npm install && npm run dev`)
- [Plano de implementação por fatias](docs/implementation/plan.md)

Os ADRs identificam decisões aceitas, propostas técnicas e temas ainda em aberto. Nenhum módulo de aplicação foi implementado apenas por adicionar esta documentação.

## Executar a F0 localmente

A base React + Hono + Worker está na main (épico [#14](https://github.com/intentzero/tredane/issues/14) / issue [#15](https://github.com/intentzero/tredane/issues/15)). Apenas dados fictícios são permitidos nesta fase.

```bash
npm ci
npm run db:migrate:local
npm run db:seed:local
npm run verify
npm run dev
```

Abra `http://localhost:5173` e consulte `/api/health`. `npm run verify` cobre typecheck, lint, testes unitários, harness Cloudflare, contraste/mocks, build e migrate/seed. O `database_id` local em `wrangler.jsonc` é placeholder; staging/prod usam IDs fictícios bloqueados por `npm run check:env` até o provisionamento ([environments.md](docs/implementation/environments.md)). Não usar dados reais na F0. A `compatibility_date` deve permanecer dentro do máximo do workerd da lockfile ([f0.md](docs/implementation/f0.md)).

A [documentação F0](docs/implementation/f0.md) detalha escolhas, migrações, harness e o estado do checkpoint.

## Identidade, Platform Admin e suporte

A identidade é feita com **Clerk sem Organizations**. Os vínculos de usuários com várias clínicas e papéis por tenant são guardados no D1. A aplicação interna Platform Admin usa a flag **`privateMetadata.superadmin === true`**, lida e validada no backend, para gerir o ciclo de vida de tenants. A impersonação de suporte usa sessões próprias emitidas pelo Tredane, com actor e subject distintos, tenant único e auditoria, sem usar funcionalidade de impersonação do provedor de identidade.

Ver [ADR-0006](docs/adr/0006-clerk-platform-admin.md), [ADR-0007](docs/adr/0007-support-impersonation.md) e [contratos de identidade e administração](docs/architecture/identity-and-admin.md).

## Acompanhamento da definição do MVP

A [auditoria do Issue #1](docs/product/definition-audit-2026-10-23.md) distingue documentação já entregue de decisões pendentes. O [registro de validação](docs/product/validation-register.md) identifica hipóteses a confirmar com o responsável pelo produto e a clínica piloto. As [liberações Meta, privacidade e condições do piloto](docs/product/pilot-gates.md) rastreiam gates externos antes de dados reais (issue #18).

## Próximo marco

Baseline F0 (#15–#18). F1: D1 admin (#19), Clinic DO (#20), Clerk (#21) — [épico #14](https://github.com/intentzero/tredane/issues/14). Dados sintéticos até os gates de liberação.


## Persistência por clínica — DEC-038

Confirmado: um Durable Object com SQLite nativo por clínica para dados operacionais e WebSockets; D1 central para tenants, memberships, convites e suporte; R2 privado para anexos. [ADR-0012](docs/adr/0012-clinic-durable-object-sqlite.md). D1 administrativo: [#19](https://github.com/intentzero/tredane/issues/19) / [f1-admin-d1.md](docs/implementation/f1-admin-d1.md). Clinic DO + migrações por instância + outbox: [#20](https://github.com/intentzero/tredane/issues/20) / [f1-clinic-do.md](docs/implementation/f1-clinic-do.md). Clerk HTTP: #21.
