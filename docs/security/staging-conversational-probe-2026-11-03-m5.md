# Sonda conversacional no staging — 03/11/2026 (M5 / Phase 1)

**Estado:** **Observado** (parcial) na clínica de teste do staging. Não fecha o piloto e não inventa DEC. Dados fictícios; sem tokens, números completos nem segredos.

**Issue:** [#415](https://github.com/intentzero/tredane/issues/415) — **mantém-se aberta** (ver gaps).  
**Quando:** 2026-11-03, America/Sao_Paulo (Paulo).  
**Ambiente:** [staging.app.tredane.com](https://staging.app.tredane.com), clínica de teste, chat WhatsApp de teste, «Ao vivo». Mesmo canal das sondas [30/10](staging-conversational-probe-2026-10-30.md) e [31/10](staging-conversational-probe-2026-10-31.md).  
**Deploy:** Phase 1 (#506–#512; PRs #518–#524 e afins) na `main` + Deploy staging feito. M5 interactive **sempre ligado** ([#499](https://github.com/intentzero/tredane/pull/499); DEC-133 revista) — sem `AI_INTERACTIVE_CHOICES`.

Continua o gate L4 Meta da [#415](https://github.com/intentzero/tredane/issues/415) / DEC-128. Guias internos da sessão: smoke Phase 1 e roteiro M5 L4.

---

## Método

Uma mensagem de cada vez no chat de teste. Cruzar WhatsApp e painel «Ao vivo». Roteiro mínimo Phase 1 (S1–S5). **Não** se correu nesta sessão o A-03 só com toques nem o `list_reply` na lista Horários.

---

## Smoke Phase 1 (S1–S5)

| ID | Mensagem / passo | Resposta / efeito | Veredito | ID matriz |
| --- | --- | --- | --- | --- |
| S1 | Depilação → linha Feminina → texto livre «Axilas e pernas» | Eco «Entendi… Certo?» → Sim → lista **Horários** com títulos de **dia da semana** | **Alinhado** | A-03 (híbrido free-text + eco DEC-137) |
| S2 | **Confirmar** na proposta de S1 | Agendamento criado; hora **local**; **sem IANA** na copy | **Alinhado** | INV-01 / DEC-061 |
| S3 | «Começar de novo» / «Outra coisa» a meio do frame | Limpa sessão / BookingFrame; não reoferece Horários antigos | **Alinhado** | — |
| S4 | Pedido fora do catálogo | Nomeia o item em falta; handoff; **sem** links Google | **Alinhado** | — |
| S5 | Qualquer passo lento do bot | Indicador nativo Meta («Vi a escrever») | **Alinhado** | — |
| — | Toque opcional na lista Horários (`list_reply`) | **Não feito** nesta sessão | **Em aberto** | A-03 toques / #415 |

S6 (validade / rodapé «vale por 24 horas») ficou opcional e **não medido** aqui.

---

## Critérios de aceite da #415

| Aceite | Estado | Notas |
| --- | --- | --- |
| A-03 ≤ 4 turnos **com toques** | **Em aberto** | Caminho desta sessão: texto + eco + Confirmar. Roteiro linha → Opções → Horários → proposta **só com toques** não corrido. |
| Unit toque duplicado / expirado / catálogo | **OK** | `choice-offer.test` (`expired`, `catalog_mismatch`, `unknown_option`) |
| Proxy L4 stale / catálogo alterado | **Em aberto** | Não provocado nesta sessão |
| Meta aceita e entrega listas | **Parcial** | Outbound lista **Horários** entregue e legível (dia da semana). Inbound `list_reply` Horários pendente |
| Webhook fecha o passo no toque | **Parcial** | Histórico M5: `button_reply` Feminina observado; Opções corrigido em #496/#497. Horários `list_reply` nesta sessão: não |
| Só Confirmar marca (DEC-061) | **Alinhado** no caminho testado | Sim do eco não marca; Confirmar cria compromisso |
| Texto livre aceite | **Alinhado** | S1 multi-zona free text |

---

## PRs relevantes

| PR | Papel |
| --- | --- |
| [#479](https://github.com/intentzero/tredane/pull/479) | M5 listas/botões (código; issue aberta pelo gate L4) |
| [#496](https://github.com/intentzero/tredane/pull/496) / [#497](https://github.com/intentzero/tredane/pull/497) | Opções após toque / filtro por linha |
| [#499](https://github.com/intentzero/tredane/pull/499) | M5 always-on |
| [#501](https://github.com/intentzero/tredane/pull/501) / [#504](https://github.com/intentzero/tredane/pull/504) | Horários após texto + eco (DEC-135 / DEC-137) |
| [#505](https://github.com/intentzero/tredane/pull/505) | Toque Horários → proposta (código; L4 do toque pendente) |
| [#518](https://github.com/intentzero/tredane/pull/518) | Títulos Horários com dia da semana (#507) |
| [#520](https://github.com/intentzero/tredane/pull/520) | Catalog miss + handoff (#512) |
| [#524](https://github.com/intentzero/tredane/pull/524) | «Começar de novo» limpa BookingFrame (#508) |
| [#503](https://github.com/intentzero/tredane/pull/503) | Typing indicator |
| [#498](https://github.com/intentzero/tredane/pull/498) | Copy sem IANA |

---

## O que o staging confirmou

- Funil multi-zona por texto livre + eco + lista Horários (outbound Meta) até Confirmar.
- DEC-061 no caminho eco/Sim vs Confirmar.
- Restart limpa BookingFrame; catalog miss sem Google; typing nativo Meta; hora local sem IANA.

## O que ficou Em aberto (bloqueia fecho da #415)

1. **`list_reply` Horários** — toque num slot → proposta do mesmo dia/hora; toque não marca; Confirmar marca.
2. **A-03 ≤ 4 turnos só com toques** — Feminina/Masculina → Opções → Horários → proposta.
3. **Proxy L4** stale / catálogo alterado (unit já verde).

## Recomendação

**Não fechar [#415](https://github.com/intentzero/tredane/issues/415)** até o toque Horários (e, de preferência, A-03 tocável completo) estar Observado em L4. Sem nova DEC neste relatório; DEC-134 corte 24c já Confirmado (opção A).
