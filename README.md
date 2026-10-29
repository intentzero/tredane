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
- [Modelo conversacional híbrido (IA interpreta, backend valida)](docs/architecture/conversational-hybrid-model.md)
- [ADRs — decisões arquiteturais](docs/adr/0001-cloudflare-native.md) (ver também [topologia D1](docs/adr/0002-d1-topology.md), [tempo real](docs/adr/0003-durable-objects-realtime.md), [IA assistiva](docs/adr/0004-ai-human-in-loop.md) e [concorrência da agenda](docs/adr/0005-d1-booking-consistency.md))
- [Mocks e guia de implementação da interface](docs/design/README.md)
- [Landing page do piloto](docs/product/landing.md): site Astro separado em `site/` (`cd site && npm install && npm run dev`). Staging: `cd site && npm run deploy:staging` → `https://staging.tredane.com` (requer auth Wrangler na conta da zona `tredane.com`; ver checklist no projeto Campo Próximo).
- [Plano de implementação por fatias](docs/implementation/plan.md)
- [Épico de salas partilhadas e audiência do serviço (DEC-075)](docs/implementation/epic-salas-audiencia.md)
- [Observabilidade e operação do piloto (F6/#44)](docs/implementation/f6-ops.md) · [runbooks](docs/implementation/runbooks/README.md)

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

Equipe e convites de attendant (#25): API + e-mail simulado em [f1-team-invites.md](docs/implementation/f1-team-invites.md); provedor real ainda Em aberto. Pedidos de suporte e aprovação do owner (#26): [f1-support-requests.md](docs/implementation/f1-support-requests.md). Sessão de suporte (#27): [f1-support-session.md](docs/implementation/f1-support-session.md). Configuração da clínica (#28): [f2-clinic-config.md](docs/implementation/f2-clinic-config.md). Caixa de entrada partilhada (#29): [f2-inbox.md](docs/implementation/f2-inbox.md). Acompanhamento (#30): [f2-pipeline.md](docs/implementation/f2-pipeline.md). WhatsApp Embedded Signup e conexão por clínica (#31): [f3-whatsapp-connection.md](docs/implementation/f3-whatsapp-connection.md).

## Acompanhamento da definição do MVP

A [auditoria do Issue #1](docs/product/definition-audit-2026-10-23.md) distingue documentação já entregue de decisões pendentes. O [registro de validação](docs/product/validation-register.md) identifica hipóteses a confirmar com o responsável pelo produto e a clínica piloto. As [liberações Meta, privacidade e condições do piloto](docs/product/pilot-gates.md) rastreiam gates externos antes de dados reais (issue #18).

## Próximo marco

Baseline F0 (#15–#18). F1 concluída na linha main (#19–#27). F2: configuração da clínica (#28), Inbox (#29 / [f2-inbox.md](docs/implementation/f2-inbox.md)) e Acompanhamento (#30 / [f2-pipeline.md](docs/implementation/f2-pipeline.md)). F3 parcial: conexão WhatsApp / Embedded Signup (#31 / [f3-whatsapp-connection.md](docs/implementation/f3-whatsapp-connection.md)); webhooks (#32) e envio (#33) seguem. Agenda completa (#35/#36) — [épico #14](https://github.com/intentzero/tredane/issues/14). Dados sintéticos até os gates de liberação.


## Persistência por clínica — DEC-038

Confirmado: um Durable Object com SQLite nativo por clínica para dados operacionais e WebSockets; D1 central para tenants, memberships, convites e suporte; R2 privado para anexos. [ADR-0012](docs/adr/0012-clinic-durable-object-sqlite.md). D1 administrativo: [#19](https://github.com/intentzero/tredane/issues/19) / [f1-admin-d1.md](docs/implementation/f1-admin-d1.md). Clinic DO + migrações por instância + outbox: [#20](https://github.com/intentzero/tredane/issues/20) / [f1-clinic-do.md](docs/implementation/f1-clinic-do.md). Clerk + authz tenant: [#21](https://github.com/intentzero/tredane/issues/21) / [f1-clerk-auth.md](docs/implementation/f1-clerk-auth.md). WebSockets + reconciliação + revogação D1→DO: [#23](https://github.com/intentzero/tredane/issues/23) / [f1-realtime-ws.md](docs/implementation/f1-realtime-ws.md). Platform Admin + ciclo tenants/owners: [#24](https://github.com/intentzero/tredane/issues/24) / [f1-platform-admin.md](docs/implementation/f1-platform-admin.md).

## Deploy do Worker (staging / production)

Use sempre um ambiente explícito:

```bash
npm run deploy -- staging
npm run deploy -- production
```

`scripts/deploy.mjs` define `CLOUDFLARE_ENV=<env>`, corre `npm run build` (o plugin Vite gera o `wrangler.json` do ambiente), confirma que o Worker gerado é `tredane-dev-<env>`, corre `check:env` (placeholders, vars e secrets obrigatórios) e só depois `wrangler deploy --env <env>`. Sem ambiente (ou com `development`) o script recusa correr — um build sem `CLOUDFLARE_ENV` gera o config de desenvolvimento (`tredane-dev`). `TREDANE_DEPLOY_DRY_RUN=1` mostra o plano sem executar.
