# ☀️ SunProof — verifiable solar RECs, anchored on Solana

**IEEE ClimateChain Global Hackathon 2026 · Track: Renewable Energy & Energy Trading (renewable certificate tracking)**

Live demo: https://sunproof-climatechain.vercel.app

Small rooftop solar owners produce clean energy but cannot cheaply prove it, and buyers of Renewable Energy Certificates (RECs) cannot see the data behind them. SunProof audits hourly meter data, commits every reading to one Merkle root on **Solana devnet**, issues 1-MWh RECs only for energy that passes the audit, refuses a second certificate for the same meter and period, and lets anyone verify — in the browser or with a 40-line CLI.

## Result on a real household solar meter

Data: [Open Power System Data — Household Data](https://data.open-power-system-data.org/household_data/2020-04-15/) (v2020-04-15, CoSSMic project, Konstanz, Germany), CC BY 4.0. Cumulative PV meter → hourly kWh.

| Real meter-month | Meter claims | Not measured (publisher's own "interpolated" flag) | SunProof held back, **without** using that flag | Measured hours wrongly flagged |
|---|---|---|---|---|
| residential3, April 2017 (logging gap) | 885.2 kWh | 631.1 kWh (71%) | **603.1 kWh = 96% of the unmeasured energy** | **0** |
| residential4, June 2017 (control) | 1,570.9 kWh | 0 | 0 | **0** → 1 REC issued |

What it caught in April 2017: 7 "catch-up" readings of ~73 kWh at 01:00 UTC (solar output while the sun is below the horizon: 419.2 kWh), and 133 hours on days that repeat an earlier day to within 5 Wh every hour (gap-filled copies: 183.8 kWh). Held-back energy is not deleted; it waits for review or a meter re-read.

Anchored on Solana devnet (Memo program, issuer `7giBnWKdqT5KAH5FLbTs58zBrDrnQC64bcj3RXpHkg7L`):
- residential3, April 2017 — root `89a966fe…cb76d5`: [2AgDpp8W…UjvUCy](https://explorer.solana.com/tx/2AgDpp8Wqq4rEu4KcewaM74BZaTZ3vib3UjGrPr9pMjTDe8cJFBomRn4uA3urPyfNTuswsJbiH2JTUjQhUUjvUCy?cluster=devnet)
- residential4, June 2017 — root `b4674285…654df3`, 1 REC: [4CpXtnKm…YoLSBZj](https://explorer.solana.com/tx/4CpXtnKmW8Cf2GMCL9jdU8bLLySRk5c4XygifRTAexD2ffQ9cAfiJ5rmk5EaVFSY2VJTJ1yKSd7XZViHoYpLSBZj?cluster=devnet)

Verify yourself, without our server:
```
node tools/verify.js 2AgDpp8Wqq4rEu4KcewaM74BZaTZ3vib3UjGrPr9pMjTDe8cJFBomRn4uA3urPyfNTuswsJbiH2JTUjQhUUjvUCy
# reads the memo from devnet, recomputes the root from data/opsd-res3-2017-04.json → ✔ MATCH
```

## How it works

```
hourly meter readings (real CSV, OPSD dataset, or synthetic demo)
  → audit: physics (solar position, capacity) + learned per-hour baseline + replay check + satellite cross-check (PVGIS)
  → SHA-256 leaf per reading ("meter|timestamp|kWh") → Merkle root
  → memo (~270 bytes: meter, period, root, claimed/eligible kWh, RECs) → Solana devnet, Memo program
  → registry = all memos signed by the issuer key; overlapping meter + period → refused (no double counting)
  → anyone recomputes the root, or checks one reading with a 10-hash Merkle proof
```

| Check | Rule |
|---|---|
| Physics: night | Output > 0.05 kWh while the sun is below the horizon for the whole hour (NOAA solar-position formula, site lat/lon). |
| Physics: capacity | Hourly kWh above the panel capacity (for OPSD: capacity is not published, so the limit is the highest measured hour in the prior 12 months + 10%). |
| Learned baseline | Per hour of day, median and MAD learned from the site's own readings; robust z > 4 is flagged. Catches plausible numbers at impossible hours. |
| Replay | A day whose 24-hour profile repeats an earlier day to within 5 Wh every hour. Real weather does not repeat that precisely. |
| Satellite cross-check | Daily total vs output expected from PVGIS-SARAH2 satellite irradiance × a site factor learned from the prior 12 months. Flags a day > 1.5× expected + 2 kWh. (On the April 2017 data it adds nothing beyond the checks above; it is there for inflated-but-not-copied days.) |

## Stack

Plain HTML + JavaScript (no build), Web Crypto SHA-256, Canvas. `audit.js` is shared by the browser and Node. Three Vercel serverless functions (`api/anchor`, `api/tx`, `api/registry`) build, sign (Node Ed25519) and send a legacy Solana transaction with one Memo-program instruction — no SDK dependencies. Every call first checks the devnet genesis hash and refuses any other cluster. The issuer key lives only in a Vercel secret.

## Run

Open the live demo, or serve the folder (`python3 -m http.server`) — audit, Merkle root and proofs work offline; anchoring needs the Vercel functions.

## Honest limits

- Devnet only (test tokens, no money). The registry rule is enforced by the issuer service reading the chain, not yet by an on-chain program.
- The anomaly checks are transparent statistics and physics, not a deep model. Exact household locations and panel capacities are not published in the OPSD data, so we use Konstanz city coordinates and a capacity limit derived from the data.
- Synthetic mode is clearly labeled and is only for the fraud-injection demo.

## Next

Solana program that stores (meter, period) → root and rejects overlaps; tokenized RECs that buyers retire on-chain; inverter APIs (Modbus / vendor clouds) and signed meters; mainnet after a security review.

## Data credits

Open Power System Data. 2020. Data Package Household Data. Version 2020-04-15. https://data.open-power-system-data.org/household_data/2020-04-15/ (CC BY 4.0). PVGIS © European Union, 2001–2026, JRC (PVGIS-SARAH2, reuse authorised with acknowledgement).

## Team

Solar DePIN Hub, Ukraine. License: MIT.
