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

## Próximo marco

Preparar a estrutura de frontend e API, migrações, ambiente local e CI. Em seguida, implementar o isolamento entre clínicas, o fluxo principal e a atualização reativa entre sessões com dados de teste antes de conectar serviços reais.
