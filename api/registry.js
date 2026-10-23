// GET [?meter=] -> SunProof certificates anchored on Solana devnet (read from chain, newest first).
'use strict';
const { registry } = require('../lib/solana');
module.exports = async (req, res) => {
  try {
    const meter = req.query && req.query.meter ? String(req.query.meter) : null;
    const all = await registry();
    res.setHeader('cache-control', 'public, max-age=5');
    res.status(200).json({ cluster: 'devnet', entries: meter ? all.filter(e => e.meter === meter) : all });
  } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
};
