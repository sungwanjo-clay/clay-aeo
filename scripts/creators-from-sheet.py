"""
Export the creator program's placement list from the affiliate team's "Influencer Master" workbook to JSON, for
scripts/sync-creators.mjs (which adds public YouTube metadata and writes the youtube/creators db documents).

    python3 -I scripts/creators-from-sheet.py <Influencer_Master.xlsx> <out.json>

Reads two sheets, by header name (column order may change):
  Placements       one row per video: creator, fit tier, agency, title, platform, post id, go-live, status, format,
                   placement type, views, Rewardful clicks / signups / conversions, the program's own data-quality flags
                   (Excluded from benchmarks, Measurable?, Shared token?) and the link token.
  Ingest - Youtube hourly cumulative snapshots per video; kept as the last snapshot per day.
Fees, payments, contacts and outreach are NOT exported: they stay in the workbook.
"""
import json
import sys
from collections import defaultdict

import openpyxl

src, out = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(src, data_only=True, read_only=True)


def rows(name):
    it = wb[name].iter_rows(values_only=True)
    head = [str(h).strip() if h is not None else '' for h in next(it)]
    for r in it:
        if any(v is not None for v in r):
            yield {h: v for h, v in zip(head, r) if h}


def day(v):
    return v.strftime('%Y-%m-%d') if hasattr(v, 'strftime') else None


def num(v):
    try:
        return None if v is None or v == '' else float(v)
    except (TypeError, ValueError):
        return None


def tok(v):
    if v is None:
        return ''
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip().lower()


def yn(v):
    return str(v or '').strip().upper() == 'Y'


placements = []
for r in rows('Placements'):
    if not (r.get('Creator') or r.get('Video title')):
        continue
    placements.append({
        'creator': r.get('Creator'), 'fit': r.get('Fit tier'), 'status': r.get('Program status'), 'agency': r.get('Agency'),
        'title': r.get('Video title'), 'channelUrl': r.get('Channel'), 'url': r.get('Video URL'), 'platform': r.get('Platform'),
        'vid': r.get('Post ID'), 'live': day(r.get('Go live')), 'videoStatus': r.get('Video status'), 'format': r.get('Format'),
        'placement': r.get('Placement'), 'views': num(r.get('Views')), 'clicks': num(r.get('Clicks')),
        'signups': num(r.get('Signups (link)')), 'conversions': num(r.get('Conversions')),
        'excluded': yn(r.get('Excluded from benchmarks')), 'measurable': yn(r.get('Measurable?')), 'shared': yn(r.get('Shared token?')),
        'token': tok(r.get('Link token')),
    })

# Last snapshot per video per day: [day, views, visitors, leads, conversions]
last = {}
for r in rows('Ingest - Youtube'):
    vid, ts = r.get('YouTube ID'), r.get('Date')
    if not vid or not hasattr(ts, 'strftime'):
        continue
    k = (vid, day(ts))
    if k not in last or ts > last[k][0]:
        last[k] = (ts, [day(ts), num(r.get('Views')), num(r.get('Visitors')), num(r.get('Leads')), num(r.get('Conversions'))])
daily = defaultdict(list)
for (vid, _), (_, row) in sorted(last.items(), key=lambda x: (x[0][0], x[0][1])):
    daily[vid].append(row)

json.dump({'placements': placements, 'daily': daily}, open(out, 'w'), separators=(',', ':'))
print(f'{len(placements)} placements, {len(daily)} videos with daily snapshots -> {out}')
