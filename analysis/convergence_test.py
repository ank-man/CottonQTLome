#!/usr/bin/env python3
"""Do linkage QTL and GWAS loci of the same trait co-localise beyond what shared gene-rich regions explain?

For every trait with >= 100 placed QTL and >= 100 placed GWAS loci, the share of its QTL (one per study and 2-Mb
window, TM-1 UTX v2.1) lying within 1 Mb of a GWAS locus of the same trait from another study is compared with the
share within 1 Mb of GWAS loci of each other qualifying trait, subsampled to the same number of loci. Other traits'
GWAS loci sit in the same gene-rich regions, so the comparison controls for gene density and for study effort.
Writes analysis/tables/convergence_same_vs_other_trait.tsv and adds "convergence" to manuscript_stats.json.
"""
import json
import os
import sys

import numpy as np
import pandas as pd
from scipy import stats

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
T = f"{ROOT}/analysis/tables"
RNG = np.random.default_rng(7)
W = 1_000_000
ax = pd.read_csv(f"{T}/records_common_axis.tsv", sep="\t")
ax = ax[ax.trait_category.ne("unclassified") & ax.record_type.isin(["QTL", "GWAS"]) & ax.pos.notna()]
ax["win"] = (ax.pos // 2e6).astype(int)
ax = ax.drop_duplicates(["record_type", "study", "trait_harmonized", "chromosome", "win"])
q, g = ax[ax.record_type == "QTL"], ax[ax.record_type == "GWAS"]
nq, ng = q.trait_harmonized.value_counts(), g.trait_harmonized.value_counts()
traits = sorted(set(nq[nq >= 100].index) & set(ng[ng >= 100].index))
G = {t: g[g.trait_harmonized == t] for t in traits}


def near(qq, gg):
    hit = np.zeros(len(qq), bool)
    for c, qc in qq.groupby("chromosome"):
        gc = gg[gg.chromosome == c]
        if not len(gc):
            continue
        p = np.sort(gc.pos.values)
        i = np.searchsorted(p, qc.pos.values)
        d = np.minimum(np.abs(qc.pos.values - p[np.clip(i - 1, 0, len(p) - 1)]), np.abs(p[np.clip(i, 0, len(p) - 1)] - qc.pos.values))
        # other study only: drop GWAS from the QTL's own study by requiring distinct study (approximate: studies rarely do both)
        hit[qq.index.get_indexer(qc.index)] = d <= W
    return hit.mean()


rows = []
for t in traits:
    qq = q[q.trait_harmonized == t].reset_index(drop=True)
    same = near(qq, G[t][~G[t].study.isin(set(qq.study))])
    others = []
    for u in traits:
        if u == t:
            continue
        gu = G[u][~G[u].study.isin(set(qq.study))]
        k = min(len(gu), len(G[t]))
        others.append(np.mean([near(qq, gu.sample(k, random_state=int(RNG.integers(1e9)))) for _ in range(5)]))
    rows.append({"trait": t, "n_qtl": len(qq), "n_gwas": len(G[t]), "same_trait": same, "other_traits_median": float(np.median(others)),
                 "other_traits_max": float(np.max(others)), "ratio": same / max(np.median(others), 1e-9)})
r = pd.DataFrame(rows).sort_values("ratio", ascending=False)
r.to_csv(f"{T}/convergence_same_vs_other_trait.tsv", sep="\t", index=False)
w = stats.wilcoxon(r.same_trait, r.other_traits_median, alternative="greater")
res = {"traits": len(r), "higher": int((r.same_trait > r.other_traits_median).sum()), "median_same": float(r.same_trait.median()),
       "median_other": float(r.other_traits_median.median()), "median_ratio": float(r.ratio.median()), "wilcoxon_p": float(w.pvalue),
       "above_max": int((r.same_trait > r.other_traits_max).sum())}
S = json.load(open(f"{T}/manuscript_stats.json"))
S["convergence"] = res
json.dump(S, open(f"{T}/manuscript_stats.json", "w"), indent=1)
print(res)
print(r.round(3).to_string())
