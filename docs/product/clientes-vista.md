# Vista Clientes / Contato — ficha operacional

**Estado:** **Proposto** (aguarda decisão do Paulo; 31/10/2026).  
**Não Confirmado.** Sem implementação no painel até decisão de navegação e recorte.

## Problema

O contacto vive sobretudo no sidepane Contato da thread ([#365](https://github.com/intentzero/tredane/pull/365), Opção A Confirmada). Falta uma ficha operacional unificada (dados explícitos + conversas + horários/serviços derivados) e uma forma de encontrar a pessoa sem abrir conversa. Não é CRM clínico nem prontuário (ACT-01).

## Contexto Confirmado (âncoras)

- Contato = ficha; ⋮ = conversa/pipeline ([#365](https://github.com/intentzero/tredane/pull/365); [ux-ui.md](ux-ui.md) TEL-01).
- Contatos no SQLite do DO por clínica ([DEC-038](decisions.md)).
- Configuração de clínica só pela responsável ([DEC-042](decisions.md)) — não decide ainda quem edita a ficha do contacto.
- Exclusão / expurgo: [REQ-071](requirements.md), [AC-52](acceptance.md), DEC-011.
- Sem sexo/género na ficha do contacto; sem inferência (DEC-075, DEC-089).
- Nome humano outbound ([DEC-088](decisions.md)) ≠ persona do atendente virtual ([DEC-089](decisions.md)).

## Navegação (a decidir)

| Opção | Ideia |
| --- | --- |
| **A** | Novo item «Clientes» na nav (lista + ficha). |
| **B** | Só aprofundar o Contato actual / a partir de Conversas. |
| **C (recomendação Proposta)** | Híbrido: manter Contato Confirmado na thread + área Clientes com a **mesma ficha** canónica. |

## Recorte Proposto (MVP+)

1. **Fase 1 — leitura:** lista, busca, ficha com dados existentes, conversas e compromissos derivados; Resumo da IA e Bloquear como em #365; exclusão REQ-071 intacta.
2. **Fase 2 — edição + comparecimento:** nome (e só campos explícitos aprovados); estados compareceu/faltou alinhados a REQ-032 (**Proposto**).
3. **Fora:** prontuário, sexo na ficha, marketing, campos novos sem decisão LGPD.

## Perguntas ao Paulo

1. Opção A, B ou C?  
2. Rótulo «Clientes» vs «Contato»?  
3. Quem edita na fase 2 (atendente + owner, ou só owner)?  
4. Campos pessoais novos no MVP+?  
5. Comparecimento: só motivo de cancelamento ou estado próprio?  
6. Prioridade face ao trabalho F5/F6 em curso?

## Relação com a spec

Atualizar [ux-ui.md](ux-ui.md) (mapa de telas / nav) e mocks em `docs/design/` **somente após** decisão Confirmada. Wireframes de exploração (não Confirmados) podem viver fora do índice de telas até lá.
