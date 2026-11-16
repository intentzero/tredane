# Mock de paleta — Coral & Menta

**Confirmado por Paulo**, 16/11/2026, «gosto, implementa». Origem: pedido de Paulo para uma landing mais vibrante e alegre, adequada a saúde e beleza, com mock primeiro. Paleta aprovada e implementada localmente em `site/src/styles/coral-menta.css`; publicação **Em aberto**. [Especificação](../../../product/landing.md#exploração-de-paleta-coral--menta--16112026).

O mock abaixo fica preservado como registro da comparação aprovada, anterior à implementação. Não regenerar a opção Atual a partir do site já recolorido.

Abra [PaletaViva.dc.html](PaletaViva.dc.html) em um navegador. É um HTML autocontido, com fontes e imagens embutidas; funciona sem servidor. Os botões **Atual** e **Proposta** comparam a mesma estrutura. Âncoras e perguntas frequentes funcionam; links comerciais e legais mostram um aviso de prévia. Animações foram suspensas para comparar cores.

| Papel | Cor proposta |
| --- | --- |
| Ação principal | Coral `#FF745F`, texto `#203632` |
| Destaque e seção de confiança | Turquesa `#007F78` |
| Rótulos pequenos e foco sobre claro | Turquesa escuro `#00665F` |
| Superfícies | Menta `#E4F8EF`, pêssego `#FFF2E9`, branco quente `#FFFDF9` |
| Texto principal / secundário | `#203632` / `#52645F` |
| Acentos decorativos | Aqua `#27C6B1` e lavanda `#D9C9F3` |

**Confirmado como execução técnica:** snapshot do código local `6b65453f`, gerado com `npm run build:staging` em `site/` e `python3 docs/design/landing/paleta-viva/gerar.py` na raiz. O gerador combina o HTML compilado, as fontes/imagens locais e `paleta.css`. Não modifica os arquivos de produção. Não confirma paridade com o site publicado.

**Verificado em 16/11/2026:** Chromium/Playwright; sem overflow horizontal em 360, 390 e 1440 px; axe-core sem violações nas regras WCAG 2 A/AA, 2.1 AA e 2.2 AA nessas larguras; alternador Atual/Proposta funcionando. Revisão visual dos previews desktop e abertura mobile. `check_contrast.py`, `check_mocks.py` e `git diff --check` passaram. Os dois primeiros verificam os tokens e mocks existentes do painel; o contraste desta proposta foi verificado pelo axe no navegador. Não foi realizada uma auditoria manual completa com leitor de tela nem Lighthouse.

Previews: [abertura desktop](previews/abertura.png), [página completa](previews/desktop.png), [abertura mobile](previews/abertura-celular.png), [mobile completo](previews/celular.png) e [paleta atual](previews/atual.png).

As imagens do aplicativo e os marcadores comerciais são os existentes na landing local. A preservação desses conteúdos permite comparar cores; não valida novas promessas nem fecha pendências comerciais. A identidade do painel e o escopo do MVP permanecem inalterados.

## Implementação aprovada

**Confirmado como execução local (16/11/2026):** `site/src/styles/coral-menta.css` aplica a paleta aprovada; `Base.astro` importa a paleta e atualiza a cor do navegador; `index.astro` usa a versão existente da marca para fundo claro. Header fixo, hover, foco, animações, redução de movimento, âncoras e FAQ foram mantidos. Páginas legais recebem os novos neutros e links.

**Verificado:** `astro check` com 0 erros/avisos; `build:staging` concluído; Chromium em 360/390/1440 px sem overflow, erros JavaScript ou violações axe (WCAG 2 A/AA, 2.1 AA e 2.2 AA). Cenas animadas da abertura, conversa, Pix, confiança e piloto sem violações detectadas em desktop; modo sem JavaScript mantém título e cartões visíveis; página de privacidade sem violações axe WCAG 2 A/AA. FAQ abre nas três larguras. Evidência: [registro](validacao.json), [desktop implementado](previews/implementado-desktop.png), [mobile implementado](previews/implementado-celular.png). Publicação e Lighthouse permanecem **Em aberto**.
