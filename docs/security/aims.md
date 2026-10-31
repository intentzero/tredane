# Sistema de gestão de IA — Tredane

**Estado:** **Proposto** (revisto em 31/10/2026 para DEC-084). Procedimento interno para manter os controles da [matriz ISO/IEC 42001](iso-42001-control-matrix.md). Não é certificação, não é parecer jurídico e não substitui uma DEC.

**Controlo deste documento:** a data e o estado no cabeçalho. Uma mudança de âmbito, de política ou de método de risco atualiza a data. O [registo](aims-register.md) guarda o que muda a cada auditoria; este ficheiro guarda o procedimento.

**Dono:** o responsável pelo produto, até designar outra pessoa (NC-06 no registo: o nome continua **Em aberto**).

## Índice das cláusulas 4 a 10

| Cláusula | Onde está o procedimento |
| --- | --- |
| 4 Contexto | §1 |
| 5 Liderança | §2 e §3 |
| 6 Planeamento | §5 |
| 7 Suporte | §4 e este ficheiro |
| 8 Operação | §6, [avaliação de impacto](ai-impact-assessment.md), runbooks de [preocupação](../implementation/runbooks/ai-concern.md) e [incidente](../implementation/runbooks/incidents.md) |
| 9 Avaliação | §7 e §8; resultado no [registo](aims-register.md) |
| 10 Melhoria | §9; não conformidades no [registo](aims-register.md) |

## 1. Âmbito e partes interessadas

O sistema de IA no âmbito é o mesmo da matriz:

1. Sugestão de resposta e resumo para a equipe (Claude via Cloudflare AI Gateway).
2. Interpretação para proposta de horário. A marcação só ocorre quando a cliente toca em **Confirmar** numa proposta versionada pelo backend (DEC-061).

3. Evolução autónoma dentro de política previamente aprovada (DEC-084, 31/10/2026): direção confirmada; ativação depende dos [gates EA-G01–06](evolucao-autonoma-threat-model.md). A autonomia de evolução não amplia as ações permitidas no atendimento.

Ficam de fora: treino de modelo próprio, resposta clínica, prontuário, campanhas e ações além das capacidades aprovadas. A política concreta de evolução permanece pendente.

Partes, ainda como hipótese do [dossiê jurídico](../product/legal-review-brief.md): a clínica trata os dados dos seus clientes; o Tredane opera esse tratamento e trata os dados de quem usa o painel; a cliente da clínica, a atendente e a responsável são as pessoas afetadas; Anthropic, Cloudflare, Meta, Clerk e Woovi são fornecedores. O parecer que confirma estes papéis é o GATE-04 (NC-03).

## 2. Política de IA

A política é o conjunto das decisões já registadas, mais as proibições abaixo. Não cria regra nova.

| Tema | Fonte |
| --- | --- |
| Provedor e contexto mínimo | DEC-011, [ai-context-minimization.md](ai-context-minimization.md) |
| Preço, procedimento, saúde, mensagem ofensiva | DEC-046 |
| Marcação só pelo botão; texto livre não marca | DEC-061 |
| Sinal sem reserva antes do Pix | DEC-047 |
| Imagens fora da IA | DEC-067 |
| Pausa e quotas pela responsável | [abuse-limits.md](abuse-limits.md) |
| Sugestão identificada | ADR-0004, REQ-022 |
| Evolução autónoma sob política e controlador independente | DEC-084, [modelo de ameaças](evolucao-autonoma-threat-model.md); ativação pendente |

Proibições em vigor: orientação clínica ou promessa de resultado; dado de outra clínica no contexto; treino ou ajuste de modelo com conversas; marcação por texto livre; a saída do modelo autorizar envio, Pix ou horário.

**Supervisão do envio da sugestão está em aberto (NC-01).** A DEC-063, o ADR-0004, o REQ-022 e [f5-ai-assist.md](../implementation/f5-ai-assist.md) dizem que uma pessoa envia. O [MVP.md](../MVP.md) (29/10/2026) diz que as mensagens sugeridas saem sozinhas, salvo injeção ou saída rejeitada. O prompt em `src/ai/prompt.ts` diz que o sistema envia a mensagem sozinho. Esta política não escolhe uma versão. Até o responsável pelo produto fechar a NC-01, as duas ficam citadas e o controle A.9 permanece **Parcial**.

O contexto que o código envia além da DEC-011 (H2) também não entra nesta política. É a NC-02.

## 3. Papéis

Papéis funcionais. Nomes de pessoas: **Em aberto** ([pilot-gates.md](../product/pilot-gates.md) §1, NC-06).

| Papel | O que faz na IA | O que não faz |
| --- | --- | --- |
| Responsável pelo produto | Aceita DEC, esta política, a matriz e a revisão pela direção | Não marca um gate jurídico como aprovado sem evidência |
| Engenharia | Mantém prompt, contexto, guarda de saída, auditoria e testes; regista evidência técnica de fornecedor quando a tiver | Não alarga o que o modelo vê nem o que ele pode causar sem DEC |
| Jurídico | GATE-04 e contratos (GATE-06 e os outros gates de terceiro) | Não substitui a DEC de produto |
| Responsável da clínica | Configura catálogo, explicação para clientes, quotas e pausa (DEC-042) | Não muda o prompt nem o modelo |
| Atendente | Lê a sugestão e age no painel dentro da regra de envio que a NC-01 vier a fechar | Não trata a sugestão como orientação de saúde nem como registo clínico |
| `system:ai-autobook` | Actor de auditoria da marcação pelo botão | Não é uma pessoa e não cancela nem remarca |

