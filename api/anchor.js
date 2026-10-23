// POST {memo} -> anchors the SunProof memo on Solana DEVNET via the Memo program.
// Refuses a second certificate for an overlapping meter + period that is already on-chain (no double counting).
'use strict';
const { sendMemo, registry } = require('../lib/solana');
const hits = new Map();
module.exports = async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0];
  const now = Date.now(), h = (hits.get(ip) || []).filter(t => now - t < 60_000);
  if (h.length >= 5) return res.status(429).json({ error: 'slow down: max 5 anchors per minute' });
  hits.set(ip, [...h, now]);
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const memo = String(body.memo || '');
    let m; try { m = JSON.parse(memo); } catch { return res.status(400).json({ error: 'memo must be JSON' }); }
    if (m.app !== 'sunproof' || !/^[0-9a-f]{64}$/.test(m.root || '') || !m.meter || !/^\d{4}-\d\d-\d\d$/.test(m.from || '') || !/^\d{4}-\d\d-\d\d$/.test(m.to || '') || Buffer.byteLength(memo) > 500)
      return res.status(400).json({ error: 'not a SunProof memo (app, meter, from, to, 64-hex root, ≤500 bytes)' });
    const clash = (await registry()).find(e => e.meter === m.meter && !(m.to < e.from || m.from > e.to));
    if (clash) return res.status(409).json({ error: 'double counting blocked', sameRoot: clash.root === m.root, existing: clash, explorer: `https://explorer.solana.com/tx/${clash.signature}?cluster=devnet` });
    const r = await sendMemo(memo);
    res.status(200).json({ ...r, cluster: 'devnet', explorer: `https://explorer.solana.com/tx/${r.signature}?cluster=devnet` });
  } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
};
