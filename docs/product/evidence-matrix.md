# Matriz de evidência do MVP (AC → issue → teste → evidência)

**Estado:** **Proposto** (engenharia, issue [#45](https://github.com/intentzero/tredane/issues/45) / MVP-31 / F6). Consolida rastreio para liberação do piloto com dados **sintéticos**. **Não** declara piloto activado nem fecha gates humanos (Clerk, Meta/LGPD, aparelhos reais, catálogo da clínica, jurídico).

**Fonte de critérios:** [acceptance.md](acceptance.md) (AC-01–53), [ux-ui.md](ux-ui.md) (UX-01–08), [journeys.md](journeys.md) (JRN-01–16), DEC-001–047 vigentes em [decisions.md](decisions.md) / [MVP.md](../MVP.md). Implementação e harness: [f6-e2e-validation.md](../implementation/f6-e2e-validation.md).

**Legenda de estado da evidência**

| Estado | Significado |
| --- | --- |
| **Confirmado** | Teste automatizado no CI ou harness runtime passa; critério coberto com dados fictícios |
| **Proposto** | Cobertura parcial / checklist documental; falta prova humana ou live |
| **Em aberto** | Gate humano, jurídico, Meta, Clerk, aparelho real ou decisão de produto |
| **Fora do MVP** | Explicitamente excluído do primeiro recorte |

## Fluxo piloto (WhatsApp → atendimento → Acompanhamento → agenda)

| Critério | Issue(s) | Teste / harness | Evidência | Estado |
| --- | --- | --- | --- | --- |
| AC-04 primeiro contacto | #29 #30 #32 | `src/clinic/pipeline/pipeline.test.ts`; `src/mvp-validation/journey.e2e.test.ts` | Ingest cria conversa + oportunidade; A≠B | Confirmado (sintético) |
| AC-05 webhook repetido/inválido | #32 | `src/whatsapp/webhook.test.ts` | Dedup; origem inválida sem efeito | Confirmado (sintético) |
| AC-08 duas sessões mesma clínica | #23 #30 | `src/worker/runtime.harness.test.ts`; `src/mvp-validation/api-roles.http.test.ts` | Fan-out A; B isolado | Confirmado (sintético) |
| AC-13 histórico/agenda coerentes | #29 #30 #36 | `journey.e2e.test.ts` | Vínculo contacto↔oportunidade↔compromisso | Confirmado (sintético) |
| JRN-01→03 sem sinal | #29–36 | `journey.e2e.test.ts` («sem Pix») | Mensagem→etapa→confirmação | Confirmado (sintético) |
| JRN-16 com sinal Pix | #37–40 | `journey.e2e.test.ts`; `src/clinic/pix/*.test.ts` | Cobrança sem hold → pago → confirma | Confirmado (sintético) |
| AC-51 confirmar sem sinal | #38 | `src/clinic/pix/signal-charge.test.ts` | Motivo obrigatório | Confirmado (sintético) |

## Isolamento, roles e revogação

| Critério | Issue(s) | Teste / harness | Evidência | Estado |
| --- | --- | --- | --- | --- |
| AC-01 acesso cruzado | #20 #21 #29 | `journey.e2e.test.ts`; HTTP inbox/pipeline | IDs forjados negados; B intacto | Confirmado (sintético) |
| AC-02/17 membership revogado | #23 #25 | `runtime.harness.test.ts`; `api-roles.http.test.ts` | A cortado; B e Clerk ok | Confirmado (sintético) |
| AC-03/18 perfis e Platform Admin | #21 #24 | `src/auth/http.test.ts`; `src/platform/*.test.ts` | Superadmin booleano; profissional sem login | Confirmado (sintético) |
| AC-16/21 owner vs attendant | #25 #28 | `api-roles.http.test.ts`; clinic-config HTTP | Attendant opera; não configura | Confirmado (sintético) |
| AC-22–24 convites | #25 | `src/team/http.test.ts` | Aceite/reenvio/cancel | Confirmado (sintético) |
| DEC-038 DO/SQLite por clínica | #20 | `runtime.harness.test.ts` | Instâncias A/B isoladas | Confirmado (sintético) |

## IA assistiva

| Critério | Issue(s) | Teste / harness | Evidência | Estado |
| --- | --- | --- | --- | --- |
| AC-06 / REQ-022 revisão humana | #41 | `src/clinic/ai/ai.test.ts`; `journey.e2e.test.ts` | Sugestão sem envio autónomo | Confirmado (sintético) |
| AC-37 / REQ-072 contexto mínimo | #41 | `ai.test.ts` | Sem telefone/anexos/dados de B | Confirmado (sintético) |
| AC-41–43 regras DEC-046 | #41 | `ai.test.ts` | Preço, ofensa, clínico | Confirmado (sintético) |
| GATE-06 AI Gateway live | #18 #41 | — | Chaves / logging off | Em aberto |

## Agenda e conflitos

| Critério | Issue(s) | Teste / harness | Evidência | Estado |
| --- | --- | --- | --- | --- |
| AC-09 conflito profissional/sala | #35 #36 | `booking.test.ts`; `exceptions.e2e.test.ts` | Segunda confirmação recusada | Confirmado (sintético) |
| AC-10/36 cancel/reagendar + motivo | #36 | `booking.test.ts` | Motivo obrigatório; conflito preserva | Confirmado (sintético) |
| AC-38 cadastro recursos | #28 | `src/clinic-config/http.test.ts` | Só owner | Confirmado (sintético) |
| Durações/buffers piloto | — | VAL-03 | Catálogo real da clínica | Em aberto |

## Pix / sinal

| Critério | Issue(s) | Teste / harness | Evidência | Estado |
| --- | --- | --- | --- | --- |
| AC-44–46 conta / cobrança / sem hold | #37 #38 | `pix/*.test.ts`; `journey.e2e.test.ts` | Horário livre após envio | Confirmado (sintético) |
| AC-47 pagamento único + duplicata | #39 | `payment.test.ts`; `exceptions.e2e.test.ts` | Replay idempotente | Confirmado (sintético) |
| AC-48 pago sem horário | #39 #40 | `exceptions.test.ts` | Alerta + sem duplicar | Confirmado (sintético) |
| AC-49 expiração + pago tardio | #40 | `exceptions.test.ts`; `exceptions.e2e.test.ts` | Expirada; tardio rastreável | Confirmado (sintético) |
| AC-50 cancel + estorno falhou | #40 | `exceptions.test.ts`; `exceptions.e2e.test.ts` | `refund_failed` ≠ Devolvido | Confirmado (sintético) |
| GATE-08 DPA/taxas Woovi | #18 | — | Dinheiro real | Em aberto |

## Suporte

| Critério | Issue(s) | Teste / harness | Evidência | Estado |
| --- | --- | --- | --- | --- |
| AC-19–35 ciclo suporte | #26 #27 | `src/support/*.test.ts` | Pedido, TTL 30 min, revogação | Confirmado (sintético) |
| Handoff/CSRF/capacidades live | VAL-08 | — | Antes de dados reais | Em aberto |

## Tempo real, falhas e recuperação

| Critério | Issue(s) | Teste / harness | Evidência | Estado |
| --- | --- | --- | --- | --- |
| AC-07 envio incerto | #33 | `send.test.ts`; `exceptions.e2e.test.ts` | `unknown`; sem retry cego | Confirmado (sintético) |
| AC-11/12 reconexão / hibernação | #23 | `runtime.harness.test.ts` | Echo WS; revoke pós-hibernação | Confirmado (sintético) |
| AC-15/53 ops / recovery | #44 | `src/ops/*.test.ts`; runbooks | Scrub PII; ensaio A≠B | Confirmado (sintético); PITR live Em aberto |
| Indisponibilidade terceiros | #44 | runbooks `unavailable.md` | Procedimento documental | Proposto |

## Exclusão e retenção

| Critério | Issue(s) | Teste / harness | Evidência | Estado |
| --- | --- | --- | --- | --- |
| AC-52 exclusão contacto / purge | #43 | `src/clinic/retention/*`; `src/retention/*`; `journey.e2e.test.ts` | Replay do evento não restaura histórico; mensagem nova abre contacto limpo (DEC-099); B intacto | Confirmado (sintético) |
| VAL-09 / GATE-04 jurídico | #18 | legal-review-brief | Antes de dados reais | Em aberto |

## UX (UI humana / aparelhos)

| Critério | Issue(s) | Teste / harness | Evidência | Estado |
| --- | --- | --- | --- | --- |
| UX-01–07 | #22 #33 #41 | unit/UI parciais; mocks | Cobertura automatizada parcial | Proposto |
| UX-08 fluxo 360 px | #22 #42 | Q-UX-01 | Aparelhos reais da clínica | Em aberto |
| PWA/push | #42 | `src/push/*.test.ts` | Sintético | Confirmado (sintético); live Em aberto |

## DEC relevantes (resumo)

| DEC | Estado na matriz | Nota |
| --- | --- | --- |
| DEC-008 agenda | Confirmado (regras); buffers piloto Em aberto | |
| DEC-009 WhatsApp Tech Provider | Confirmado (decisão); GATE-01/02 Em aberto | |
| DEC-011 IA + retenção | Confirmado (código sintético); jurídico Em aberto | |
| DEC-026 revogação | Confirmado (sintético) | |
| DEC-029–037 suporte | Confirmado (sintético); handoff live Em aberto | |
| DEC-038 topologia | Confirmado (sintético); PITR live Em aberto | |
| DEC-047/049 Pix | Confirmado (simulado); GATE-08 Em aberto | |

## Como regenerar / verificar

```bash
npm run mvp:evidence   # valida referências da matriz e imprime resumo go/no-go
npm test -- src/mvp-validation
npm run test:runtime   # hibernação / duas sessões / revoke no harness CF
```

**Piloto activado:** **Não.** Só após checklist go/no-go com autorização explícita de produto + gates em [pilot-gates.md](pilot-gates.md).
