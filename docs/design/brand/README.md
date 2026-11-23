# Identidade visual do Tredane — direção A, Confluência

**Estado:** direção **Confirmada** pelo responsável pelo produto em 27/10/2026 (cores revistas em 23/11/2026, ver [Paleta](#paleta)) ([DEC-050](../../product/decisions.md)), escolhida entre três direções apresentadas no [canvas de exploração](https://claude.ai/artifact/TTdBW9suhBBLyB1ZpfjPPW) (privado). Aplicar a paleta aos tokens do painel continua **Em aberto** (ver [Pendências](#pendências)).

**Conceito:** duas conversas que correm para o mesmo lugar formam o T; de perto, é uma pessoa de braços abertos — o paciente acolhido.

## Ficheiros

Todos gerados por [`tools/build_brand.py`](../tools/build_brand.py); não edite à mão.

| Caminho | Conteúdo |
| --- | --- |
| `svg/tredane-simbolo-*.svg` | Símbolo sozinho (grelha 64 × 64) |
| `svg/tredane-nome-*.svg` | Nome «tredane» em contornos (Manrope 700, espaçamento −3,5 %) |
| `svg/tredane-horizontal-*.svg` | Símbolo + nome lado a lado |
| `svg/tredane-empilhado-*.svg` | Símbolo acima do nome |
| `icon/tredane-icone.svg` | Ícone do app, 1024 × 1024, fundo opaco Tinta violeta |
| `icon/tredane-icone-{1024,512,192,32}.png` | Ícone em PNG, RGB sem transparência |
| `icon/tredane-icone-fundo-branco-1024.png` | Ícone 1024 × 1024, fundo branco (símbolo cor); para avatar / perfil em fundo claro (ex. WhatsApp Business). Não gerado por `build_brand.py` |
| `icon/favicon.svg` · `icon/favicon.ico` | Favicon (placa arredondada; .ico com 16, 32 e 48 px) |

Sufixos de cor: `cor` (fundo claro), `escuro` (fundo escuro), `mono-preto` e `mono-branco` (uma só cor).

## Paleta

**Confirmado** (Paulo, 23/11/2026, «o logo no canto superior esquerdo e o favicon têm de ser atualizados»): a marca passa de Petróleo e Damasco para **Violeta e Lima**, a paleta da landing e do painel (tokens v0.12.0). **Revê** a paleta da DEC-050; o desenho do símbolo, as proporções, o nome e a grelha **não mudam**.

| Papel | Nome | HEX |
| --- | --- | --- |
| Primária | Violeta | `#5C32C9` |
| Secundária (só sobre fundo escuro) | Lima | `#D5FF55` |
| Neutra escura | Tinta violeta | `#211339` |
| Neutra clara | Lavanda clara | `#F1ECFA` |
| Traço do símbolo sobre fundo escuro | Lavanda | `#CBB8FF` |

Como entram nas versões:

- **`cor`** (fundo claro): traço Violeta, **ponto e nome em Tinta**. O ponto não usa o Lima: sobre claro mede 1,1:1 e a «cabeça» da pessoa desapareceria.
- **`escuro`** (fundo escuro): traço Lavanda, **ponto Lima**, nome Lavanda clara.
- **Ícone do app e favicon:** placa Tinta, símbolo Lavanda clara, ponto Lima.
- **`mono-preto` e `mono-branco`:** sem mudança.

Contraste (WCAG 2.x):

| Par | Razão | Uso |
| --- | --- | --- |
| Violeta sobre branco suave `#FBF9FF` | 7,30 : 1 | Símbolo no cabeçalho claro (AA e AAA) |
| Violeta sobre Lavanda clara | 6,58 : 1 | Texto (AA) |
| Branco sobre Violeta | 7,62 : 1 | Texto (AA e AAA) |
| Tinta sobre Lavanda clara | 14,89 : 1 | Texto (AA e AAA) |
| Ponto Tinta sobre branco suave | 16,51 : 1 | Ponto e nome na versão `cor` |
| Lima sobre Tinta | 15,01 : 1 | Ponto nas versões `escuro`, ícone e favicon |
| Lavanda sobre Tinta | 9,73 : 1 | Traço na versão `escuro` |
| Lima sobre fundo claro | 1,10 : 1 | **Não usar** |
| Violeta sobre Tinta | 2,26 : 1 | **Não usar** (por isso o traço escuro é Lavanda) |

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
- **Aplicado (27/10/2026):** tokens 0.3.0 — Petróleo como cor de ação no painel, no login Clerk e no site, com neutros alinhados (ver [CHANGELOG](../CHANGELOG.md)).
- **Aplicado (29/10/2026, [#209](https://github.com/intentzero/tredane/issues/209)):** símbolo de 32 px no cabeçalho do painel, logotipo horizontal em «Entrar» (no lugar do «T» provisório) e empilhado em «Escolha a clínica», importados de `svg/` sem alterar cor, proporção nem espaçamento. A cor Areia do kit (`#F4F1EA`) é diferente do fundo do painel (`#F5F4EF`): **Confirmado (Paulo, 29/10/2026)** manter o fundo do painel em `#F5F4EF` (DEC-070); o Areia fica para materiais de marca.
- **Imagens:** `site/public/og-image.png` foi refeita em 23/11/2026 na paleta violeta e lima (ver [landing.md](../../product/landing.md#direção-violeta-e-lima-23112026)); os PNG de preview dos mocks foram regenerados na mesma data. O `theme-color` da landing é `#FBF9FF`.
- **Proposto:** verificar se o nome e o símbolo estão livres para registo de marca no INPI antes de uso público amplo.
