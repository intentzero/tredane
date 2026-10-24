# Fronteira de dados por clínica

**Estado:** especificação proposta para revisão de produto e arquitetura. **Objetivo:** duas clínicas que usam o mesmo SaaS não podem ler, alterar, receber ou inferir dados uma da outra. DEC-038 confirma um DO por clínica com SQLite operacional próprio e D1 central administrativo; os demais limites continuam obrigatórios.

## Origem confiável do tenant

| Entrada | Como associar à clínica | Regra de negação |
| --- | --- | --- |
| Painel e API autenticada | Identidade do usuário + associação vigente com a clínica selecionada. | Tenant informado no navegador sem associação válida não concede acesso. |
| WebSocket | Autorização da requisição antes do upgrade; conexão vinculada à clínica e à sessão verificadas. | Conexão de A não pode ser roteada ao objeto nem receber eventos de B. |
| Webhook do WhatsApp | Origem verificada + conta/número oficial associado a uma única clínica. | Número desconhecido ou validação falha não cria dados nem publica eventos. |
| Queue e Workflow | Contexto interno de tenant e ID de evento/ação emitidos por entrada já verificada. | Payload incompleto, adulterado ou sem associação vigente não executa efeito colateral. |

**Confirmado:** um usuário pode pertencer a várias clínicas. Ele seleciona explicitamente a clínica ativa e pode trocá-la no painel; cada aba/requisição opera no tenant escolhido e revalidado contra o membership vigente. A troca não reaproveita assinatura WebSocket nem cache de outro tenant.

## Limites por componente

| Componente | Regra exigida no MVP | Ponto ainda em aberto |
| --- | --- | --- |
| Worker/Hono | Autorização central em toda rota e ação; nunca confiar no ID de tenant fornecido pelo cliente. | Provedor de identidade e papéis finais. |
| D1 central | Tenants, memberships, convites e suporte escopados; nunca concede acesso operacional implícito. | Protocolo de revogação/consistência D1–DO e testes. |
| DO + SQLite por clínica | DEC-038: operações e dados clínicos operacionais persistem apenas no SQLite do DO correto; Worker autoriza roteamento e DO valida contexto/tenant. | Migrações por instância, capacidade, restauração e protocolo de autorização vigente. |
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

## Armazenamento confirmado — DEC-038

SQLite nativo por DO/clínica para operação; D1 central para administração, memberships, convites e suporte; anexos privados no R2. As alternativas D1 operacional compartilhado/por clínica permanecem como histórico no ADR-0002, substituídas pelo [ADR-0012](../adr/0012-clinic-durable-object-sqlite.md). Não há banco D1 dentro do DO.

Nenhuma transação distribuída é presumida entre stores. Revogação confirmada deve barrar novas operações e entregas de dados no DO, inclusive hibernado, sem cache positivo obsoleto; desenho e testes permanecem abertos. Restaurar SQLite não pode reativar membership/suporte revogado no D1 nem repetir efeitos externos. R2 exige autorização separada e contexto de tenant.
