// SunProof — verifiable solar RECs. Everything runs in the browser.
'use strict';
let R = [], root = null, flags = [], leaves = [];
const $ = id => document.getElementById(id);
const REG_KEY = 'sunproof:registry:v1';

// ---------- helpers ----------
async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function rng(seed) { // mulberry32: same seed -> same demo data -> same root
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const clearSky = h => (h < 6 || h > 19 ? 0 : Math.sin(Math.PI * (h - 6) / 13));
const hourOf = r => new Date(r.ts).getUTCHours();
const total = arr => arr.reduce((a, r) => a + r.kwh, 0);
const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const short = h => h.slice(0, 10) + '…' + h.slice(-6);
const log = html => { $('out').innerHTML = html; };
const add = html => { $('out').innerHTML += html; };
function setStep(n) { document.querySelectorAll('.steps button').forEach((b, i) => b.classList.toggle('done', i < n)); }

// ---------- 1. data ----------
function gen() {
  const cap = +$('cap').value, days = +$('days').value, meter = $('meter').value.trim() || 'METER-1';
  const rand = rng(+$('seed').value || 1);
  const start = Date.UTC(2026, 8, 1);
  R = [];
  for (let i = 0; i < days * 24; i++) {
    const h = i % 24, cloud = 0.6 + 0.4 * rand();
    R.push({ meter, id: i, ts: new Date(start + i * 36e5).toISOString(), kwh: +(cap * 0.85 * clearSky(h) * cloud).toFixed(3) });
  }
  if ($('inject').checked) {
    R[2 * 24 + 2].kwh = 4.2;                              // output at 02:00 (night)
    R[5 * 24 + 12].kwh = +(cap * 1.6).toFixed(3);          // above panel capacity
    R[9 * 24 + 13].kwh = +(cap * 1.4).toFixed(3);          // above panel capacity
    R[14 * 24 + 8].kwh = +(cap * 0.85).toFixed(3);         // subtle: plausible number, impossible for 08:00
    R[21 * 24 + 17].kwh = +(cap * 0.8).toFixed(3);         // subtle: plausible number, impossible for 17:00
  }
  root = null; flags = []; leaves = [];
  draw(); setStep(1);
  log(`Generated <b>${R.length}</b> hourly readings for <b>${meter}</b> (${R[0].ts.slice(0, 10)} → ${R[R.length - 1].ts.slice(0, 10)}), total <b>${total(R).toFixed(1)} kWh</b>.<br><span class=muted>Synthetic demo data (clear-sky model + random clouds). Seed ${$('seed').value} — the same seed always gives the same data.</span>`);
}

// ---------- 2. audit: physical rules + learned baseline ----------
function audit() {
  if (!R.length) return log('Press 1 first.');
  const cap = +$('cap').value;
  // Learn a normal profile from the data itself: for each hour of day, the median and the MAD across all days.
  const byHour = Array.from({ length: 24 }, () => []);
  R.forEach(r => byHour[hourOf(r)].push(r.kwh));
  const base = byHour.map(v => { const m = median(v); return { m, mad: median(v.map(x => Math.abs(x - m))) }; });
  flags = [];
  for (const r of R) {
    const h = hourOf(r), b = base[h];
    const robustZ = (r.kwh - b.m) / (1.4826 * b.mad + 0.02 * cap);
    if (clearSky(h) === 0 && r.kwh > 0.05) flags.push([r, 'Rule: output at night']);
    else if (r.kwh > cap) flags.push([r, 'Rule: above panel capacity']);
    else if (robustZ > 4) flags.push([r, `Learned baseline: ${r.kwh} kWh at ${String(h).padStart(2, '0')}:00, normal ≈ ${b.m.toFixed(2)} (robust z = ${robustZ.toFixed(1)})`]);
  }
  draw(); setStep(2);
  log(flags.length
    ? `<span class=bad>${flags.length} suspicious reading(s) excluded from certificates:</span><table><tr><th>#</th><th>time (UTC)</th><th>kWh</th><th>why</th></tr>${flags.map(([r, w]) => `<tr><td>${r.id}</td><td>${r.ts.slice(0, 16)}</td><td>${r.kwh}</td><td>${w}</td></tr>`).join('')}</table><span class=muted>Two checks: hard physical rules, and a baseline learned from this site's own data (median + MAD per hour of day). The baseline catches numbers that look normal but are impossible for that hour.</span>`
    : '<span class=ok>No anomalies. All readings eligible.</span>');
}

// ---------- 3. Merkle commit + REC issuance + double-count registry ----------
async function buildTree(rows) {
  let level = await Promise.all(rows.map(x => sha(JSON.stringify(x))));
  const levels = [level];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(await sha(level[i] + (level[i + 1] ?? level[i])));
    levels.push(level = next);
  }
  return levels;
}
const registry = () => JSON.parse(localStorage.getItem(REG_KEY) || '[]');
async function commit() {
  if (!R.length) return log('Press 1 first.');
  const meter = R[0].meter, from = R[0].ts, to = R[R.length - 1].ts;
  const reg = registry();
  const clash = reg.find(e => e.meter === meter && !(to < e.from || from > e.to));
  leaves = await buildTree(R); root = leaves[leaves.length - 1][0];
  if (clash) {
    setStep(3);
    return log(`<span class=bad>✘ Double counting blocked.</span> Meter <b>${meter}</b> already has certificates for ${clash.from.slice(0, 10)} → ${clash.to.slice(0, 10)} (root <code>${short(clash.root)}</code>). The same energy cannot be certified twice.<br><button onclick="resetRegistry()">Clear demo registry</button>`);
  }
  const bad = new Set(flags.map(f => f[0].id)), ok = R.filter(r => !bad.has(r.id));
  const kwh = total(ok), recs = Math.floor(kwh / 1000);
  const serials = Array.from({ length: recs }, (_, i) => `SP-${meter}-${from.slice(0, 10)}-${String(i + 1).padStart(3, '0')}`);
  reg.push({ meter, from, to, root, recs, serials, at: new Date().toISOString() });
  localStorage.setItem(REG_KEY, JSON.stringify(reg));
  const memo = JSON.stringify({ app: 'sunproof', v: 1, meter, from: from.slice(0, 10), to: to.slice(0, 10), root, eligible_kwh: +kwh.toFixed(3), recs_mwh: recs });
  setStep(3); renderRegistry();
  log(`Merkle root of all ${R.length} readings:<br><code>${root}</code><br>
  Eligible energy: <b>${kwh.toFixed(1)} kWh</b> (${bad.size} excluded) → <b>${recs}</b> REC(s) of 1 MWh${serials.length ? ': <b>' + serials.join(', ') + '</b>' : ''}. Remainder ${(kwh % 1000).toFixed(1)} kWh carries forward.<br>
  Memo to anchor on a public chain (${memo.length} bytes, fits the Solana Memo program):<br><code id=memo>${memo}</code> <button onclick="navigator.clipboard.writeText($('memo').textContent)">Copy</button><br>
  <span class=muted>Period ${from.slice(0, 10)} → ${to.slice(0, 10)} is now registered for ${meter}. Press 3 again to see double counting blocked.</span>`);
}
function renderRegistry() {
  const reg = registry();
  $('reg').innerHTML = reg.length
    ? `<table><tr><th>meter</th><th>period</th><th>RECs</th><th>root</th></tr>${reg.map(e => `<tr><td>${e.meter}</td><td>${e.from.slice(0, 10)} → ${e.to.slice(0, 10)}</td><td>${e.recs}</td><td><code>${short(e.root)}</code></td></tr>`).join('')}</table>`
    : '<span class=muted>Empty. Certificates you issue appear here.</span>';
}
function resetRegistry() { localStorage.removeItem(REG_KEY); renderRegistry(); log('Demo registry cleared.'); }

