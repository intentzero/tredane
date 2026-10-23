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

## Próximo marco

Preparar a estrutura de frontend e API, migrações, ambiente local e CI. Em seguida, implementar o isolamento entre clínicas, o fluxo principal e a atualização reativa entre sessões com dados de teste antes de conectar serviços reais.
