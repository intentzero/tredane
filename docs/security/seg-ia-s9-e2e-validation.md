# S9 — Validação de segurança ponta a ponta e liberação controlada (#180)

**Estado:** **Proposto** (engenharia) · épico [SEG-IA #171](https://github.com/intentzero/tredane/issues/171) · issue [#180](https://github.com/intentzero/tredane/issues/180)  
**Dados:** só fictícios (`clinic-demo-*`, Ana Silva, etc.)  
**Esta entrega (o harness S9) não faz deploy.** **Confirmado depois (Paulo, 29/10/2026):** a proposta de horário está sempre ligada; as vars `AI_AUTOBOOK` e `AI_AUTOBOOK_TENANTS` foram retiradas. A owner pausa na clínica. Texto livre não marca.

## Resumo

| Camada | Estado | O que prova |
| --- | --- | --- |
| Autorização / isolamento (S2–S6, S8 + adversariais S9) | **Confirmado (sintético, CI)** | Zero marcações por texto/JSON/saída de modelo; clique só com proposta válida; tenant/contato/conversa amarrados |
| Pix / agenda (sem hold; pago sem vaga; replay) | **Confirmado (sintético)** | Regras #38–#40 preservadas; proposta não reserva slot |
| Abuse scaffold (S7) | **Proposto** | Código + testes; **valores Em aberto (Paulo)** |
| Qualidade de modelo (H9) | **Em aberto** | Separada dos gates de auth; não bloqueia merge de isolamento |
| UI / aparelhos / Meta staging | **Em aberto (Paulo / Meta)** | Checklist abaixo; engenharia não fecha |
| H10 / #45 qualidade do piloto | **Em aberto** (o interruptor não) | Capacidade **Confirmada** sempre ligada (Paulo, 29/10/2026). Gates de qualidade abaixo continuam abertos |

**Veredicto da capacidade:** ligada (Paulo, 29/10/2026). **Veredicto da qualidade do piloto (20 marcações revistas, Meta, aparelhos):** ainda **Em aberto**.

## Harness e CI

| Entrega | Caminho |
| --- | --- |
| Matriz requisito → cenário → teste | `src/seg-ia-validation/matrix.ts` |
| Adversariais / falha / recovery sintéticos | `src/seg-ia-validation/adversarial.test.ts` |
| Integridade da matriz | `src/seg-ia-validation/matrix.test.ts` |
| Suite focada | `npm run test:seg-ia` |
| Verificador de evidência | `npm run seg-ia:evidence` → sempre `pilotActivated: false`, `verdict: NO-GO` |
| Runbook kill switch | [ai-autobook-kill-switch.md](../implementation/runbooks/ai-autobook-kill-switch.md) |

Os testes S2–S8 existentes continuam a correr em `npm test` / CI. S9 **consolida e preenche lacunas**; não reimplementa S2–S8.

## Mapa requisito → cenário → teste

Fonte canónica máquina-legível: `SEG_IA_EVIDENCE_MATRIX`. Resumo:

| ID | Requisito | Cenário (sintético) | Teste | Estado |
| --- | --- | --- | --- | --- |
| S9-T01 | REQ-083 / AC-56 | Texto livre / JSON nunca marca | `autobook.test.ts` | Confirmado |
| S9-T02 | DEC-061 | Só botão versionado | `execute-confirm.test.ts`, `adversarial.test.ts` | Confirmado |
| S9-T03 | DEC-008/047 | Proposta/Pix sem hold | `proposals.test.ts`, `execute-confirm`, `adversarial` | Confirmado |
| S9-T04 | Isolamento | Tenant/contato/conversa trocados | `proposals.test.ts`, `adversarial` | Confirmado |
| S9-T05 | Webhook adulterado | Assinatura inválida | `webhook.test.ts`, `adversarial` | Confirmado |
| S9-T06 | Proposta antiga | Expirada / substituída / não `enviada` | `proposals`, `execute-confirm`, `adversarial` | Confirmado |
| S9-T07 | Duplo clique / ack | Idempotência `proposal.book:` / `proposal.pix:` | `execute-confirm`, `adversarial` | Confirmado |
| S9-T08 | Kill mid-job | `capability` off antes/depois do commit | `execute-confirm`, `adversarial` + runbook | Confirmado |
| S9-T09 | Falha de envio | Pending communication; compromisso preservado | `send.test.ts`, `adversarial` | Confirmado |
| S9-T10 | Hibernate/restore | Reabrir SQLite + replay | `adversarial` (+ WS hibernate runtime) | Confirmado |
| S9-T11 | Pix pago sem vaga / replay | `#39/#40` | `pix/payment`, `pix/exceptions`, `mvp-validation/exceptions` | Confirmado |
| S9-T12 | Prompt injection | Saída/modelo hostil | `prompt-injection.test.ts` | Confirmado |
| S9-T13 | Contexto IA | Minimização / isolamento | `context-minimization.test.ts` | Confirmado |
| S9-T14 | Regressões H3–H8 | amanhã-tarde + free-text | `amanha-tarde`, `prompt-injection`, `autobook` | Confirmado |
| S9-T15 | S7 abuse | Quotas com `ABUSE_LIMITS=on` | `abuse-limits.test.ts` | Proposto (valores Paulo) |
| S9-H9 | H9 qualidade | Matriz de modelos ~150 | — | Em aberto |
| S9-H10 | H10/#45 | Religar piloto | — | Em aberto |
| S9-UI | Aparelhos / fallback | Checklist Paulo/Meta | — | Em aberto |

## Evidência sintética de integração / falha / recovery

Não fechar #180 só com unit CI abstracto — os cenários abaixo exercitam falha e recuperação no mesmo processo SQLite (e hibernação por ficheiro):

1. **Falha de envio do resultado** após book → compromisso permanece; pendência H7 (`adversarial` + `send.test.ts`).
2. **Kill switch mid-job** → efeito novo negado; reentrega após commit é replay (`adversarial`).
3. **Ack perdido** → segundo `providerEventKey` não cria segundo appointment.
4. **Restore SQLite** → reabrir ficheiro após book; clique repetido = `idempotentReplay`.
5. **Webhook assinatura inválida** → 401 `invalid_signature`, fila vazia.
6. **Pix** → `paid_without_slot` e replay financeiro nos testes #39/#40 (sem segundo efeito).

Runtime Cloudflare (WebSocket hibernável, revoke): `src/worker/runtime.harness.test.ts` (pré-existente #23) — apontado na matriz; não substitui os gates humanos.

## Qualidade de modelo (H9) ≠ gates de auth

**Confirmado (engenharia):** autorização e isolamento são gates independentes. Um modelo «bom» não autoriza marcação; um modelo «mau» não deve conseguir efeito não autorizado se S2–S6/S9-T* passarem.

**Em aberto (H9 / #166):** conjunto ~150 conversas, matriz Haiku/Sonnet, p95 de latência, escolha final de thinking. Esses critérios medem **qualidade de rascunho**. A capacidade de proposta já não depende deles (Paulo, 29/10/2026).

## Gates H10 / #45 (qualidade do piloto)

**Confirmado (Paulo, 29/10/2026):** a proposta está sempre ligada. Não há `AI_AUTOBOOK` nem allowlist para religar. Os gates abaixo medem qualidade e operação do piloto; não são o interruptor.

| # | Gate | Estado | Responsável |
| --- | --- | --- | --- |
| G-S9-01 | CI `test:seg-ia` + `seg-ia:evidence` verdes nesta branch | Proposto (PR) | Engenharia |
| G-S9-02 | S2–S6/S8 em `main` sem regressão | Confirmado no código | Engenharia |
| G-S9-03 | Valores S7 (abuse/quotas) decididos | **Em aberto** | Paulo |
| G-S9-04 | Meta staging: interactive buttons + TMPL-04 / janela 24 h | **Em aberto** | Paulo / Meta |
| G-S9-05 | #18 dados/LGPD/Tech Provider evidência explícita | **Em aberto** | Paulo / jurídico |
| G-S9-06 | Checklist aparelhos piloto (abaixo) | **Em aberto** | Paulo |
| G-S9-07 | Config remota da flag | **Substituído (Paulo, 29/10/2026):** vars retiradas; o interruptor é a pausa da owner | Paulo |
| G-S9-08 | 20 marcações revistas, zero indevidas (Decidido) | **Em aberto** | Equipe piloto |
| G-S9-09 | Autorização explícita para a proposta | **Confirmado (Paulo, 29/10/2026):** sempre ligada, em todos os ambientes | Paulo |
| G-S9-10 | Runbook kill switch ensaiado (sintético ok; live Em aberto) | Proposto | Engenharia / ops |

**Não inventar** critérios de amostra de Paulo nem autorização Meta. Mínimo de 20 marcações revistas (Decidido 28/10/2026) permanece; o resto dos gates humanos não está fechado neste PR.

## Checklist UI / aparelhos (Em aberto — Paulo / staging Meta)

Marcar só com evidência live. Engenharia **não** reivindica conclusão.

- [ ] Botões **Confirmar** / **Alterar detalhes** visíveis e utilizáveis no WhatsApp do aparelho piloto (Android e iOS usados pela clínica).
- [ ] Corpo da proposta com clínica, serviço, data/fuso, horário, profissional, preço/sinal — sem o rótulo «beneficiária» (DEC-100) e sem truncar de forma a tornar o botão ambíguo.
- [ ] Clique Confirmar numa proposta válida (staging sintético ou piloto autorizado) produz book ou Pix conforme serviço — **sem** caminho de marcação por texto se o botão falhar.
- [ ] Se o botão não for utilizável (cliente sem UI de botões / falha Meta): mensagem de fallback humano na conversa; atendente assume; **proibido** degradar silenciosamente para «sim»/texto livre a marcar.
- [ ] «Alterar detalhes» encaminha à equipe sem cancelar compromisso legítimo já existente.
- [ ] Comunicação pendente (5 min) visível no painel quando envio de resultado falha.

## Relação com documentos existentes

- Contenção e vars: [environments.md](../implementation/environments.md)
- Kill switch: [ai-autobook-kill-switch.md](../implementation/runbooks/ai-autobook-kill-switch.md)
- S6 / S7 / S8: [prompt-injection.md](prompt-injection.md), [abuse-limits.md](abuse-limits.md), [ai-context-minimization.md](ai-context-minimization.md)
- Sonda de staging 30/10/2026 (**Observado**, não fecha H10): [staging-conversational-probe-2026-10-30.md](staging-conversational-probe-2026-10-30.md)
- Inventário: [security-and-protection-inventory.md](security-and-protection-inventory.md)
- H9/H10 plano: [epic-conversational-hybrid-model.md](../implementation/epic-conversational-hybrid-model.md)
- Go/no-go MVP #45: [f6-e2e-validation.md](../implementation/f6-e2e-validation.md)

## O que este PR confirma vs deixa Em aberto

**Confirmado (sintético):** consolidação de testes do épico + adversariais listados; zero book por texto/JSON/modelo nos testes; Pix/agenda/pending rules apontadas; runbook de interrupção; matriz H9 separada; evidência de falha/recovery no harness.

**Em aberto (Paulo / externos):** valores S7; UI/aparelhos; Meta staging; evidência #18; configuração remota live; 20 marcações revistas; autorização de activar piloto; H9 matriz de modelos.
