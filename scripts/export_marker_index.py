#!/usr/bin/env python3
"""Marker index of every linkage map on the site, for the linkage-map plotter's comparison with the database.

website/public/data/maps/marker_index.json:
  {"maps": [map_id...], "chrs": [chromosome...],
   "m": {MARKER: [map_index, chromosome_index, cM x 10, ...]}}      (marker names upper-cased)
Usage: python3 scripts/export_marker_index.py
"""
import csv
import json
import os
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = f"{ROOT}/website/public/data"

maps = [r["map_id"] for r in csv.DictReader(open(f"{SITE}/maps.csv"))]
chrs, cidx = [], {}
idx = defaultdict(list)
for i, mid in enumerate(maps):
    p = f"{SITE}/maps/{mid}.csv"
    if not os.path.exists(p):
        continue
    for r in csv.DictReader(open(p)):
        try:
            cm = round(float(r["position_cm"]) * 10)
        except ValueError:
            continue
        c = r.get("chromosome") or r.get("linkage_group") or ""
        if c not in cidx:
            cidx[c] = len(chrs)
            chrs.append(c)
        idx[r["marker"].strip().upper()] += [i, cidx[c], cm]
with open(f"{SITE}/maps/marker_index.json", "w") as fh:
    json.dump({"maps": maps, "chrs": chrs, "m": idx}, fh, separators=(",", ":"))
print(f"{len(idx):,} markers across {len(maps)} maps; {os.path.getsize(f'{SITE}/maps/marker_index.json') / 1e6:.1f} MB")
