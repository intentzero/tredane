"""Valida os pares de contraste declarados em tokens.json (WCAG 2.1).

Uso: python3 docs/design/tools/check_contrast.py
Sai com código 1 se algum par ficar abaixo do mínimo; use no CI. Só biblioteca padrão.
"""
import json, os, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
t = json.load(open(os.path.join(ROOT, 'tokens.json')))

def resolve(path):
    node = t['color']
    for part in path.split('.'):
        node = node[part]
    return node

def lum(h):
    h = h.lstrip('#')
    r, g, b = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)

def ratio(a, b):
    la, lb = lum(a), lum(b)
    if la < lb: la, lb = lb, la
    return (la + 0.05) / (lb + 0.05)

fails = 0
for p in t['contrastPairs']:
    r = ratio(resolve(p['fg']), resolve(p['bg']))
    ok = r >= p['min']
    fails += 0 if ok else 1
    print('%s %5.2f (mín %.1f)  %s sobre %s — %s' % ('OK   ' if ok else 'FALHA', r, p['min'], p['fg'], p['bg'], p['use']))
print('\n%d par(es) abaixo do mínimo' % fails if fails else '\nTodos os %d pares atendem ao mínimo' % len(t['contrastPairs']))
sys.exit(1 if fails else 0)
