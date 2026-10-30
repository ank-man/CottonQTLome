#!/usr/bin/env python3
"""Download marker primer sequences from CottonGen, one marker type at a time.

Usage: cottongen_primers.py RAW_COTTONGEN_DIR
"""
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cottongen_maps_markers import export, open_form, options  # noqa: E402

out = sys.argv[1]
_, form = open_form("tripal_megasearch_marker")
for mtype in options(form, "marker_type"):
    fn = f"{out}/primers/{re.sub(r'[^A-Za-z0-9._-]+', '_', mtype)}.tsv"
    if os.path.exists(fn):
        continue
    size, count = export("tripal_megasearch_marker", fn, {"marker_type": mtype}, ["name", "marker_type", "primers"], tries=2)
    print(mtype, size, count[:40], flush=True)
    time.sleep(2)
