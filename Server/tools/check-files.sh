#!/bin/bash
# Signs in to this Mac's app (password read from .env, never printed) and checks GET /files/<name> for every name given,
# or, with no names, for every output file named in the Results sheet (main + helper links), skipping archived cases/requests. Prints "<http code> <name>".
APP="$(cd "$(dirname "$0")/.." && pwd)"; cd "$APP"
PATH="$HOME/.local/node/bin:/opt/homebrew/bin:/usr/local/bin:$PATH" node - "$@" <<'JS'
const fs=require('fs');const env={};for(const l of fs.readFileSync('.env','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)env[m[1]]=m[2].replace(/^["']|["']$/g,'')}
const base='http://127.0.0.1:'+(env.PORT||8765),user=(env.USERS||'Rishabh').split(',')[0].trim();
(async()=>{const r=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json','x-requested-with':'mf'},body:JSON.stringify({user,password:env.APP_PASSWORD})});
if(!r.ok){console.log('login failed',r.status);process.exit(1)}const ck=(r.headers.get('set-cookie')||'').split(';')[0];
let names=process.argv.slice(2);if(!names.length){try{const s=JSON.parse(fs.readFileSync('data/sheet_snapshot.json','utf8'));
// archived cases/requests (data/archived.json) are skipped, same rule as pending-files.sh
let AR={};try{AR=JSON.parse(fs.readFileSync('data/archived.json','utf8'))||{}}catch(e){}const arC=new Set(AR.cases||[]),arR=new Set([...(AR.requests||[]),...(AR.hidden_children||[])]);for(const q of s.requests||[])if(arC.has(q.case_id))arR.add(q.request_id);
const each=(l)=>String(l||'').split(/[\s,;]+/).forEach((x)=>{let b=x.split('/').pop();try{b=decodeURIComponent(b)}catch(e){}if(/\.(pdf|xlsx|csv|pptx|docx|png|jpg)$/i.test(b))names.push(b)});
for(const x of s.results||[]){if(arR.has(x.request_id))continue;each(x.output_link);try{for(const st of JSON.parse(x.sub_agent_steps||'[]'))each(st&&st.output_link)}catch(e){}}}catch(e){}names=[...new Set(names)]}
let bad=0;for(const n of names){const g=await fetch(base+'/files/'+encodeURIComponent(n),{headers:{cookie:ck}});if(!g.ok)bad++;console.log(g.status+' '+n)}process.exit(bad?2:0)})();
JS
