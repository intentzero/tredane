# Fronteira de dados por clínica

**Estado:** especificação proposta para revisão de produto e arquitetura. **Objetivo:** duas clínicas que usam o mesmo SaaS não podem ler, alterar, receber ou inferir dados uma da outra. A escolha de um Durable Object por clínica está em avaliação; ela não resolve sozinha os demais limites de dados.

## Origem confiável do tenant

| Entrada | Como associar à clínica | Regra de negação |
| --- | --- | --- |
| Painel e API autenticada | Identidade do usuário + associação vigente com a clínica selecionada. | Tenant informado no navegador sem associação válida não concede acesso. |
| WebSocket | Autorização da requisição antes do upgrade; conexão vinculada à clínica e à sessão verificadas. | Conexão de A não pode ser roteada ao objeto nem receber eventos de B. |
| Webhook do WhatsApp | Origem verificada + conta/número oficial associado a uma única clínica. | Número desconhecido ou validação falha não cria dados nem publica eventos. |
| Queue e Workflow | Contexto interno de tenant e ID de evento/ação emitidos por entrada já verificada. | Payload incompleto, adulterado ou sem associação vigente não executa efeito colateral. |

Um usuário que pertença a várias clínicas, caso isso seja permitido, seleciona um tenant por sessão/contexto de trabalho. A troca revalida acesso e não reaproveita assinatura WebSocket ou cache de outro tenant.

## Limites por componente

| Componente | Regra exigida no MVP | Ponto ainda em aberto |
| --- | --- | --- |
| Worker/Hono | Autorização central em toda rota e ação; nunca confiar no ID de tenant fornecido pelo cliente. | Provedor de identidade e papéis finais. |
| D1/Drizzle | Consultas, mutações, vínculos e unicidade lógica sempre no escopo da clínica. Testar acesso por ID de outra clínica. | D1 compartilhado com escopo rigoroso ou D1 por clínica. |
| Durable Objects | Se adotado um objeto por clínica, o Worker decide a instância após autorização. Conexões e estado privado do objeto não cruzam clínicas. | Validar se um objeto por clínica atende ao padrão de carga; decidir que dados, se houver, ficam no armazenamento do objeto. |
| WebSockets hibernáveis | Evento entregue só a conexões autorizadas da clínica; metadados mínimos da conexão sobrevivem à hibernação. Revogação encerra ou reautoriza conexões antigas. | Mecanismo de invalidação e contrato de eventos. |
| Queues | Cada trabalho carrega tenant e identificador lógico; processamento revalida contexto e evita duplicar efeito em reentrega. | Política de retentativa e tratamento de falha permanente. |
| R2 | Objetos organizados por clínica e servidos somente após autorização; não usar URL pública permanente para anexo privado. | Prefixo ou bucket por clínica, retenção e exclusão. |
| Workflows | Instância vinculada à clínica e à ação originadora; cada etapa verifica o contexto antes de enviar, alterar ou expor dados. | Quais fluxos entram de fato no MVP. |
| IA | Contexto obtido somente da conversa autorizada; saída não é publicada a outro tenant e depende de revisão humana para envio. | Provedor, campos enviados e retenção. |
| Logs e suporte | Registrar IDs técnicos mínimos para diagnóstico; não registrar tokens ou conteúdo pessoal desnecessário. | Acesso excepcional e prazo de retenção. |

## Identidade multi-tenant e suporte controlado

**Confirmado:** Clerk autentica, sem Organizations. Um usuário pode integrar múltiplos tenants; memberships e roles pertencem ao D1. Toda requisição e WebSocket verifica sessão, tenant selecionado e associação vigente.

**Confirmado:** `privateMetadata.superadmin === true` (booleano, validado pelo backend) permite gerir a plataforma, mas não ler automaticamente dados operacionais. Para manutenção, o Tredane emite uma sessão **própria** no D1 com actor, subject, tenant, motivo e validade, mantendo a autenticação Clerk do actor e aplicando a role do subject mais restrições de suporte. Auditoria distingue ambos; não se usa impersonação do Clerk.

**Proposto para F1:** código de entrada único, sessão vinculada ao actor, revogação imediata, proteção CSRF e validação de WebSockets. Qualquer falha nega o acesso.

## Revogação por tenant — DEC-026

A revogação de `tenant_memberships` em A é uma alteração de autorização **específica de A**. Depois da confirmação no D1, a API deve negar novas ações sobre A; o Durable Object deve invalidar as conexões A daquele usuário e impedir entrega subsequente. O usuário continua autenticado no Clerk e pode operar B mediante membership válido; não revogar a identidade global para remover apenas um tenant. Sessões próprias de suporte que atuem como o usuário removido em A perdem autorização. **Mecanismo proposto, a testar:** confirmar a revogação no D1, sinalizar ao DO de A e validar o membership antes de expor eventos; não depender apenas de claims Clerk ou cache local. Lidar com falhas de sinalização/hibernação sem permissões positivas obsoletas. Testar reconexão, corrida com publicação, hibernação e duas abas em tenants diferentes.

## Invariantes verificáveis

1. **Leitura:** um membro de A não recebe conteúdo de B por listagem, busca, detalhe, arquivo ou evento.
2. **Escrita:** um membro de A não altera entidade de B, mesmo conhecendo seu ID.
3. **Associação:** contato, conversa, oportunidade, mensagem, recurso e agendamento vinculados pertencem ao mesmo tenant; relação cruzada é rejeitada.
4. **Integração:** número/conta de WhatsApp é associado de forma inequívoca à clínica antes de processar mensagem.
5. **Assíncrono:** reentrega de evento mantém o tenant original e não duplica uma ação lógica.
6. **Tempo real:** conexões de B não recebem evento ou payload de A; após revogação, conexão antiga de A não continua recebendo dados.
7. **Recuperação:** reconexão ou hibernação não muda o tenant da sessão e não usa memória como fonte única de verdade.
8. **Suporte:** operador da plataforma não ganha acesso implícito a conteúdo por estar fora da clínica.

Os [cenários AC-01, AC-02, AC-04, AC-05, AC-08, AC-11 e AC-12](acceptance.md) cobrem as primeiras demonstrações dessas invariantes. A implementação deve complementar com testes automatizados de acesso por ID, reentrega e rotas de arquivo.

## Decisão de armazenamento pendente

**Opção A — D1 compartilhado com escopo por clínica:** menos bancos para administrar no piloto, exige disciplina em todas as consultas, vínculos e migrações. **Opção B — D1 por clínica:** separação de dados por banco, exige provisionamento, roteamento e migrações por tenant. A escolha depende de requisitos de isolamento, escala operacional e custo medidos para o piloto. A decisão deve ser registrada em [decisões](decisions.md) antes de dados reais.

O armazenamento privado de cada Durable Object pode ajudar a separar estado desse objeto, mas **não** altera o isolamento de um D1 compartilhado nem de arquivos R2. Referências: [isolamento de dados em SaaS na Cloudflare](https://developers.cloudflare.com/use-cases/saas/data-isolation/), [armazenamento de Durable Objects](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) e [WebSockets com hibernação](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).
