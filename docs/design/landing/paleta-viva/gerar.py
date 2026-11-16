"""Gera a comparação a partir do build original (6b65453f), anterior à paleta aprovada."""
from pathlib import Path
import base64
import mimetypes
import re

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
DIST = ROOT / 'site/dist'

def data(path):
    mime = mimetypes.guess_type(path)[0] or 'application/octet-stream'
    return 'data:' + mime + ';base64,' + base64.b64encode(Path(path).read_bytes()).decode()

source = (DIST / 'index.html').read_text()
baseline_css = '\n'.join(p.read_text() for p in (DIST / '_astro').glob('*.css'))
if '#ff745f' in baseline_css.lower():
    raise SystemExit('A comparação exige o build anterior à paleta Coral & Menta. Preserve o snapshot aprovado ou use o build de 6b65453f.')
body = re.search(r'<body[^>]*>(.*)</body>', source, re.S).group(1)
body = re.sub(r'<script\b[^>]*>.*?</script>', '', body, flags=re.S)
body = re.sub(r' srcset="[^"]*"', '', body)
# Usa a imagem maior no snapshot, sem depender do servidor Astro.
for match in re.finditer(r'<img\b[^>]*>', body):
    tag = match.group(0)
    src = re.search(r'src="([^"]+)"', tag)
    if not src or not src.group(1).startswith('/'): continue
    path = DIST / src.group(1).lstrip('/')
    if path.suffix == '.webp':
        path = max(path.parent.glob(path.name.split('.')[0] + '.*.webp'), key=lambda p: p.stat().st_size)
    body = body.replace(tag, tag.replace(src.group(1), data(path)))
css = baseline_css
css = re.sub(r'url\(([^)]+)\)', lambda m: 'url(' + data(DIST / m.group(1).strip('"\'').lstrip('/')) + ')', css)
logo_current = data(DIST / 'tredane-horizontal-escuro.svg')
logo_light = data(DIST / 'tredane-horizontal-cor.svg')
body = body.replace(logo_current, logo_light)
bar = '''<aside class="review-bar" aria-label="Comparar paletas">
<div class="review-label"><strong>Proposta · Coral &amp; Menta</strong><span>Mock de cores · 16 nov 2026</span>
<span class="review-swatches" aria-hidden="true"><i style="background:#FF745F"></i><i style="background:#007F78"></i><i style="background:#E4F8EF"></i><i style="background:#FFF2E9"></i></span></div>
<div class="review-options"><button type="button" data-choice="atual" aria-pressed="false">Atual</button><button type="button" data-choice="viva" aria-pressed="true">Proposta</button></div></aside>'''
script = '''<script>
const logos = %s;
document.querySelectorAll('[data-choice]').forEach(button => button.addEventListener('click', () => {
  document.documentElement.dataset.palette = button.dataset.choice;
  document.querySelector('.brand img').src = logos[button.dataset.choice];
  document.querySelectorAll('[data-choice]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
}));
// O mock não abre canais comerciais nem páginas fora desta prévia.
document.querySelectorAll('a').forEach(a => {
  if (!a.getAttribute('href')?.startsWith('#')) a.addEventListener('click', e => {
    e.preventDefault();
    alert('Prévia de cores: este link estará disponível no site.');
  });
});
</script>'''
import json
script = script % json.dumps({'atual': logo_current, 'viva': logo_light})
html = '<!doctype html><html lang="pt-BR" data-palette="viva"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Tredane · Proposta Coral &amp; Menta</title><style>' + css + '\n' + (HERE / 'paleta.css').read_text() + '</style></head><body>' + bar + body + script + '</body></html>'
(HERE / 'PaletaViva.dc.html').write_text(html)
print('Mock autocontido gerado:', HERE / 'PaletaViva.dc.html')
