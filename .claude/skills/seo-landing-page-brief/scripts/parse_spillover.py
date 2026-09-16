#!/usr/bin/env python3
"""Parse a GSC or Ahrefs result that spilled to /home/user/.spillover/.

Tool results over ~8K chars get written to a file instead of returned, and
loading the whole thing into context defeats the point. This prints a compact
table of the rows that matter.

Usage:
    python3 parse_spillover.py /home/user/.spillover/<file>.txt
    python3 parse_spillover.py <file> --top 40 --sort clicks
    python3 parse_spillover.py <file> --min-impressions 100
"""
import argparse
import json
import sys

# GSC search-analytics rows and Ahrefs rows use different key names for the
# same ideas; normalize both into one shape.
GSC_METRICS = ("clicks", "impressions", "position", "ctr")
LABEL_KEYS = ("keyword", "query", "page", "url", "best_position_url")


def load(path):
    with open(path) as fh:
        data = json.load(fh)
    for key in ("rows", "results", "data", "keywords", "positions"):
        if isinstance(data, dict) and isinstance(data.get(key), list):
            return data[key]
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        sys.exit(f"no row list found; top-level keys: {sorted(data)}")
    sys.exit("unrecognized JSON shape")


def label_of(row):
    dims = row.get("dimension_values") or row.get("keys")
    if isinstance(dims, dict):
        return " | ".join(str(v) for v in dims.values())
    if isinstance(dims, list):
        return " | ".join(str(v) for v in dims)
    for key in LABEL_KEYS:
        if key in row:
            return str(row[key])
    return "?"


def normalize(row):
    out = {"label": label_of(row)}
    for metric in GSC_METRICS:
        out[metric] = row.get(metric)
    # Ahrefs equivalents
    out["volume"] = row.get("volume") or row.get("global_volume")
    out["difficulty"] = row.get("difficulty") or row.get("keyword_difficulty")
    out["position"] = out["position"] if out["position"] is not None else row.get("best_position")
    cpc = row.get("cpc")
    out["cpc"] = cpc / 100 if isinstance(cpc, (int, float)) else None  # Ahrefs CPC is cents
    return out


def fmt(val, spec=""):
    return "-" if val is None else format(val, spec)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("path")
    ap.add_argument("--top", type=int, default=40)
    ap.add_argument("--sort", default="auto",
                    choices=["auto", "impressions", "clicks", "position", "volume"])
    ap.add_argument("--min-impressions", type=int, default=0)
    args = ap.parse_args()

    rows = [normalize(r) for r in load(args.path) if isinstance(r, dict)]
    if not rows:
        print("0 rows - an empty result is a finding, report it as one.")
        return 0

    if args.min_impressions:
        rows = [r for r in rows if (r["impressions"] or 0) >= args.min_impressions]

    key = args.sort
    if key == "auto":
        key = "impressions" if any(r["impressions"] is not None for r in rows) else "volume"
    ascending = key == "position"
    rows.sort(key=lambda r: (r[key] is None, r[key] if ascending else -(r[key] or 0)))

    print(f"{len(rows)} rows, sorted by {key}{' (asc)' if ascending else ''}\n")
    print(f"{'label':<44}{'clicks':>8}{'impr':>9}{'pos':>7}{'ctr%':>8}{'vol':>9}{'KD':>5}{'CPC':>8}")
    print("-" * 98)
    for r in rows[:args.top]:
        ctr = r["ctr"] * 100 if isinstance(r["ctr"], (int, float)) else None
        print(f"{r['label'][:42]:<44}"
              f"{fmt(r['clicks']):>8}{fmt(r['impressions']):>9}"
              f"{fmt(r['position'], '.1f'):>7}{fmt(ctr, '.2f'):>8}"
              f"{fmt(r['volume']):>9}{fmt(r['difficulty']):>5}{fmt(r['cpc'], '.2f'):>8}")

    if len(rows) > args.top:
        print(f"\n... {len(rows) - args.top} more rows (--top to show more)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
