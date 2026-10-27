"""Gera catalog/index.html: tokens e componentes com todos os estados.

Uso: python3 docs/design/tools/build_catalog.py   (rode build_tokens.py antes)
A página usa ../tokens.css; abra o arquivo no navegador, sem servidor.
"""
import json, os, html

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
t = json.load(open(os.path.join(ROOT, 'tokens.json')))
kebab = lambda s: ''.join('-' + c.lower() if c.isupper() else c for c in s)

def lum(h):
    h = h.lstrip('#'); r, g, b = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
def ratio(a, b):
    la, lb = lum(a), lum(b)
    if la < lb: la, lb = lb, la
    return (la + 0.05) / (lb + 0.05)

sw = []
for g, items in t['color'].items():
    cells = []
    for k, v in items.items():
        ink = '#142625' if ratio(v, '#142625') > ratio(v, '#FFFFFF') else '#FFFFFF'
        cells.append('<li class="sw" style="background:%s;color:%s"><b>%s.%s</b><span>%s</span></li>' % (v, ink, g, k, v))
    sw.append('<h3>%s</h3><ul class="swatches">%s</ul>' % (g, ''.join(cells)))
sizes = ''.join('<div class="row"><code>%s · %dpx</code><span style="font-size:%dpx">Agendamento confirmado para sexta</span></div>' % (k, v, v) for k, v in t['font']['size'].items())
radii = ''.join('<div class="rad" style="border-radius:%dpx"><code>%s<br>%dpx</code></div>' % (v, k, v) for k, v in t['radius'].items())
space = ''.join('<div class="row"><code>space.%s · %dpx</code><span class="bar" style="width:%dpx"></span></div>' % (k, v, v) for k, v in t['space'].items())

def st(label, inner):
    return '<div class="state"><small>%s</small>%s</div>' % (label, inner)

ICON_ALERT = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>'
ICON_INFO = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/></svg>'
ICON_OK = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/></svg>'
comp = []
comp.append('<h3>Botão primário</h3><div class="states">' + ''.join([
    st('normal', '<button class="btn primary">Confirmar</button>'),
    st('pressionado', '<button class="btn primary pressed">Confirmar</button>'),
    st('foco', '<button class="btn primary focus">Confirmar</button>'),
    st('desabilitado', '<button class="btn primary" disabled>Confirmar</button>'),
    st('carregando', '<button class="btn primary" aria-busy="true">Confirmando…</button>')]) + '</div>')
comp.append('<h3>Botão secundário e destrutivo</h3><div class="states">' + ''.join([
    st('normal', '<button class="btn secondary">Cancelar</button>'),
    st('pressionado', '<button class="btn secondary pressed">Cancelar</button>'),
    st('foco', '<button class="btn secondary focus">Cancelar</button>'),
    st('desabilitado', '<button class="btn secondary" disabled>Cancelar</button>'),
    st('destrutivo', '<button class="btn secondary danger">Remover acesso</button>')]) + '</div>')
comp.append('<h3>Campo de texto</h3><div class="states">' + ''.join([
    st('normal', '<label class="field">Nome<input value="Juliana Prado"></label>'),
    st('foco', '<label class="field">Nome<input class="focus" value="Juliana Prado"></label>'),
    st('erro', '<label class="field">Nome<input class="err" value="" aria-invalid="true" aria-describedby="e1"><span id="e1" class="msg">%s Informe o nome.</span></label>' % ICON_ALERT),
    st('desabilitado', '<label class="field">Nome<input value="Juliana Prado" disabled></label>')]) + '</div>')
comp.append('<h3>Chip de filtro</h3><div class="states">' + ''.join([
    st('normal', '<button class="chip">Novas · 1</button>'),
    st('selecionado', '<button class="chip on" aria-pressed="true">Todas</button>'),
    st('foco', '<button class="chip focus">Minhas</button>'),
    st('desabilitado', '<button class="chip" disabled>Encerradas</button>')]) + '</div>')
comp.append('<h3>Selos de estado (sempre com texto)</h3><div class="states">' + ''.join([
    st('conversa', '<span class="badge info">Nova</span>'),
    st('em atendimento', '<span class="badge ok">Em atendimento</span>'),
    st('encerrada', '<span class="badge neutral">Encerrada</span>'),
    st('aviso', '<span class="badge warn">Pendente</span>'),
    st('IA', '<span class="badge ai">Sugestão da IA</span>')]) + '</div>')
