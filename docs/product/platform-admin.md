# Platform Admin — especificação do dashboard interno

**Estado:** recorte, topologia e ordem de trabalho **Confirmados** ([DEC-192](decisions.md), Paulo, 16/11/2026). Mocks PA-01 a PA-11 **Confirmados** (Paulo, 16/11/2026, «aprovado»). Jornadas e requisitos seguem **Propostos** até virarem issues; Q-PA-01 a Q-PA-03 continuam em aberto. **Data:** 16 de novembro de 2026.

Este documento especifica a interface da Platform Admin (ACT-05). A capacidade e as regras de segurança já estão confirmadas em [ADR-0006](../adr/0006-clerk-platform-admin.md), [ADR-0007](../adr/0007-support-impersonation.md), [ADR-0011](../adr/0011-owner-approval-for-support.md) e DEC-018 a DEC-037; este documento não as repete, só liga cada tela a elas. A spec do painel das clínicas ([ux-ui.md](ux-ui.md)) não se aplica aqui, exceto tokens, componentes e acessibilidade.

## 1. Ponto de partida

| Item | Estado | Notas |
| --- | --- | --- |
| API de tenants, owners, ciclo de vida e exclusão lógica (`/api/platform/tenants/*`) | **Implementado** (#24) | `src/platform/routes.ts`; testes em `f1-platform-admin.md`. |
| API de pedidos e sessões de suporte (`/api/platform/support-*`, `/api/support/*`) | **Implementado** (#26, #27) | `src/support/routes.ts`. |
| Snapshot operacional por clínica (`GET /api/f6/ops/tenants/:id/snapshot`), métricas de conversa, inventário de segredos | **Implementado** (F6) | `src/ops/routes.ts`; só contagens, sem conteúdo. |
| Amostras de revisão, métricas e relatório sombra H1 | **Implementado só por MCP** | `POST /api/mcp/review-central` (DEC-159). |
| Interface da Platform Admin | **Não existe** | Ficou fora de escopo em #24 e #22. É o objeto deste documento. |

## 2. Decisões que orientam a interface

- **Confirmado (DEC-192):** quatro áreas no primeiro recorte — clínicas, suporte, saúde operacional e qualidade da IA.
- **Confirmado (DEC-192):** rota `/admin` no mesmo SPA e Worker, com bundle carregado à parte. A separação exigida pelo ADR-0006 é de autorização, não de deploy; cada rota `/api/platform/*` continua a verificar a flag no Clerk a cada pedido.
- **Confirmado (DEC-192):** desktop primeiro (referência 1440×900). No celular a área só precisa funcionar (leitura e ações sem layout quebrado). É exceção à DEC-039 apenas para a Platform Admin.
- **Confirmado (DEC-192):** spec e mocks antes do código.
- **Confirmado (DEC-018, ADR-0006 §6):** a flag não dá acesso ao conteúdo da clínica. A Platform Admin mostra **metadados e contagens** (estado, membros, integrações, filas, métricas agregadas). Mensagens, contatos e agenda só aparecem dentro de uma sessão de suporte aprovada (DEC-029), na Clinic App, nunca na Platform Admin.
- **Proposto:** sem WebSocket no primeiro corte; as telas recarregam por ação e por intervalo (30 s na visão geral e no suporte). Motivo: o volume é de um operador; o DO por clínica não tem canal de plataforma. Rever se o pedido de suporte precisar de aviso imediato de aprovação.

## 3. Ator e permissões

ACT-05, superadmin Tredane, conforme [actors-permissions.md](actors-permissions.md).

| Pode | Não pode |
| --- | --- |
| Ver e gerir clínicas, owners e estado (DEC-018, DEC-020/103) | Ler mensagens, contatos, agenda ou anexos fora de sessão de suporte |
| Ver membros (identidade Clerk, papel, estado) | Criar ou remover attendants (é da owner, DEC-103) |
| Pedir, ativar e encerrar sessão de suporte (DEC-029–037) | Prolongar sessão (DEC-033) ou ativar sem aprovação |
| Ver contagens operacionais e alertas por clínica | Ver texto de mensagens na tela de saúde |
| Ver métricas agregadas de IA e o relatório sombra | — ver Em aberto Q-PA-01 sobre amostras com texto |

Qualquer pessoa sem a flag que abra `/admin` vê a mesma resposta de rota inexistente; o cliente não é fonte de autorização.

## 4. Jornadas

### JRN-20 — Abrir a Platform Admin

- **Estado:** Proposto.
- **Ator:** superadmin. **Gatilho:** abre `/admin` ou o atalho no menu da conta.
- **Pré-condições:** sessão Clerk válida.
- **Fluxo:** cliente chama `GET /api/me` → backend devolve `isSuperadmin` verificado no Clerk → cliente carrega o bundle admin → visão geral (PA-01).
- **Alternativas:** sem flag → tela «Página não encontrada», sem pedir o bundle; verificação Clerk indisponível → erro com «Tentar de novo», nunca acesso (fail closed); sessão expira a meio → volta ao login e regressa a `/admin`.
- **Requisitos:** REQ-104, REQ-006.

### JRN-21 — Criar clínica com a primeira owner

- **Estado:** Proposto (capacidade Confirmada em JRN-10).
- **Fluxo:** PA-02 → «Nova clínica» (PA-03) → nome, fuso e e-mail da owner → o backend cria a clínica e **emite um convite de owner** (DEC-194) → abre o detalhe (PA-04) com o estado do convite. **Implementado (PR #848, #842):** `POST /api/platform/tenants` com `ownerEmail`; o `ownerClerkUserId` antigo continua a funcionar. No detalhe: reenviar, cancelar, «Emitir novo convite» (vencido) e «Convidar owner» (sem owner e sem convite em curso) — estes controlos ainda não têm mock (#835).
- **Estado «Em configuração» (DEC-194):** clínica ativa sem owner ativa até o convite ser aceite; é derivado, não existe no D1. O superadmin reenvia ou cancela o convite no detalhe; sem owner ativa não há aprovação de suporte.
- **Alternativas:** e-mail inválido ou já owner → erro no campo; falha a meio → nada criado (a API é atómica); duplo clique → uma só clínica.
- **Requisitos:** REQ-006, REQ-105.

### JRN-22 — Mudar o estado de uma clínica

- **Estado:** Proposto (capacidade Confirmada em JRN-10).
- **Fluxo:** PA-04 → Suspender / Reativar / Excluir → diálogo com motivo obrigatório → endpoint correspondente → estado e auditoria atualizados na mesma tela.
- **Alternativas:** excluir exige escrever o nome da clínica e resulta em `pending_deletion`, não em purga (ADR-0006 §7; purga em #43); suspensa mostra o efeito («equipe e WhatsApp bloqueados»); trocar a última owner usa `owners/replace`, nunca deixa a clínica sem owner.
- **Requisitos:** REQ-006, REQ-105, REQ-106.

### JRN-23 — Pedir e usar sessão de suporte

- **Estado:** Proposto (regras Confirmadas em JRN-11 e DEC-029–037).
- **Fluxo:** PA-04 aba Suporte ou PA-05 → «Pedir suporte» → escolher membro (subject) e motivo → pedido `pending` com prazo de 24 h → quando a owner aprova, botão «Entrar como …» → handoff à Clinic App com banner → contador de 30 min → «Encerrar».
- **Alternativas:** rejeitado, expirado ou revogado pela owner → estado final com motivo, sem botão de entrar; 30 min esgotados → só «Pedir de novo» (DEC-033); pedido de fim do subject (DEC-037) aparece na linha da sessão.
- **Requisitos:** REQ-007, REQ-060 a REQ-066, REQ-107.

### JRN-24 — Investigar uma clínica com problema

- **Estado:** Proposto.
- **Gatilho:** alerta na visão geral, queixa da clínica ou métrica fora do limite.
- **Fluxo:** PA-01 ou PA-06 → linha da clínica → PA-04 aba Saúde (outbox pendente/falhado, envios incertos, jobs LLM abertos/falhados, versão de schema, estado do WhatsApp) → se precisar de ver conteúdo, JRN-23.
- **Alternativas:** DO da clínica não responde → linha marcada «sem resposta» com hora da última leitura; clínica suspensa → saúde mostra só o último snapshot.
- **Requisitos:** REQ-108, REQ-109.

### JRN-25 — Rever a qualidade da IA

- **Estado:** Proposto.
- **Fluxo:** PA-07 → período e clínica (ou todas) → métricas de conversa e relatório sombra H1 → lista de amostras marcadas para revisão (ver Q-PA-01).
- **Requisitos:** REQ-110.

## 5. Requisitos

| ID | Prioridade | Comportamento e aceite |
| --- | --- | --- |
| REQ-104 | MVP interno | `/admin` só carrega para quem o backend confirma superadmin no pedido atual. `GET /api/me` passa a devolver `isSuperadmin` verificado (hoje é sempre `false`, `src/auth/routes.ts`). **Aceite:** AC-81. |
| REQ-105 | MVP interno | Lista de clínicas com nome, estado, owners, WhatsApp, criação; busca por nome e filtro por estado; detalhe com membros e auditoria da clínica. **Aceite:** AC-82. |
| REQ-106 | MVP interno | Ações de ciclo de vida pedem confirmação com motivo; excluir pede o nome digitado. A tela só mostra o novo estado depois da resposta do servidor (princípio 1 da ux-ui). **Aceite:** AC-83. |
| REQ-107 | MVP interno | Tela de suporte lista pedidos e sessões com estado, prazo restante e owner que decidiu; entrar só aparece com aprovação válida; contador de 30 min vem do `expires_at` do servidor. **Aceite:** AC-84. |
| REQ-108 | MVP interno | Saúde por clínica e global, só com contagens e estados: outbox, envios incertos, jobs LLM, schema, WhatsApp real (substitui o stub de `src/platform/integration-status.ts`). **Aceite:** AC-85. |
| REQ-109 | MVP interno | Visão geral com clínicas por estado, alertas de `evaluateOpsSignals` e suporte pendente/ativo. **Aceite:** AC-85. |
| REQ-110 | MVP interno | Qualidade da IA com métricas agregadas e relatório sombra, pelas mesmas funções que o Review MCP usa, sem duplicar cálculo. **Aceite:** AC-86. |

Toda rota nova fica sob `/api/platform/*` com `requireSuperadmin()` e é somente leitura, exceto as já existentes.

## 6. Telas

Mocks **Confirmados** (Paulo, 16/11/2026) em [`docs/design/admin/`](../design/admin/) com previews 1440×900, índice em [screens.md](../design/screens.md#platform-admin-desktop-1440900-confirmado); IDs PA-xx, área TEL-13 na ux-ui. Navegação lateral fixa no desktop: Visão geral · Clínicas · Suporte · Saúde · Qualidade IA.

| ID | Tela | Endpoints existentes | Lacuna de backend |
| --- | --- | --- | --- |
| PA-01 | Visão geral | `GET /api/platform/tenants` | Resumo agregado de alertas e suporte |
| PA-02 | Clínicas (lista) | `GET /api/platform/tenants` | Busca/filtro no servidor se a lista crescer |
| PA-03 | Nova clínica | `POST /api/platform/tenants` (`ownerEmail`), `POST .../invitations`, `.../resend`, `.../cancel` | — (implementado em #842) |
| PA-04 | Detalhe da clínica (abas Resumo, Membros, Saúde, Suporte, Auditoria) | `GET/PATCH .../:id`, `suspend`, `reactivate`, `DELETE`, `members`, `owners*`, `GET /api/f6/ops/tenants/:id/snapshot` | Estado real do WhatsApp; `GET .../:id/audit` |
| PA-05 | Suporte | `GET /api/platform/support`, `GET .../tenants/:id/support`, `POST /api/platform/support-requests` | **Pedir e listar: PR #854 (#831).** Ativar, entrar, encerrar e cancelar pedido: #853 (no D1 de produção essas rotas dão 503; a Clinic App não lê o cookie de suporte) |
| PA-06 | Saúde global | `GET /api/platform/health` (resumo gravado pelo cron, DEC-193); `GET .../tenants/:id/health`; `POST .../health/refresh` | — (implementado em #833/PR #851) |
| PA-07 | Qualidade IA | `GET /api/f6/ops/conversation-metrics`; MCP review-central | Rotas REST `/api/platform/quality/*` sobre as funções do MCP |
| PA-08 a PA-11 | Abas Membros, Saúde, Suporte e Auditoria do detalhe | ver 6.1 | ver 6.1 |

Estados obrigatórios em todas: carregando, vazio, erro com repetir, sessão expirada; PA-04 e PA-06 também «clínica sem resposta».

### 6.1 Abas do detalhe da clínica (PA-04, PA-08 a PA-11)

**Estado:** **Confirmado** (Paulo, 16/11/2026, «Aprovado») com os mocks PA-08 a PA-11 em `docs/design/admin/`. Continuam em aberto Q-PA-04 e as lacunas de backend abaixo. O cabeçalho (nome, estado, ações Pedir suporte / Suspender / Excluir) e o alerta de saúde são comuns a todas as abas; a aba ativa fica na URL (`/admin/clinicas/:id/membros`) para poder ser partilhada.

**Membros (PA-08).** Fonte: `GET /api/platform/tenants/:id/members` (inclui revogados).
- Colunas: pessoa (nome e e-mail), papel (Owner, Attendant), estado (Ativo, Revogado), entrou em, revogado em.
- Filtro: Ativos (padrão) · Revogados · Todos. Contador na aba = ativos.
- Ações só sobre owners (DEC-018, DEC-103): Adicionar owner, Substituir, Remover; Remover fica desativado com a razão quando é a última owner ativa (`last_owner_protected`). Sobre attendants não há ação, com a frase «Attendants são geridos pela owner na Equipe da clínica».
- Convites pendentes: **fora** deste corte (não há rota de plataforma); a linha da owner convidada na criação mostra «Convite enviado» enquanto não aceita.
- **Lacuna de backend:** a rota devolve só `clerkUserId`. Nome e e-mail vêm do Clerk Backend API em lote, com o mesmo cuidado de custo já em aberto no ADR-0006; se o Clerk falhar, a linha mostra o id e «Nome indisponível», sem bloquear a tela.

**Saúde (PA-09).** Fonte: `GET /api/f6/ops/tenants/:id/snapshot` (`getOpsSnapshot`) e `evaluateOpsSignals`.
- Faixa de alertas da clínica com sinal, valor, limiar e desde quando.
- Cartões: Envios (outbox pendente, falhado, incertos), WhatsApp (estado e último erro, sem número de telefone), IA (jobs na fila e falhados na última hora — **lacuna**: ainda não estão no snapshot), Dados (versão do schema e se está pronta).
- Volume: contatos, mensagens, marcações e anexos, só como números (Q-PA-04).
- Hora da leitura e «Atualizar»; DO sem resposta mostra a última leitura válida com a hora.

**Suporte (PA-10).** Fonte: as mesmas rotas do PA-05, filtradas pela clínica.
- Sessão ativa no topo (como no PA-05), depois o histórico desta clínica: quando, como quem, motivo, estado final, quem decidiu, duração.
- «Pedir suporte» abre o diálogo já com a clínica escolhida; o membro (subject) só pode ser alguém ativo na clínica.
- **Lacuna de backend:** listar pedidos por clínica do lado da plataforma (hoje há só `GET` por id).

**Auditoria (PA-11).** Fonte: `central_audit_events` filtrado por `tenant_id` (índice `central_audit_tenant_occurred_idx` já existe). **Lacuna:** `GET /api/platform/tenants/:id/audit`, paginado por `occurred_at`.
- Colunas: quando, ator, sobre quem (subject), ação em português, resultado (Feito, Negado, Falhou), sessão de suporte quando houver.
- Filtros: período e tipo — Clínica (`tenant.*`), Owners e membros (`owner.*`, `membership.*`, `invitation.*`), Suporte (`support.*`), E-mail (`email.*`).
- Linha expande para mostrar `metadata_json` como lista chave–valor, sem texto clínico (a auditoria não guarda conteúdo, ADR-0006).
- Só leitura; «Carregar mais» em blocos de 50; sem exportar neste corte.

## 7. Em aberto

| ID | Pergunta | Opções | Decide | Bloqueia |
| --- | --- | --- | --- | --- |
| Q-PA-01 | **Resolvida (Paulo, 16/11/2026: «sim»):** PA-07 mostra o texto das amostras de revisão, como o Review MCP já faz ao superadmin (DEC-159). | Opção (b). Descartada: só ids. | Paulo | O mock PA-07 aprovado mostra só ids e precisa de ajuste (abrir amostra com as mensagens) antes de #834 |
| Q-PA-02 | **Resolvida (Paulo, 16/11/2026):** a saúde global lê um **resumo periódico gravado no D1** (cron), não o DO a cada pedido. | Opção (b). Descartada: fan-out aos DOs a pedido. | Paulo | PA-06 e PA-01 mostram a hora do resumo; PA-09 (clínica) pode atualizar o snapshot da própria clínica a pedido |
| Q-PA-03 | Aviso de aprovação de suporte em tempo real para o superadmin | polling 30 s (proposto) ou canal próprio | Paulo | Não bloqueia o primeiro corte |
| Q-PA-04 | **Ainda em aberto; o PR #851 (#833) não mostra volume.** A aba Saúde pode mostrar volume (contatos, mensagens, marcações, anexos) da clínica? | (a) sim, só números, como o snapshot já faz; (b) não, só sinais de falha | Paulo | Mock PA-09 |

**Fora deste recorte:** purga física e retenção LGPD (#43, VAL-09); MFA (DEC-028); edição do catálogo ou da agenda de uma clínica pela Platform Admin; faturação de clínicas.

## 8. Ordem de entrega

1. Spec (este documento) e DEC-192.
2. Mocks PA-01 a PA-07, desktop 1440×900 — **Confirmados** (Paulo, 16/11/2026); faltam os estados listados em screens.md. O PA-07 aprovado mostra amostras só por id; isso não decide a Q-PA-01.
3. Épico [intentzero/tredane#827](https://github.com/intentzero/tredane/issues/827) com as issues #828 a #835 (criadas 16/11/2026): shell e gate → clínicas → suporte → saúde → qualidade IA. Código em `src/client/admin/`, reaproveitando `src/client/ui/` e o padrão de rotas de `src/client/panel/routes.ts`.
