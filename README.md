# ☀️ SunProof — verifiable solar RECs

**IEEE ClimateChain Global Hackathon 2026 · Track: Renewable Energy & Energy Trading (renewable certificate tracking)**

Live demo: https://sunproof-climatechain.vercel.app

Small rooftop solar owners produce clean energy but cannot cheaply prove it. Renewable Energy Certificate (REC) registries are built for big plants: slow, paperwork-heavy and opaque. SunProof makes the proof itself checkable by anyone.

## How it works

```
hourly meter readings
  → audit: physical rules + baseline learned from the site's own data
  → SHA-256 hash of every reading → one Merkle root
  → eligible kWh → 1-MWh RECs with serial numbers, remainder carried forward
  → registry: one meter + period can be certified only once (no double counting)
  → compact memo (≈200 bytes) ready to anchor on a public chain (e.g. Solana Memo program)
  → anyone recomputes the root, or checks one reading with a short Merkle proof
```

| Step | What happens |
|---|---|
| 1. Generate | Synthetic hourly data for one meter (clear-sky model + random clouds, seeded so the demo is reproducible). Optional fraud injection. |
| 2. Audit | Rules: output at night, output above panel capacity. Learned baseline: for every hour of day, median and MAD across all days; readings with robust z > 4 are excluded. This catches values that look normal (e.g. 8.5 kWh) but are impossible for that hour (08:00). |
| 3. Commit | Merkle root over all readings, eligible energy → RECs with serials `SP-<meter>-<start>-NNN`, registry entry, anchor memo. Pressing it again for the same meter and period is rejected: double counting blocked. |
| 4–5. Tamper + verify | Changing one reading by 0.5 kWh changes the root, so verification fails. |
| 6. Prove one reading | Merkle inclusion proof: ~10 hashes instead of 720 readings. |

## Run

No build, no backend, no keys. Open `index.html` in a browser, or visit the live demo. Plain HTML + JavaScript, Web Crypto SHA-256, Canvas.

## Honest limits

- Demo data is synthetic, not from a real site.
- The registry is stored in the browser (localStorage) to show the rule; the memo is generated but not yet anchored on-chain in this version.
- The anomaly detector is a robust statistical baseline, not a deep model.

## Next

Anchor roots on Solana devnet, then mainnet; on-chain registry program that rejects overlapping periods; ingest real inverter APIs (Modbus / vendor clouds); tokenized RECs that buyers can retire; better anomaly models with weather data.

## Team

Solar DePIN Hub, Ukraine. License: MIT.
