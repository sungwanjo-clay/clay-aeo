"""Build the deliverable CSVs from the monthly GSC pull."""
import csv, json, os, sys
from collections import defaultdict

OUTDIR = "out"
os.makedirs(OUTDIR, exist_ok=True)

monthly = json.load(open("monthly_rows.json"))
months = sorted(monthly)

# ---- monthly long-format -------------------------------------------------
mpath = os.path.join(OUTDIR, "clay-gsc-keyword-url-by-month-2026.csv")
n_monthly = 0
with open(mpath, "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["month", "keyword", "url", "clicks", "impressions", "ctr_pct", "avg_position"])
    for m in months:
        rows = sorted(monthly[m], key=lambda r: (-r["clicks"], -r["impressions"]))
        for r in rows:
            q, p = r["keys"]
            w.writerow([m, q, p, int(r["clicks"]), int(r["impressions"]),
                        f"{r['ctr'] * 100:.2f}", f"{r['position']:.1f}"])
            n_monthly += 1

# ---- aggregate: recombine months --------------------------------------
# clicks/impressions sum; avg_position is impression-weighted (this is exactly
# how GSC derives it: sum(position*impressions)/sum(impressions)).
agg = defaultdict(lambda: {"clicks": 0, "impr": 0, "pos_num": 0.0, "months": set()})
for m in months:
    for r in monthly[m]:
        k = tuple(r["keys"])
        a = agg[k]
        a["clicks"] += r["clicks"]
        a["impr"] += r["impressions"]
        a["pos_num"] += r["position"] * r["impressions"]
        a["months"].add(m)

apath = os.path.join(OUTDIR, "clay-gsc-keyword-url-2026.csv")
items = sorted(agg.items(), key=lambda kv: (-kv[1]["clicks"], -kv[1]["impr"]))
with open(apath, "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["keyword", "url", "clicks", "impressions", "ctr_pct",
                "avg_position", "months_with_data", "first_month", "last_month"])
    for (q, p), a in items:
        ctr = (a["clicks"] / a["impr"] * 100) if a["impr"] else 0.0
        pos = (a["pos_num"] / a["impr"]) if a["impr"] else 0.0
        ms = sorted(a["months"])
        w.writerow([q, p, int(a["clicks"]), int(a["impr"]), f"{ctr:.2f}",
                    f"{pos:.1f}", len(ms), ms[0], ms[-1]])

stats = {
    "pairs": len(agg),
    "monthly_rows": n_monthly,
    "clicks": sum(a["clicks"] for a in agg.values()),
    "impressions": sum(a["impr"] for a in agg.values()),
    "keywords": len({q for q, _ in agg}),
    "urls": len({p for _, p in agg}),
    "per_month": {m: len(monthly[m]) for m in months},
}
json.dump(stats, open("stats.json", "w"), indent=2)
print(json.dumps(stats, indent=2))
