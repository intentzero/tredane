# ADR-0007 — Design system, componentes, ícones e fonte do painel

- **Estado:** a **biblioteca-base de componentes** continua **Proposta**: o responsável pelo produto decidiu em 24/10/2026 que ela será escolhida por prova de conceito na F0 ([DEC-019](../product/decisions.md)). **Confirmados** na mesma decisão: tokens v0.2, ícones Lucide e modo escuro fora do MVP. A fonte Inter hospedada pelo Tredane também foi aprovada, sujeita à conferência da licença.
- **Origem:** [UI/UX](../product/ux-ui.md), [docs/design](../design/README.md), [DEC-017](../product/decisions.md) (mobile first).

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

## Recomendação (Proposta)

Partir de **A ou B**, escolhida por **prova de conceito na F0**, não por preferência. Hipótese inicial: B, pela interação de toque e pelos componentes de data da agenda; A permanece válida se o tamanho ou a curva de aprendizado pesarem. Critérios de aceite da prova:

1. Implementar duas telas reais dos mocks com cada candidata: **M-04 Agendar** (campos, seleção, faixa de aviso) e **M-05 Pipeline** (abas, folha inferior “Mover para…”).
2. Zero violações de acessibilidade automática (axe) nas duas telas e no [catálogo](../design/catalog/index.html); navegação completa por teclado; leitor de tela nos fluxos de formulário e de folha inferior.
3. Funcionamento em Safari no iPhone e Chrome no Android, instalado como PWA, incluindo teclado virtual cobrindo o compositor.
4. Tamanho do pacote medido e registrado; orçamento a definir na F0.
5. Aparência fiel a [tokens.json](../design/tokens.json) sem sobrescritas por tela.

## Estilização, ícones, fonte, modo escuro

- **Tokens:** variáveis CSS geradas de `tokens.json` (`tokens.css`). A ferramenta de CSS (módulos CSS, utilitários ou outra) fica **em aberto** para a F0; regra independente da ferramenta: nenhum valor de cor, raio, fonte ou espaçamento fora dos tokens (verificado por `tools/check_mocks.py` e, no código, por revisão e lint).
- **Ícones:** Lucide (`lucide-react`), conforme [icons.md](../design/icons.md). **Confirmado** (DEC-019).
- **Fonte:** Inter (400, 500, 600), **hospedada pelo próprio Tredane** nos arquivos estáticos do painel, em vez de carregada de um serviço externo, para não enviar o IP de usuários a terceiros e para funcionar offline no PWA. Verificar a licença do arquivo de fonte ao incluí-lo. **Confirmado** (DEC-019), sujeito a essa verificação.
- **Modo escuro:** **Fora do MVP** (Confirmado, DEC-019). Os tokens são organizados por papel (superfície, texto, linha) para permitir um segundo tema depois, sem redesenho das telas.
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
