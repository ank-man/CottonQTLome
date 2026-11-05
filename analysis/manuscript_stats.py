#!/usr/bin/env python3
"""Statistics that test the main results against simple alternatives (run after the pipeline).

1. Accuracy of literature mining: linkage QTL mined from papers that CottonGen also curates, compared with the
   CottonGen records of the same study (recovery, and agreement of position, LOD and PVE).
2. Linkage-GWAS agreement of meta-QTL against a permutation null: study method labels shuffled within trait.
3. Hotspots against a gene-density null: each study's occupied windows placed with probability proportional to the
   number of annotated genes in the window (TM-1 UTX v2.1), instead of uniformly.
4. Subgenome shares of annotated genes, for comparison with the shares of loci.
5. Trait pairs that co-localise in multi-trait meta-QTL clusters more often than their frequencies predict.
6. Cloned / validated genes: evidence tiers, validation methods over time.

Writes analysis/tables/manuscript_stats.json and the tables named below.
Usage: python3 analysis/manuscript_stats.py .
"""
import json
import os
import sys
from collections import Counter
from itertools import combinations

import numpy as np
import pandas as pd
from scipy import stats

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
sys.path.insert(0, f"{ROOT}/analysis")
import hotspot_analysis as HA  # noqa: E402

T = f"{ROOT}/analysis/tables"
RNG = np.random.default_rng(20261104)
OUT = {}


def study_of(d):
    k = d.pmid.fillna("").astype(str).str.replace(r"\.0$", "", regex=True)
    return k.where(k != "", d.doi.fillna("").str.lower())


# ------------------------------------------------------------------ 1. mining accuracy against CottonGen
def mining_accuracy():
    cols = ["record_id", "record_type", "source_db", "pmid", "doi", "trait_harmonized", "chromosome", "cm_peak",
            "cm_start", "cm_stop", "phys_start", "lod", "r2_pct", "lead_marker", "qtl_name", "trait_category"]
    a = pd.read_csv(f"{ROOT}/data/processed/records_all.tsv", sep="\t", dtype=str, usecols=cols, low_memory=False)
    a = a[(a.record_type == "QTL") & a.trait_category.ne("unclassified")].copy()
    a["study"] = study_of(a)
    for c in ("cm_peak", "cm_start", "cm_stop", "phys_start", "lod", "r2_pct"):
        a[c] = pd.to_numeric(a[c], errors="coerce")
    a["pos"] = a.cm_peak.fillna((a.cm_start + a.cm_stop) / 2)
    cg, li = a[a.source_db == "CottonGen"], a[a.source_db == "Literature"]
    both = sorted(set(cg.study) & set(li.study) - {""})
    cg, li = cg[cg.study.isin(both)], li[li.study.isin(both)]
    # best literature match for each CottonGen QTL: same study, trait and chromosome, nearest cM position
    m = cg.merge(li, on=["study", "trait_harmonized", "chromosome"], suffixes=("_cg", "_li"))
    m["dpos"] = (m.pos_cg - m.pos_li).abs()
    # several QTL of one trait can share a position (one per environment): among equally close candidates take the
    # one whose statistics agree best, and use each mined record once
    m["dstat"] = (m.lod_cg - m.lod_li).abs().fillna(0) + (m.r2_pct_cg - m.r2_pct_li).abs().fillna(0)
    m = m.sort_values(["dpos", "dstat"])
    keep, used = [], set()
    for i, rc, rl in zip(m.index, m.record_id_cg, m.record_id_li):
        if rc in used or rl in used:
            continue
        used.add(rc); used.add(rl); keep.append(i)
    m = m.loc[keep]
    rec = m[m.dpos.le(1) | (m.pos_cg.isna() | m.pos_li.isna())]
    n_cg = len(cg)
    lod = rec.dropna(subset=["lod_cg", "lod_li"])
    pve = rec.dropna(subset=["r2_pct_cg", "r2_pct_li"])
    pos = rec.dropna(subset=["pos_cg", "pos_li"])
    res = {"studies": len(both), "cg_qtl": n_cg, "recovered": len(rec), "recovered_pct": 100 * len(rec) / max(n_cg, 1),
           "pos_pairs": len(pos), "pos_exact_pct": 100 * (pos.dpos <= 0.05).mean(),
           "lod_pairs": len(lod), "lod_agree_pct": 100 * ((lod.lod_cg - lod.lod_li).abs() <= np.maximum(0.05, 0.02 * lod.lod_cg.abs())).mean(),
           "lod_r": float(stats.pearsonr(lod.lod_cg, lod.lod_li)[0]) if len(lod) > 2 else None,
           "pve_pairs": len(pve), "pve_agree_pct": 100 * ((pve.r2_pct_cg - pve.r2_pct_li).abs() <= np.maximum(0.1, 0.02 * pve.r2_pct_cg.abs())).mean(),
           "pve_r": float(stats.pearsonr(pve.r2_pct_cg, pve.r2_pct_li)[0]) if len(pve) > 2 else None}
    OUT["mining"] = res
    rec[["study", "trait_harmonized", "chromosome", "record_id_cg", "record_id_li", "pos_cg", "pos_li", "lod_cg", "lod_li",
         "r2_pct_cg", "r2_pct_li"]].to_csv(f"{T}/mining_vs_cottongen.tsv", sep="\t", index=False)


