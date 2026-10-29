# S8 — Minimização de contexto IA, retenção e isolamento

**Issue:** [#179](https://github.com/intentzero/tredane/issues/179) · Épico [#171](https://github.com/intentzero/tredane/issues/171) · Relacionado: DEC-011, REQ-072, H2 [#159](https://github.com/intentzero/tredane/issues/159), #43, GATE-04/06.  
**Dados:** apenas fictícios / sintéticos até revisão jurídica e gates.

Este documento inventaria, campo a campo, o que vai ao LLM versus o que fica só no backend, e regista retenção, logs do AI Gateway e itens **Em aberto** para Paulo. Não implementa S3/S4/S5 (propostas/botão/clique).

## 1. Divergência DEC-011 × H2 (Em aberto — Paulo)

| Afirmação | Estado |
| --- | --- |
| Conjunto mínimo DEC-011: mensagens recentes (proposta ≤20), primeiro nome, catálogo (nome, duração, preço e audiência do serviço — feminino, masculino ou qualquer, DEC-075; descreve o serviço, não a pessoa; DEC-046 acrescenta explicação), etapa; nunca telefone, anexos, outras conversas, outra clínica. A IA não anuncia vagas nem abre a mistura de sexos no bloco | **Confirmado** (parcialmente — DEC-011; audiência Confirmada em DEC-075, 29/10/2026) |
| DEC-011 listou «horários livres» / conversa inteira como opções **descartadas** | **Confirmado** no texto de 23/10/2026 |
| H2 (#159) pede compromissos futuros, data/hora por mensagem, vagas do período, sem dados proibidos | **Proposto** (arquitetura híbrida / épico) |
| Código de rascunho (`buildClinicAiContext`) já envia nome/endereço/URL Google/políticas, `nowLabel`/`today`/`openingHours`, `freeSlots` (7 dias) e `upcomingAppointments` quando há `clock` | **Código à frente da DEC** — **não** Confirmado como política até Paulo fechar |
| Timestamp por mensagem no payload LLM | **Em aberto** (pedido H2; `AiContextMessage` só tem `direction`+`body`) |
| Propostas versionadas no contexto LLM | **Confirmado engenharia:** objecto S3 existe em `main` (`appointment_proposals`) mas **não** entra no payload LLM neste PR; inclusão no prompt continua **Em aberto** (H2/arch) |

**Não confundir:** confirmação de marcação (DEC-061 / botão) **não** é consentimento LGPD para tratamento de dados.

## 2. Inventário campo a campo

### 2.1 Enviado ao LLM (payload `AiContextPayload` + prompt)

| Campo | LLM? | Estado | Notas |
| --- | --- | --- | --- |
| Corpos das mensagens da conversa alvo (≤20) + `direction` | Sim | **Confirmado** (DEC-011); limite 20 **Proposto** | Texto passa por `redactProhibitedFromText` + `sanitizeUntrusted` |
| Primeiro nome (`contactFirstName`) | Sim | **Confirmado** | Nunca telefone/`wa_id` |
| Etapa da oportunidade (`stage`) | Sim | **Confirmado** | |
| Catálogo: `name`, `durationMinutes`, `priceCents`, `clientExplanation` | Sim | **Confirmado** (+ DEC-046) | Nome/explicação também redigidos se contiverem telefone/token; sem IDs internos, salas ou profissionais |
| `clinic.name`, `address`, `googleBusinessUrl`, políticas, `nowLabel`/`today`/`timezone`, `openingHours` | Sim (rascunho com `clock`) | **Em aberto** vs DEC-011 literal | Presente no código; aguarda aprovação Paulo |
| `clinic.freeSlots` | Sim (idem) | **Em aberto** (DEC-011 descartou; H2 pede) | |
| `clinic.upcomingAppointments` (mesmo contacto) | Sim (idem) | **Em aberto** / H2 **Proposto** | Só do `contactId` da conversa |
| Timestamp por mensagem | Não (ainda) | **Em aberto** (H2) | Backend usa `created_at` (ex.: autobook relativo) |
| Proposta / versão / clique | Não (S8) | Objecto S3 em backend; inclusão no LLM **Em aberto**; clique = S4/S5 | |

### 2.2 Só backend (não vai no payload ao provedor)

| Dado | Onde fica | Notas |
| --- | --- | --- |
| Telefone / `wa_id` | Contacto SQLite | Contado em `_debugExcluded` só em memória de teste |
| Anexos / `r2_key` / bytes | `attachments` + R2 | `includedInAiContext: false` (DEC-011 / DEC-067) |
| Outras conversas do tenant | SQLite | IDs listados só em `_debugExcluded` |
| Outras clínicas | Outro Durable Object / tenant | Isolamento por `tenant_id` + DO |
| Tokens Gateway / Anthropic / Clerk | Secrets Worker | Nunca no JSON de inspeção enviado a testes com valor |
| Sugestão gerada, notas internas, decisão humana | `ai_suggestions` | Texto após geração; não reenviado ao LLM salvo se ecoado em mensagens |
| Idempotência `ai_commands` | SQLite | **Confirmado engenharia S8:** só `{ v:2, suggestionId }` — sem prompts/contexto |
| Jobs `ai_autodraft_jobs`, uso diário | SQLite | Backend; apagados no delete/purge (S8) |
| `appointment_proposals` | SQLite (S3) | Backend-only no S8; apagadas no delete/wipe; não vão ao LLM |
| Auditoria `operational_audit` | SQLite | IDs/ações; sem corpos; retenção de logs **Em aberto** (REQ-070) |
| Disponibilidade completa / holds / Pix | Agenda / Pix | LLM só vê fatia `freeSlots` se bloco clinic ativo |
| Confirmação de marcação / consentimento | Fluxos distintos | Marcação ≠ consentimento LGPD |

## 3. Proibições no payload (enforcement)

**Confirmado** em código + testes (`assertContextMinimized`, `redactProhibitedFromText`, AC-37 / S8):

- Sem chaves `waId`/`phone`/`r2Key`/tokens/credenciais no JSON do payload.
- Sem telefones ou `wa.me` nos corpos após redacção; falha o assert se restarem.
- Sem padrões de segredo (`Bearer …`, `sk-…`, etc.) no JSON.
- Catálogo: nomes/explicações redigidos; assert falha se telefone permanecer.
- Duas clínicas A/B: catálogo e dados de B não aparecem no pedido de A.
- Várias conversas no mesmo tenant: só a conversa alvo entra em `messages`.

## 4. Retenção e exclusão

| Objecto | Contact delete (#43) | Wipe tenant | Reset staging | Estado |
| --- | --- | --- | --- | --- |
| `ai_suggestions` | Sim (por conversa) | Sim | Sim | **Confirmado** engenharia |
| `ai_commands` | Sim | Sim | Sim | **Confirmado**; conteúdo mínimo S8 |
| `ai_autodraft_jobs` | Sim (S8) | Sim (S8) | Sim | **Confirmado** engenharia |
| `ai_daily_usage` | N/A (por clínica/dia) | Sim (S8) | Sim | **Confirmado** engenharia |
| `appointment_proposals` (S3) | Sim (por `contact_id`, S3+#43) | Sim | Sim | **Confirmado** engenharia de exclusão; prazo/política LGPD de cliques/auditoria de proposta **Em aberto** (GATE-04; S4/S5 ainda sem clique) |
| `operational_audit` | Mantém (sem PII de conteúdo) | Mantém | Mantém | Retenção de logs **Em aberto** (jurídico) |

Lacunas LGPD que exigem parecer (GATE-04) e **não** são fechadas por este PR: prazo de conservação de auditoria; tratamento contratual Anthropic/Cloudflare; política fina de cliques quando S4/S5 aterrarem. **Não** tratar clique de marcação como consentimento de dados.

## 5. AI Gateway — logs e cache (expectativa efectiva)

| Controlo | Valor no código | Estado |
| --- | --- | --- |
| `cf-aig-collect-log-payload` | `false` | **Confirmado** como intenção de produto (DEC-011); evidência dashboard = GATE-06 **Em aberto** |
| `cf-aig-skip-cache` | `true` | **Proposto** engenharia S8 — evita reutilizar resposta personalizada entre pedidos; cache global do gateway deve permanecer desligado no dashboard (default Cloudflare) |
| Segredos no log de inspeção | Só nomes de header não secretos | **Confirmado** |
| Logs internos `ai.generated` / `ai.synthetic_fallback` | `tenantId`, kind, tokens, latência — sem corpos | **Confirmado** |
| Contrato / ZDR Anthropic | — | GATE-06 **Em aberto** |

Ver também [environments.md](../implementation/environments.md) § AI Gateway e [pilot-gates.md](../product/pilot-gates.md) GATE-06.

## 6. Isolamento (WebSocket / Queue / R2 / suporte)

| Canal | Regra | Estado |
| --- | --- | --- |
| Construção de contexto | Sempre `tenant_id` + `conversation_id` do pedido autorizado | **Confirmado** |
| WebSocket / Queue / R2 / suporte | Não ampliam o conjunto de campos do payload; autorização continua a ser a da clínica/membro | **Confirmado** em desenho; testes S8 cobrem isolamento A/B e multi-conversa no builder — não reabrem permissões |
| Suporte / impersonação | Sessão própria; política de dados sensíveis Em aberto (DEC-019) | Sem alargar contexto IA neste PR |

## 7. Em aberto para Paulo (produto / jurídico)

1. Aprovar ou rejeitar o conjunto ampliado H2 no LLM (slots, upcoming, meta da clínica, timestamps por mensagem).  
2. Actualizar DEC-011 / REQ-072 / AC-37 após (1) — bloqueia uso real.  
3. GATE-04 parecer LGPD (retenção IA, exclusão, transferência).  
4. GATE-06 evidência de logging/cache no dashboard + contrato Anthropic.  
5. Política LGPD fina de cliques/auditoria de proposta (objecto S3 já se apaga no delete/wipe; S4/S5 ainda sem clique) — sem confundir com consentimento.  
6. Limite de 20 mensagens (continua **Proposto**).  
7. Retenção de `operational_audit` / logs técnicos (REQ-070).

## 8. Testes

- `src/clinic/ai/ai.test.ts` — AC-37 base.  
- `src/clinic/ai/context-minimization.test.ts` — S8: redacção, catálogo, multi-conversa, duas clínicas, `ai_commands` mínimo, headers Gateway, delete/purge AI + propostas S3.  
- `src/clinic/retention/retention.test.ts` — exclusão de contacto e wipe.

## 9. Fora deste PR

S4/S5 (botão WhatsApp, clique→agenda/Pix); activar `AI_AUTOBOOK`; deploy; dados reais. S3 (#174) já em `main` — retenção de propostas alinhada; propostas **não** entram no payload LLM neste PR.
