#!/usr/bin/env python3
"""Verify meta title / description character counts before recommending them.

Eyeballing these does not work. Real defects this catches: a 193-char
description (38 over), and a title sitting at exactly 60 with zero margin for
a longer brand suffix on mobile.

Usage:
    python3 check_metadata.py --title "Clay Sequencer | Cold Email on Live Data"
    python3 check_metadata.py --title "New" --current-title "Old" --desc "..." --current-desc "..."
    python3 check_metadata.py --json candidates.json

JSON form: {"rec_title": "...", "rec_desc": "...", "cur_title": "..."} - any
key containing "title" is checked against the title limit, anything else
against the description limit.
"""
import argparse
import json
import sys

TITLE_LIMIT = 60
DESC_LIMIT = 155
# Within this many chars of the limit there is no room for a brand suffix or a
# SERP rewrite, so it is worth flagging even though it technically fits.
TIGHT_MARGIN = 3


def check(label, text, limit):
    n = len(text)
    over = n - limit
    if over > 0:
        status, note = "LONG", f"{over} over - must trim"
    elif over > -TIGHT_MARGIN:
        status, note = "TIGHT", f"{-over} to spare - no mobile margin"
    else:
        status, note = "OK", f"{-over} to spare"
    print(f"[{status:<5} {n:>3}/{limit}] {label}: {text}")
    print(f"{'':>13}  └─ {note}")
    return status != "LONG"


def limit_for(key):
    return TITLE_LIMIT if "title" in key.lower() else DESC_LIMIT


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--title", help="recommended title")
    ap.add_argument("--desc", help="recommended meta description")
    ap.add_argument("--current-title", help="their draft, for before/after")
    ap.add_argument("--current-desc", help="their draft, for before/after")
    ap.add_argument("--json", help="JSON file of {label: string} pairs")
    args = ap.parse_args()

    items = {}
    if args.json:
        with open(args.json) as fh:
            loaded = json.load(fh)
        if not isinstance(loaded, dict):
            sys.exit("--json must contain an object of {label: string}")
        items.update(loaded)
    for key, val in (("current_title", args.current_title),
                     ("rec_title", args.title),
                     ("current_desc", args.current_desc),
                     ("rec_desc", args.desc)):
        if val is not None:
            items[key] = val

    if not items:
        ap.error("nothing to check - pass --title/--desc or --json")

    all_ok = True
    for label, text in items.items():
        if not isinstance(text, str):
            sys.exit(f"value for {label!r} is not a string")
        all_ok &= check(label, text, limit_for(label))

    print()
    print("All within limits." if all_ok else "Something is over - trim before recommending.")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
