// Reproduces the headline numbers in the README from the committed public datasets.
// Run: node --test   (Node 18+, no dependencies, no network)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../audit.js');

function load(id) {
  const d = require(`../data/${id}.json`);
  const rows = d.readings.map((r, i) => ({ id: i, ts: r.ts, kwh: r.kwh, gapfilled: r.gapfilled, sat: r.sat }));
  return { d, rows };
}
function blindAudit({ d, rows }) {
  const blind = rows.map(r => ({ ...r, gapfilled: false })); // the audit never sees the publisher's flag
  const { flags } = A.audit(blind, { cap: d.capacity_limit_kw, lat: d.lat, lon: d.lon, siteFactor: d.site_factor_kwp });
  const s = A.summarize(rows, flags);
  const bad = new Set(flags.map(f => f.id));
  const gapK = rows.filter(r => r.gapfilled).reduce((a, r) => a + r.kwh, 0);
  const caughtK = rows.filter(r => r.gapfilled && bad.has(r.id)).reduce((a, r) => a + r.kwh, 0);
  const falseFlags = rows.filter(r => !r.gapfilled && bad.has(r.id)).length;
  return { s, flags, gapK, caughtK, falseFlags };
}
const round1 = x => Math.round(x * 10) / 10;

test('residential3, April 2017: holds back 603.1 kWh = 96% of unmeasured energy, 0 false flags', () => {
  const r = blindAudit(load('opsd-res3-2017-04'));
  assert.equal(round1(r.s.raw), 885.2);
  assert.equal(round1(r.gapK), 631.1);
  assert.equal(round1(r.s.excluded), 603.1);
  assert.equal(round1(r.s.eligible), 282.1);
  assert.equal(Math.round(100 * r.caughtK / r.gapK), 96);
  assert.equal(r.falseFlags, 0);
  assert.equal(r.s.byRule.night.n, 7);
  assert.equal(round1(r.s.byRule.night.kwh), 419.2);
  assert.equal(r.s.byRule.replay.n, 133);
  assert.equal(round1(r.s.byRule.replay.kwh), 183.8);
});

test('residential4, June 2017 (clean control): nothing flagged, 1 REC', () => {
  const r = blindAudit(load('opsd-res4-2017-06'));
  assert.equal(r.flags.length, 0);
  assert.equal(round1(r.s.eligible), 1570.9);
  assert.equal(Math.floor(r.s.eligible / 1000), 1);
});

test('Merkle roots equal the roots anchored on Solana devnet', async () => {
  const cases = [
    ['opsd-res3-2017-04', 'OPSD-DE_KN_residential3_pv', '89a966fe402788895c3385a009610cd0ee398c561c8d5eca2f2fa478cbcb76d5'],
    ['opsd-res4-2017-06', 'OPSD-DE_KN_residential4_pv', 'b467428574e19545dca36c97d7774450fa90845b2521f0e6d7bb86ea0d654df3'],
  ];
  for (const [id, meter, onchain] of cases) {
    const { rows } = load(id);
    const L = await A.merkle(meter, rows.map(r => ({ id: r.id, ts: r.ts, kwh: r.kwh })));
    assert.equal(L[L.length - 1][0], onchain, id);
  }
});

test('changing one reading by 0.5 kWh changes the root', async () => {
  const { rows } = load('opsd-res3-2017-04');
  const base = rows.map(r => ({ id: r.id, ts: r.ts, kwh: r.kwh }));
  const t = base.map(r => ({ ...r })); t[368].kwh = +(t[368].kwh + 0.5).toFixed(3);
  const a = await A.merkle('m', base), b = await A.merkle('m', t);
  assert.notEqual(a[a.length - 1][0], b[b.length - 1][0]);
});

test('night physics uses solar position, not clock hours', () => {
  // Konstanz, 21 June 2017: 00:00 UTC is night, 11:00 UTC is near solar noon.
  assert.ok(A.sunElevation(new Date('2017-06-21T00:00:00Z'), 47.66, 9.17) < 0);
  assert.ok(A.sunElevation(new Date('2017-06-21T11:00:00Z'), 47.66, 9.17) > 50);
});

test('synthetic fraud injection is caught', () => {
  const rows = A.synthetic({ meter: 'T', cap: 12, days: 30, seed: 7, lat: 50.45, lon: 30.52, inject: true });
  const { flags } = A.audit(rows, { cap: 12, lat: 50.45, lon: 30.52 });
  assert.ok(flags.length > 0);
});
