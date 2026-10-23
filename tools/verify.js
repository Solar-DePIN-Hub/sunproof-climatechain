#!/usr/bin/env node
// Independent verifier: node tools/verify.js <devnet-tx-signature> [path/to/dataset.json]
// Reads the SunProof memo from Solana devnet, recomputes the Merkle root from the public dataset
// in data/, and prints whether they match. Uses only public RPC + this repo; no SunProof server.
'use strict';
const path = require('path');
const A = require('../audit.js');
const RPC = process.env.SOLANA_DEVNET_RPC || 'https://api.devnet.solana.com';
const ALPH = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const b58dec = s => { let n = 0n; for (const c of s) n = n * 58n + BigInt(ALPH.indexOf(c)); let h = n.toString(16); if (h.length % 2) h = '0' + h; return Buffer.from(h, 'hex'); };
(async () => {
  const [sig, file] = process.argv.slice(2);
  if (!sig) { console.error('usage: node tools/verify.js <signature> [dataset.json]'); process.exit(2); }
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [sig, { encoding: 'json', maxSupportedTransactionVersion: 0 }] }) });
  const tx = (await r.json()).result;
  if (!tx) throw new Error('transaction not found on devnet');
  const keys = tx.transaction.message.accountKeys;
  const ix = tx.transaction.message.instructions.find(i => keys[i.programIdIndex] === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
  const memo = JSON.parse(b58dec(ix.data).toString('utf8'));
  console.log('on-chain memo (slot ' + tx.slot + ', signer ' + keys[0] + '):\n', memo);
  const ds = require(path.resolve(file || path.join(__dirname, '..', 'data', memo.data + '.json')));
  const rows = ds.readings.map((x, i) => ({ id: i, ts: x.ts, kwh: x.kwh }));
  const L = await A.merkle(memo.meter, rows), root = L[L.length - 1][0];
  console.log('recomputed root:', root);
  console.log(root === memo.root ? '✔ MATCH — the dataset is exactly what was certified' : '✘ MISMATCH — the dataset differs from what was certified');
  process.exit(root === memo.root ? 0 : 1);
})().catch(e => { console.error(e.message); process.exit(1); });
