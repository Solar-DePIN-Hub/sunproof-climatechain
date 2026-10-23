// SunProof audit engine. Shared by the browser (window.SunAudit) and Node tests (module.exports).
(function (root) {
  'use strict';
  const RAD = Math.PI / 180;
  // Solar elevation in degrees (NOAA simplified algorithm), t = Date, lat/lon in degrees.
  function sunElevation(t, lat, lon) {
    const d = t.getTime() / 864e5 + 2440587.5 - 2451545.0;          // days since J2000
    const g = (357.529 + 0.98560028 * d) * RAD;                      // mean anomaly
    const q = 280.459 + 0.98564736 * d;                              // mean longitude
    const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
    const e = (23.439 - 0.00000036 * d) * RAD;
    const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
    const dec = Math.asin(Math.sin(e) * Math.sin(L));
    const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
    const ha = ((gmst * 15 + lon) * RAD) - ra;
    return Math.asin(Math.sin(lat * RAD) * Math.sin(dec) + Math.cos(lat * RAD) * Math.cos(dec) * Math.cos(ha)) / RAD;
  }
  // A reading covers the hour [ts, ts+1h). Night = sun below the horizon for that whole hour.
  function isNightHour(ts, lat, lon) {
    const t0 = new Date(ts).getTime();
    return [0, 15, 30, 45, 60].every(m => sunElevation(new Date(t0 + m * 6e4), lat, lon) < -0.5);
  }
  const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const hourOf = r => new Date(r.ts).getUTCHours();
  const dayOf = r => r.ts.slice(0, 10);

  /**
   * rows: [{id, ts, kwh, gapfilled?, sat?}]  (sat = satellite-modelled kWh per kWp for that hour)
   * ctx:  {cap, lat, lon, siteFactor?}
   * returns {flags: [{id, rule, why}], base, days}
   */
  function audit(rows, ctx) {
    const { cap, lat, lon, siteFactor } = ctx;
    const flags = new Map();
    const flag = (r, rule, why) => { if (!flags.has(r.id)) flags.set(r.id, { id: r.id, rule, why }); };
    // Learned per-hour baseline (median + MAD), learned only from readings that pass the hard rules.
    const night = new Map(rows.map(r => [r.id, isNightHour(r.ts, lat, lon)]));
    const byHour = Array.from({ length: 24 }, () => []);
    rows.forEach(r => { if (!r.gapfilled && !night.get(r.id) && r.kwh <= cap) byHour[hourOf(r)].push(r.kwh); });
    const base = byHour.map(v => { const m = median(v); return { m, mad: median(v.map(x => Math.abs(x - m))) }; });
    for (const r of rows) {
      const h = hourOf(r), b = base[h];
      if (night.get(r.id) && r.kwh > 0.05) flag(r, 'night', `Physics: ${r.kwh} kWh while the sun is below the horizon`);
      else if (r.kwh > cap) flag(r, 'capacity', `Physics: ${r.kwh} kWh in one hour > ${cap} kW capacity`);
      else if (r.gapfilled && r.kwh > 0) flag(r, 'gapfilled', 'Not measured: hour was gap-filled by the data publisher');
      else {
        const z = (r.kwh - b.m) / (1.4826 * b.mad + 0.02 * cap);
        if (z > 4) flag(r, 'baseline', `Learned baseline: ${r.kwh} kWh at ${String(h).padStart(2, '0')}:00 UTC, normal ≈ ${b.m.toFixed(2)} (robust z = ${z.toFixed(1)})`);
      }
    }
    // Replay check: a day whose hourly profile repeats an earlier day to within 5 Wh every hour.
    // Real weather never repeats that precisely, so this catches copy-pasted / replayed / gap-filled days.
    const dayRows = new Map(), earlier = [];
    rows.forEach(r => { const d = dayOf(r); if (!dayRows.has(d)) dayRows.set(d, []); dayRows.get(d).push(r); });
    for (const [d, rs] of dayRows) {
      const v = Array(24).fill(0);
      rs.forEach(r => { if (!flags.has(r.id)) v[hourOf(r)] = r.kwh; });
      if (v.reduce((a, x) => a + x, 0) < 0.5) continue;
      const twin = earlier.find(e => e.v.every((x, i) => Math.abs(x - v[i]) <= 0.005));
      if (twin) rs.forEach(r => { if (r.kwh > 0.05) flag(r, 'replay', `Replay: ${d} repeats ${twin.d} within 5 Wh every hour`); });
      earlier.push({ d, v });
    }
    // Satellite cross-check (independent weather data): day total vs irradiance-based expectation.
    const days = [];
    if (siteFactor && rows.some(r => r.sat != null)) {
      const g = new Map();
      rows.forEach(r => { const d = dayOf(r); if (!g.has(d)) g.set(d, []); g.get(d).push(r); });
      for (const [d, rs] of g) {
        const left = rs.filter(r => !flags.has(r.id));               // only readings that passed the other checks
        const meter = left.reduce((a, r) => a + r.kwh, 0), expected = rs.reduce((a, r) => a + (r.sat || 0), 0) * siteFactor;
        const suspicious = meter > 1.5 * expected + 2;
        days.push({ day: d, meter: +meter.toFixed(2), expected: +expected.toFixed(2), suspicious });
        if (suspicious) left.forEach(r => { if (r.kwh > 0.05) flag(r, 'satellite', `Satellite check: ${d} remaining ${meter.toFixed(1)} kWh vs ${expected.toFixed(1)} kWh expected from satellite irradiance`); });
      }
    }
    return { flags: [...flags.values()], base, days };
  }

  function summarize(rows, flags) {
    const bad = new Set(flags.map(f => f.id)), byRule = {};
    let raw = 0, excluded = 0;
    for (const r of rows) { raw += r.kwh; if (bad.has(r.id)) excluded += r.kwh; }
    for (const f of flags) { const r = rows.find(x => x.id === f.id); byRule[f.rule] = byRule[f.rule] || { n: 0, kwh: 0 }; byRule[f.rule].n++; byRule[f.rule].kwh += r.kwh; }
    return { raw, excluded, eligible: raw - excluded, byRule, nFlags: flags.length, pctExcluded: raw ? 100 * excluded / raw : 0 };
  }


  // ---------- synthetic demo data (clearly labeled) ----------
  function rng(seed) { // mulberry32: same seed -> same data -> same root
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function synthetic({ meter, cap, days, seed, lat, lon, inject }) {
    const rand = rng(seed || 1), start = Date.UTC(2026, 8, 1), rows = [];
    let cloud = 0.8;
    for (let i = 0; i < days * 24; i++) {
      if (i % 24 === 0) cloud = 0.35 + 0.65 * rand();                 // daily weather
      const ts = new Date(start + i * 36e5).toISOString().slice(0, 13) + ':00:00Z';
      const e = sunElevation(new Date(start + i * 36e5 + 18e5), lat, lon);
      const k = e > 0 ? cap * 0.85 * Math.pow(Math.sin(e * RAD), 0.9) * cloud * (0.9 + 0.1 * rand()) : 0;
      rows.push({ id: i, ts, kwh: +k.toFixed(3) });
    }
    const at = (d, h) => rows[d * 24 + h];
    if (inject && days >= 22) {
      const peakHour = [...Array(24).keys()].sort((a, b) => at(0, b).kwh - at(0, a).kwh)[0];
      at(2, (peakHour + 12) % 24).kwh = 4.2;                            // output in the middle of the night
      at(5, peakHour).kwh = +(cap * 1.6).toFixed(3);                    // above panel capacity
      at(9, peakHour).kwh = +(cap * 1.4).toFixed(3);                    // above panel capacity
      const early = [...Array(24).keys()].find(h => at(14, h).kwh > 0.05 && at(14, h).kwh < cap * 0.1);
      at(14, early).kwh = +(cap * 0.7).toFixed(3);                      // plausible number, impossible for that hour
      for (let h = 0; h < 24; h++) at(17, h).kwh = at(3, h).kwh;        // replay: day 18 copies day 4
    }
    return rows;
  }

  // ---------- Merkle tree over canonical leaves ----------
  const leafText = (meter, r) => `${meter}|${r.ts}|${r.kwh.toFixed(3)}`;
  async function sha(s) {
    const b = await (globalThis.crypto || require('crypto').webcrypto).subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  async function merkle(meter, rows) {
    let level = await Promise.all(rows.map(r => sha(leafText(meter, r))));
    const levels = [level];
    while (level.length > 1) {
      const next = [];
      for (let i = 0; i < level.length; i += 2) next.push(await sha(level[i] + (level[i + 1] ?? level[i])));
      levels.push(level = next);
    }
    return levels; // levels[levels.length-1][0] = root
  }

  const api = { sunElevation, isNightHour, audit, summarize, median, synthetic, merkle, leafText, sha };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SunAudit = api;
})(typeof window !== 'undefined' ? window : globalThis);