# ------------------------------------------------------------------ 2. linkage-GWAS agreement vs permutation
def agreement_null(n_perm=1000):
    mq = pd.read_csv(f"{T}/meta_qtl.tsv", sep="\t", usecols=["mqtl_id", "trait", "n_studies"])
    mem = pd.read_csv(f"{T}/meta_qtl_members.tsv", sep="\t")
    rec = pd.read_csv(f"{ROOT}/data/processed/records_deduplicated.tsv", sep="\t", dtype=str,
                      usecols=["record_id", "record_type", "pmid", "doi"], low_memory=False)
    rec["study"] = study_of(rec)
    mem = mem.merge(rec, on="record_id").merge(mq[["mqtl_id", "trait"]], on="mqtl_id")
    sm = mem.groupby(["mqtl_id", "trait", "study"]).record_type.agg(lambda s: "both" if s.nunique() > 1 else s.iloc[0]).reset_index()
    cls = lambda n: "2" if n == 2 else "3" if n == 3 else "4" if n == 4 else "5–6" if n <= 6 else "7–9" if n <= 9 else "≥10"  # noqa: E731
    klass = mq.set_index("mqtl_id").n_studies.map(cls)   # same classes as Fig. 2b

    def share_both(lab):
        x = sm.assign(m=lab)
        has = x.groupby("mqtl_id").m.agg(lambda s: ("QTL" in set(s) or "both" in set(s)) and ("GWAS" in set(s) or "both" in set(s)))
        return has.groupby(klass).mean()
    obs = share_both(sm.record_type.values)
    # null: a study's method is a property of the study; shuffle study -> method within trait
    st = sm.drop_duplicates(["trait", "study"])[["trait", "study", "record_type"]]
    nulls = []
    for _ in range(n_perm):
        perm = st.copy()
        perm["record_type"] = perm.groupby("trait").record_type.transform(lambda s: RNG.permutation(s.values))
        lab = sm[["trait", "study"]].merge(perm, on=["trait", "study"], how="left").record_type.values
        nulls.append(share_both(lab))
    N = pd.concat(nulls, axis=1)
    order = ["2", "3", "4", "5–6", "7–9", "≥10"]
    tab = pd.DataFrame({"n": klass.value_counts(), "observed": obs, "null_mean": N.mean(axis=1),
                        "null_lo": N.quantile(0.025, axis=1), "null_hi": N.quantile(0.975, axis=1),
                        "p_upper": (N.ge(obs, axis=0).sum(axis=1) + 1) / (n_perm + 1)}).reindex(order)
    tab.to_csv(f"{T}/agreement_vs_null.tsv", sep="\t")
    tot_obs = (obs * tab.n).sum() / tab.n.sum()
    tot_null = (N.mul(tab.n.reindex(N.index), axis=0).sum() / tab.n.sum())
    OUT["agreement"] = {"by_class": tab.round(4).reset_index().rename(columns={"index": "class"}).to_dict("records"),
                        "overall_obs": float(tot_obs), "overall_null": float(tot_null.mean()),
                        "overall_null_hi": float(tot_null.quantile(0.975)),
                        "p_overall": float((tot_null.ge(tot_obs).sum() + 1) / (n_perm + 1)), "n_perm": n_perm}


