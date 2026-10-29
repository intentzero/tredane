"""Verifica se os mocks mobile usam apenas valores de tokens.json.

Uso: python3 docs/design/tools/check_mocks.py
Confere cores, tamanhos de fonte e raios. Sai com código 1 se achar valor fora da escala.
Exceções declaradas: raio de 3px (alça da folha inferior) e de 4px (canto do balão).
"""
import glob, json, os, re, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
t = json.load(open(os.path.join(ROOT, 'tokens.json')))
colors = {v.upper() for g in t['color'].values() for v in g.values()}
sizes = set(t['font']['size'].values())
radii = {v for v in t['radius'].values()}
ok_radius_exceptions = {3, 4}
# Paleta das pessoas na agenda e no horário (#223, Confirmado por Paulo em 29/10/2026): ponto, fundo e texto.
# Cor nunca é o único sinal; o nome da pessoa sempre aparece junto.
colors |= {'#2563A8', '#E3EDF7', '#1D4F86', '#C2410C', '#FBEDE3', '#8A3410', '#2F7D4F', '#E6F2EA', '#24603D'}
bad = []
for f in sorted(glob.glob(os.path.join(ROOT, 'mobile', '*.dc.html')) + glob.glob(os.path.join(ROOT, 'desktop', 'Horarios.dc.html'))):
    s = open(f).read()
    name = os.path.basename(f)
    for c in set(re.findall(r'#[0-9A-Fa-f]{6}\b', s)):
        if c.upper() not in colors: bad.append((name, 'cor', c))
    for n in set(int(x) for x in re.findall(r'font-size: (\d+)px', s)):
        if n not in sizes: bad.append((name, 'fonte', '%dpx' % n))
    for n in set(int(x) for x in re.findall(r'border-radius: (\d+)px(?=[;"])', s)):
        if n not in radii and n not in ok_radius_exceptions: bad.append((name, 'raio', '%dpx' % n))
for b in bad: print('FORA DA ESCALA  %-28s %-6s %s' % b)
print('\n%d valor(es) fora da escala' % len(bad) if bad else 'Todos os mocks mobile usam apenas valores de tokens.json')
sys.exit(1 if bad else 0)
