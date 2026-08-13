"""Month-by-month keyword -> URL export for 2026 onward."""
import json, sys
import gsc

SITE = "sc-domain:clay.com"
MONTHS = [
    ("2026-01", "2026-01-01", "2026-01-31"),
    ("2026-02", "2026-02-01", "2026-02-28"),
    ("2026-03", "2026-03-01", "2026-03-31"),
    ("2026-04", "2026-04-01", "2026-04-30"),
    ("2026-05", "2026-05-01", "2026-05-31"),
    ("2026-06", "2026-06-01", "2026-06-30"),
    ("2026-07", "2026-07-01", "2026-07-31"),
    ("2026-08", "2026-08-01", "2026-08-10"),
]

out = {}
for label, start, end in MONTHS:
    print(f"== {label} ({start}..{end})", file=sys.stderr)
    rows = gsc.fetch_all(SITE, start, end, ["query", "page"], page_cap=2_000_000)
    out[label] = rows
    print(f"  {label}: {len(rows)} rows", file=sys.stderr)

with open("monthly_rows.json", "w") as f:
    json.dump(out, f)
print("TOTAL:", sum(len(v) for v in out.values()), file=sys.stderr)
