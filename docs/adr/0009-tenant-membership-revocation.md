# ADR-0009 — Revogação imediata de acesso por tenant

**Estado:** decisão de comportamento **aceita** (DEC-026); estratégia técnica e testes de concorrência **propostos**, sujeitos a validação em F1.
**Origem:** escolha da opção A pelo responsável do produto em 23/10/2026.
**Relacionados:** [ADR-0006](0006-clerk-platform-admin.md), [ADR-0007](0007-support-impersonation.md), [REQ-003](../product/requirements.md), [AC-02](../product/acceptance.md), [DEC-026](../product/decisions.md).

## Decisão confirmada

Remover um utilizador do tenant A deve **revogar imediatamente o acesso ao tenant A**: as próximas requisições e operações HTTP são negadas; WebSockets e subscrições A são invalidados e não entregam novos dados; a Clinic App avisa que o acesso foi revogado. **Não fazer logout ou revogar sessão Clerk**, porque a mesma identidade pode continuar autorizada em B, C etc. A remoção em A não altera os seus memberships em outros tenants.

Revogar membership do **subject** em A também torna inválida a autorização de toda sessão de suporte própria do Tredane que represente esse subject em A. A sessão do superadmin real continua autenticada no Clerk, mas o contexto de suporte revogado não pode continuar a aceder A.

A operação deve preservar histórico/auditoria de quem removeu, quem foi removido, qual tenant, quando e qual efeito. Não apagar nem reatribuir automaticamente mensagens históricas.

## Protocolo recomendado para F1 (ainda não implementado)

1. No Worker Hono, validar a identidade Clerk do actor e o seu membership/role atual no **tenant A**, verificando que é owner e que o alvo é attendant ativo. Apenas superadmin administra owners.
2. Executar revogação persistente no **D1**, com transição atómica de membership ativo para revogado e evento de auditoria (e possível versão/epoch de autorização).
3. **Desde a confirmação da revogação**, impedir autorizações positivas para A: cada HTTP request e novo handshake WebSocket resolve membership atual; nenhum tenant/role é derivado apenas de claims Clerk ou do estado do browser.
4. Publicar uma invalidação para as conexões A no Durable Object responsável por esse tenant. Identificar sockets do membro removido, enviar sinal de encerramento sem payload clínico e fechar ou invalidar conexões. Verificar novamente autorização no caminho de entrega de eventos, para não depender somente da chegada desse sinal.
5. Após hibernação, reidratar somente metadados mínimos, **revalidando memberships antes de enviar qualquer payload**. Recuperações e reconexões devem ser negadas para A enquanto a associação estiver revogada; permitir B normalmente.
6. Sessões de suporte com subject removido de A deixam de passar na autorização por requisição/entrega; revogar/inutilizar o respetivo contexto de suporte, sem encerrar o login Clerk do actor.
7. Reagir a falhas de notificação, propagação, D1 ou estado de autorização sem permissões otimistas: negar entrega de conteúdo quando a validação vigente não puder ser garantida (*fail closed*).

**Desafio técnico em aberto:** desenhar um protocolo robusto entre confirmação da escrita D1 e fan-out de WebSockets em múltiplas instâncias/corridas. Sinalizar o DO sem barreira de autorização é insuficiente; avaliar versão monotónica de membership, fence de entrega, cache de validade nulo ou leitura autoritativa na publicação conforme escala e semântica do D1. O requisito de produto é bloqueio após confirmação, mas a alegação de garantia temporal só ocorrerá após teste. Dados já enviados ao navegador **antes** da revogação não podem ser retirados retroativamente.

## Efeitos esperados

- **Clerk:** continua autenticado; nenhum logout global.
- **D1:** membership A revogado; memberships B preservados.
- **HTTP/Clinic API:** pedidos subsequentes com A são negados, independentemente do estado da UI.
- **WebSocket:** nenhuma nova entrega autorizada em A; encerrar/inutilizar sockets A; conservar sockets B.
- **Suporte:** actor mantém conta Clerk; sessões de suporte para subject revogado em A perdem autorização.
- **UI:** A mostra mensagem clara de acesso revogado, sem conteúdo operacional novo; B mantém funcionamento.
- **Auditoria:** actor, subject, tenant, timestamp, resultado e correlação com revogação.

## Cenários de aceite

1. Usuário com memberships A e B e duas abas: owner remove attendant em A; A nega novas APIs e eventos, B continua funcional, Clerk continua com sessão válida.
2. Socket A conectado antes da revogação, com DO ativo ou hibernado: nenhum evento novo após confirmação; socket inativo é encerrado ou invalidado.
3. Publicação de evento e revogação simultâneas: não há exposição de payload novo após confirmação da revogação.
4. Falha na sinalização ao DO não permite cache positivo indefinido nem entrega de conteúdo a usuário revogado.
5. Owner de B e attendant em A não podem remover membros de A; owner de A não remove owner (superadmin apenas).
6. Sessão própria de suporte com subject revogado em A perde autorização em A; não se converte em acesso global de superadmin.
7. Revogação da mesma membership repetida é idempotente, auditável e não altera B.
8. Testar pedido que começou antes da revogação, mas termina depois, e definir política consistente de bloqueio da resposta antes de uso real.

**Não implementado:** a decisão registra comportamento desejado. A F1 deve demonstrar a garantia de autorização com testes que simulem concorrência, revogação e hibernação em duas clínicas fictícias.
