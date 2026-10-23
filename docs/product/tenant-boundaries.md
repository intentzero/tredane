# Fronteira de dados por clínica

**Estado:** especificação proposta para revisão de produto e arquitetura; topologia de dados e Durable Object por clínica confirmados em 23/10/2026 (DEC-005, DEC-010). **Objetivo:** duas clínicas que usam o mesmo SaaS não podem ler, alterar, receber ou inferir dados uma da outra. Um Durable Object e um D1 dedicados por clínica foram confirmados; eles não resolvem sozinhos os limites no D1 central, nas Queues, no R2 e nos Workflows.

## Origem confiável do tenant

| Entrada | Como associar à clínica | Regra de negação |
| --- | --- | --- |
| Painel e API autenticada | Token do Clerk + associação vigente com a clínica ativa, verificadas no D1 central; só então o D1 da clínica é aberto. | Tenant informado no navegador sem associação válida não concede acesso nem abre banco. |
| App de superadmin | Token do Clerk com metadado privado `superadmin: true`, lido no servidor. | Não concede associação a clínica nem leitura do D1 da clínica; suporte com conteúdo só por acesso temporário concedido pelo responsável. |
| WebSocket | Autorização da requisição antes do upgrade; conexão vinculada à clínica e à sessão verificadas. | Conexão de A não pode ser roteada ao objeto nem receber eventos de B. |
| Webhook do WhatsApp | Origem verificada + conta/número oficial associado a uma única clínica. | Número desconhecido ou validação falha não cria dados nem publica eventos. |
| Queue e Workflow | Contexto interno de tenant e ID de evento/ação emitidos por entrada já verificada. | Payload incompleto, adulterado ou sem associação vigente não executa efeito colateral. |

Um usuário que pertença a várias clínicas (Confirmado, DEC-007) seleciona um tenant por sessão no seletor. A troca revalida acesso e não reaproveita assinatura WebSocket ou cache de outro tenant.

## Limites por componente

| Componente | Regra exigida no MVP | Ponto ainda em aberto |
| --- | --- | --- |
| Worker/Hono | Autorização central em toda rota e ação; nunca confiar no ID de tenant fornecido pelo cliente. | Provedor de identidade e papéis finais. |
| D1 central | Identidade, associações, mapa clínica → banco e roteamento de números; nenhum conteúdo de clínica. | Proteção dos dados de login e auditoria de superadmin. |
| D1 da clínica | Um banco por clínica; a requisição só abre o banco da clínica resolvida. Consultas mantêm escopo por tenant. Testar acesso por ID de outra clínica. | Mecanismo de abertura dinâmica e migração ([ADR-0002](../adr/0002-d1-topology.md)). |
| Durable Objects | Um objeto por clínica (Confirmado); o Worker decide a instância após autorização. Conexões e estado privado do objeto não cruzam clínicas. | Validar se um objeto por clínica atende ao padrão de carga; decidir que dados, se houver, ficam no armazenamento do objeto. |
| WebSockets hibernáveis | Evento entregue só a conexões autorizadas da clínica; metadados mínimos da conexão sobrevivem à hibernação. Revogação encerra ou reautoriza conexões antigas. | Mecanismo de invalidação e contrato de eventos. |
| Queues | Cada trabalho carrega tenant e identificador lógico; processamento revalida contexto e evita duplicar efeito em reentrega. | Política de retentativa e tratamento de falha permanente. |
| R2 | Bucket privado com prefixo por clínica (Confirmado), servido somente após autorização; sem URL pública permanente. | Rotina de exclusão por contato e por clínica. |
| Workflows | Instância vinculada à clínica e à ação originadora; cada etapa verifica o contexto antes de enviar, alterar ou expor dados. | Quais fluxos entram de fato no MVP. |
| IA | Claude via AI Gateway (Confirmado); contexto só da conversa autorizada, com os campos de DEC-011; saída não é publicada a outro tenant e depende de revisão humana para envio. | AI Gateway sem registro de conteúdo e revisão jurídica. |
| Logs e suporte | Registrar IDs técnicos mínimos para diagnóstico; não registrar tokens ou conteúdo pessoal desnecessário. | Acesso excepcional e prazo de retenção. |

## Invariantes verificáveis

1. **Leitura:** um membro de A não recebe conteúdo de B por listagem, busca, detalhe, arquivo ou evento.
2. **Escrita:** um membro de A não altera entidade de B, mesmo conhecendo seu ID.
3. **Associação:** contato, conversa, oportunidade, mensagem, recurso e agendamento vinculados pertencem ao mesmo tenant; relação cruzada é rejeitada.
4. **Integração:** número/conta de WhatsApp é associado de forma inequívoca à clínica antes de processar mensagem.
5. **Assíncrono:** reentrega de evento mantém o tenant original e não duplica uma ação lógica.
6. **Tempo real:** conexões de B não recebem evento ou payload de A; após revogação, conexão antiga de A não continua recebendo dados.
7. **Recuperação:** reconexão ou hibernação não muda o tenant da sessão e não usa memória como fonte única de verdade.
8. **Suporte:** superadmin não ganha acesso implícito a conteúdo de clínica; o acesso temporário concedido pelo responsável expira sozinho e é auditado.

Os [cenários AC-01, AC-02, AC-04, AC-05, AC-08, AC-11 e AC-12](acceptance.md) cobrem as primeiras demonstrações dessas invariantes. A implementação deve complementar com testes automatizados de acesso por ID, reentrega e rotas de arquivo.

## Decisão de armazenamento

**Confirmado em 23/10/2026 (DEC-010):** D1 por clínica para dados de negócio, D1 central de controle para plataforma e R2 com prefixo por clínica. A opção de D1 compartilhado com escopo por clínica foi descartada. O mecanismo técnico de abertura dinâmica e migração dos bancos segue em aberto no [ADR-0002](../adr/0002-d1-topology.md).

O armazenamento privado de cada Durable Object separa apenas o estado desse objeto; não substitui o D1 da clínica nem isola arquivos R2. Referências: [isolamento de dados em SaaS na Cloudflare](https://developers.cloudflare.com/use-cases/saas/data-isolation/), [armazenamento de Durable Objects](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) e [WebSockets com hibernação](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).
