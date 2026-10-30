# Prompt injection — fronteira de capacidades (S6, #177)

Estado: **implementado em PR** (reland de #198 / S6 sobre `main`; S2 já em #191). Sem deploy. Não afirma imunidade total: o modelo pode ser enganado no texto do rascunho, que continua a exigir revisão humana.

## Entradas não confiáveis

Nunca são instrução, venham de onde vierem: mensagens da conversa (cliente **e** equipe), nome do contato, nome e explicação dos serviços, políticas, nome/endereço/link Google Business da clínica e a **saída do modelo**. A autoria (`[cliente]`/`[clínica]`) vem do campo `direction`, nunca do texto.

## Camadas

1. **Prompt** (`src/ai/untrusted.ts`, `src/ai/prompt.ts`): todo texto não confiável passa por `sanitizeUntrusted` (uma linha só, sem marcadores de papel `[sistema]`/`[clínica]`, tags `<system>`, delimitadores `<<<`/`>>>`, cercas de código, caracteres invisíveis; truncado). Conversa e catálogo ficam entre `<<<DADOS … DADOS>>>`, com regra explícita no prompt de sistema.
2. **Aviso à atendente** (`detectInjectionSignals`, `src/ai/rules.ts`): heurística (Proposto) → aviso `injection_suspected`. Só avisa; nunca bloqueia nem autoriza.
3. **Schema fechado da saída** (`guardReplyOutput`, `src/ai/reply-output.ts`; usado em `src/clinic/ai/operations.ts`): só `{mensagem, notas}` (string). Rejeita campos extras, IDs internos, tipos inválidos, array no topo, texto > 1000/600 caracteres, marcadores de papel, chave Pix / Pix copia e cola, e afirmações de que algo foi marcado/confirmado. Rejeição → rascunho descartado, aviso `output_rejected`, fallback humano.
4. **Sem autoridade do modelo**: a IA não envia mensagens nem chama ferramentas; com o S2 (#191) texto livre nunca marca. Tenant, remetente, preço, sinal, Pix e horários vêm do backend no escopo da clínica.
5. **Imagens nunca vão à IA** (DEC-011): anexos fora do contexto (AC-37), coberto também pelo teste de ataque.

## Testes (CI)

`src/clinic/ai/prompt-injection.test.ts`: instruções na mensagem, JSON colado, mudança de papel, «ignore as regras», texto que imita `[sistema]`/`[clínica]` e tags XML, falsa nota do Tredane, pedido de dados de outra clínica, Pix sem pagar, catálogo/nome malicioso; saída de modelo comprometido; zero compromissos, auditoria `appointment.*` ou envios, com `AI_AUTOBOOK` ligado e clínica autorizada; anexos fora do prompt.

## Limites

- Heurística de deteção é Proposta (pode ter falsos positivos/negativos); serve só para aviso.
- O resumo (`kind: summary`) não usa o schema `{mensagem, notas}` (é texto interno para a equipe). `guardSummaryOutput` descarta marcador de papel, chamada de ferramenta e frase em que o modelo diz que marcou ou enviou. «Ficou marcado» continua válido.
- Proposta/clique por botão (S3–S5) estão no código; a validação do clique fica no backend (`executeProposalConfirmOp`, #176). Validação ponta a ponta e liberação controlada: S9 [#180](https://github.com/intentzero/tredane/issues/180) / [seg-ia-s9-e2e-validation.md](seg-ia-s9-e2e-validation.md) — **sem** activar piloto neste documento.