Profissional da clínica não tem login. O encaminhamento de pergunta de saúde (DEC-046) chega à equipe; o caminho até a profissional não está definido e fica na avaliação de impacto.

## 4. Competência

O que cada papel precisa de saber antes de usar ou mudar a IA. Não há registo de formação: a tabela de baixo fica vazia até haver nome e evidência.

| Papel | Precisa de saber |
| --- | --- |
| Atendente | A sugestão é identificada; preço e explicação vêm do cadastro; pergunta de saúde vai à profissional; falha da IA não impede responder à mão |
| Responsável da clínica | Onde ligar quotas e pausar marcações novas; a pausa não apaga o que já foi marcado; o que a IA não faz (clínico, outra clínica, marcação por texto) |
| Produto | Onde estão as DEC, a matriz, as NCs abertas e o que bloqueia dados reais |
| Engenharia | Contexto mínimo, guarda de saída, proposta versionada, o que não entra no log |

| Nome | Papel | Evidência | Data |
| --- | --- | --- | --- |
| — | — | Nenhuma linha. Nomes **Em aberto**. | — |

## 5. Riscos

Método: para cada efeito na pessoa, registar se já há controle e se o controle está fechado. Risco novo ganha uma linha no [registo](aims-register.md). Não há escala numérica.

| Efeito | Controle já decidido | Estado |
| --- | --- | --- |
| Mensagem errada chega à cliente | Sugestão identificada; saída rejeitada não vira rascunho | NC-01 em aberto sobre quem envia |
| Horário errado ou agenda cheia | Botão, revalidação, quotas, pausa | Qualidade do piloto (H10) **Em aberto** |
| Sugestão parece orientação de saúde | DEC-046: sem mérito clínico | Pergunta de dado sensível no GATE-04 |
| Dado de outra clínica no modelo | Isolamento e minimização testados | NC-02 se o código estiver à frente da DEC-011 |
| Conteúdo da conversa retido pelo fornecedor | Headers no código | NC-04: dashboard e contrato por fechar |

Repetir esta leitura quando mudar o que a IA vê, o que ela pode causar, ou o fornecedor do modelo. O resultado da leitura de impacto sobre pessoas está em [ai-impact-assessment.md](ai-impact-assessment.md).

## 6. Operação

O desenho de execução está no ADR-0004, no [modelo híbrido](../architecture/conversational-hybrid-model.md) e em [f5-ai-assist.md](../implementation/f5-ai-assist.md). Este manual não o repete.

Uso pretendido, para entregar à responsável da clínica quando o texto for aceite. **Ainda não publicado** na landing nem no WhatsApp. Informar a cliente de que houve IA está **Em aberto**.

> O Tredane sugere respostas e resumos para a sua equipe e pode preparar uma proposta de horário. A marcação só acontece se a cliente tocar em Confirmar no WhatsApp. A IA não dá orientação de saúde, não usa dados de outra clínica e não marca por uma frase solta. Sem preço ou sem explicação cadastrados, a sugestão não inventa valor nem descreve o procedimento. Você pode pausar marcações novas em Clínica → Limites das automações; o que já foi marcado permanece até a equipe decidir. Não use o resumo como prontuário.

Uso proibido, no mesmo texto: colar a sugestão sem a ler, pedir ao modelo que marque por texto, usar o resumo como registo clínico, pedir desconto ou diagnóstico que não está no cadastro.

Reporte externo (A.8.3): a determinação é que **não está fechada** até o parecer do GATE-04. Enquanto isso não há comunicação a autoridade por causa da IA. Isto regista o estado da decisão; não é a comunicação em si.

Fornecedores (A.10): a evidência continua só em [pilot-gates.md](../product/pilot-gates.md) §4. Célula vazia não é aprovação. Evidência nova entra com data e referência. Os headers `cf-aig-collect-log-payload: false` e `cf-aig-skip-cache: true` no código são a intenção da DEC-011; não provam o dashboard. Isso é a NC-04.

Preocupação de uma pessoa com a IA: [ai-concern.md](../implementation/runbooks/ai-concern.md). Incidente técnico de IA: [incidents.md](../implementation/runbooks/incidents.md).

## 7. Auditoria interna

Quando: antes de dados reais, e de novo quando uma DEC mudar o que a IA vê ou o que ela pode causar.

Quem: uma pessoa que não tenha escrito o controle examinado. Se a equipe for a mesma pessoa, o registo da auditoria diz essa limitação e o resultado não conta como auditoria independente.

O que olha: a matriz, as NCs abertas, os gates GATE-04 e GATE-06, e uma amostra dos testes de minimização, injeção, proposta e resumo. Não pede log com corpo de mensagem.

O resultado vai para o [registo](aims-register.md). Conclusão possível inclui «não conforme para certificação».

## 8. Revisão pela direção

Entradas: última auditoria, NCs abertas, gates de dados reais, incidentes de IA desde a revisão anterior.

Saídas: decisões pedidas ao responsável pelo produto, com dono. Sem o aceite dele, a minuta fica **Em aberto** e a revisão não está feita.

A primeira minuta está no registo. Pede o fecho de NC-01, NC-02 e NC-06, a decisão de informar ou não a cliente, e o aceite da matriz.

## 9. Não conformidade e ação corretiva

Cada NC no registo tem dono, controle afetado e o que a fecha. Ação que muda o que a IA vê ou faz espera decisão do responsável pelo produto. Ação que só documenta, ou que completa um controle já decidido (guarda de saída, auditoria sem corpo de mensagem), segue sem DEC nova.

Fechar uma NC atualiza o registo e, se o estado do controle mudou, a matriz. Não se apaga a NC.
