#!/usr/bin/env python3
"""Genetic-map meta-QTL vs physical meta-QTL: same-trait match rate against other traits as a control.
A genetic-map meta-QTL matches when a physical meta-QTL's 95% CI overlaps the interquartile physical range of its
member QTL, +-1 Mb (the rule of analysis/meta_qtl_cm.R). Control: the same test against the physical meta-QTL of
each other trait, averaged. Adds "cm_control" to manuscript_stats.json."""
import json
import sys

import numpy as np
import pandas as pd

R = sys.argv[1] if len(sys.argv) > 1 else "."
mc = pd.read_csv(f"{R}/analysis/tables/meta_qtl_cm.tsv", sep="\t")
mp = pd.read_csv(f"{R}/analysis/tables/meta_qtl.tsv", sep="\t")
mc = mc[mc.physical_q1_mb.notna()]


def ov(r, tr, slack=1.0):
    m = mp[(mp.trait == tr) & (mp.chromosome == r.chromosome)]
    return bool(((m.ci_start_mb <= r.physical_q3_mb + slack) & (m.ci_end_mb >= r.physical_q1_mb - slack)).any())


ts = [t for t in mp.trait.unique() if t in set(mc.trait)]
same = np.array([ov(r, r.trait) for r in mc.itertuples()])
other = np.array([np.mean([ov(r, t) for t in ts if t != r.trait]) for r in mc.itertuples()])
res = {"n": int(len(mc)), "same_pct": float(100 * same.mean()), "other_pct": float(100 * other.mean()),
       "same_strict_pct": float(100 * np.mean([ov(r, r.trait, 0) for r in mc.itertuples()])),
       "other_strict_pct": float(100 * np.mean([np.mean([ov(r, t, 0) for t in ts if t != r.trait]) for r in mc.itertuples()]))}
S = json.load(open(f"{R}/analysis/tables/manuscript_stats.json"))
S["cm_control"] = res
json.dump(S, open(f"{R}/analysis/tables/manuscript_stats.json", "w"), indent=1)
print(res)
