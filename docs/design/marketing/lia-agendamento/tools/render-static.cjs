const fs=require('fs');
const [,, src, out]=process.argv;
let html=fs.readFileSync(src,'utf8');
const sm=html.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/);
let vals={};
if(sm){
  class DCLogic{constructor(p){this.props=p||{};this.state={};}setState(s){Object.assign(this.state,s);}}
  const C=new Function('DCLogic',sm[1]+'\nreturn Component;')(DCLogic);
  const inst=new C({}); vals=inst.renderVals();
}
let body=html.match(/<x-dc>([\s\S]*)<\/x-dc>/)[1];
const he=body.match(/<helmet>([\s\S]*?)<\/helmet>/);
const head=he?he[1]:''; body=body.replace(/<helmet>[\s\S]*?<\/helmet>/,'');
const get=(ctx,path)=>path.trim().split('.').reduce((o,k)=>o==null?undefined:o[k],ctx);
function findClose(s,from,tag){ // returns index of matching close tag start
  const open=new RegExp('<'+tag+'[\\s>]','g'),close='</'+tag+'>';
  let depth=1,i=from;
  while(true){
    const c=s.indexOf(close,i); if(c<0) throw new Error('no close '+tag);
    open.lastIndex=i; let m,n=0;
    while((m=open.exec(s))&&m.index<c) n++;
    depth+=n-1; // n opens before this close, minus this close
    if(depth===0) return c;
    i=c+close.length;
  }
}
function sub(t,ctx){
  t=t.replace(/\s([\w:-]+)="\{\{([^}]*)\}\}"/g,(all,name,path)=>{
    const v=get(ctx,path);
    if(typeof v==='function'||v===undefined) return '';
    if(name==='disabled'&&!v) return '';
    if(name==='disabled'&&v) return ' disabled';
    return ' '+name+'="'+String(v).replace(/"/g,'&quot;')+'"';
  });
  return t.replace(/\{\{([^}]*)\}\}/g,(all,path)=>{const v=get(ctx,path);return v===undefined||typeof v==='function'?'':String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;');});
}
function expand(s,ctx){
  let out='',i=0;
  const re=/<(sc-for|sc-if)\s([^>]*)>/g;
  while(true){
    re.lastIndex=i; const m=re.exec(s);
    if(!m){out+=sub(s.slice(i),ctx);break;}
    out+=sub(s.slice(i,m.index),ctx);
    const tag=m[1],attrs=m[2];
    const start=m.index+m[0].length;
    const end=findClose(s,start,tag);
    const inner=s.slice(start,end);
    if(tag==='sc-for'){
      const list=get(ctx,attrs.match(/list="\{\{([^}]*)\}\}"/)[1])||[];
      const as=attrs.match(/as="(\w+)"/)[1];
      list.forEach((it,idx)=>{out+=expand(inner,Object.assign({},ctx,{[as]:it,$index:idx}));});
    } else {
      const v=get(ctx,attrs.match(/value="\{\{([^}]*)\}\}"/)[1]);
      if(v) out+=expand(inner,ctx);
    }
    i=end+('</'+tag+'>').length;
  }
  return out;
}
let res=expand(body,vals);
res=res.replace(/<script[\s\S]*?<\/script>/g,'');
const page='<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>'+((html.match(/<title>([^<]*)<\/title>/)||[])[1]||'')+'</title>'+head+'</head><body>'+res+(process.argv[4]?'<script>'+process.argv[4]+'</script>':'')+'</body></html>';
fs.writeFileSync(out,page);
