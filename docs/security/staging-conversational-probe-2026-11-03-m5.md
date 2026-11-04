# Sonda conversacional no staging — 03/11/2026 (M5 / Phase 1)

**Estado:** **Observado** na clínica de teste do staging. Aceite da [#415](https://github.com/intentzero/tredane/issues/415) **coberto** (A-03 tocável + `list_reply` Horários + DEC-061). Residual stale/catálogo L4 proxy **não bloqueante**. Não inventa DEC. Dados fictícios; sem tokens, números completos nem segredos.

**Issue:** [#415](https://github.com/intentzero/tredane/issues/415) — fecho via PR docs (`Closes #415`).  
**Quando:** 2026-11-03, America/Sao_Paulo (Paulo).  
**Ambiente:** [staging.app.tredane.com](https://staging.app.tredane.com), clínica de teste, chat WhatsApp de teste, «Ao vivo». Mesmo canal das sondas [30/10](staging-conversational-probe-2026-10-30.md) e [31/10](staging-conversational-probe-2026-10-31.md).  
**Deploy:** Phase 1 (#506–#512; PRs #518–#524 e afins) na `main` + Deploy staging feito. M5 interactive **sempre ligado** ([#499](https://github.com/intentzero/tredane/pull/499); DEC-133 revista) — sem `AI_INTERACTIVE_CHOICES`.

Duas voltas no mesmo dia: (1) smoke Phase 1 parcial registado no [#526](https://github.com/intentzero/tredane/pull/526); (2) follow-up A-03 / `list_reply` Horários abaixo.

---

## Método

Uma mensagem de cada vez no chat de teste. Cruzar WhatsApp e painel «Ao vivo».

**Sessão 1 (parcial, #526):** roteiro Phase 1 S1–S5 com desvio em S1 (sem toque Horários). Elo Horários→proposta **não auditado** nessa volta.

**Sessão 2 (fecha aceite):** Run 1 prova `list_reply` Horários → proposta → Confirmar (DEC-061). Run 2 prova A-03 só com toques (linha → Opções → Horários → proposta).

---

## Sessão 1 — Smoke Phase 1 (S1–S5) · parcial

| ID | Mensagem / passo | Resposta / efeito | Veredito | ID matriz |
| --- | --- | --- | --- | --- |
| S1 | Depilação → linha Feminina → texto livre «Axilas e pernas» | Eco «Entendi… Certo?» → Sim → lista **Horários** com títulos de **dia da semana**. Sem toque no slot nesta volta | **Parcial** na sessão 1; **fechado** na sessão 2 (Run 1) | A-03 (híbrido free-text + eco DEC-137) |
| S1→S2 | Passo entre lista Horários e a proposta usada em S2 | **Gap na sessão 1** — elo exacto não registado; **não** foi `list_reply` | **Fechado** na sessão 2 | — |
| S2 | **Confirmar** numa proposta versionada da mesma sessão | Agendamento criado; hora **local**; **sem IANA** na copy | **Alinhado** no gesto Confirmar→marca (DEC-061) | INV-01 / DEC-061 |
| S3 | «Começar de novo» / «Outra coisa» a meio do frame | Limpa sessão / BookingFrame | **Alinhado** | — |
| S4 | Pedido fora do catálogo | Nomeia o item em falta; handoff; **sem** links Google | **Alinhado** | — |
| S5 | Qualquer passo lento do bot | Indicador nativo Meta («Vi a escrever») | **Alinhado** | — |

S6 (validade / rodapé «vale por 24 horas») ficou opcional e **não medido** aqui.

---

## Sessão 2 — A-03 completo e `list_reply` Horários · Confirmado (Paulo)

### Run 1 — Horários `list_reply` + DEC-061

Outra coisa → Quero depilação → Feminina → (**saltou Opções**; frame Axila/Pernas residual) → Horários → toque `quarta 04/11 10:45` → proposta → **Confirmar** → Agendado **10:45–11:15** + Agenda «Marcado pela IA».

| Observação | Estado |
| --- | --- |
| Toque no slot monta proposta (mesmo dia/hora) | **Alinhado** |
| Toque **sozinho** não cria compromisso | **Alinhado** (DEC-061) |
| Confirmar cria compromisso + Agenda «Marcado pela IA» | **Alinhado** |
| Residual: saltou Opções / frame Axila/Pernas | **Não bloqueante** (Run 2 limpo) |

### Run 2 — A-03 limpo com Opções

Outra coisa → Depilação → Feminina → **Opções** (zonas) → toque **Pernas** → Horários → toque `quarta 04/11 13:00` → proposta **Depilação · Pernas 13:00–13:20 Gi R$ 120**.

Parou **sem** Confirmar (já provado no Run 1).

| Observação | Estado |
| --- | --- |
| Funil tocável: linha → Opções → Horários → proposta | **Alinhado** (A-03 ≤ 4 turnos) |
| Meta entrega lista Opções e lista Horários | **Alinhado** |
| `list_reply` fecha o passo até à proposta | **Alinhado** |

---

## Critérios de aceite da #415

| Aceite | Estado | Notas |
| --- | --- | --- |
| A-03 ≤ 4 turnos **com toques** | **Alinhado** | Run 2 |
| Unit toque duplicado / expirado / catálogo | **OK** | `choice-offer.test` (`expired`, `catalog_mismatch`, `unknown_option`) |
| Proxy L4 stale / catálogo alterado | **Não corrido** (residual opcional) | Unit já verde; **não** bloqueia o aceite da issue |
| Meta aceita e entrega listas | **Alinhado** | Opções + Horários |
| Webhook fecha o passo no toque | **Alinhado** | `button_reply` / `list_reply` (Runs 1–2) |
| Só Confirmar marca (DEC-061) | **Alinhado** | Run 1: toque≠marca; Confirmar=marca |
| Texto livre aceite | **Alinhado** | Sessão 1 até eco + Horários outbound |

---

## PRs relevantes

| PR | Papel |
| --- | --- |
| [#479](https://github.com/intentzero/tredane/pull/479) | M5 listas/botões (código; issue aberta pelo gate L4) |
| [#496](https://github.com/intentzero/tredane/pull/496) / [#497](https://github.com/intentzero/tredane/pull/497) | Opções após toque / filtro por linha |
| [#499](https://github.com/intentzero/tredane/pull/499) | M5 always-on |
| [#501](https://github.com/intentzero/tredane/pull/501) / [#504](https://github.com/intentzero/tredane/pull/504) | Horários após texto + eco (DEC-135 / DEC-137) |
| [#505](https://github.com/intentzero/tredane/pull/505) | Toque Horários → proposta (código; L4 Observado na sessão 2) |
| [#518](https://github.com/intentzero/tredane/pull/518) | Títulos Horários com dia da semana (#507) |
| [#520](https://github.com/intentzero/tredane/pull/520) | Catalog miss + handoff (#512) |
| [#524](https://github.com/intentzero/tredane/pull/524) | «Começar de novo» limpa BookingFrame (#508) |
| [#503](https://github.com/intentzero/tredane/pull/503) | Typing indicator |
| [#498](https://github.com/intentzero/tredane/pull/498) | Copy sem IANA |
| [#526](https://github.com/intentzero/tredane/pull/526) | Docs sessão 1 (parcial; #415 aberta) |

---

## O que o staging confirmou

- A-03 tocável L4 (linha → Opções → Horários → proposta) e `list_reply` Horários → proposta versionada.
- DEC-061: toque não marca; Confirmar marca; Agenda «Marcado pela IA».
- Sessão 1: multi-zona free text + eco (DEC-137); restart; catalog miss; typing nativo; hora local sem IANA.

## Residual (não bloqueia fecho da #415)

1. **Frame stale / saltou Opções (Run 1)** — coberto pelo Run 2 limpo.
2. **Proxy L4** stale / catálogo alterado — unit OK; L4 não corrido.

## Recomendação

**Fechar [#415](https://github.com/intentzero/tredane/issues/415)** — aceite da issue coberto em L4. Sem nova DEC neste relatório; DEC-134 corte 24c já Confirmado (opção A). Preferência do Project: review antes de merge do PR docs.
