# F1 — Platform Admin e ciclo de tenants/owners

**Estado:** implementação da issue [#24](https://github.com/intentzero/tredane/issues/24) (épico [#14](https://github.com/intentzero/tredane/issues/14)). API Platform Admin + ciclo de vida no D1, com propagação D1→DO. **Sem** UI de login/biblioteca de componentes (#22; DEC de componentes ainda Proposta). Dados sintéticos apenas.

## Decisões aplicadas (Confirmado)

| DEC / ADR | Comportamento neste entrega |
| --- | --- |
| DEC-018 / ADR-0006 | `privateMetadata.superadmin === true` booleano só no backend; string/`publicMetadata` → 403 |
| DEC-020 / REQ-004 | Superadmin cria tenant + primeiro owner; gestão de owners exclusiva do superadmin |
| REQ-006 / AC-18 | Criar/editar/suspender/reativar/exclusão lógica com auditoria |
| DEC-026 / #23 | Suspensão e exclusão lógica propagam fence ao DO e cortam sockets |
| ADR-0006 | Superadmin **não** lê conteúdo clínico sem membership ou suporte aprovado |

## Regras explícitas — último owner (Em aberto → regra de engenharia no PR)

Antes de habilitar remoções irreversíveis de owner:

1. Criar tenant **exige** `ownerClerkUserId` na mesma operação.
2. Remover ou despromover o **último** owner ativo → `403 last_owner_protected`.
3. `replace` promove/ativa o destino **antes** de revogar a origem, na mesma transação (sync) ou sequência protegida (D1), mantendo ≥1 owner.
4. Memberships do mesmo utilizador noutros tenants não são alterados.
5. Owner da clínica **não** promove/cria owners (só superadmin nas rotas `/api/platform/...`).

## Migração `0004_platform_admin_lifecycle.sql`

- Tabela `tenant_deletion_commands` (comando durável `queued` para a tarefa de retenção/expurgo).
- Índice único parcial: no máximo um comando aberto (`queued`/`in_progress`) por tenant.
- `admin_schema_state.version = 4`.

## Rotas

| Método | Caminho | Authz |
| --- | --- | --- |
| GET | `/api/platform/tenants` | superadmin |
| POST | `/api/platform/tenants` | superadmin (+ primeiro owner) |
| GET | `/api/platform/tenants/:id` | superadmin — estado admin + integração **sem** clínico |
| PATCH | `/api/platform/tenants/:id` | superadmin |
| POST | `.../suspend` | superadmin → D1 + fence DO |
| POST | `.../reactivate` | superadmin → limpa fence; **não** restaura memberships/suporte revogados |
| DELETE | `/api/platform/tenants/:id` | exclusão lógica `pending_deletion` + comando `queued` |
| GET/POST/DELETE | `.../members`, `.../owners`, `.../owners/replace` | superadmin |
| GET | `.../clinical-probe` | sempre 403 `clinical_access_denied` |

Código: `src/platform/`, repositórios em `src/db/admin/` (`owners`, `lifecycle`, `deletion-commands`).

## Testes

- `src/platform/platform.test.ts` — domínio (último owner, suspend/reativar, exclusão)
- `src/platform/http.test.ts` — AC-18/21 HTTP sintético
- Harness: criar → suspende corta WS → exclusão lógica + comando

## Fora deste PR

- UI Platform Admin / login (#22)
- Tarefa de retenção que consome `tenant_deletion_commands` até expurgo físico
- Sessões de suporte HTTP completas / handoff cookies (épico suporte)
- Convites HTTP do owner — ver [f1-team-invites.md](f1-team-invites.md) (#25)
- Política LGPD de purga (Em aberto)
