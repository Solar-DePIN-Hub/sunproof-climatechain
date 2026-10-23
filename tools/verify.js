#!/usr/bin/env node
// Independent verifier: node tools/verify.js <devnet-tx-signature> [path/to/dataset.json]
// Reads the SunProof memo from Solana devnet, recomputes the Merkle root from the public dataset
// in data/, and prints whether they match. Uses only public RPC + this repo; no SunProof server.
'use strict';
const path = require('path');
const A = require('../audit.js');
// Public devnet RPCs, tried in order (the official one is rate-limited or unreachable from some networks).
const RPCS = process.env.SOLANA_DEVNET_RPC ? [process.env.SOLANA_DEVNET_RPC] : ['https://api.devnet.solana.com', 'https://solana-devnet.api.onfinality.io/public'];
const ISSUER = process.env.SUNPROOF_ISSUER || '7giBnWKdqT5KAH5FLbTs58zBrDrnQC64bcj3RXpHkg7L'; // SunProof issuer public key
const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const rpc = async (url, method, params) => { const r = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(12000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }); const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result; };
const ALPH = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const b58dec = s => { let n = 0n; for (const c of s) n = n * 58n + BigInt(ALPH.indexOf(c)); let h = n.toString(16); if (h.length % 2) h = '0' + h; return Buffer.from(h, 'hex'); };
(async () => {
  const [sig, file] = process.argv.slice(2);
  if (!sig) { console.error('usage: node tools/verify.js <signature> [dataset.json]'); process.exit(2); }
  let tx = null, used = null;
  for (const url of RPCS) {
    try {
      if (await rpc(url, 'getGenesisHash', []) !== DEVNET_GENESIS) { console.error(url + ' is not Solana devnet, skipped'); continue; }
      tx = await rpc(url, 'getTransaction', [sig, { encoding: 'json', maxSupportedTransactionVersion: 0 }]); used = url;
      if (tx) break;
    } catch (e) { console.error(url + ': ' + e.message + ', trying the next RPC'); }
  }
  if (used) console.log('RPC: ' + used + ' (devnet genesis checked)');
  if (!tx) throw new Error('transaction not found on devnet');
  const keys = tx.transaction.message.accountKeys;
  const ix = tx.transaction.message.instructions.find(i => keys[i.programIdIndex] === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
  const memo = JSON.parse(b58dec(ix.data).toString('utf8'));
  if (keys[0] !== ISSUER) { console.log('✘ signed by ' + keys[0] + ', not the SunProof issuer ' + ISSUER); process.exit(1); }
  console.log('on-chain memo (slot ' + tx.slot + ', signer ' + keys[0] + '):\n', memo);
  const ds = require(path.resolve(file || path.join(__dirname, '..', 'data', memo.data + '.json')));
  const rows = ds.readings.map((x, i) => ({ id: i, ts: x.ts, kwh: x.kwh }));
  const L = await A.merkle(memo.meter, rows), root = L[L.length - 1][0];
  console.log('recomputed root:', root);
  console.log(root === memo.root ? '✔ MATCH — the dataset is exactly what was certified' : '✘ MISMATCH — the dataset differs from what was certified');
  process.exit(root === memo.root ? 0 : 1);
})().catch(e => { console.error(e.message); process.exit(1); });
