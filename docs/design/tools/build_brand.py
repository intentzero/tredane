"""Gera os ficheiros da identidade visual (direção A, Confluência) em docs/design/brand.

Uso (a partir da raiz do repositório):
    uv run --with fonttools --with uharfbuzz --with pillow \
        python3 docs/design/tools/build_brand.py caminho/para/Manrope[wght].ttf
Requer `rsvg-convert` (librsvg) no PATH. A fonte Manrope (OFL) é usada só para
converter o nome em contornos; o resultado não depende da fonte instalada.
Gera SVG do símbolo, do nome e das versões horizontal e empilhada (cor, escuro,
mono preto, mono branco), o ícone do app em PNG RGB opaco (1024, 512, 192, 32),
favicon.svg e favicon.ico (16, 32, 48).
"""
import io, os, subprocess, sys

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'brand')

PRIMARY = '#0E5A5C'    # Petróleo
SECONDARY = '#E8875A'  # Damasco
DARK = '#142625'       # Tinta
LIGHT = '#F4F1EA'      # Areia

# Símbolo numa grelha de 64: duas correntes que se juntam no T, com o ponto acima.
MARK_PATH = 'M13 24H22A10 10 0 0 1 32 34V54M51 24H42A10 10 0 0 0 32 34'
MARK_DOT = (32, 10, 5.5)
MARK_STROKE = 10
MARK_BOX = (8, 4.5, 56, 59)  # limites da tinta (x0, y0, x1, y1)

VARIANTS = {
    # nome: (traço do símbolo, ponto, nome)
    'cor': (PRIMARY, SECONDARY, DARK),
    'escuro': (LIGHT, SECONDARY, LIGHT),
    'mono-preto': ('#000000', '#000000', '#000000'),
    'mono-branco': ('#FFFFFF', '#FFFFFF', '#FFFFFF'),
}

WORD = 'tredane'
WEIGHT = 700
TRACKING = -0.035  # em


def mark_svg(stroke, dot, tx=0.0, ty=0.0, s=1.0):
    cx, cy, r = MARK_DOT
    return (f'<g transform="translate({tx:.3f} {ty:.3f}) scale({s:.5f})">'
            f'<path d="{MARK_PATH}" fill="none" stroke="{stroke}" stroke-width="{MARK_STROKE}" '
            f'stroke-linecap="round" stroke-linejoin="round"/>'
            f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{dot}"/></g>')


def word_outline(font_path):
    """Devolve (path d em unidades da fonte com y para baixo, largura, ascendente da tinta)."""
    blob = hb.Blob.from_file_path(font_path)
    face = hb.Face(blob)
    hfont = hb.Font(face)
    hfont.set_variations({'wght': WEIGHT})
    buf = hb.Buffer()
    buf.add_str(WORD)
    buf.guess_segment_properties()
    hb.shape(hfont, buf, {'kern': True, 'liga': False})

    tt = instantiateVariableFont(TTFont(font_path), {'wght': WEIGHT})
    upm = tt['head'].unitsPerEm
    order = tt.getGlyphOrder()
    gs = tt.getGlyphSet()
    pen = SVGPathPen(gs)
    track = TRACKING * upm
    x = 0
    infos, poss = buf.glyph_infos, buf.glyph_positions
    for i, (info, pos) in enumerate(zip(infos, poss)):
        tp = TransformPen(pen, (1, 0, 0, -1, x + pos.x_offset, -pos.y_offset))
        gs[order[info.codepoint]].draw(tp)
        x += pos.x_advance + (track if i < len(infos) - 1 else 0)
    # Limites reais da tinta
    from fontTools.pens.boundsPen import BoundsPen
    bp = BoundsPen(gs)
    x = 0
    for i, (info, pos) in enumerate(zip(infos, poss)):
        gs[order[info.codepoint]].draw(TransformPen(bp, (1, 0, 0, 1, x + pos.x_offset, pos.y_offset)))
        x += pos.x_advance + (track if i < len(infos) - 1 else 0)
    xmin, ymin, xmax, ymax = bp.bounds
    return pen.getCommands(), (xmin, -ymax, xmax, -ymin), upm


def svg_doc(w, h, body, title):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.2f} {h:.2f}" '
            f'role="img" aria-label="{title}"><title>{title}</title>{body}</svg>\n')


