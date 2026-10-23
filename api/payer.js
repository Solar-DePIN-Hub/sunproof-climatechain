// GET -> public address + devnet balance of the demo fee payer (no secrets).
'use strict';
const { loadPayer, rpc } = require('../lib/solana');
module.exports = async (req, res) => {
  try {
    const { address } = loadPayer();
    const bal = (await rpc('getBalance', [address])).value;
    res.status(200).json({ address, cluster: 'devnet', balance_sol: bal / 1e9, explorer: `https://explorer.solana.com/address/${address}?cluster=devnet` });
  } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
};
