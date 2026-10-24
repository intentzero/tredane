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
open(os.path.join(ROOT, 'tokens.css'), 'w').write('\n'.join(out) + '\n')
print('tokens.css gerado com %d variáveis' % (len(out) - 3))
