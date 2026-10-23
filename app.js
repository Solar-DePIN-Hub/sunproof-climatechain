// SunProof UI. Audit + Merkle run in the browser (audit.js); /api/* anchors and reads memos on Solana devnet.
'use strict';
const A = window.SunAudit;
const $ = id => document.getElementById(id);
let R = [], meta = null, flags = [], levels = [], root = null, lastAnchor = null, summary = null;
const short = h => h.slice(0, 10) + '…' + h.slice(-6);
const fmt = (x, d = 1) => x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const log = html => { $('out').innerHTML = html; };
const add = html => { $('out').innerHTML += html; };
const exp = sig => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
function setStep(n) { document.querySelectorAll('.steps button').forEach((b, i) => b.classList.toggle('done', i < n)); }
const sessionTag = (crypto.getRandomValues(new Uint32Array(1))[0] % 46656).toString(36).toUpperCase().padStart(3, '0');
const datasets = {};

async function getDataset(id) {
  if (!datasets[id]) datasets[id] = await (await fetch(`data/${id}.json`)).json();
  return datasets[id];
}
async function onMode() {
  const m = $('mode').value;
  $('synthOpts').style.display = m === 'synthetic' ? '' : 'none';
  $('csvOpts').style.display = m === 'csv' ? '' : 'none';
  $('realOpts').style.display = m.startsWith('opsd') ? '' : 'none';
  if (m.startsWith('opsd')) {
    const d = await getDataset(m);
    $('meter').value = `OPSD-${d.column}`; $('cap').value = d.capacity_limit_kw; $('lat').value = d.lat; $('lon').value = d.lon;
    $('src').innerHTML = `Source: <a href="${d.source_url}" target=_blank>${d.source}</a>, license ${d.license}. ${d.note}<br>Location: ${d.location_note}. ${d.capacity_note} (${d.capacity_limit_kw} kW).<br>Satellite: <a href="${d.satellite_url}" target=_blank>${d.satellite_source}</a>; site factor ${d.site_factor_kwp} kWp-equivalent learned from ${d.site_factor_learned}.`;
  } else if (m === 'synthetic') {
    $('meter').value = `UA-KYIV-ROOF-${sessionTag}`; $('cap').value = 12; $('lat').value = 50.45; $('lon').value = 30.52;
    $('src').innerHTML = '<b>Synthetic</b> demo data: solar-position model for Kyiv + random daily clouds, seeded (same seed → same data → same root). Not real site data.';
  } else {
    $('meter').value = `MY-METER-${sessionTag}`; if (!$('cap').value) $('cap').value = 10;
    $('src').innerHTML = 'CSV with one row per hour: <code>timestamp,kwh</code> (ISO time in UTC, e.g. 2026-09-01T10:00:00Z). Set capacity and location for the physics checks. Nothing is uploaded: parsing runs in your browser.';
  }
}
$('mode').addEventListener('change', () => { onMode(); R = []; draw(); log('Press 1 to load the data.'); setStep(0); });

// ---------- 1. load ----------
async function load() {
  const m = $('mode').value, meter = $('meter').value.trim();
  if (m.startsWith('opsd')) {
    meta = await getDataset(m);
    R = meta.readings.map((r, i) => ({ id: i, ts: r.ts, kwh: r.kwh, gapfilled: r.gapfilled, sat: r.sat }));
  } else if (m === 'synthetic') {
    meta = null;
    R = A.synthetic({ meter, cap: +$('cap').value, days: +$('days').value, seed: +$('seed').value, lat: +$('lat').value, lon: +$('lon').value, inject: $('inject').checked });
  } else {
    const f = $('csv').files[0]; if (!f) return log('Choose a CSV file first.');
    meta = null;
    R = (await f.text()).split(/\r?\n/).map(l => l.split(/[,;]/)).filter(c => c.length >= 2 && !isNaN(parseFloat(c[1])) && !isNaN(Date.parse(c[0])))
      .map((c, i) => ({ id: i, ts: new Date(c[0]).toISOString().slice(0, 13) + ':00:00Z', kwh: +parseFloat(c[1]).toFixed(3) }));
    if (!R.length) return log('No rows found. Expected: timestamp,kwh');
  }
  flags = []; levels = []; root = null; lastAnchor = null; summary = null;
  draw(); setStep(1);
  const tot = R.reduce((a, r) => a + r.kwh, 0);
  log(`Loaded <b>${R.length}</b> hourly readings for <b>${meter}</b> (${R[0].ts.slice(0, 10)} → ${R[R.length - 1].ts.slice(0, 10)}). The meter claims <b>${fmt(tot)} kWh</b>.` +
    (meta ? `<br><span class=muted>Real measured data (${meta.license}). ${R.filter(r => r.gapfilled).length} of these hours are marked "interpolated" by the publisher — the audit does ${$('useFlags').checked ? '' : '<b>not</b> '}use that flag.</span>` : ''));
}

