#!/bin/bash
# Lists desk output files this Mac does not have yet (one name per line): everything in data/file_wants.json plus every
# file named in the Results sheet (output_link and sub_agent_steps output_link). Used by the delivery sweep.
# Archived cases/requests (data/archived.json) are skipped, so archived files are never re-delivered.
APP="$(cd "$(dirname "$0")/.." && pwd)"; cd "$APP"
PATH="$HOME/.local/node/bin:/opt/homebrew/bin:/usr/local/bin:$PATH" node -e "
const fs=require('fs'),RE=/^[A-Za-z0-9._ -]+\.(pdf|xlsx|csv|png|jpg|pptx|docx)$/i,names=new Set(),skip=new Set();
let AR={};try{AR=JSON.parse(fs.readFileSync('data/archived.json','utf8'))||{}}catch(e){}
const arC=new Set(AR.cases||[]),arR=new Set([...(AR.requests||[]),...(AR.hidden_children||[])]);
let s={};try{s=JSON.parse(fs.readFileSync('data/sheet_snapshot.json','utf8'))}catch(e){}
for(const q of s.requests||[])if(arC.has(q.case_id))arR.add(q.request_id);
const each=(l,f)=>String(l||'').split(/[\s,;]+/).forEach((x)=>{const b=decodeURIComponent(x.split('/').pop()||'');if(RE.test(b))f(b)});
const scan=(r,f)=>{each(r.output_link,f);try{for(const st of JSON.parse(r.sub_agent_steps||'[]'))each(st&&st.output_link,f)}catch(e){}};
for(const r of s.results||[])if(arR.has(r.request_id))scan(r,(b)=>skip.add(b));
for(const r of s.results||[])if(!arR.has(r.request_id))scan(r,(b)=>names.add(b));
try{for(const n of Object.keys(JSON.parse(fs.readFileSync('data/file_wants.json','utf8'))))if(!skip.has(n))names.add(n)}catch(e){}
for(const n of names)if(!skip.has(n)&&!fs.existsSync('files/'+n))console.log(n)"
