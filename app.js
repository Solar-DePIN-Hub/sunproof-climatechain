let R=[],root=null,flags=[];const $=id=>document.getElementById(id);
async function sha(s){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}
function clear(h){return h<6||h>19?0:Math.sin(Math.PI*(h-6)/13)}
function gen(){const cap=+$('cap').value,d=+$('days').value;R=[];let t=Date.UTC(2026,8,1);
for(let i=0;i<d*24;i++){const h=i%24,cloud=0.6+0.4*Math.random();let kw=+(cap*0.85*clear(h)*cloud).toFixed(3);R.push({id:i,ts:new Date(t+i*36e5).toISOString(),kwh:kw})}
if($('inject').checked){R[2*24+2].kwh=4.2;R[5*24+12].kwh=cap*1.6;R[9*24+13].kwh=cap*1.4}
root=null;flags=[];draw();$('out').innerHTML=`Generated ${R.length} hourly readings, total <b>${tot().toFixed(1)} kWh</b>.`}
const tot=()=>R.reduce((a,r)=>a+r.kwh,0);
function audit(){const cap=+$('cap').value;flags=[];const m=R.reduce((a,r)=>a+r.kwh,0)/R.length,sd=Math.sqrt(R.reduce((a,r)=>a+(r.kwh-m)**2,0)/R.length);
for(const r of R){const h=new Date(r.ts).getUTCHours();if(clear(h)===0&&r.kwh>0.05)flags.push([r,'output at night']);else if(r.kwh>cap)flags.push([r,'above panel capacity']);else if((r.kwh-m)/sd>3.5)flags.push([r,'statistical outlier (z>3.5)'])}
draw();$('out').innerHTML=flags.length?`<span class=bad>${flags.length} suspicious readings excluded from RECs:</span><table>${flags.map(([r,w])=>`<tr><td>#${r.id}</td><td>${r.ts}</td><td>${r.kwh} kWh</td><td>${w}</td></tr>`).join('')}</table>`:'<span class=ok>No anomalies. All readings eligible.</span>'}
async function merkle(leaves){let l=await Promise.all(leaves.map(x=>sha(JSON.stringify(x))));while(l.length>1){const n=[];for(let i=0;i<l.length;i+=2)n.push(await sha(l[i]+(l[i+1]??l[i])));l=n}return l[0]}
async function commit(){if(!R.length)return;const bad=new Set(flags.map(f=>f[0].id)),ok=R.filter(r=>!bad.has(r.id));root=await merkle(R);const kwh=ok.reduce((a,r)=>a+r.kwh,0),recs=Math.floor(kwh/1000);
const memo=JSON.stringify({app:'sunproof',root,eligible_kwh:+kwh.toFixed(3),recs_mwh:recs});
$('out').innerHTML=`Merkle root: <code>${root}</code><br>Eligible: <b>${kwh.toFixed(1)} kWh</b> → <b>${recs}</b> full 1-MWh REC(s), remainder ${(kwh%1000).toFixed(1)} kWh carried forward.<br>On-chain memo (e.g. Solana Memo program):<br><code>${memo}</code>`}
function tamper(){if(!R.length)return;const r=R[Math.floor(R.length/2)];r.kwh=+(r.kwh+0.5).toFixed(3);draw();$('out').innerHTML+=`<br><span class=bad>Reading #${r.id} changed by +0.5 kWh.</span>`}
async function verify(){if(!root){$('out').innerHTML='Commit first (step 3).';return}const n=await merkle(R);$('out').innerHTML+=n===root?'<br><span class=ok>✔ Data matches committed root.</span>':`<br><span class=bad>✘ Mismatch! recomputed ${n.slice(0,16)}… ≠ committed ${root.slice(0,16)}… — certificate invalid.</span>`}
function draw(){const c=$('c'),g=c.getContext('2d');g.clearRect(0,0,c.width,c.height);if(!R.length)return;const mx=Math.max(...R.map(r=>r.kwh),1),w=c.width/R.length,bad=new Set(flags.map(f=>f[0].id));
R.forEach((r,i)=>{g.fillStyle=bad.has(r.id)?'#ff6b6b':'#ffc83d';const h=r.kwh/mx*(c.height-10);g.fillRect(i*w,c.height-h,Math.max(w,1),h)})}
gen();
