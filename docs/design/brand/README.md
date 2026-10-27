# Identidade visual do Tredane — direção A, Confluência

**Estado:** direção **Confirmada** pelo responsável pelo produto em 27/10/2026 ([DEC-050](../../product/decisions.md)), escolhida entre três direções apresentadas no [canvas de exploração](https://claude.ai/artifact/TTdBW9suhBBLyB1ZpfjPPW) (privado). Aplicar a paleta aos tokens do painel continua **Em aberto** (ver [Pendências](#pendências)).

**Conceito:** duas conversas que correm para o mesmo lugar formam o T; de perto, é uma pessoa de braços abertos — o paciente acolhido.

## Ficheiros

Todos gerados por [`tools/build_brand.py`](../tools/build_brand.py); não edite à mão.

| Caminho | Conteúdo |
| --- | --- |
| `svg/tredane-simbolo-*.svg` | Símbolo sozinho (grelha 64 × 64) |
| `svg/tredane-nome-*.svg` | Nome «tredane» em contornos (Manrope 700, espaçamento −3,5 %) |
| `svg/tredane-horizontal-*.svg` | Símbolo + nome lado a lado |
| `svg/tredane-empilhado-*.svg` | Símbolo acima do nome |
| `icon/tredane-icone.svg` | Ícone do app, 1024 × 1024, fundo opaco Petróleo |
| `icon/tredane-icone-{1024,512,192,32}.png` | Ícone em PNG, RGB sem transparência |
| `icon/favicon.svg` · `icon/favicon.ico` | Favicon (placa arredondada; .ico com 16, 32 e 48 px) |

Sufixos de cor: `cor` (fundo claro), `escuro` (fundo escuro), `mono-preto` e `mono-branco` (uma só cor).

## Paleta

| Papel | Nome | HEX |
| --- | --- | --- |
| Primária | Petróleo | `#0E5A5C` |
| Secundária | Damasco | `#E8875A` |
| Neutra escura | Tinta | `#142625` |
| Neutra clara | Areia | `#F4F1EA` |

Contraste (WCAG 2.x):

| Par | Razão | Uso |
| --- | --- | --- |
| Petróleo sobre Areia | 7,06 : 1 | Texto (AA e AAA) |
| Branco sobre Petróleo | 7,97 : 1 | Texto (AA e AAA) |
| Tinta sobre Areia | 13,96 : 1 | Texto (AA e AAA) |
| Damasco sobre Tinta | 6,03 : 1 | Texto (AA) |
| Damasco sobre Petróleo | 3,05 : 1 | Só grafismo (o ponto do símbolo); não usar em texto normal |
| Damasco sobre Areia | 2,31 : 1 | Não usar em texto |

## Regras de uso

**Proposto** (falta revisão do responsável pelo produto):

- **Área de proteção:** à volta do símbolo e das versões, deixe livre pelo menos a altura do ponto do símbolo.
- **Tamanho mínimo:** símbolo a 16 px; versão horizontal a 24 px de altura. Abaixo de 24 px use só o símbolo.
- **Ícone do app:** o fundo ocupa a área toda; o símbolo cabe no círculo de 80 % (corte redondo do Android e `maskable` do PWA). O iOS aplica os cantos arredondados.
- Não alterar cores, proporções nem espaçamento; não pôr o símbolo sobre fotografia sem placa de fundo; não juntar balões de conversa nem o logotipo do WhatsApp (marca da Meta).

## Regenerar

```bash
uv run --with fonttools --with uharfbuzz --with pillow python3 docs/design/tools/build_brand.py caminho/para/Manrope[wght].ttf
```

Requer `rsvg-convert` (librsvg). A fonte Manrope está sob a [SIL Open Font License 1.1](https://github.com/google/fonts/blob/main/ofl/manrope/OFL.txt), que permite convertê-la em contornos num logotipo; o ficheiro da fonte não fica no repositório.

## Pendências

- **Aplicado (27/10/2026):** ícones do PWA (`public/icons/icon-192.png` e `icon-512.png`, também `maskable`), `public/favicon.{svg,ico}`, `site/public/favicon.{svg,ico}` . O cache do service worker passou a `tredane-pwa-v2` para buscar os ícones novos. **Ajuste (27/10/2026):** `theme-color`, `theme_color` e `background_color` do painel passaram a `#FFFFFF` (cor do cabeçalho `--color-surface-card`), com `apple-mobile-web-app-status-bar-style=default`, para a barra de estado do iOS ficar branca e integrada ao cabeçalho; cache do SW `tredane-pwa-v3`.
- **Em aberto — tokens do painel:** a cor de ação do painel, do login Clerk e do site continua azul `#2F5BD3` (DEC-041). Adotar o Petróleo exige nova decisão, `check_contrast.py` e revisão do catálogo e dos mocks. Responsável: responsável pelo produto.
- **Em aberto — site:** a imagem `site/public/og-image.png` ainda não usa a marca; o `theme-color` do site continua branco, igual ao cabeçalho.
- **Proposto:** verificar se o nome e o símbolo estão livres para registo de marca no INPI antes de uso público amplo.
