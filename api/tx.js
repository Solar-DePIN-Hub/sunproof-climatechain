// GET ?sig=... -> reads a devnet transaction and returns the memo it carries (for independent verification).
'use strict';
const { readMemo } = require('../lib/solana');
module.exports = async (req, res) => {
  const sig = String((req.query && req.query.sig) || '');
  if (!/^[1-9A-HJ-NP-Za-km-z]{60,90}$/.test(sig)) return res.status(400).json({ error: 'bad signature' });
  try {
    const r = await readMemo(sig);
    if (!r) return res.status(404).json({ error: 'not found on devnet (yet)' });
    res.setHeader('cache-control', 'public, max-age=60');
    res.status(200).json({ ...r, cluster: 'devnet', explorer: `https://explorer.solana.com/tx/${sig}?cluster=devnet` });
  } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
};
