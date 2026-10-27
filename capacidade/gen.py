import subprocess
CSS="""*{box-sizing:border-box;margin:0}body{width:390px;height:844px;overflow:hidden;font-family:Inter,system-ui,sans-serif;background:#F5F7F7;color:#142625;font-size:14px}
.top{background:#fff;padding:14px 16px;border-bottom:1px solid #DDE3E3}.top h1{font-size:18px}.top p{color:#566160;font-size:13px;margin-top:2px}
.wrap{padding:12px 16px}.card{background:#fff;border:1px solid #DDE3E3;border-radius:12px;padding:12px;margin-bottom:8px}
.row{display:flex;align-items:center;gap:10px;min-height:44px}.t{width:48px;font-weight:600}.f{flex:1;min-width:0}
.bar{display:flex;gap:2px;margin-top:4px}.bar i{flex:1;height:6px;border-radius:2px;background:#E7F1F1}.bar i.on{background:#0E5A5C}
.pill{font-size:12px;font-weight:600;padding:3px 8px;border-radius:99px;background:#E7F1F1;color:#0A4547;white-space:nowrap}.full{background:#FDF1E3;color:#7A4A0B}
.sub{color:#566160;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.li{font-size:13px;padding:6px 0;border-top:1px solid #EEF1F1;display:flex;justify-content:space-between}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.cell{min-height:52px;border:1px solid #B3D1D1;border-radius:10px;background:#fff;text-align:center;padding:6px 2px}
.cell b{display:block;font-size:14px}.cell span{font-size:11px;color:#0A4547;white-space:nowrap}.cell.sel{background:#0E5A5C;color:#fff;border-color:#0E5A5C}.cell.sel span{color:#fff}
.cell.dis{background:#EEF1F1;border-color:#DDE3E3;color:#8A9493}.cell.dis span{color:#566160}.cell.last span{color:#7A4A0B}
h2{font-size:13px;color:#424B4A;margin:12px 0 8px;font-weight:600}.btn{height:48px;border-radius:10px;background:#0E5A5C;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600}
.step{display:flex;align-items:center;gap:12px}.sb{width:44px;height:44px;border:1px solid #B3D1D1;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;color:#0E5A5C;background:#fff}
.ban{background:#FDF1E3;border:1px solid #F0C998;border-radius:12px;padding:12px;color:#5C3708}.chip{display:inline-block;border:1px solid #B3D1D1;background:#fff;border-radius:10px;padding:10px 12px;margin:8px 6px 0 0;font-weight:600;color:#0A4547;font-size:13px}"""
def bar(n,c): return '<div class="bar">'+''.join('<i class="on"></i>' if i<n else '<i></i>' for i in range(c))+'</div>'
def page(name,body):
    open(name+'.html','w').write(f'<html><head><meta charset=utf-8><style>{CSS}</style></head><body>{body}</body></html>')
    subprocess.run(['google-chrome','--headless','--no-sandbox','--hide-scrollbars','--force-device-scale-factor=2','--window-size=390,844',f'--screenshot={name}.png',name+'.html'],capture_output=True)
rows=[('08:00',2,''),('08:30',5,''),('09:00',3,'open'),('09:30',1,''),('10:00',0,''),('10:30',4,'')]
b=''
for t,n,o in rows:
    pill=f'<span class="pill full">Lotado 5/5</span>' if n==5 else f'<span class="pill">{n}/5</span>'
    b+=f'<div class="card"><div class="row"><span class="t">{t}</span><div class="f"><div class="sub">Bronzeamento natural · 40 min</div>{bar(n,5)}</div>{pill}</div>'
    if o: b+=''.join(f'<div class="li"><span>{x}</span><span class="sub">{y}</span></div>' for x,y in [('Ana Ribeiro','Confirmado'),('Bia Lopes','Confirmado'),('Carla Nunes','Aguardando')])
    b+='</div>'
page('c01-agenda-ocupacao',f'<div class="top"><h1>Agenda · Ter, 3 nov</h1><p>Sala Sol · atende 5 ao mesmo tempo</p></div><div class="wrap">{b}</div>')
cells=[('08:00','3 vagas',''),('08:30','Lotado','dis'),('09:00','2 vagas','sel'),('09:30','4 vagas',''),('10:00','5 vagas',''),('10:30','Última vaga','last'),('11:00','Lotado','dis'),('11:30','3 vagas',''),('14:00','Última vaga','last'),('14:30','2 vagas',''),('15:00','Lotado','dis'),('15:30','5 vagas','')]
g=''.join(f'<div class="cell {c}"><b>{t}</b><span>{s}</span></div>' for t,s,c in cells)
page('c02-agendar-vagas',f'<div class="top"><h1>Agendar</h1><p>Bronzeamento natural · Sala Sol</p></div><div class="wrap"><h2>Ter, 3 nov · escolha o horário</h2><div class="grid">{g}</div><div class="card" style="margin-top:16px"><b>09:00 · 2 vagas restantes</b><div class="sub" style="margin-top:4px">Cliente divide a sala com outras 3 pessoas</div></div><div class="btn" style="margin-top:8px">Agendar 09:00</div></div>')
page('c03-config-capacidade','<div class="top"><h1>Sala Sol</h1><p>Clínica · Recursos · Sala</p></div><div class="wrap"><h2>Nome da sala ou equipamento</h2><div class="card">Sala Sol</div><h2>Atende ao mesmo tempo</h2><div class="card"><div class="step"><div class="sb">−</div><div class="f" style="text-align:center"><b style="font-size:20px">5</b> pessoas</div><div class="sb">+</div></div><div class="sub" style="margin-top:8px">Deixe 1 se a sala recebe uma pessoa por vez.</div></div><div class="btn">Salvar</div><h2 style="margin-top:24px">No Agendar, quando o horário lota</h2><div class="ban"><b>Esse horário lotou. Nada foi reservado.</b><div style="font-size:13px;margin-top:4px">Horários com vaga hoje:</div><span class="chip">09:30 · 4 vagas</span><span class="chip">10:00 · 5 vagas</span><span class="chip">10:30 · Última vaga</span></div></div>')