// ---------- 4. tamper ----------
function tamper() {
  if (!R.length) return;
  const r = R.find(x => x.id === 12 * 24 + 12) || R[R.length >> 1];
  r.kwh = +(r.kwh + 0.5).toFixed(3); draw();
  add(`<br><span class=bad>Reading #${r.id} (${r.ts.slice(0, 16)}) changed by +0.5 kWh.</span>`);
}

// ---------- 5. verify whole dataset ----------
async function verify() {
  if (!root) return log('Commit first (step 3).');
  const levels = await buildTree(R), n = levels[levels.length - 1][0];
  setStep(5);
  add(n === root
    ? '<br><span class=ok>✔ Data matches the committed root. Certificates are valid.</span>'
    : `<br><span class=bad>✘ Mismatch! Recomputed <code>${short(n)}</code> ≠ committed <code>${short(root)}</code>. Certificates for this data are invalid.</span>`);
}

// ---------- 6. Merkle proof for one reading ----------
async function proveOne() {
  if (!root || !leaves.length) return log('Commit first (step 3).');
  const i = Math.min(Math.max(+$('pid').value | 0, 0), R.length - 1);
  const path = []; let idx = i;
  for (let l = 0; l < leaves.length - 1; l++) {
    const lvl = leaves[l], sib = idx ^ 1;
    path.push({ hash: lvl[sib] ?? lvl[idx], left: sib < idx });
    idx >>= 1;
  }
  let h = await sha(JSON.stringify(R[i]));
  for (const p of path) h = await sha(p.left ? p.hash + h : h + p.hash);
  log(`Reading #${i}: <code>${JSON.stringify(R[i])}</code><br>Proof = ${path.length} hashes (not all ${R.length} readings):<br>${path.map((p, k) => `${k + 1}. ${p.left ? 'left ' : 'right'} <code>${short(p.hash)}</code>`).join('<br>')}<br>` +
    (h === root ? `<span class=ok>✔ Reading #${i} is part of committed root ${short(root)}.</span>` : `<span class=bad>✘ Reading #${i} does not match root ${short(root)} (data was changed).</span>`));
}

// ---------- chart ----------
function draw() {
  const c = $('c'), g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  if (!R.length) return;
  const cap = +$('cap').value, mx = Math.max(...R.map(r => r.kwh), cap) * 1.05, w = c.width / R.length, bad = new Set(flags.map(f => f[0].id));
  R.forEach((r, i) => { g.fillStyle = bad.has(r.id) ? '#ff6b6b' : '#ffc83d'; const h = r.kwh / mx * (c.height - 10); g.fillRect(i * w, c.height - h, Math.max(w, 1), h); });
  const y = c.height - cap / mx * (c.height - 10);
  g.strokeStyle = '#8fd3ff'; g.setLineDash([6, 4]); g.beginPath(); g.moveTo(0, y); g.lineTo(c.width, y); g.stroke(); g.setLineDash([]);
  g.fillStyle = '#8fd3ff'; g.font = '12px system-ui'; g.fillText(`panel capacity ${cap} kW`, 6, y - 4);
}

renderRegistry(); gen();
