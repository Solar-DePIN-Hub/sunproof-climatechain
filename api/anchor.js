// POST {memo} -> anchors the SunProof memo on Solana DEVNET via the Memo program.
'use strict';
const { sendMemo } = require('../lib/solana');
module.exports = async (req, res) => {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const memo = String(body.memo || '');
    let m; try { m = JSON.parse(memo); } catch { return res.status(400).json({ error: 'memo must be JSON' }); }
    if (m.app !== 'sunproof' || !/^[0-9a-f]{64}$/.test(m.root || '') || Buffer.byteLength(memo) > 500)
      return res.status(400).json({ error: 'not a SunProof memo (app, 64-hex root, ≤500 bytes)' });
    const r = await sendMemo(memo);
    res.status(200).json({ ...r, cluster: 'devnet', explorer: `https://explorer.solana.com/tx/${r.signature}?cluster=devnet` });
  } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
};
