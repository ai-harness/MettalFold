const fs=require('fs');const env={};for(const l of fs.readFileSync('.env','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)env[m[1]]=m[2].replace(/^["']|["']$/g,'')}
const base='http://127.0.0.1:'+(env.PORT||8765),user=(env.USERS||'Rishabh').split(',')[0].trim();
(async()=>{const r=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json','x-requested-with':'mf'},body:JSON.stringify({user,password:env.APP_PASSWORD})});
const ck=(r.headers.get('set-cookie')||'').split(';')[0];const H={cookie:ck,'x-requested-with':'mf'};
let d;for(let i=0;i<20;i++){d=await (await fetch(base+'/api/cases',{headers:H})).json();if(d.ready!==false&&d.requests.length)break;await new Promise(z=>setTimeout(z,1500))}
console.log('cases:',[...new Set(d.requests.map(x=>x.case_id))].join(','));
for(const q of d.requests){console.log(q.request_id,q.case_id,q.agent_code,q.chip,'file_ready='+q.file_ready);
 for(const f of q.files||[]){const g=await fetch(base+f.url,{headers:H});let t='';if(/\.(xlsx|csv)$/.test(f.name)){const tr=await fetch(base+'/api/table/'+encodeURIComponent(f.name.replace(/\.(csv|xlsx)$/,'')),{headers:H});const tj=await tr.json().catch(()=>({}));t=' table '+tr.status+' '+(tj.source||'')+' '+(tj.sheet||'')+' '+((tj.rows||[]).length)+'rows '+(tj.error||'')}console.log('   ',g.status,f.ready?'ready':'NOT-READY',f.from,f.name,t)}
 for(const b of (q.behind&&q.behind.items)||[])if(b.output_link)console.log('    helper link',b.name,'->',b.output_link)}
})();
