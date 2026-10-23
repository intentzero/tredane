# ADR-0010 — MFA adiado: MVP sem segundo fator

**Estado:** **DEC-027 substituída pela DEC-028** em 23/10/2026. Não usar a política anterior de MFA por role na F1/MVP.
**Histórico:** a proposta anterior exigia MFA para superadmin e owner, opcional para attendant. O responsável pelo produto reviu a decisão e escolheu **não implementar MFA por enquanto para nenhum perfil**.

## Decisão atual — DEC-028

- Clerk autentica os utilizadores sem exigir MFA no Tredane MVP, incluindo superadmin, owner e attendant.
- **Não configurar** inscrição, desafios, guarda por nível MFA ou step-up MFA como requisito do MVP, inclusive na Platform Admin e na sessão própria de suporte.
- Continuam obrigatórios: verificação da sessão Clerk, `privateMetadata.superadmin === true` booleano verificado no backend, roles/memberships D1 por tenant, auditoria de ações e isolamento, revogação e autorização fail-closed.
- Na impersonação própria: o actor superadmin permanece autenticado como ele mesmo; validação do subject, tenant, motivo, TTL, credencial/handoff seguro, CSRF, auditoria dupla e limites de capacidades, inicialmente leitura/diagnóstico.
- **Decisão pós-MVP:** reconsiderar MFA, métodos, recuperação e reautenticação forte depois de validar produto/operação. O adiamento reduz atrito mas aumenta a importância da proteção das contas privilegiadas e da revisão de segurança antes de dados reais.

## Aceite do MVP

1. Superadmin com sessão Clerk válida e flag privada correta consegue gerir tenants sem desafio MFA, com auditoria; outro usuário é negado.
2. Owner com membership vigente em A pode gerir attendants em A sem MFA; não pode gerir tenants/owners nem atravessar B.
3. Session Clerk sem membership em A não obtém acesso, mesmo autenticada; revogação em A interrompe APIs e WebSockets A, mantendo B.
4. Suporte próprio não pede MFA, mas nunca concede acesso global ou capacidade sensível fora do escopo previsto; motivo, TTL, role do subject, auditoria e segurança de sessão são verificados.

**Atenção:** documento apenas de decisão de escopo. Segurança/implementação precisam de revisão e testes na F1.