// ---------- 2. audit ----------
function runAudit() {
  if (!R.length) return log('Press 1 first.');
  const rows = meta && !$('useFlags').checked ? R.map(r => ({ ...r, gapfilled: false })) : R;
  const res = A.audit(rows, { cap: +$('cap').value, lat: +$('lat').value, lon: +$('lon').value, siteFactor: meta && meta.site_factor_kwp });
  flags = res.flags; summary = A.summarize(R, flags);
  draw(); setStep(2);
  const names = { night: 'Physics: output at night (solar position)', capacity: 'Physics: above capacity', gapfilled: 'Publisher flag: not measured', baseline: 'Learned baseline (per hour of day)', replay: 'Replay: day copied from another day', satellite: 'Satellite cross-check (PVGIS)' };
  const rules = Object.entries(summary.byRule).map(([k, v]) => `<tr><td>${names[k]}</td><td>${v.n}</td><td>${fmt(v.kwh)}</td></tr>`).join('');
  let truth = '';
  if (meta) {
    const gf = R.filter(r => r.gapfilled), bad = new Set(flags.map(f => f.id));
    const gfK = gf.reduce((a, r) => a + r.kwh, 0), caughtK = gf.filter(r => bad.has(r.id)).reduce((a, r) => a + r.kwh, 0);
    const fp = R.filter(r => !r.gapfilled && bad.has(r.id)).length;
    truth = gf.length ? `<br><b>Ground truth check</b> (publisher's own flags): ${fmt(gfK)} kWh were not measured; the audit held back <b>${fmt(caughtK)} kWh (${fmt(100 * caughtK / gfK, 0)}%)</b> of it and flagged <b>${fp}</b> measured hour(s).` :
      `<br><b>Ground truth check:</b> this month has no gap-filled hours; the audit flagged <b>${fp}</b> measured hour(s).`;
  }
  log(`<div class=kpis><div class=kpi><b>${fmt(summary.raw)}</b><span>kWh claimed by the meter</span></div><div class=kpi><b style="color:#ff6b6b">${fmt(summary.excluded)}</b><span>kWh held back (${fmt(summary.pctExcluded)}%)</span></div><div class=kpi><b style="color:#5be08a">${fmt(summary.eligible)}</b><span>kWh eligible for RECs</span></div><div class=kpi><b>${summary.nFlags}</b><span>hours flagged of ${R.length}</span></div></div>` +
    (rules ? `<table><tr><th>check</th><th>hours</th><th>kWh held back</th></tr>${rules}</table>` : '<span class=ok>No anomalies: all readings are eligible.</span>') + truth +
    (flags.length ? `<details><summary class=muted>Show flagged readings</summary><table><tr><th>#</th><th>time (UTC)</th><th>kWh</th><th>why</th></tr>${flags.slice(0, 200).map(f => { const r = R[f.id]; return `<tr><td>${r.id}</td><td>${r.ts.slice(0, 16)}</td><td>${r.kwh}</td><td>${f.why}</td></tr>`; }).join('')}</table></details>` : '') +
    `<br><span class=muted>Checks: (1) physics — no output while the sun is below the horizon at this location, none above capacity; (2) a baseline learned from this site's own data (median + MAD per hour of day); (3) replay — a day that repeats another day to within 5 Wh every hour; (4) satellite cross-check of daily totals against PVGIS irradiance (real data). Held-back energy is not deleted: it waits for review or a re-read of the meter.</span>`);
}

