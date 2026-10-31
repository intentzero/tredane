# Registo do sistema de gestão de IA

**Estado:** **Proposto** (30/10/2026). O procedimento está no [manual](aims.md). Aqui ficam não conformidades, auditorias e revisões. Não promove nenhuma NC a fechada sem a evidência indicada.

## Não conformidades

| ID | Descrição | Dono | Bloqueia | O que fecha |
| --- | --- | --- | --- | --- |
| NC-01 | Envio da sugestão sem versão única. DEC-063, ADR-0004, REQ-022 e [f5-ai-assist.md](../implementation/f5-ai-assist.md) dizem que uma pessoa envia. [MVP.md](../MVP.md) (29/10/2026) diz que as mensagens sugeridas saem sozinhas, salvo injeção ou saída rejeitada. `src/ai/prompt.ts` diz que o sistema envia a mensagem sozinho. Nenhuma destas frases foi alterada por este registo. | Produto | A.9.2, A.9.3, A.9.4 | Uma decisão do responsável pelo produto que reconcilie as três fontes, e a atualização dos textos para essa decisão. |
| NC-02 | O código de contexto envia campos além do conjunto confirmado na DEC-011 (nome e endereço da clínica, horários livres, compromissos futuros). Descrição em [ai-context-minimization.md](ai-context-minimization.md) §1 (H2). | Produto | A.4.3, A.7.4 | O responsável pelo produto aprova ou rejeita o conjunto. A DEC-011 e o código ficam iguais. |
| NC-03 | Parecer LGPD em falta (GATE-04): base legal, dado sensível, papéis de controlador e operador, transferência. | Jurídico e produto | A.8.3, A.10.2, cláusula 4 | Parecer datado, referido em [pilot-gates.md](../product/pilot-gates.md). |
| NC-04 | Logs do AI Gateway e não retenção pela Anthropic por confirmar (GATE-06). Os headers `cf-aig-collect-log-payload: false` e `cf-aig-skip-cache: true` no código são intenção, não evidência do dashboard nem do contrato. | Engenharia e jurídico | A.4.4, A.6.2.8, A.10.3 | Evidência datada no §4.2 de pilot-gates.md. Célula vazia não fecha a NC. |
| NC-05 | Retenção de `operational_audit` sem prazo (REQ-070). O código grava a trilha; a política de quanto tempo ela fica está em aberto. | Jurídico | A.6.2.8 | Prazo aceite no parecer ou numa DEC, e o comportamento alinhado a esse prazo. |
| NC-06 | Papéis do sistema de gestão sem nomes. O [manual](aims.md) §3 usa papéis funcionais. [pilot-gates.md](../product/pilot-gates.md) §1 já deixava a atribuição nominal em aberto. | Produto | Cláusula 5, A.3.2, A.4.6 | Nomes designados pelo responsável pelo produto, com a competência do §4 do manual preenchida só quando houver evidência. |

## Riscos acrescentados depois do manual

**31/10/2026 — evolução autónoma (DEC-084):** riscos EA-R01–15 registrados no [modelo de ameaças](evolucao-autonoma-threat-model.md), incluindo escalada de autoridade, falsificação de avaliação, adulteração de artefato, envenenamento de métricas, isolamento, orçamento e recuperação. Donos funcionais e gates EA-G01–06 definidos; nomes e evidências **Em aberto**. Revisão documental pelo mesmo autor do desenho, sem auditoria independente, testes executados ou NC fechada. A ativação aguarda evidência de todos os gates.

## Auditoria interna — 30/10/2026

**Estado:** registada, com limitação. Quem escreveu os artefatos desta remediação é quem os examinou. O [manual](aims.md) §7 diz que, nesse caso, o resultado não conta como auditoria independente.

**Âmbito:** matriz ISO/IEC 42001, manual, avaliação de impacto, runbooks de preocupação e de incidente, e o código de `guardSummaryOutput`, `proposal.created` e `proposal.confirm_refused`. Dados fictícios. Sem dashboard da Cloudflare e sem parecer jurídico.

**O que foi visto**

- Política, papéis, competência, risco, uso pretendido e reporte externo estão escritos e **Propostos**. Nomes continuam vazios (NC-06).
- A avaliação de impacto cobre sugestão/resumo e marcação por botão. A.5.5 não foi excluído. A pergunta de dado sensível continua no GATE-04.
- O canal de preocupação não é um ecrã novo. O incidente de IA tem três casos e aponta para a pausa sem apagar compromisso.
- `guardSummaryOutput` rejeita marcador, ferramenta e «marquei/enviei»; «ficou marcado» passa. Teste em `src/clinic/ai/prompt-injection.test.ts`.
- `proposal.created` grava id, versão, contato e conversa, uma vez. `proposal.confirm_refused` grava vaga, pausa e contato errado, sem segundo evento no replay e sem nome. O sucesso do clique já gravava `appointment.ai_booked`. Testes em `proposals.test.ts` e `execute-confirm.test.ts`.
- Corrida local desses ficheiros: 87 testes passaram (30/10/2026). Isso não é evidência de produção.

**Conclusão:** o sistema não está conforme para certificação. Nenhum controle fica **Coberto**. NC-01 a NC-06 permanecem abertas. A guarda do resumo e a trilha de proposta e clique deixam A.7.6 e A.6.2.8 em **Parcial** na matriz.

## Revisão pela direção

**Estado:** **Em aberto.** Minuta de 30/10/2026. Sem o aceite do responsável pelo produto, a revisão não está feita.

Entradas usadas: esta auditoria, NC-01 a NC-06, GATE-04 e GATE-06 ainda pendentes em [pilot-gates.md](../product/pilot-gates.md), nenhum incidente de IA registado neste ficheiro.

Decisões pedidas ao responsável pelo produto:

1. Fechar NC-01: quem envia a sugestão (DEC-063, a frase do MVP de 29/10/2026 e a linha do prompt).
2. Fechar NC-02: aprovar ou rejeitar o contexto H2 face à DEC-011.
3. Fechar NC-06: nomes dos papéis do sistema de gestão.
4. Informar ou não a cliente, no WhatsApp, de que houve IA.
5. Aceitar ou devolver a matriz e este manual. Até lá continuam **Propostos**.

NC-03, NC-04 e NC-05 ficam com jurídico e engenharia, nos gates já existentes. Esta minuta não as fecha.
