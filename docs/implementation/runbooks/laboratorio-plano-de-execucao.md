# Laboratório conversacional: plano de execução para um agente

**Estado:** Proposto (14/11/2026). Escrito para um agente que não viu a conversa de origem. Pré-requisito: ler
`laboratorio-mcp.md` (ferramentas e limites, DEC-186). **Nota (DEC-202):** o funil de marcação do chat e a sombra do interpretador foram removidos; os passos que dependem deles ficam sem objeto.

## Regras que o agente não pode quebrar

- Só staging, só a clínica demo. Números `5500…`. Nada de dados reais. Se o gate responder 404, parar e avisar.
- **Não decidir pela owner.** Os pontos marcados «decisão do Paulo» abaixo só se descrevem (o que a cliente recebeu);
  não se altera código nem texto para os resolver. Nada de copy nova para a cliente (DEC-104).
- Defeito confirmado = caso L1 primeiro, correção depois (`metodologia-avaliacao-conversacional.md`). Um PR por defeito.
- Configuração alterada pelo laboratório (`lab_config_*`) é anotada e **desfeita no fim**; a clínica demo é partilhada.
- Respeitar o teto de turnos diário; o `lab_status` diz quantos restam. Não repetir frases só para encher o teto.
- Não colar no PR ids de conversa nem texto de conversas reais; as do laboratório são fictícias e podem citar-se.

## Passo 0 — ligação (feito uma vez, por uma pessoa)

Deploy de staging; registar `https://<staging>/api/mcp/lab` no cliente MCP e consentir com a conta superadmin. O
agente começa por `lab_status`. Se o OAuth falhar, relatar o erro exato e parar.

## Passo 1 — teste de fumo

Pré-requisito: `lab_config_get` com `settings.aiAssistEnabled: true` (senão `lab_say` só grava inbound). Se estiver
falso: `lab_config_ai_assist` com `enabled: true` (o seed da demo também liga a IA).

`lab_status` → `lab_say "Quero massagem amanhã"` → `lab_state`. Esperado: resposta da IA em segundos, mensagens
novas em `messages`, nenhuma exceção. Registar o que veio.

## Passo 2 — reproduzir os defeitos dos PRs abertos (só descrever)

Para cada PR, correr a frase com 3 variantes e 3 `waId` diferentes (a frase aprovada varia por conversa) e registar a
resposta literal. Comparar staging **antes** da fusão do PR com o comportamento esperado do PR.

| PR | Frase | Pergunta para o Paulo (decisão dele) |
| --- | --- | --- |
| #748 | «Quero massagem amanhã» / «domingo» com a clínica fechada | A cliente recebe «não tenho horário livre» ou «fechada, próximo na segunda»? Qual prefere? |
| #750 | «terminar», «encerrar», «deixa pra lá», «cancela tudo» a meio do funil | O âmbito do abandono deve ficar só em «terminar/encerrar»? |
| #752 | «tenho dor nas costas, serve a massagem?» | Sintoma de saúde passa a handoff ou fica a resposta de «falar com a profissional» (DEC-046)? |

Saída: uma tabela frase → resposta literal → o que o PR muda, no comentário do respetivo PR.

## Passo 3 — bateria para medir H1 (removido pela DEC-202)

A sombra do interpretador e o extrator foram removidos; não há o que medir. O passo fica só como registo.

## Passo 4 — cenários de configuração (opcional)

Uma sala só; serviço com variantes e sem; profissional com horário próprio; fecho num dia. Para cada um:
`lab_config_*`, 3 conversas, `lab_state`, e **desfazer**. Falhas viram casos L1.

## Entrega

Relatório no PR ou na issue indicada pelo Paulo: o que correu, o que falhou, o que ficou por decidir, turnos gastos e
a configuração desfeita. Marcar cada achado como **Confirmado** (reproduzido em 3 variantes), **Proposto** ou **Em aberto**.
