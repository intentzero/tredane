# Proteção da equipe: imagens, sinalização e pausa das automações (P1)

**Estado:** especificação de planejamento do [épico #182](https://github.com/intentzero/tredane/issues/182), entrega [#183](https://github.com/intentzero/tredane/issues/183). Decisão-fonte: **DEC-067** ([decisions.md](decisions.md)). Nada aqui declara implementação, liberação ou ativação; código existente não aprova política. Apenas dados fictícios até os gates #18/#45.

## 1. Fixo (não depende do Paulo)

- **Imagens nunca vão para a IA** (DEC-011): nem bytes, nem miniatura, nem descrição gerada. A IA só recebe o marcador «a cliente enviou uma imagem não analisada» (#188). Legenda é texto não confiável, tratado como qualquer mensagem.
- **Pausa ou bloqueio negam ações novas** em S2 ([#173](https://github.com/intentzero/tredane/issues/173)) e S5 ([#176](https://github.com/intentzero/tredane/issues/176)): sem nova proposta, sem execução de clique, sem Pix automático, sem sugestão automática enquanto ativo. A checagem é no backend, dentro da transação, não na UI.
- **Staging com `AI_AUTOBOOK=off`**; automações desligadas por padrão até os gates (DEC-061 proposta, PR #181).
- Sem moderação visual por provedor externo, sem diagnóstico por imagem, sem prontuário/anamnese; tipos de mídia permitidos não mudam (#34).
- Bloqueio interno do Tredane **não** é apresentado como bloqueio/denúncia na Meta.

## 2. Reconciliação com DEC-046 e o bloqueio existente

- DEC-046(c) (24/10/2026) continua valendo: em mensagem ofensiva a IA só sugere aviso + resposta cordial; **não bloqueia** contato. DEC-067 não altera isso; acrescenta ações **humanas** (sinalizar, pausar) e efeito de pausa nas automações.
- O bloqueio de contato já descrito em `BlockContactDialog.tsx` (preserva histórico, compromissos e Pix) é base existente; sua política é registrada pela primeira vez em DEC-067. Bloqueio continua decisão humana, nunca efeito automático de detector.

## 3. Imagens na conversa

- Cada imagem aparece como cartão **oculto por padrão** («Imagem recebida — Ver»), com legenda exibida à parte como texto.
- Nenhum byte ou miniatura é buscado antes do toque explícito em «Ver», por imagem (não vale para a conversa inteira); leitura autenticada por clínica (`attachments/routes.ts`).
- Falha de download/indisponibilidade aparece no cartão; não há preview automático em notificações, lista de conversas ou tempo real.
- Imagem sinalizada volta a ficar oculta para todos; ver exige novo toque com aviso.

## 4. Gravidade (detector só alerta)

| Nível | Exemplo fictício | Efeito |
| --- | --- | --- |
| Reclamação/irritação | «Demorou demais, péssimo» | Nada automático; atendimento normal. |
| Insulto | xingamento à atendente | Alerta sugerido; humano decide sinalizar. |
| Assédio/conteúdo sexual indesejado | imagem ou texto sexual não pedido | Alerta; atendente pode sinalizar e pausar sem abrir. |
| Ameaça | ameaça à equipe ou à clínica | Alerta prioritário; atendente pausa e encaminha. |
| Repetição | novo insulto após sinalização | Alerta; conta para aviso à responsável. |

Detector (IA/heurística) só cria **alerta sujeito a revisão**; não pausa, bloqueia nem apaga. Falso positivo é corrigido com «Não é abuso» pela responsável, com auditoria.

## 5. Permissões

| Ação | Atendente | Responsável (owner) | Superadmin |
| --- | :---: | :---: | :---: |
| Ver imagem (sob demanda) | ✓ | ✓ | só em suporte aprovado |
| Sinalizar conteúdo (sem abrir) | ✓ | ✓ | — |
| Ocultar imagem/mensagem | ✓ | ✓ | — |
| Pausar automações | ✓ | ✓ | — |
| Encaminhar à responsável | ✓ | — | — |
| Revisar fila e marcar falso positivo | — | ✓ | — |
| Bloquear contato | **P-1** | ✓ | — |
| Desbloquear contato / retomar automações | — | ✓ | — |

Toda ação grava auditoria (ator, horário, motivo). Tudo restrito à própria clínica.

## 6. Em aberto — propostas para o Paulo

### P-1 · Quem sinaliza, oculta e retoma — **Decidido (28/10/2026, Paulo, D-20261028-201300-CUR)**
**Proposta:** atendente sinaliza, oculta e pausa (e pode bloquear como medida imediata); só a responsável (owner) da clínica desbloqueia, retoma e marca falso positivo.
**Porquê:** quem está na linha de frente se protege na hora; desfazer a proteção exige quem responde pela clínica.

### P-2 · Alcance da pausa, retenção e exclusão — **Decidido (28/10/2026, Paulo, D-20261028-201300-CUR)**
**Proposta:** a pausa vale para o **contato na clínica** (todas as conversas atuais e novas desse número na mesma clínica), até retomada humana; nunca afeta outra clínica. Mensagens novas continuam chegando ao painel, mas sem automação. Registros de sinalização ficam enquanto o contato existir e saem junto com a exclusão do contato (#43); imagem sinalizada segue a retenção normal dos anexos, e preservação excepcional (ex.: ameaça) exige ação explícita da responsável com prazo de 90 dias, renovável por ela.
**Porquê:** pausa só na conversa seria contornada ao reabrir conversa; prazo explícito evita guarda indefinida.

### P-3 · Critérios de aviso à responsável — **Decidido (28/10/2026, Paulo, D-20261028-201300-CUR)**
**Proposta:** avisar a responsável (no painel, como o pedido de suporte) sempre que houver: sinalização de ameaça ou assédio; pausa ou bloqueio feitos por atendente; segunda sinalização do mesmo contato. Insulto isolado e reclamação entram só na fila de revisão, sem aviso ativo.
**Porquê:** regra simples, sem depender de contagem calibrada; o que é grave ou repetido chega a quem decide.

Pendências P-1–P-3 têm Paulo como responsável e **bloqueiam uso real** (#186, #187, #189).

## 7. Ligação com as issues

| Critério | Issue |
| --- | --- |
| Anexos ligados às mensagens, reconciliação em tempo real | #184 |
| Cartão oculto e visualização sob demanda (§3) | #185 |
| Sinalizações e fila de revisão (§4, §5, P-3) | #186 |
| Pausa/bloqueio em jobs, propostas e cliques; retomada (§1, P-2) | #187, #173, #176 |
| Marcador de imagem não analisada para a IA; ofensas sem efeito automático | #188 |
| Validação ponta a ponta, privacidade e recuperação | #189, #179, #180 |
