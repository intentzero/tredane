# ADR-0012 — SQLite por clínica no Durable Object e D1 central

- **Estado:** Confirmado — DEC-038, 23/10/2026.
- **Origem:** Paulo aprovou o desenho após avaliação dos impactos e pediu expressamente «Regista no repo» nesta conversa.
- **Substitui:** a hipótese provisória de dados operacionais em D1 do ADR-0002; confirma a cardinalidade de um DO por clínica de DEC-005 e resolve a topologia de DEC-010. Complementa ADR-0003 e substitui o mecanismo D1 batch proposto no ADR-0005.
- **Escopo:** decisão de arquitetura; não é implementação, migração executada, deploy ou autorização para dados reais. Não aprova as outras recomendações apresentadas na conversa.

## Contexto e alternativas

O domínio operacional pertence a uma clínica: conversas, pipeline, recursos e agenda precisam de consistência local e atualização em tempo real. Foram consideradas: (A) D1 operacional compartilhado com tenant_id, (B) D1 externo por clínica com DO de tempo real e (C) SQLite nativo por DO/clínica com D1 administrativo central. A recomendação anterior por A era provisória; a escolha aprovada é C. SQLite do DO não é um banco D1 dentro do DO.

## Decisão e responsabilidade dos dados

| Componente | Fonte de verdade / responsabilidade |
| --- | --- |
| Clerk | Identidade e sessão; sem Organizations, impersonação Clerk ou MFA no MVP |
| D1 central | Tenants, memberships N:N e roles, convites, pedidos/sessões de suporte e auditoria administrativa/de suporte |
| Um Durable Object por clínica com SQLite nativo | Contatos, conversas, mensagens, oportunidades, serviços, profissionais, recursos, disponibilidade, agendamentos, histórico operacional, deduplicação e outbox operacional; coordenação e WebSockets da clínica |
| R2 privado | Anexos associados à clínica, servidos após autorização |
| Queues / Workflows | Efeitos externos e processos assíncronos aprovados, sempre com tenant e idempotência |

Dados operacionais são acessados através do DO da clínica; não manter cópia operacional canônica concorrente no D1. Um namespace/classe pode atender muitas instâncias: não criar uma classe de DO por clínica. O Worker resolve a instância por ID interno estável do tenant após validar identidade ou integração e autorização. O DO também valida coerência entre o contexto interno recebido e seu tenant; nenhum ID livre do navegador concede acesso.

O índice global que resolve conta/número WhatsApp para tenant precisa de unicidade e verificação. Sua localização/esquema exatos, armazenamento de credenciais e contratos de integração ficam **Propostos/Em aberto** para F1/F3; configuração e estado operacional pertencem à clínica. Não expor segredos em parâmetros ou logs.

## Transações, publicação e efeitos externos

- Confirmar/reagendar reservas verifica todos os recursos e persiste compromisso, alocações, histórico e outbox numa transação SQLite local. O desenho SQL exato permanece proposto até testes; usar APIs transacionais do storage, incluindo transactionSync quando aplicável.
- O DO ser single-threaded não prova atomicidade de uma sequência com awaits. Não fazer chamadas Meta, IA, e-mail ou R2 dentro da transação de domínio.
- Publicar eventos somente depois de persistência; reidratar pela API a partir do SQLite após reconexão/hibernação. Memória e WebSockets não são fonte de verdade.
- Efeitos externos usam intenção persistida, Queue/Workflow, IDs estáveis, retentativas e reconciliação de resultado incerto. Não presumir exactly-once externo.
- Não existe transação atómica única entre D1 central, SQLite do DO, R2 e provedores externos. Usar protocolo idempotente e reconciliação; mecanismo final ainda a especificar/testar.

## Segurança e revogação — pendência bloqueante de F1

DEC-026 e DEC-029–037 permanecem em vigor. D1 continua autoritativo para memberships e suporte; SQLite local não pode restaurar permissões antigas nem transformar cache em autoridade. Projetar barreira de autorização que impeça novas operações e entrega posterior de dados após revogação confirmada, inclusive durante concorrência, falha de sinalização, suspensão, expiração e hibernação. Simples notificação assíncrona ao DO ou cache positivo com TTL não bastam como prova. Protocolo, ordem de confirmação e testes de segurança permanecem **Em aberto**, sem enfraquecer o comportamento aprovado.

Suporte mantém actor/subject/aprovador, aprovação por sessão, 30 minutos fixos, nova solicitação para continuar, notificações e pedido de encerramento. Dados/auditoria operacionais locais e auditoria central podem correlacionar IDs; não assumir commit distribuído. A topologia não concede escrita ao suporte nem redefine a política de capacidades. R2 e o D1 central continuam exigindo isolamento por tenant.

## Consequências e trabalho de engenharia

1. **Migrações:** esquema versionado por instância, migrações pendentes antes de operações de negócio e erro de migração bloqueando uso. Testar atualização de bancos antigos e rollout gradual. Migrações de classe/namespace Wrangler não substituem migrações SQL das tabelas. Adaptar persistência/Drizzle ao backend DO sem manter código D1 operacional como se fosse definitivo.
2. **Capacidade:** medir volume, latência, CPU e armazenamento por clínica; um DO é um ponto de coordenação com capacidade finita. No plano pago, a documentação consultada informa 10 GB por DO. Anexos ficam no R2. Não prometer escala ilimitada de uma clínica; particionamento futuro exige nova avaliação.
3. **Relatórios:** consultas operacionais por clínica; relatórios globais poderão usar agregados assíncronos sem duplicar conteúdo pessoal por padrão. Não fazer fan-out irrestrito a todos os DOs em cada tela administrativa.
4. **Recuperação:** PITR disponível até 30 dias segundo documentação consultada. Testar restauração de uma clínica e reconciliação com D1, R2, mensagens, filas e efeitos externos; restaurar banco não desfaz envio ao WhatsApp nem deve reativar suporte/membership revogado. Política de backups/exportação, retenção e recuperação ainda a especificar.
5. **F0:** preservar scaffold e migração já existentes como checkpoint histórico; a adaptação é trabalho futuro, sem reescrever migrações aplicadas nem executar migrações remotas nesta decisão.

## Critérios de aceite de engenharia (a implementar)

- Dois tenants sintéticos usam DOs/SQLite distintos; IDs, rotas, RPC, eventos e anexos adulterados não permitem acesso cruzado (REQ-001, AC-01).
- Reservas concorrentes sobre o mesmo profissional ou sala/equipamento confirmam no máximo uma; falha em qualquer recurso reverte toda a transação e preserva reserva antiga no reagendamento (REQ-031/032, AC-09/10).
- Após hibernação/reconexão, dados são reconstruídos da persistência correta e não duplicam mensagens, reservas ou efeitos (REQ-011/041, AC-12).
- Migração de DO existente mantém dados e versão; falha não expõe esquema parcialmente utilizável.
- Revogação/suspensão/expiração de suporte corta HTTP e entregas WS sem afetar outro tenant, inclusive com corrida e falha de notificação (REQ-003/061/063).
- Restauração de clínica não reenvia mensagens nem ressuscita permissões revogadas. Especificar ensaio e evidência antes de dados reais.

## Referências

- [Storage SQLite e APIs transacionais](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Acesso e recuperação temporal](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/)
- [Limites](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [WebSockets hibernáveis](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Modelo de dados](../architecture/data-model.md), [fronteiras](../product/tenant-boundaries.md), [plano](../implementation/plan.md)
