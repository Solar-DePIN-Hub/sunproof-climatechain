// Minimal Solana devnet client: no dependencies. Node's built-in Ed25519 signs a legacy
// transaction with one Memo-program instruction. DEVNET ONLY.
'use strict';
const crypto = require('crypto');

const RPC = process.env.SOLANA_DEVNET_RPC || 'https://api.devnet.solana.com';
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function b58enc(buf) {
  let n = BigInt('0x' + (Buffer.from(buf).toString('hex') || '0')), s = '';
  while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b === 0) s = '1' + s; else break; }
  return s;
}
function b58dec(str) {
  let n = 0n;
  for (const c of str) { const i = A.indexOf(c); if (i < 0) throw new Error('bad base58'); n = n * 58n + BigInt(i); }
  let hex = n.toString(16); if (hex.length % 2) hex = '0' + hex;
  const body = n === 0n ? Buffer.alloc(0) : Buffer.from(hex, 'hex');
  let z = 0; for (const c of str) { if (c === '1') z++; else break; }
  return Buffer.concat([Buffer.alloc(z), body]);
}
const shortvec = n => { const o = []; do { let b = n & 0x7f; n >>= 7; if (n) b |= 0x80; o.push(b); } while (n); return Buffer.from(o); };

async function rpc(method, params = []) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(method + ': ' + (j.error.message || JSON.stringify(j.error)));
  return j.result;
}

// secret = base64 of 32-byte Ed25519 seed (env SUNPROOF_DEVNET_SEED)
function loadPayer() {
  const seed = Buffer.from(process.env.SUNPROOF_DEVNET_SEED || '', 'base64');
  if (seed.length !== 32) throw new Error('fee payer not configured');
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
  const key = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  const pub = crypto.createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32);
  return { key, pub, address: b58enc(pub) };
}

async function assertDevnet() {
  const g = await rpc('getGenesisHash');
  if (g !== DEVNET_GENESIS) throw new Error('RPC is not Solana devnet — refusing to send');
}

async function sendMemo(text) {
  await assertDevnet();
  const payer = loadPayer();
  let bal = (await rpc('getBalance', [payer.address, { commitment: 'confirmed' }])).value;
  if (bal < 1_000_000) { // < 0.001 devnet SOL: ask the public devnet faucet (free test tokens)
    try { await rpc('requestAirdrop', [payer.address, 1_000_000_000]); } catch (e) { /* rate limited */ }
    for (let i = 0; i < 20 && bal < 1_000_000; i++) { await new Promise(r => setTimeout(r, 1500)); bal = (await rpc('getBalance', [payer.address, { commitment: 'confirmed' }])).value; }
    if (bal < 10_000) throw new Error('devnet fee payer has no test SOL (faucet rate limit) — try again later');
  }
  const { blockhash } = (await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }])).value;
  const data = Buffer.from(text, 'utf8');
  const msg = Buffer.concat([
    Buffer.from([1, 0, 1]),                     // 1 signer, 0 readonly signed, 1 readonly unsigned (memo program)
    shortvec(2), payer.pub, b58dec(MEMO_PROGRAM),
    b58dec(blockhash),
    shortvec(1), Buffer.from([1]), shortvec(0), shortvec(data.length), data,
  ]);
  const sig = crypto.sign(null, msg, payer.key);
  const tx = Buffer.concat([shortvec(1), sig, msg]).toString('base64');
  const signature = await rpc('sendTransaction', [tx, { encoding: 'base64', preflightCommitment: 'confirmed' }]);
  let status = null;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const s = (await rpc('getSignatureStatuses', [[signature]])).value[0];
    if (s && s.confirmationStatus) { status = s; if (s.confirmationStatus !== 'processed') break; }
  }
  return { signature, payer: payer.address, status: status ? status.confirmationStatus : 'sent', err: status ? status.err : null };
}

// Read a transaction back from devnet and return the memo text it carries.
async function readMemo(signature) {
  await assertDevnet();
  const tx = await rpc('getTransaction', [signature, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
  if (!tx) return null;
  const keys = tx.transaction.message.accountKeys;
  const ix = tx.transaction.message.instructions.find(i => keys[i.programIdIndex] === MEMO_PROGRAM);
  return {
    memo: ix ? b58dec(ix.data).toString('utf8') : null,
    slot: tx.slot, blockTime: tx.blockTime, err: tx.meta && tx.meta.err, signer: keys[0],
  };
}

module.exports = { sendMemo, readMemo, loadPayer, b58enc, b58dec, rpc, MEMO_PROGRAM };

// ---- on-chain registry: every SunProof memo signed by the demo payer ----
const cache = new Map(); // signature -> parsed entry (immutable once finalized)
async function rpcBatch(calls) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(calls.map((c, i) => ({ jsonrpc: '2.0', id: i, method: c[0], params: c[1] }))) });
  const j = await r.json();
  return (Array.isArray(j) ? j : [j]).sort((a, b) => a.id - b.id).map(x => x.result);
}
async function registry(limit = 200) {
  await assertDevnet();
  const { address } = loadPayer();
  const sigs = await rpc('getSignaturesForAddress', [address, { limit, commitment: 'confirmed' }]);
  const todo = sigs.filter(s => !s.err && !cache.has(s.signature)).map(s => s.signature);
  for (let i = 0; i < todo.length; i += 20) {
    const part = todo.slice(i, i + 20);
    const txs = await rpcBatch(part.map(s => ['getTransaction', [s, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]]));
    txs.forEach((tx, k) => {
      if (!tx) return;
      const keys = tx.transaction.message.accountKeys;
      const ix = tx.transaction.message.instructions.find(x => keys[x.programIdIndex] === MEMO_PROGRAM);
      let memo = null; try { memo = ix ? JSON.parse(b58dec(ix.data).toString('utf8')) : null; } catch { memo = null; }
      cache.set(part[k], memo && memo.app === 'sunproof' && /^[0-9a-f]{64}$/.test(memo.root) && !/^0+$/.test(memo.root) && memo.from
        ? { signature: part[k], slot: tx.slot, blockTime: tx.blockTime, ...memo } : null);
    });
  }
  return sigs.map(s => cache.get(s.signature)).filter(Boolean);
}
module.exports.registry = registry;