# ------------------------------------------------------------------ 3 + 4. genes per window; gene-density null
def gene_counts():
    gd = f"{ROOT}/website/public/data/genes/chr"
    cnt = {}
    for c in HA.CHRS:
        g = json.load(open(f"{gd}/{c}.json"))
        g = g.get("genes", g) if isinstance(g, dict) else g
        mids = np.array([(x[1] + x[2]) / 2 for x in g])
        n = int(np.ceil(HA.CHR_LEN[c] / HA.WINDOW))
        cnt[c] = np.bincount(np.minimum((mids // HA.WINDOW).astype(int), n - 1), minlength=n)
    return cnt


def hotspots_gene_null(n_perm=0):
    """Is study support explained by gene density? Each 2-Mb window is ranked against windows of the same
    gene-density decile; a window exceeds expectation when its support is above the 95th percentile of its decile."""
    win = pd.read_csv(f"{T}/windows_2mb.tsv", sep="\t")
    gc = gene_counts()
    genes = np.concatenate([gc[c] for c in HA.CHRS]).astype(float)
    win["genes"] = genes.astype(int)
    win["gene_decile"] = pd.qcut(win.genes.rank(method="first"), 10, labels=False)
    thr = win.groupby("gene_decile").n_studies.transform(lambda s: s.quantile(0.95))
    win["above_gene_expectation"] = win.n_studies > thr
    win["support_percentile_in_decile"] = win.groupby("gene_decile").n_studies.rank(pct=True)
    win.to_csv(f"{T}/windows_2mb_gene_density.tsv", sep="\t", index=False)
    sigw = win[win.significant]
    hs_gene_ratio = sigw.genes.mean() / win.genes.mean()
    hs = pd.read_csv(f"{T}/hotspots.tsv", sep="\t")
    keep = 0
    for _, h in hs.iterrows():
        ww = win[(win.chromosome == h.chromosome) & (win.start < h.end) & (win.end > h.start)]
        keep += bool(ww.above_gene_expectation.any())
    rho, rp = stats.spearmanr(win.n_studies, win.genes)
    a_genes = sum(gc[c].sum() for c in HA.CHRS if c[0] == "A")
    d_genes = sum(gc[c].sum() for c in HA.CHRS if c[0] == "D")
    sub = pd.read_csv(f"{T}/subgenome_bias.tsv", sep="\t")
    al = sub[sub.trait_category == "all"].iloc[0]
    n_ = int(al.At + al.Dt)
    OUT["genes"] = {"n_genes": int(a_genes + d_genes), "dt_gene_share": float(d_genes / (a_genes + d_genes)),
                    "p_loci_vs_gene_share": float(stats.binomtest(int(al.Dt), n_, d_genes / (a_genes + d_genes)).pvalue),
                    "rho_support_genes": float(rho), "rho_p": float(rp),
                    "hotspots": int(len(hs)), "hotspots_kept_gene_null": int(keep),
                    "hotspot_gene_density_ratio": float(hs_gene_ratio),
                    "hotspot_windows_above_gene_expectation": int(sigw.above_gene_expectation.sum()),
                    "sig_windows_uniform": int(win.significant.sum()),
                    "median_pct_in_decile_hotspot_windows": float(100 * sigw.support_percentile_in_decile.median())}
    # per-chromosome: loci vs genes
    pc = pd.read_csv(f"{T}/per_chromosome.tsv", sep="\t").set_index("chromosome")
    pc["genes"] = [gc[c].sum() for c in pc.index]
    r1 = stats.spearmanr(pc.loci, pc.genes)
    r2 = stats.spearmanr(pc.loci, pc.length_mb)
    OUT["genes"].update({"rho_chr_loci_genes": float(r1[0]), "p_chr_loci_genes": float(r1[1]),
                         "rho_chr_loci_length": float(r2[0]), "p_chr_loci_length": float(r2[1])})
    pc.to_csv(f"{T}/per_chromosome_genes.tsv", sep="\t")


# ------------------------------------------------------------------ 5. co-localising trait pairs
def trait_pairs():
    c = pd.read_csv(f"{T}/multi_trait_mqtl_clusters.tsv", sep="\t")
    sets = [set(t.split("; ")) for t in c.traits]
    N = len(sets)
    f = Counter(t for s in sets for t in s)
    pairs = Counter(pr for s in sets for pr in combinations(sorted(s), 2))
    rows = []
    for (a, b), o in pairs.items():
        if f[a] < 10 or f[b] < 10:
            continue
        e = f[a] * f[b] / N
        p = stats.hypergeom.sf(o - 1, N, f[a], f[b])
        rows.append({"trait_a": a, "trait_b": b, "observed": o, "expected": e, "ratio": o / e, "p": p})
    tp = pd.DataFrame(rows)
    tp["q"] = HA.bh(tp.p.values)
    tp = tp.sort_values("ratio", ascending=False)
    tp.to_csv(f"{T}/multi_trait_pairs.tsv", sep="\t", index=False)
    sig = tp[(tp.q < 0.05) & (tp.ratio > 1)]
    mt = pd.read_csv(f"{T}/multi_trait_qtl.tsv", sep="\t")
    cats = c.categories.str.split("; ")
    OUT["multi_trait"] = {
        "clusters": N, "clusters_ge3": int((c.n_traits >= 3).sum()), "clusters_ge2cat": int((c.n_categories >= 2).sum()),
        "median_traits": float(c.n_traits.median()), "median_core_kb": float(((c.core_end_mb - c.core_start_mb) * 1000).median()),
        "median_extent_mb": float(c.span_mb.median()),
        "fq_yield_pct": float(100 * cats.map(lambda v: "fiber quality" in v and "yield" in v).mean()),
        "pairs_tested": int(len(tp)), "pairs_enriched": int(len(sig)),
        "top_pairs": sig.head(8)[["trait_a", "trait_b", "observed", "ratio", "q"]].round(4).to_dict("records"),
        "within": {k: int(v) for k, v in mt.kind.value_counts().items()}, "within_total": int(len(mt)),
        "within_studies": int(mt.study.nunique()), "within_ge3": int((mt.n_traits >= 3).sum()),
        "within_broad": int(mt.broad.sum()),
        "within_top_pairs": Counter(pr for t in mt.traits for pr in combinations(sorted(t.split("; ")), 2)).most_common(5)}
    # clusters that hold a hotspot
    OUT["multi_trait"]["clusters_in_hotspots"] = int(c.hotspots.fillna("").ne("").sum())


# ------------------------------------------------------------------ 6. cloned genes
def cloned():
    g = pd.read_csv(f"{ROOT}/data/processed/cloned_genes.tsv", sep="\t", dtype=str).fillna("")
    g["year"] = pd.to_numeric(g.year, errors="coerce")
    p = g.drop_duplicates(["doi", "pmid"])
    meth = lambda s, k: s.str.contains(k, regex=False)  # noqa: E731
    early, late = p[p.year < 2020], p[p.year >= 2020]
    OUT["cloned"] = {
        "rows": len(g), "genes": int(g.gene.str.lower().nunique()), "papers": len(p),
        "tiers": g.drop_duplicates("gene").evidence_tier.value_counts().to_dict(),
        "validated_genes": int(g[g.evidence_tier.isin(["map-based cloning", "mapped and functionally validated"])].gene.str.lower().nunique()),
        "categories": g.drop_duplicates("gene").trait_category.value_counts().head(8).to_dict(),
        "traits_top": g.drop_duplicates("gene").trait_harmonized.value_counts().head(6).to_dict(),
        "with_chromosome": int(g.drop_duplicates("gene").chromosome.ne("").sum()),
        "papers_since_2020_pct": float(100 * (p.year >= 2020).mean()),
        "vigs_early_pct": float(100 * meth(early.validation_methods, "VIGS").mean()) if len(early) else None,
        "vigs_late_pct": float(100 * meth(late.validation_methods, "VIGS").mean()),
        "crispr_early_pct": float(100 * meth(early.validation_methods, "CRISPR").mean()) if len(early) else None,
        "crispr_late_pct": float(100 * meth(late.validation_methods, "CRISPR").mean()),
        "gwas_route_late_pct": float(100 * meth(late.mapping_evidence, "GWAS").mean()),
        "gwas_route_early_pct": float(100 * meth(early.mapping_evidence, "GWAS").mean()) if len(early) else None,
        "n_early": len(early), "n_late": len(late)}


if __name__ == "__main__":
    for f in (mining_accuracy, agreement_null, hotspots_gene_null, trait_pairs, cloned):
        f(); print(f.__name__, "done", flush=True)
    json.dump(OUT, open(f"{T}/manuscript_stats.json", "w"), indent=1, default=lambda x: x.item() if hasattr(x, "item") else str(x))
    print(json.dumps(OUT, indent=1, default=str)[:6000])
