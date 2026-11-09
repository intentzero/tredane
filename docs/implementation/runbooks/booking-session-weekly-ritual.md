# Ritual semanal de sessão de marcação (T5 / DEC-148)

**Estado:** **Proposto** (implementação T5; desenho de analytics aprovado pelo Paulo 07/11/2026). Cadência alinhada à DEC-139 (piloto semanal). **Só lista / sugestão** — nunca grava stop-list nem sinónimo sozinho (DEC-141 / DEC-104 / DEC-061). Sem dashboard de transcript. Sem nota LLM por sessão. Sem decisão DEC-143.

## Objectivo

Uma vez por semana (ou antes de cada liberação, o que vier primeiro — DEC-139):

1. Ver o funil agregado (T4) sem abrir chats.
2. Amostrar **N** sessões com friction e/ou `abandon` / `handoff`.
3. Rotular outcomes humanos no painel da clínica (autorização vigente).
4. Acumular um backlog de **candidatos** a stop-word ou sinónimo — aprovação humana depois (cartão DEC-141 ou lista irmã neste runbook).

## Pré-requisitos

- T1–T4 emitidos / legíveis (`booking_sessions`, outbox, Workers Logs).
- Acesso de ops ao SQLite da clínica **ou** export JSONL; owner/equipe com acesso ao painel para ler a conversa.
- Script: `scripts/booking-session-weekly-sample.mjs` (reutiliza o parser do T4).

## Passos (checklist)

Copiar para a nota da semana e marcar:

- [ ] **0. Janela** — escolher `desde` (ex. segunda anterior, UTC) e `tenantId` do piloto.
- [ ] **1. Funil T4** — `node scripts/booking-session-funnel.mjs staging <tenant> <desde>` (pacote) e, se houver JSONL, `--from-jsonl`. Anotar outcomes, top friction, `flowUsed`.
- [ ] **2. Amostra T5** — `node scripts/booking-session-weekly-sample.mjs staging <tenant> <desde> [--n 10] [--from-jsonl …]`. Guardar a ficha Markdown gerada (sessões + backlog).
- [ ] **3. Rotular** — para cada `sessionId` / `conversationId` da amostra, abrir a conversa **no painel da clínica** e preencher o rótulo humano (secção abaixo). Sem exportar transcript.
- [ ] **4. Sugestões** — candidatos `stop_word` / `synonym` vão para o backlog; **não** editar `ZONE_MENTION_STOP` nem gravar sinónimo neste passo.
- [ ] **5. Aplicar (humano)** — sinónimos elegíveis: owner no cartão DEC-141 (M-63). Stop-words: PR de código com caso L1 (DEC-146), nunca script. Outros: issue / CF.
- [ ] **6. Fecho** — uma linha no §7 do [plano de testes](../plano-testes-conversacional.md) ou nota da iteração: N rotulados, K candidatos, 0 auto-apply.

## Rótulos humanos (por sessão amostrada)

| Rótulo | Quando usar |
| --- | --- |
| `ok` | Fricção esperada ou falso positivo; nada a mudar |
| `bug` | Comportamento incorrecto → issue / caso L1 |
| `stop_candidate` | Token deveria estar na stop-list de zona/partícula (ex. `tem`, `feira`) |
| `synonym_candidate` | Termo de catálogo a gravar pela owner (DEC-141 / DEC-110) |
| `unclear` | Precisa segunda passagem |

Não inventar outcome analítico novo: o `outcome` da sessão (`agendado` / `handoff` / `abandon`) já vem do T1; o rótulo é a **leitura humana** da amostra.

## Backlog de candidatos (só lista)

| Origem | Tipo sugerido | Onde aplicar (humano) | O que **não** fazer |
| --- | --- | --- | --- |
| Friction `particle_as_zone` / `nao_encontrei` + `kind=particle_suspected` | `stop_word` | PR em `ZONE_MENTION_STOP` / allowlist de partículas + L1 | Auto-append pela script |
| Friction `nao_encontrei` + `kind=catalog` **ou** linha `unmatched_terms` `aberto` | `synonym` | Cartão M-63 DEC-141 (owner Gravar/Descartar) | Gravar sinónimo sem a owner |
| `mode_uma_todas`, `day_ask_ignored_locked_variant`, … | (não léxico) | Issue / regressão L1 | Tratar como sinónimo |

O analytics só traz `termHash` (sha256 truncado), **não** o texto. O termo em claro recupera-se na conversa do painel ou em `unmatched_terms.term` (DEC-141). O script lista hash + flag + sessão — a pessoa preenche o termo na ficha.

## Script

```bash
# Pacote: SQL amostra + SQL unmatched_terms + lembrete do checklist
node scripts/booking-session-weekly-sample.mjs staging <tenantId> [YYYY-MM-DD] [--n 10]

# Ficha a partir de JSONL (mesmos eventos que o T4)
node scripts/booking-session-weekly-sample.mjs staging <tenantId> 2026-11-01 --n 10 --from-jsonl ./tail.jsonl
```

`TREDANE_WEEKLY_DRY_RUN=1` força só o pacote (mesmo com `--from-jsonl`).

Complementar: [Funil booking_session (T4)](booking-session-funnel.md), `node scripts/flow-funnel.mjs …`.

## O que **não** fazer

| Proibido neste recorte | Motivo |
| --- | --- |
| Transcript / lista de mensagens no Admin | Paulo: revisão na clínica |
| Juiz / nota LLM por sessão | Fora do MVP deste desenho |
| Auto-aplicar stop-list ou sinónimo | DEC-104 / DEC-061 / DEC-141 |
| Decidir DEC-143 só com feeling | Continua Em aberto / teste com pessoas |

## Referências

- Desenho: store `docs/session-analytics.md` §1 / §6 / §7 T5
- DEC-139 (cadência), DEC-141 (sugestão owner), DEC-148 (sessão)
- Código: `scripts/booking-session-weekly-sample.mjs`, `scripts/booking-session-funnel.mjs`
- Painel: `UnmatchedTermsCard` (M-63)