// ---------- 3. Merkle root + RECs ----------
function memoFor() {
  const meter = $('meter').value.trim();
  return { app: 'sunproof', v: 2, meter, from: R[0].ts.slice(0, 10), to: R[R.length - 1].ts.slice(0, 10), n: R.length, root,
    claimed_kwh: +summary.raw.toFixed(3), eligible_kwh: +summary.eligible.toFixed(3), recs_mwh: Math.floor(summary.eligible / 1000), data: meta ? meta.id : $('mode').value };
}
async function commit() {
  if (!R.length) return log('Press 1 first.');
  if (!summary) runAudit();
  const meter = $('meter').value.trim();
  levels = await A.merkle(meter, R); root = levels[levels.length - 1][0];
  const m = memoFor(), serials = Array.from({ length: m.recs_mwh }, (_, i) => `SP-${meter}-${m.from}-${String(i + 1).padStart(3, '0')}`);
  setStep(3);
  log(`Merkle root of all ${R.length} readings (leaf = SHA-256 of <code>meter|timestamp|kWh</code>):<br><code>${root}</code><br>
  Eligible energy <b>${fmt(m.eligible_kwh)} kWh</b> → <b>${m.recs_mwh}</b> REC(s) of 1 MWh${serials.length ? ': <b>' + serials.join(', ') + '</b>' : ''}; remainder ${fmt(m.eligible_kwh % 1000)} kWh carries forward to the next period.<br>
  Certificate memo (${JSON.stringify(m).length} bytes) for the Solana Memo program:<br><code>${JSON.stringify(m)}</code><br><span class=muted>Next: press 4 to anchor it on Solana devnet.</span>`);
}

// ---------- 4. anchor on devnet ----------
async function anchor() {
  if (!root) await commit();
  const b = $('anchorBtn'); b.disabled = true; add('<br>Sending memo transaction to Solana devnet…');
  try {
    const r = await fetch('/api/anchor', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ memo: JSON.stringify(memoFor()) }) });
    const j = await r.json();
    if (r.status === 409) {
      lastAnchor = j.existing.signature;
      add(`<br><span class=bad>✘ Double counting blocked on-chain.</span> ${j.existing.meter} already has a certificate for ${j.existing.from} → ${j.existing.to}: <a href="${j.explorer}" target=_blank>${short(j.existing.signature)}</a> (slot ${j.existing.slot}). ` +
        (j.sameRoot ? '<span class=ok>It commits exactly this data (same root)</span>, so press 6 to verify it.' : 'It commits different data (different root) — a second certificate for the same energy is refused.'));
    } else if (!r.ok) add(`<br><span class=bad>Anchor failed: ${j.error}</span>`);
    else {
      lastAnchor = j.signature;
      add(`<br><span class=ok>✔ Anchored on Solana devnet</span> (${j.status}): <a href="${j.explorer}" target=_blank>${j.signature}</a><br><span class=muted>Issuer key ${j.payer}. Press 3 + 4 again to see double counting blocked on-chain.</span>`);
    }
    setStep(4); loadRegistry();
  } catch (e) { add(`<br><span class=bad>${e}</span>`); } finally { b.disabled = false; }
}

// ---------- 5. tamper ----------
function tamper() {
  if (!R.length) return;
  const r = R.reduce((best, x) => (x.kwh > 0.5 && !flags.some(f => f.id === x.id) && Math.abs(x.id - R.length / 2) < Math.abs(best.id - R.length / 2) ? x : best), R[0]);
  r.kwh = +(r.kwh + 0.5).toFixed(3); draw(); setStep(5);
  add(`<br><span class=bad>Reading #${r.id} (${r.ts.slice(0, 16)} UTC) changed by +0.5 kWh.</span>`);
}

