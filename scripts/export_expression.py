#!/usr/bin/env python3
"""Organ expression of TM-1 genes for the website (after export_gene_index.py and analysis/expression_overlay.py).

    python3 scripts/export_expression.py

Source: RNA-seq of 11 TM-1 organs (BioProject PRJNA248163; Zhang et al. 2015, Nat Biotechnol 33:531,
doi:10.1038/nbt.3207), one library per organ, 3 M reads quantified with kallisto against one transcript per
UTX v2.1 gene (PolyploidQTLome step 13). Class values, tau, peak class and the fibre-preferential call come from
analysis/tables/expression_gene_atlas_cotton.tsv.gz, so the site matches the manuscript.

Outputs (website/public/data/)
  genes/expr/meta.json        organs, classes, source and genome-wide shares
  genes/expr/<chr>.json       {gene_id: [tpm x 11 organs, tau x 100, peak class index (-1 = not expressed), fibre-pref 0/1]}
  genes/expr/intervals.json   {hotspot or meta-QTL id: [genes, expressed, fibre-preferential, peak in fibre, peak in seed]}
  downloads/gene_expression_tm1_organs.csv.gz
"""
import gzip
import json
import os

import numpy as np
import pandas as pd

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PQ = os.path.abspath(os.path.join(ROOT, "..", "PolyploidQTLome"))
SITE = f"{ROOT}/website/public/data"
OUT = f"{SITE}/genes/expr"
CHRS = [f"{g}{i:02d}" for g in "AD" for i in range(1, 14)]

# library -> organ label shown on the site (order = display order); class as in PolyploidQTLome config/rnaseq_runs.tsv
ORGANS = [("SRR1695173", "root", "root"), ("SRR1695174", "stem", "stem"), ("SRR1695175", "leaf", "leaf"),
          ("SRR1695164", "cotyledon", "leaf"), ("SRR1695177", "petal", "flower"), ("SRR1695178", "stamen", "flower"),
          ("SRR1695179", "pistil", "flower"), ("SRR1695187", "ovule 10 dpa", "seed"), ("SRR1695160", "seed", "seed"),
          ("SRR1695192", "fibre 10 dpa", "fibre"), ("SRR1695193", "fibre 20 dpa", "fibre")]
CLASSES = ["root", "stem", "leaf", "flower", "seed", "fibre"]


def rnd(x):
    return float(round(x, 1)) if x < 10 else int(round(x))


def main():
    tpm = pd.concat({lab: pd.read_csv(f"{PQ}/data/expression/quant/{run}/abundance.tsv", sep="\t",
                                      index_col="target_id")["tpm"] for run, lab, _ in ORGANS}, axis=1)
    atlas = pd.read_csv(f"{ROOT}/analysis/tables/expression_gene_atlas_cotton.tsv.gz", sep="\t").set_index("gene_id")

    os.makedirs(OUT, exist_ok=True)
    genes, n = [], 0
    for c in CHRS:
        rows = json.load(open(f"{SITE}/genes/chr/{c}.json"))
        shard = {}
        for r in rows:
            gid = r[0]
            if gid not in tpm.index or gid not in atlas.index:
                continue
            a = atlas.loc[gid]
            t = tpm.loc[gid].values
            expressed = bool(t.max() >= 1)
            peak = CLASSES.index(a.peak_class) if expressed and isinstance(a.peak_class, str) else -1
            tau = int(round(100 * a.tau)) if expressed and pd.notna(a.tau) else -1
            shard[gid] = [rnd(x) for x in t] + [tau, peak, int(bool(a.fibre_pref))]
            genes.append([gid, c, r[1], r[2], r[7], r[9], *[round(x, 2) for x in t],
                          *[round(a[f"tpm_{k}"], 2) for k in CLASSES], a.tau if expressed else np.nan,
                          a.peak_class if expressed else "", bool(a.fibre_pref)])
        json.dump(shard, open(f"{OUT}/{c}.json", "w"), separators=(",", ":"))
        n += len(shard)

    cols = ["gene_id", "chromosome", "start", "end", "arabidopsis_symbol", "description"] + \
           [f"tpm_{lab.replace(' ', '_')}" for _, lab, _ in ORGANS] + [f"class_tpm_{k}" for k in CLASSES] + \
           ["tau", "peak_class", "fibre_preferential"]
    D = pd.DataFrame(genes, columns=cols)
    D["tau"] = D.tau.round(3)
    os.makedirs(f"{SITE}/downloads", exist_ok=True)
    with gzip.open(f"{SITE}/downloads/gene_expression_tm1_organs.csv.gz", "wt") as fh:
        D.to_csv(fh, index=False)

    # per hotspot and per meta-QTL: genes (midpoint inside), expressed, fibre-preferential, peak in fibre / seed
    D["mid"] = (D.start + D.end) // 2
    D["expr"] = D.peak_class != ""
    by = {c: d.sort_values("mid") for c, d in D.groupby("chromosome")}

    def count(c, s, e):
        if c not in by:
            return [0, 0, 0, 0, 0]
        d = by[c]
        lo, hi = np.searchsorted(d.mid.values, [s, e])
        x = d.iloc[lo:hi]
        return [len(x), int(x.expr.sum()), int(x.fibre_preferential.sum()),
                int((x.peak_class == "fibre").sum()), int((x.peak_class == "seed").sum())]

    iv = {}
    for r in pd.read_csv(f"{SITE}/hotspots.csv").itertuples():
        iv[r.hotspot_id] = count(r.chromosome, r.start, r.end)
    for r in pd.read_csv(f"{SITE}/mqtl.csv").itertuples():
        iv[r.mqtl_id] = count(r.chromosome, r.ci_start_mb * 1e6, r.ci_end_mb * 1e6)
    json.dump(iv, open(f"{OUT}/intervals.json", "w"), separators=(",", ":"))

    meta = {
        "organs": [lab for _, lab, _ in ORGANS],
        "organ_class": [k for *_, k in ORGANS],
        "runs": [run for run, *_ in ORGANS],
        "classes": CLASSES,
        "genes": n,
        "expressed_share": round(float(D.expr.mean()), 4),
        "fibre_preferential_share": round(float(D.fibre_preferential.mean()), 4),
        "source": "TM-1 organ RNA-seq, BioProject PRJNA248163 (Zhang et al. 2015, Nat Biotechnol 33:531)",
        "doi": "10.1038/nbt.3207",
        "method": "kallisto 0.52, 3 M single-end reads per library, one transcript per UTX v2.1 gene; one library per organ",
    }
    json.dump(meta, open(f"{OUT}/meta.json", "w"), indent=1)
    print(f"genes with expression: {n}; intervals: {len(iv)}; download rows: {len(D)}")
    print(f"expressed {meta['expressed_share']:.3f}, fibre-preferential {meta['fibre_preferential_share']:.3f}")


if __name__ == "__main__":
    main()
