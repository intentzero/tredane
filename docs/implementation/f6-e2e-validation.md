# F6 — Validação ponta a ponta e go/no-go do piloto

**Estado:** implementação **parcial** da issue [#45](https://github.com/intentzero/tredane/issues/45) (MVP-31 / épico [#14](https://github.com/intentzero/tredane/issues/14)). Dados **sintéticos** apenas. **Não** activa a clínica piloto nem fecha gates humanos.

| Item | Estado |
| --- | --- |
| Matriz AC/UX/JRN → issue → teste → evidência | **Proposto** (consolidada) — [evidence-matrix.md](../product/evidence-matrix.md) |
| Harness E2E duas clínicas / roles / excepções | **Confirmado** (CI sintético) — `src/mvp-validation/` |
| Checklist go/no-go + script de demo | **Proposto** (neste documento) |
| Validação em aparelhos reais 360 px+ | **Em aberto** (Q-UX-01) |
| Autorização explícita de activação do piloto | **Em aberto** (humano) |

## Decisões aplicadas

- AC-01–53 e DEC-001–047 vigentes; cobertura automatizada marcada **Confirmado (sintético)** ou **Em aberto** quando depende de gate humano.
- DEC-038: duas instâncias DO/SQLite (`clinic-demo-a` / `clinic-demo-b`); memberships no D1.
- Pix/IA/WhatsApp em modo `synthetic` até GATE-08/06/01–02.
- **Fora do MVP:** bot autónomo, prontuário, dinheiro real, MFA.

## Entregáveis in-repo

| Entrega | Caminho |
| --- | --- |
| Matriz de evidência | [docs/product/evidence-matrix.md](../product/evidence-matrix.md) |
| Matriz máquina-legível | `src/mvp-validation/matrix.ts` |
| Jornada E2E | `src/mvp-validation/journey.e2e.test.ts` |
| Excepções (concorrência, Pix, envio incerto) | `src/mvp-validation/exceptions.e2e.test.ts` |
| API roles / revogação / duas sessões | `src/mvp-validation/api-roles.http.test.ts` |
| Verificador | `npm run mvp:evidence` |
| Hibernação / WS / revoke runtime | `src/worker/runtime.harness.test.ts` (pré-existente #23) |
| Ops / recovery | [f6-ops.md](f6-ops.md) (#44) |

## Fluxos exercitados (sintéticos)

1. **Sem sinal:** mensagem → oportunidade → etapa → confirmação agenda (JRN-01–03).
2. **Com sinal Pix:** cobrança sem hold → pagamento → confirmação atómica (JRN-16 / AC-46–47).
3. **IA assistiva:** sugestão + decisão humana sem envio autónomo (AC-06).
4. **Exclusão:** contacto apagado, compromisso anonimizado, B intacto (AC-52).
5. **Excepções:** conflito de agenda, pagamento duplicado/tardio, estorno falhado, envio `unknown` (AC-07/09/48–50).
6. **Isolamento / roles:** owner+attendant em A; owner B negado; revoke A preserva B e Clerk (AC-01/02/17).

## Checklist go/no-go (piloto)

Marcar só com evidência. **GO** exige todas as linhas Confirmado **e** autorização explícita de Produto.

### Engenharia (pode fechar no CI)

| # | Critério | Estado | Evidência |
| --- | --- | --- | --- |
| G1 | Matriz AC aplicáveis com teste ou gate explícito | Proposto | evidence-matrix.md |
| G2 | Isolamento A/B + revoke sem logout Clerk | Confirmado (sintético) | mvp-validation + runtime harness |
| G3 | Fluxo WhatsApp→agenda com e sem Pix | Confirmado (sintético) | journey.e2e |
| G4 | Zero duplicação financeira nos cenários sintéticos | Confirmado (sintético) | exceptions.e2e / pix tests |
| G5 | Envio incerto / hibernação / recovery ensaio | Confirmado (sintético) | send + runtime + ops |
| G6 | `npm run verify` verde nesta branch | Proposto | CI do PR |

### Humanos / externos (bloqueiam GO)

| # | Critério | Estado | Gate |
| --- | --- | --- | --- |
| H1 | Chaves Clerk (publishable/secret) + plano/DPA | Em aberto | GATE-05 |
| H2 | Meta Tech Provider / CNPJ / App Review | Em aberto | GATE-01/02 |
| H3 | Parecer LGPD + política de privacidade (#18) | Em aberto | GATE-03/04 |
| H4 | Aparelhos reais ≥360 px + acessibilidade (Q-UX-01) | Em aberto | UX-08 |
| H5 | Catálogo/horários/buffers da clínica piloto | Em aberto | VAL-03 / GATE-12 |
| H6 | Aprovações jurídicas Pix/AI/retenção | Em aberto | GATE-06/08/11 |
| H7 | Staging CF com D1/R2 reais (sem placeholder) | Em aberto | GATE-09 / #44 |
| H8 | Autorização explícita «activar piloto» por Produto | Em aberto | GATE-13 / #45 |

**Veredicto actual:** **NO-GO** para clínica real. Harness sintético pronto para revisão; activação **não** reivindicada.

## Script de demonstração (dados fictícios)

Ambiente: `npm run dev` + auth sintético (`AUTH_MODE=synthetic`). Clínicas `clinic-demo-a` / `clinic-demo-b`.

| Passo | Actor | Acção | Resultado esperado |
| --- | --- | --- | --- |
| 1 | — | Abrir painel; seleccionar Clínica Aurora | Shell mobile; sem dados de B |
| 2 | Attendant A | Inbox mostra contacto sintético (seed ou webhook harness) | Conversa + oportunidade «Novo contacto» |
| 3 | Attendant A | Responder manualmente; pedir sugestão IA; **não** enviar sugestão directa | Bloco «Sugestão»; compositor separado |
| 4 | Attendant A | Mover para «Em atendimento» | Segunda sessão A actualiza (se aberta) |
| 5a | Attendant A | Agendar serviço **sem** sinal → Confirmar | Compromisso confirmado; etapa Agendado |
| 5b | Attendant A | Serviço **com** sinal → Enviar sinal | Cartão Aguardando sinal; horário ainda livre |
| 6 | — | Simular pagamento Pix (`PIX_MODE=synthetic`) | Confirmação automática ou alerta «Pago sem horário» |
| 7 | Owner A | Revogar attendant | Sessão A do attendant perde acesso; B do multi ok |
| 8 | Owner A | Excluir contacto de demo | Mensagens sumidas; compromisso anónimo |
| 9 | — | Abrir clínica B | Sem dados de A |

Gravar evidência (screenshot/vídeo) só com dados fictícios. **Não** usar números Meta reais nem pacientes.

## Blockers que exigem autorização humana

1. **Clerk keys / configuração de app** — GATE-05; checklist TR-17.
2. **Meta / CNPJ / App Review / modelos** — GATE-01/02/10; VAL-13.
3. **LGPD / política / dossiê jurídico (#18)** — GATE-03/04; legal-review-brief.
4. **Aparelhos reais 360 px+, VoiceOver, textos com clínica** — Q-UX-01; UX-08.
5. **Catálogo, preços, expediente e política de cancelamento da clínica** — GATE-12; VAL-01–03.
6. **DPA Woovi, AI Gateway logging off, e-mail transacional** — GATE-06/07/08.
7. **Staging Cloudflare sem placeholders + ensaio PITR live** — #44 / GATE-09.
8. **Decisão documentada de activar piloto** (responsável + runbooks + interrupção) — GATE-13.

## Testes

```bash
npm test -- src/mvp-validation
npm run mvp:evidence
npm run test:runtime   # hibernação / duas sessões / revoke
npm run verify         # suite completa
```

## Em aberto

- Aceite de produto/clínica em UI real (H4–H5), incluindo **UX-08** em aparelho ≥360 px e roteiro VoiceOver/TalkBack (**Q-UX-01**). Polimento a11y in-repo (axe/jsdom) não fecha H4.
- Activação do piloto (H8) — **proibida** sem assinatura humana.
- Qualquer promoção de Proposto→Confirmado em gates externos.
