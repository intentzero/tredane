# ADR-0013 — Design system, componentes, ícones e fonte do painel

- **Estado:** a **biblioteca-base de componentes** continua **Proposta**. A prova de conceito F0 (issue #16) foi **executada** em 24/10/2026: M-04 e M-05 nas duas candidatas em `/prova`, medições registadas abaixo. **A escolha formal pelo responsável pelo produto ainda não foi registada** — não promover base produtiva nem apagar candidata até nova DEC. **Confirmados** (DEC-041): tokens v0.2, ícones Lucide, modo escuro fora do MVP; Inter hospedada localmente com licença SIL OFL 1.1 conferida (`docs/licenses/Inter-OFL.txt`).
- **Origem:** [UI/UX](../product/ux-ui.md), [docs/design](../design/README.md), [DEC-039](../product/decisions.md) (mobile first).

## Problema

Os mocks têm tokens consolidados (v0.2), mas não há componentes em código, nem base escolhida para foco, teclado, leitores de tela, folhas inferiores, diálogos, abas e seleção de data. Sem essa base, cada tela reimplementa interação e acessibilidade, e o painel (PWA usada no celular) tende a divergir do desenho.

## Opções para a base de componentes

| Opção | Resumo | Pontos a favor | Pontos de atenção |
| --- | --- | --- | --- |
| **A. Primitivos sem estilo (Radix UI Primitives)** | Componentes acessíveis sem aparência própria, estilizados por nós | Controle total do visual pelos tokens; boa cobertura de diálogo, abas, seleção, interruptor | Não traz componentes de data e calendário; menos foco em interações de toque |
| **B. React Aria Components** | Componentes sem estilo, com foco em acessibilidade, toque e internacionalização | Tratamento de eventos de toque e teclado; inclui calendário e campos de data, úteis na agenda; localização em pt-BR | Estilização por nós; curva de aprendizado; avaliar tamanho no PWA |
| **C. Kit completo com tema (por exemplo, MUI)** | Biblioteca visual pronta | Rapidez | Aparência imposta, mais difícil de seguir os mocks e os tokens; peso maior |
| **D. Cópia de componentes prontos (por exemplo, shadcn/ui)** | Código copiado para o repositório, sobre primitivos e uma ferramenta de CSS | Ponto de partida rápido, código nosso | Acopla a escolha de ferramenta de CSS e a um conjunto de decisões visuais próprias |
| **E. Construir do zero** | Tudo próprio | Nenhuma dependência | Custo e risco de acessibilidade altos; só justificável para peças muito específicas |

As descrições das bibliotecas vêm do conhecimento geral sobre elas, **sem consulta à documentação atual nesta sessão**: confirmar versão, licença, tamanho e estado de manutenção antes de decidir.

## Recomendação (Proposta — aguarda DEC do produto)

Prova F0 executada (issue #16). **Não há decisão confirmada.** Aplicando a regra deste ADR às medições:

1. Ambas as candidatas passaram no axe automático nas quatro telas de prova (0 violações; contraste excluído do axe em jsdom e coberto por `check_contrast.py`).
2. Diff de pacote M-04+M-05: **Radix ~104 KB gzip** vs **React Aria ~177 KB gzip** (Δ ≈ **+73 KB** a favor de A). Orçamento de bundle ainda **Em aberto**.
3. Só **B** traz DatePicker/Calendar pt-BR sem código próprio (necessário para agenda M-04/M-13).
4. Testes em Safari iPhone / Chrome Android como PWA e roteiro completo de leitor de tela **ainda não feitos** nestes aparelhos (limitação registada; repetir com aparelhos da clínica piloto — Q-UX-01).

**Recomendação de engenharia (Proposta):** preferir **B (React Aria)** se o produto priorizar calendário/i18n da agenda e interação de toque sem biblioteca extra de data — a hipótese inicial do ADR. Preferir **A (Radix)** se o orçamento de PWA (ainda em aberto) tratar ~73 KB gzip como decisivos *e* aceitar calendário próprio ou dependência adicional depois. **Bloqueio:** registo da escolha pelo responsável pelo produto (nova DEC) antes de remover a candidata descartada e de iniciar telas produtivas.

## Roteiro da prova de conceito (Proposto)

**Quando:** na F0, depois do esqueleto do app (`src/client`) com `tokens.css` carregado e antes de qualquer tela de produção. **Quem decide:** o responsável pelo produto, com o resultado medido abaixo. **Duração:** a estimar na F0; limitar a prova às duas telas.

1. **Preparar.** Uma pasta de prova no repositório (fora das rotas de produção) com as duas candidatas, A (Radix UI Primitives) e B (React Aria Components), cada uma com a mesma entrada: `tokens.css` e os dados fictícios dos mocks.
2. **Implementar M-04 e M-05** nas duas candidatas, seguindo [screens.md](../design/screens.md) e o [catálogo](../design/catalog/index.html). Só valores por token; nada de sobrescrita por tela.
3. **Medir** e registrar neste ADR, na tabela abaixo, para cada candidata.
4. **Decidir** pela regra: reprova quem tiver violação de acessibilidade que não consiga corrigir, ou falhar no PWA de iPhone ou Android. Entre as aprovadas, vale a de menor pacote; se a diferença for pequena, a que cobrir calendário e campos de data da agenda (M-04 e Semana, M-13) sem código próprio. Empate: B, pela interação de toque.
5. **Registrar** a decisão como nova DEC, mudar o estado deste ADR para **Confirmado** e apagar a candidata descartada do repositório.

| Critério | A. Radix | B. React Aria | Como medir |
| --- | --- | --- | --- |
| Violações axe em M-04, M-05 e catálogo | **0** (M-04/M-05; 24/10/2026, vitest+jsdom+axe-core). Catálogo HTML estático: contraste OK via `check_contrast.py` | **0** (idem) | axe automático em `src/client/prova/prova.a11y.test.tsx` |
| Teclado completo e leitor de tela (formulário, folha inferior) | **Parcial** — roles/focus trap do Dialog/Select Radix; roteiro VoiceOver/TalkBack pendente | **Parcial** — Modal/Select/DatePicker RAC; roteiro VoiceOver/TalkBack pendente | roteiro manual |
| Safari iPhone e Chrome Android como PWA, teclado virtual sobre o compositor | **Pendente** (sem aparelhos neste ambiente de CI) | **Pendente** (idem) | aparelhos reais; modelos da clínica piloto **em aberto** (Q-UX-01) |
| Tamanho do pacote das duas telas (gzip) | **~104 KB** | **~177 KB** (Δ +73 KB) | `npm run prova:bundle` → [prova-bundle-latest.json](prova-bundle-latest.json) |
| Calendário e data sem código próprio | **Não** — faixa de dias do mock; sem DatePicker | **Sim** — `DatePicker` + `Calendar` (`@internationalized/date`, locale pt-BR) | revisão |
| Fidelidade aos tokens sem sobrescritas | **Sim** — `panel.css` só com variáveis de `tokens.css` | **Sim** (idem) | `check_contrast.py`, revisão de `src/client/ui/panel.css` |

**Limites da prova:** não cobre dados reais, tempo real nem autenticação. Aparelhos iPhone/Android reais e teclado virtual **não** foram medidos neste ambiente; repetir quando a clínica piloto informar os dela (Q-UX-01). Evidências visuais desktop em viewport 390×844: store `media/issue-16/`. Código da prova: `src/client/prova/` (rotas `/prova/*`, lazy-load; não é tela produtiva).

## Estilização, ícones, fonte, modo escuro

- **Tokens:** variáveis CSS geradas de `tokens.json` (`tokens.css`). A ferramenta de CSS (módulos CSS, utilitários ou outra) fica **em aberto** para a F0; regra independente da ferramenta: nenhum valor de cor, raio, fonte ou espaçamento fora dos tokens (verificado por `tools/check_mocks.py` e, no código, por revisão e lint).
- **Ícones:** Lucide (`lucide-react`), conforme [icons.md](../design/icons.md). **Confirmado** (DEC-041).
- **Fonte:** Inter (400, 500, 600), **hospedada pelo próprio Tredane** via `@fontsource/inter` no painel (`src/client/ui/fonts.css`), sem CDN externo. Licença **SIL OFL 1.1** conferida e copiada em [docs/licenses/Inter-OFL.txt](../licenses/Inter-OFL.txt). Lucide: ISC em [docs/licenses/Lucide-ISC.txt](../licenses/Lucide-ISC.txt). **Confirmado** (DEC-041).
- **Modo escuro:** **Fora do MVP** (Confirmado, DEC-041). Os tokens são organizados por papel (superfície, texto, linha) para permitir um segundo tema depois, sem redesenho das telas.
- **Movimento:** respeitar `prefers-reduced-motion`.

## Qualidade contínua

- `tools/check_contrast.py` e `tools/check_mocks.py` no CI da documentação; falha de contraste ou valor fora da escala reprova a alteração.
- Teste de acessibilidade automático (axe) sobre o catálogo e sobre as telas implementadas.
- Cada componente novo entra no catálogo com todos os estados (normal, pressionado, foco, desabilitado, carregando, erro, quando aplicável) antes de ser usado em uma tela.

## Consequências

- A F0 ganha a prova de conceito acima e a entrega de `tokens.css` e do catálogo como parte da base de UI.
- Trocar valores de tokens é barato (um arquivo); trocar a biblioteca de componentes depois da F1 é caro. Por isso a decisão vem antes das telas.
- Enquanto a biblioteca estiver **Proposta**, nenhuma tela de produção deve ser iniciada com uma biblioteca de componentes escolhida por conveniência.

## Itens a revisar

- Identidade visual do Tredane (logotipo, ícone do PWA, cor de marca), que não existe hoje: **Em aberto**.
- Orçamento de tamanho do pacote e de desempenho do PWA.
