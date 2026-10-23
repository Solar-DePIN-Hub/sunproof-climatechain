"""Rebuild data/opsd-*.json from the public sources (needs pandas).
1) household_data_60min_singleindex.csv from https://data.open-power-system-data.org/household_data/2020-04-15/
2) PVGIS hourly: https://re.jrc.ec.europa.eu/api/v5_2/seriescalc?lat=47.66&lon=9.17&startyear=2016&endyear=2017&pvcalculation=1&peakpower=1&loss=14&angle=35&aspect=0&outputformat=json
usage: python3 tools/build_opsd.py household_data_60min_singleindex.csv pvgis.json
"""
import json, sys, pandas as pd
csv, pvgis = sys.argv[1], sys.argv[2]
j = json.load(open(pvgis)); h = pd.DataFrame(j["outputs"]["hourly"])
h["t"] = pd.to_datetime(h.time, format="%Y%m%d:%H%M", utc=True).dt.floor("h"); P = h.set_index("t").P / 1000
df = pd.read_csv(csv, usecols=["utc_timestamp", "interpolated", "DE_KN_residential4_pv", "DE_KN_residential3_pv"], parse_dates=["utc_timestamp"]).set_index("utc_timestamp")
def build(col, site, month, learn_from, learn_to, fname, note):
    d = df[col].diff().round(3)
    interp = df.interpolated.fillna("").str.contains(col.replace("DE_KN_", ""))
    A = pd.DataFrame({"kwh": d, "i": interp, "sat": P.reindex(d.index)})
    L = A.loc[learn_from:learn_to].dropna(subset=["kwh"])
    bad_days = set(L[L.i].index.date); Lc = L[[x not in bad_days for x in L.index.date]]
    factor = Lc.kwh.sum() / Lc.sat.sum(); cap = round(Lc.kwh.max() * 1.1, 2)
    M = A.loc[month]
    out = {"id": fname, "site": site, "column": col, "month": month, "lat": 47.66, "lon": 9.17,
           "location_note": "Konstanz, Germany (city coordinates; exact household location is not published)",
           "source": "Open Power System Data, Household Data package v2020-04-15 (CoSSMic project, ISC Konstanz), 60-min, cumulative PV meter → hourly kWh",
           "source_url": "https://data.open-power-system-data.org/household_data/2020-04-15/", "license": "CC-BY-4.0",
           "satellite_source": "PVGIS 5.2 (EU JRC), PVGIS-SARAH2 hourly, 1 kWp c-Si, 35° south, 14% loss", "satellite_url": "https://re.jrc.ec.europa.eu/pvg_tools/en/",
           "site_factor_kwp": round(float(factor), 3), "site_factor_learned": f"{learn_from} → {learn_to}, {len(Lc)//24} measured days",
           "capacity_limit_kw": cap, "capacity_note": "Panel capacity is not published; limit = highest measured hourly output in the learning window + 10%",
           "note": note,
           "readings": [{"ts": t.strftime("%Y-%m-%dT%H:00:00Z"), "kwh": float(r.kwh), "gapfilled": bool(r.i), "sat": round(float(r.sat), 4)} for t, r in M.iterrows()]}
    json.dump(out, open(f"data/{fname}.json", "w"), separators=(",", ":"))
build("DE_KN_residential3_pv", "residential3", "2017-04", "2016-04-01", "2017-03-31", "opsd-res3-2017-04", "Raw month with a logging gap: the data publisher filled missing hours (flagged 'interpolated').")
build("DE_KN_residential4_pv", "residential4", "2017-06", "2016-06-01", "2017-05-31", "opsd-res4-2017-06", "Control month: clean measured data, no gap-filled hours.")
