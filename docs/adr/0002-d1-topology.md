# ADR-0002 — Topologia multi-tenant: histórico das alternativas D1

- **Estado:** questão resolvida e hipótese provisória substituída por **DEC-038 / [ADR-0012](0012-clinic-durable-object-sqlite.md)** em 23/10/2026.
- **Histórico:** antes da decisão, recomendava-se D1 compartilhado apenas para prototipagem sintética; D1 por clínica era alternativa. Nenhuma dessas recomendações era uma aprovação definitiva de persistência operacional.

## Alternativas consideradas

- **A — D1 operacional compartilhado:** operação inicial simples, exigindo escopo por tenant em toda consulta e mutação.
- **B — D1 operacional por clínica:** separação por banco, com provisionamento, roteamento e migrações por banco.
- **C — SQLite nativo por DO/clínica e D1 central:** dados operacionais locais ao coordenador da clínica e administração/memberships no D1. **Alternativa aprovada.**

## Decisão vigente

Um Durable Object por clínica com SQLite próprio é fonte de verdade dos dados operacionais; D1 central permanece para tenants, memberships N:N, convites e suporte. Anexos ficam no R2 privado. SQLite nativo do DO não é um D1 dentro do DO. Ver ADR-0012 para responsabilidades, consequências, referências e gates de implementação.

Revogação D1/DO, segurança, migrações e recuperação continuam pendentes de execução/testes. A decisão não altera Clerk, papéis, regras de suporte ou política de dados. F0 permanece checkpoint histórico, sem migração executada nesta alteração.
