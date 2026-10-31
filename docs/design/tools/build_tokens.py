"""Gera tokens.css (variáveis CSS) a partir de tokens.json.

Uso: python3 docs/design/tools/build_tokens.py
Só biblioteca padrão. Não edite tokens.css à mão.
"""
import json, os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
t = json.load(open(os.path.join(ROOT, 'tokens.json')))
out = ['/* Gerado por tools/build_tokens.py a partir de tokens.json v%s (%s). Não edite à mão. */' % (t['version'], t['status']), ':root {']

def kebab(s):
    return ''.join('-' + c.lower() if c.isupper() else c for c in s)

def add(name, value):
    out.append('  --%s: %s;' % (name, value))

add('font-family', t['font']['family'])
for k, v in t['font']['weight'].items(): add('font-weight-' + k, v)
for k, v in t['font']['size'].items(): add('font-size-' + k, '%dpx' % v)
for k, v in t['font']['lineHeight'].items(): add('line-height-' + kebab(k), v)
for group, items in t['color'].items():
    for k, v in items.items(): add('color-%s-%s' % (kebab(group), kebab(k)), v)
for k, v in t['radius'].items(): add('radius-' + k, '%dpx' % v)
for k, v in t['space'].items(): add('space-' + k, '%dpx' % v)
for k, v in t['size'].items():
    add('size-' + kebab(k), '%dpx' % v)
out.append('}')

def dark_block(indent):
    lines = []
    for group, items in t['colorDark'].items():
        for k, v in items.items(): lines.append('%s--color-%s-%s: %s;' % (indent, kebab(group), kebab(k), v))
    return lines

# Tema escuro (Proposto, DEC-092): data-theme explícito vence; sem ele, segue o sistema.
out.append('/* Tema escuro (Proposto, DEC-092) */')
out.append(':root[data-theme="dark"] {')
out += dark_block('  ')
out.append('  color-scheme: dark;')
out.append('}')
out.append('@media (prefers-color-scheme: dark) {')
out.append('  :root:not([data-theme="light"]) {')
out += dark_block('    ')
out.append('    color-scheme: dark;')
out.append('  }')
out.append('}')
open(os.path.join(ROOT, 'tokens.css'), 'w').write('\n'.join(out) + '\n')
print('tokens.css gerado com %d linhas' % len(out))