def word_g(d, color, tx, ty, s):
    return f'<path transform="translate({tx:.3f} {ty:.3f}) scale({s:.5f})" fill="{color}" d="{d}"/>'


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        f.write(text)


def render_png(svg_path, size):
    out = subprocess.run(['rsvg-convert', '-w', str(size), '-h', str(size), svg_path],
                         check=True, capture_output=True).stdout
    return Image.open(io.BytesIO(out)).convert('RGBA')


def main(font_path):
    d, (wx0, wy0, wx1, wy1), upm = word_outline(font_path)
    mx0, my0, mx1, my1 = MARK_BOX
    mw, mh = mx1 - mx0, my1 - my0
    pad = 4

    # Nome sozinho: altura da tinta = 100 unidades.
    ws = 100 / (wy1 - wy0)
    nw, nh = (wx1 - wx0) * ws, 100
    for v, (stroke, dot, text) in VARIANTS.items():
        write(f'{ROOT}/svg/tredane-nome-{v}.svg', svg_doc(
            nw + 2 * pad, nh + 2 * pad,
            word_g(d, text, pad - wx0 * ws, pad - wy0 * ws, ws), 'Tredane'))

        # Símbolo sozinho, quadrado 64 (mantém a grelha original).
        write(f'{ROOT}/svg/tredane-simbolo-{v}.svg', svg_doc(
            64, 64, mark_svg(stroke, dot), 'Tredane'))

        # Horizontal: símbolo com 1,3× a altura da tinta do nome, centrado nela.
        sm = 1.3 * nh / mh
        gap = 0.28 * nh
        hw = mw * sm + gap + nw
        hh = mh * sm
        body = mark_svg(stroke, dot, pad - mx0 * sm, pad - my0 * sm, sm)
        body += word_g(d, text, pad + mw * sm + gap - wx0 * ws, pad + (hh - nh) / 2 - wy0 * ws, ws)
        write(f'{ROOT}/svg/tredane-horizontal-{v}.svg', svg_doc(hw + 2 * pad, hh + 2 * pad, body, 'Tredane'))

        # Empilhado: símbolo centrado acima do nome.
        ss = 2.6 * nh / mh
        sgap = 0.35 * nh
        sw = max(mw * ss, nw)
        sh = mh * ss + sgap + nh
        body = mark_svg(stroke, dot, pad + (sw - mw * ss) / 2 - mx0 * ss, pad - my0 * ss, ss)
        body += word_g(d, text, pad + (sw - nw) / 2 - wx0 * ws, pad + mh * ss + sgap - wy0 * ws, ws)
        write(f'{ROOT}/svg/tredane-empilhado-{v}.svg', svg_doc(sw + 2 * pad, sh + 2 * pad, body, 'Tredane'))

    # Ícone do app: fundo opaco a toda a área; símbolo a 62% e dentro do círculo de 80%.
    s = 0.62 * 1024 / 64
    cx, cy = (mx0 + mx1) / 2, (my0 + my1) / 2
    icon = (f'<rect width="1024" height="1024" fill="{PRIMARY}"/>'
            + mark_svg(LIGHT, SECONDARY, 512 - cx * s, 512 - cy * s, s))
    icon_svg = f'{ROOT}/icon/tredane-icone.svg'
    write(icon_svg, svg_doc(1024, 1024, icon, 'Tredane'))
    for size in (1024, 512, 192, 32):
        img = render_png(icon_svg, size).convert('RGB')
        img.save(f'{ROOT}/icon/tredane-icone-{size}.png', optimize=True)

    # Favicon: placa arredondada, símbolo maior para ler a 16 px.
    fs = 0.72 * 64 / 64
    fav = (f'<rect width="64" height="64" rx="14" fill="{PRIMARY}"/>'
           + mark_svg(LIGHT, SECONDARY, 32 - cx * fs, 32 - cy * fs, fs))
    fav_svg = f'{ROOT}/icon/favicon.svg'
    write(fav_svg, svg_doc(64, 64, fav, 'Tredane'))
    big = render_png(fav_svg, 256)
    big.save(f'{ROOT}/icon/favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])

    print('ok:', ROOT)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