comp.append('<h3>Faixas de aviso</h3><div class="stack">' + ''.join([
    '<div class="banner danger" role="alert">%s <span><b>15:00 acabou de ser ocupado.</b> Nada foi reservado. Escolha outro horário.</span></div>' % ICON_ALERT,
    '<div class="banner warn" role="status">%s <span>Reconectando… as informações podem estar desatualizadas.</span></div>' % ICON_ALERT,
    '<div class="banner info" role="status">%s <span>Atualizando com os dados mais recentes…</span></div>' % ICON_INFO,
    '<div class="banner ok" role="status">%s <span>Compromisso confirmado.</span></div>' % ICON_OK]) + '</div>')
comp.append('<h3>Estados de envio de mensagem</h3><div class="states">' + ''.join([
    st('Pendente', '<span class="send">Enviando…</span>'),
    st('Aceita', '<span class="send">Enviada</span>'),
    st('Entregue', '<span class="send">Entregue</span>'),
    st('Lida', '<span class="send read">Lida</span>'),
    st('Falhou', '<span class="send fail">%s Não enviada</span>' % ICON_ALERT),
    st('Incerto', '<span class="send warn">%s Verificando envio…</span>' % ICON_ALERT)]) + '</div>')
comp.append('<h3>Bloco de IA</h3><div class="ai-block" role="region" aria-label="Sugestão da IA"><b>Sugestão da IA — revise antes de enviar</b><p>Claro, Juliana! Vou conferir os horários de sexta à tarde e te envio as opções em seguida.</p><div class="row2"><button class="btn secondary ai-btn">Usar e editar</button><button class="btn secondary ai-btn">Gerar outra</button></div></div>')