// ---------- 6. verify against the chain ----------
async function verify() {
  if (!R.length) return log('Press 1 first.');
  const meter = $('meter').value.trim(), L = await A.merkle(meter, R), now = L[L.length - 1][0];
  if (!lastAnchor) return add(`<br>Recomputed root <code>${short(now)}</code>. Anchor first (step 4) to compare with the chain.`);
  const j = await (await fetch('/api/tx?sig=' + lastAnchor)).json();
  if (j.error) return add(`<br><span class=bad>${j.error}</span>`);
  const onchain = JSON.parse(j.memo).root;
  setStep(6);
  add(now === onchain
    ? `<br><span class=ok>✔ Data matches the root read back from Solana devnet</span> (<a href="${exp(lastAnchor)}" target=_blank>tx</a>, slot ${j.slot}). Certificates are valid.`
    : `<br><span class=bad>✘ Mismatch! Recomputed <code>${short(now)}</code> ≠ on-chain <code>${short(onchain)}</code> (<a href="${exp(lastAnchor)}" target=_blank>tx</a>). This data is not what was certified.</span>`);
}

// ---------- Merkle proof for one reading ----------
async function proveOne() {
  if (!root) return ($('proof').innerHTML = 'Run step 3 first.');
  const i = Math.min(Math.max(+$('pid').value | 0, 0), R.length - 1), meter = $('meter').value.trim();
  const path = []; let idx = i;
  for (let l = 0; l < levels.length - 1; l++) { const lvl = levels[l], sib = idx ^ 1; path.push({ hash: lvl[sib] ?? lvl[idx], left: sib < idx }); idx >>= 1; }
  let h = await A.sha(A.leafText(meter, R[i]));
  for (const p of path) h = await A.sha(p.left ? p.hash + h : h + p.hash);
  $('proof').innerHTML = `Reading #${i}: <code>${A.leafText(meter, R[i])}</code><br>Proof = ${path.length} hashes (not all ${R.length} readings).<br>` +
    (h === root ? `<span class=ok>✔ Included in root ${short(root)}.</span>` : `<span class=bad>✘ Not in root ${short(root)} (data was changed).</span>`);
}

// ---------- on-chain registry ----------
async function loadRegistry() {
  try {
    const j = await (await fetch('/api/registry')).json();
    if (j.error) throw new Error(j.error);
    $('reg').innerHTML = j.entries.length ? `<table><tr><th>meter</th><th>period</th><th>eligible kWh</th><th>tx</th></tr>${j.entries.slice(0, 12).map(e =>
      `<tr><td>${e.meter}</td><td>${e.from} → ${e.to}</td><td>${e.eligible_kwh ?? ''}</td><td><a href="${exp(e.signature)}" target=_blank>${e.signature.slice(0, 8)}…</a></td></tr>`).join('')}</table>` : '<span class=muted>No certificates yet.</span>';
  } catch (e) { $('reg').innerHTML = `<span class=muted>Registry unavailable: ${e.message}</span>`; }
}

// ---------- chart ----------
function draw() {
  const c = $('c'), g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  if (!R.length) return;
  const cap = +$('cap').value, sorted = R.map(r => r.kwh).sort((a, b) => a - b);
  const mx = Math.max(cap, sorted[Math.floor(sorted.length * 0.98)]) * 1.15, H = c.height - 14, w = c.width / R.length, bad = new Set(flags.map(f => f.id));
  R.forEach((r, i) => { g.fillStyle = bad.has(r.id) ? '#ff6b6b' : '#ffc83d'; const h = Math.min(r.kwh / mx, 1) * H; g.fillRect(i * w, c.height - h, Math.max(w, 1), h); if (r.kwh > mx) { g.fillText('▲', i * w - 3, 10); } });
  if (meta) { g.strokeStyle = '#5be08a'; g.lineWidth = 1; g.beginPath(); R.forEach((r, i) => { const y = c.height - Math.min((r.sat || 0) * meta.site_factor_kwp / mx, 1) * H; i ? g.lineTo(i * w + w / 2, y) : g.moveTo(0, y); }); g.stroke(); }
  const y = c.height - cap / mx * H;
  g.strokeStyle = '#8fd3ff'; g.setLineDash([6, 4]); g.beginPath(); g.moveTo(0, y); g.lineTo(c.width, y); g.stroke(); g.setLineDash([]);
  g.fillStyle = '#8fd3ff'; g.font = '12px system-ui'; g.fillText(`capacity limit ${cap} kW${sorted[sorted.length - 1] > mx ? ' · ▲ = bar cut off (value far above the chart)' : ''}`, 6, y - 4);
}

onMode().then(load); loadRegistry();
