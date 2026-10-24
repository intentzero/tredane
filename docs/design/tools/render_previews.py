"""Converte os mocks .dc.html em HTML estático para gerar previews.

Uso (a partir da raiz do repositório):
    python3 docs/design/tools/render_previews.py
Requer: python3, Node 18+, `npm i -D playwright` e um Chromium instalado.
Gera HTML temporário em docs/design/.tmp-html (ignorado) e atualiza os PNG em
mobile/previews e desktop/previews. Telas com estado (M-09 e M-20) saem no
estado inicial: passo de e-mail e aba Profissionais.
"""
import glob, json, os, re, subprocess, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SC = {'isEmail': True, 'isCode': False, 'isPro': True, 'isRoom': False}
ON = 'height: 44px; border: 0; background: #1C1E21; color: #FFFFFF; font-size: 14px; font-weight: 600; cursor: pointer'
OFF = 'height: 44px; border: 0; background: #FFFFFF; color: #1C1E21; font-size: 14px; cursor: pointer'


def conv(src):
    body = re.search(r'<x-dc>(.*)</x-dc>', src, re.S).group(1)
    helmet = re.search(r'<helmet>(.*?)</helmet>', body, re.S)
    style = ''
    if helmet:
        style = ''.join(re.findall(r'<style>(.*?)</style>', helmet.group(1), re.S))
        body = body.replace(helmet.group(0), '')
    body = re.sub(r'<sc-if value="\{\{(\w+)\}\}"[^>]*>(.*?)</sc-if>',
                  lambda m: m.group(2) if SC.get(m.group(1), True) else '', body, flags=re.S)
    body = body.replace('style="{{tabProStyle}}"', 'style="%s"' % ON).replace('style="{{tabRoomStyle}}"', 'style="%s"' % OFF)
    body = body.replace('aria-selected="{{proSelected}}"', 'aria-selected="true"').replace('aria-selected="{{roomSelected}}"', 'aria-selected="false"')
    body = re.sub(r'\s+onClick="\{\{\w+\}\}"', '', body)
    body = re.sub(r'href="[A-Za-z]+\.dc\.html"', 'href="#"', body)
    title = re.search(r'<title>(.*?)</title>', src).group(1)
    return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>%s</title><style>%s</style></head><body>%s</body></html>' % (title, style, body)


for name in ('mobile', 'desktop'):
    out = os.path.join(ROOT, '.tmp-html', name)
    os.makedirs(out, exist_ok=True)
    for f in glob.glob(os.path.join(ROOT, name, '*.dc.html')):
        open(os.path.join(out, os.path.basename(f).replace('.dc.html', '.html')), 'w').write(conv(open(f).read()))

subprocess.check_call(['node', os.path.join(ROOT, 'tools', 'shot.mjs')], cwd=ROOT)
# nomes dos PNG mobile: M-xx-Arquivo.png, conforme canvas.json
boards = json.load(open(os.path.join(ROOT, 'mobile', 'canvas.json')))['boards']
for fn, b in boards.items():
    stem = fn.replace('.dc.html', '')
    mid = re.match(r'(M-\d+)', b['title']).group(1)
    os.replace(os.path.join(ROOT, '.tmp-png', 'mobile', stem + '.png'), os.path.join(ROOT, 'mobile', 'previews', '%s-%s.png' % (mid, stem)))
for f in glob.glob(os.path.join(ROOT, '.tmp-png', 'desktop', '*.png')):
    os.replace(f, os.path.join(ROOT, 'desktop', 'previews', os.path.basename(f)))
print('previews atualizados')