CSS = '''
*{box-sizing:border-box}body{margin:0;font-family:var(--font-family);color:var(--color-text-primary);background:var(--color-surface-app);line-height:var(--line-height-default);font-size:var(--font-size-body)}
main{max-width:980px;margin:0 auto;padding:var(--space-6) var(--space-4) 64px}
h1{font-size:var(--font-size-display);margin:0 0 var(--space-2)}h2{font-size:var(--font-size-headline);margin:48px 0 var(--space-3);padding-top:var(--space-4);border-top:1px solid var(--color-line-border)}h3{font-size:var(--font-size-small);text-transform:uppercase;letter-spacing:.04em;color:var(--color-text-muted);margin:var(--space-5) 0 var(--space-2)}
p.lead{color:var(--color-text-secondary);margin:0}code{font-size:var(--font-size-small)}
.swatches{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:var(--space-2)}.sw{padding:var(--space-3);border-radius:var(--radius-md);border:1px solid var(--color-line-border);display:flex;flex-direction:column;font-size:var(--font-size-small)}.sw span{font-size:var(--font-size-caption)}
.row{display:flex;align-items:center;gap:var(--space-4);margin:var(--space-2) 0}.row code{width:180px;flex:none}.bar{height:12px;background:var(--color-primary-base);display:inline-block;border-radius:2px}
.rad{width:96px;height:64px;background:var(--color-surface-card);border:1px solid var(--color-line-control);display:inline-flex;align-items:center;justify-content:center;margin-right:var(--space-3);text-align:center}
.states{display:flex;flex-wrap:wrap;gap:var(--space-4);align-items:flex-end}.state{display:flex;flex-direction:column;gap:var(--space-2)}.state small{color:var(--color-text-muted);font-size:var(--font-size-caption)}.stack{display:flex;flex-direction:column;gap:var(--space-2);max-width:480px}
.btn{height:var(--size-control-lg);padding:0 var(--space-5);border-radius:var(--radius-md);font:inherit;font-weight:var(--font-weight-semibold);cursor:pointer;border:1px solid transparent;min-width:120px}
.btn.primary{background:var(--color-primary-base);color:var(--color-text-on-primary)}.btn.primary.pressed{background:var(--color-primary-ink)}
.btn.secondary{background:var(--color-surface-card);color:var(--color-text-primary);border-color:var(--color-line-control);font-weight:var(--font-weight-medium)}.btn.secondary.pressed{background:var(--color-surface-sunken)}.btn.danger{color:var(--color-danger-ink)}
.btn:disabled{background:var(--color-line-disabled);color:var(--color-text-secondary);border-color:transparent;cursor:not-allowed}.btn[aria-busy=true]{cursor:progress}
.focus{outline:var(--size-focus-ring-width) solid var(--color-primary-base);outline-offset:var(--size-focus-ring-offset)}
.field{display:flex;flex-direction:column;gap:6px;font-size:var(--font-size-small);color:var(--color-text-secondary);width:220px}.field input{height:var(--size-control-md);padding:0 var(--space-3);border:1px solid var(--color-line-control);border-radius:var(--radius-sm);font:inherit;font-size:var(--font-size-body);color:var(--color-text-primary);background:var(--color-surface-card)}
.field input.focus{border-color:var(--color-primary-base)}.field input.err{border:2px solid var(--color-danger-ink)}.field input:disabled{background:var(--color-surface-sunken);color:var(--color-text-secondary)}.msg{display:flex;gap:6px;align-items:center;color:var(--color-danger-ink)}
.chip{height:var(--size-control-sm);padding:0 var(--space-3);border-radius:var(--radius-pill);border:1px solid var(--color-line-control);background:var(--color-surface-card);font:inherit;font-size:var(--font-size-small);cursor:pointer;position:relative}.chip::after{content:"";position:absolute;inset:-2px 0}.chip.on{background:var(--color-text-primary);color:var(--color-text-on-primary);border-color:var(--color-text-primary)}.chip:disabled{background:var(--color-surface-sunken);color:var(--color-text-secondary);border-color:var(--color-line-border);cursor:not-allowed}
.badge{padding:2px var(--space-3);border-radius:var(--radius-pill);font-size:var(--font-size-small);font-weight:var(--font-weight-semibold)}.badge.info{background:var(--color-primary-tint);color:var(--color-primary-ink)}.badge.ok{background:var(--color-success-tint);color:var(--color-success-ink)}.badge.neutral{background:var(--color-surface-sunken);color:var(--color-text-secondary)}.badge.warn{background:var(--color-warning-tint);color:var(--color-warning-ink)}.badge.ai{background:var(--color-ai-avatar);color:var(--color-ai-ink)}
.banner{display:flex;gap:var(--space-3);padding:var(--space-3) var(--space-4);border-radius:var(--radius-md);border:1px solid;font-size:var(--font-size-small)}.banner svg{flex:none;margin-top:2px}.banner.danger{background:var(--color-danger-tint);border-color:var(--color-danger-border);color:var(--color-danger-ink)}.banner.warn{background:var(--color-warning-tint);border-color:var(--color-warning-border);color:var(--color-warning-ink)}.banner.info{background:var(--color-primary-tint);border-color:var(--color-primary-border);color:var(--color-primary-ink)}.banner.ok{background:var(--color-success-tint);border-color:var(--color-success-ink);color:var(--color-success-ink)}
.send{display:inline-flex;gap:6px;align-items:center;font-size:var(--font-size-small);color:var(--color-text-muted)}.send.read{color:var(--color-primary-ink)}.send.fail{color:var(--color-danger-ink);font-weight:var(--font-weight-medium)}.send.warn{color:var(--color-warning-ink);font-weight:var(--font-weight-medium)}
.ai-block{max-width:420px;border:1.5px dashed var(--color-ai-border);background:var(--color-ai-tint);border-radius:var(--radius-lg);padding:var(--space-3) var(--space-4);color:var(--color-ai-ink)}.ai-block p{color:var(--color-text-primary);margin:var(--space-2) 0}.ai-block .row2{display:flex;gap:var(--space-2)}.ai-btn{min-width:0;height:var(--size-touch);border-color:var(--color-ai-border);color:var(--color-ai-ink);padding:0 var(--space-4)}
.note{background:var(--color-surface-card);border:1px solid var(--color-line-border);border-radius:var(--radius-md);padding:var(--space-3) var(--space-4);font-size:var(--font-size-small);color:var(--color-text-secondary)}
'''
page = '''<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Catálogo do design system — Tredane</title><link rel="stylesheet" href="../tokens.css"><style>%s</style></head><body><main>
<h1>Catálogo do design system</h1>
<p class="lead">Tokens v%s (%s) e componentes com seus estados. Gerado por <code>tools/build_catalog.py</code> a partir de <code>tokens.json</code>. Estados "pressionado" e "foco" aparecem forçados para revisão; no produto vêm de <code>:active</code> e <code>:focus-visible</code>. Dados fictícios.</p>
<h2>Cores</h2>%s
<h2>Tipografia</h2>%s
<h2>Raios</h2><div>%s</div>
<h2>Espaçamento</h2>%s
<h2>Tamanhos de toque</h2>
<div class="note">Área clicável mínima: <b>%dpx</b>. Altura visual dos controles: pequeno %dpx, médio %dpx (campos), grande %dpx (botão primário). Controles pequenos (chips) precisam de área clicável de %dpx: no catálogo isso é feito por pseudo-elemento, sem mudar o visual.</div>
<h2>Componentes e estados</h2>%s
</main></body></html>
''' % (CSS, t['version'], t['status'], ''.join(sw), sizes, radii, space, t['size']['touch'], t['size']['controlSm'], t['size']['controlMd'], t['size']['controlLg'], t['size']['touch'], ''.join(comp))
os.makedirs(os.path.join(ROOT, 'catalog'), exist_ok=True)
open(os.path.join(ROOT, 'catalog', 'index.html'), 'w').write(page)
print('catalog/index.html gerado')
