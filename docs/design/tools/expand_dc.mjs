// Expande <sc-for>, <sc-if> e {{…}} dos mocks interativos (.dc.html) usando o renderVals do próprio
// componente, e sobrescreve o HTML estático em .tmp-html. Chamado por render_previews.py depois da
// conversão simples; só toca nos mocks que têm <sc-for> (os demais já saem certos da conversão).
import { chromium } from 'playwright';
import fs from 'fs';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><meta charset="utf-8"><body></body>');
let n = 0;
for (const dir of ['mobile', 'desktop']) {
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.dc.html'))) {
    const text = fs.readFileSync(`${dir}/${f}`, 'utf8');
    if (!text.includes('<sc-for')) continue;
    const out = await page.evaluate((text) => {
      const doc = new DOMParser().parseFromString(text, 'text/html');
      const sc = doc.querySelector('script[data-dc-script]');
      const props = JSON.parse(sc.getAttribute('data-props') || '{}');
      const defaults = {};
      for (const [k, v] of Object.entries(props)) if (v && typeof v === 'object' && 'default' in v) defaults[k] = v.default;
      class DCLogic { constructor(p) { this.props = p; this.state = {}; } setState() {} }
      const Component = new Function('DCLogic', sc.textContent + '\nreturn Component;')(DCLogic);
      const vals = new Component(defaults).renderVals();
      const ev = (expr, scope) => new Function(...Object.keys(scope), 'return (' + expr + ')')(...Object.values(scope));
      const sub = (s, scope) => s.replace(/\{\{([^}]*)\}\}/g, (_, e) => { const v = ev(e, scope); return v == null ? '' : String(v); });
      const walk = (node, scope) => {
        for (const child of [...node.childNodes]) {
          if (child.nodeType === 3) { child.textContent = sub(child.textContent, scope); continue; }
          if (child.nodeType !== 1) continue;
          const tag = child.tagName.toLowerCase();
          if (tag === 'sc-for') {
            const list = ev(child.getAttribute('list').replace(/^\{\{|\}\}$/g, ''), scope) || [];
            const as = child.getAttribute('as');
            const frag = document.createDocumentFragment();
            for (const item of list) {
              const holder = document.createElement('div');
              holder.innerHTML = child.innerHTML;
              walk(holder, { ...scope, [as]: item });
              while (holder.firstChild) frag.appendChild(holder.firstChild);
            }
            child.replaceWith(frag); continue;
          }
          if (tag === 'sc-if') {
            const ok = ev(child.getAttribute('value').replace(/^\{\{|\}\}$/g, ''), scope);
            if (ok) { walk(child, scope); child.replaceWith(...child.childNodes); } else child.remove();
            continue;
          }
          for (const a of [...child.attributes]) {
            if (/^on/i.test(a.name)) { child.removeAttribute(a.name); continue; }
            if (!a.value.includes('{{')) continue;
            const whole = a.value.match(/^\s*\{\{([^}]*)\}\}\s*$/);
            if (whole) {
              const v = ev(whole[1], scope);
              if (v === false || v == null) child.removeAttribute(a.name);
              else if (v === true) child.setAttribute(a.name, a.name.startsWith('aria-') ? 'true' : '');
              else if (typeof v !== 'function') child.setAttribute(a.name, String(v));
            } else child.setAttribute(a.name, sub(a.value, scope));
          }
          walk(child, scope);
        }
      };
      const dc = doc.querySelector('x-dc');
      const style = [...doc.querySelectorAll('helmet style')].map((s) => s.textContent).join('\n');
      dc.querySelector('helmet')?.remove();
      walk(dc, vals);
      dc.querySelectorAll('a[href$=".dc.html"]').forEach((a) => a.setAttribute('href', '#'));
      return { style, html: dc.innerHTML, title: doc.title };
    }, text);
    fs.mkdirSync(`.tmp-html/${dir}`, { recursive: true });
    fs.writeFileSync(
      `.tmp-html/${dir}/${f.replace('.dc.html', '.html')}`,
      `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${out.title}</title><style>${out.style}</style></head><body>${out.html}</body></html>`,
    );
    n++;
  }
}
await browser.close();
console.log(`${n} mock(s) com <sc-for> expandidos`);
