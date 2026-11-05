#!/usr/bin/env python3
"""Multi-trait (pleiotropic) QTL, computed three ways; the author-reported clusters stay as 'QTL cluster' records.

1. Within-study multi-trait QTL: linkage QTL of >= 2 named traits from one study whose intervals overlap on the
   same chromosome of the same assembly (Mb), or on the same linkage group of the same map (cM). Peak-only QTL
   get +-1 Mb / +-2.5 cM. All members of a region share a common stretch (no chaining through neighbours);
   regions spanning > 20 Mb / 40 cM are flagged as broad.
2. Pleiotropic GWAS signals: one study, the same lead SNP (or positions within 100 kb) for >= 2 named traits.
3. Multi-trait meta-QTL clusters: physical meta-QTL (TM-1 UTX v2.1) of different traits whose 95% CIs overlap;
   only meta-QTL with a CI <= 5 Mb take part, and all members share a common stretch (core_start/end_mb).

Outputs analysis/tables/multi_trait_qtl.tsv (1 and 2), multi_trait_qtl_members.tsv, multi_trait_mqtl_clusters.tsv.
Usage: python3 analysis/multi_trait.py .
"""
import os
import sys

import numpy as np
import pandas as pd

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
T = f"{ROOT}/analysis/tables"
PEAK_BP, PEAK_CM, GWAS_BP = 1_000_000, 2.5, 100_000
MAX_CI_MB = 5.0


def study_key(d):
    k = d.pmid.fillna("").astype(str).str.replace(r"\.0$", "", regex=True)
    k = k.where(k != "", d.doi.fillna("").str.lower())
    k = k.where(k != "", d.source_dataset.fillna("") + "|" + d.first_author.fillna("") + "|" + d.year.fillna("").astype(str))
    return k


def intervals_join(g, lo, hi):
    """Group intervals that all share a common stretch (no chaining): sweep by start, open a new group when the
    next interval misses the running intersection. Returns group number per row (input order)."""
    o = np.argsort(lo.values, kind="stable")
    grp = np.empty(len(g), int)
    cur, core_hi = -1, -np.inf
    for i in o:
        if lo.values[i] > core_hi:
            cur += 1; core_hi = hi.values[i]
        else:
            core_hi = min(core_hi, hi.values[i])
        grp[i] = cur
    return grp


def main():
    cols = ["record_id", "record_type", "source_dataset", "trait_harmonized", "trait_category", "chromosome", "ref_genome",
            "phys_start", "phys_end", "map_name", "linkage_group", "cm_start", "cm_stop", "cm_peak", "lead_marker", "qtl_name",
            "lod", "r2_pct", "neg_log10_p", "pmid", "doi", "year", "first_author", "source_db"]
    d = pd.read_csv(f"{ROOT}/data/processed/records_deduplicated.tsv", sep="\t", dtype=str, usecols=cols, low_memory=False)
    d = d[d.record_type.isin(["QTL", "GWAS"]) & d.trait_category.ne("unclassified") & d.trait_harmonized.notna()].copy()
    d["study"] = study_key(d)
    for c in ("phys_start", "phys_end", "cm_start", "cm_stop", "cm_peak"):
        d[c] = pd.to_numeric(d[c], errors="coerce")
    ax = pd.read_csv(f"{T}/records_common_axis.tsv", sep="\t", usecols=["record_id", "pos"])
    d = d.merge(ax, on="record_id", how="left")
    regions, members = [], []

    def emit(kind, g, unit, lo, hi, chrom, place):
        traits = sorted(set(g.trait_harmonized))
        if len(traits) < 2:
            return
        rid = f"MTQ{len(regions) + 1:05d}"
        r0 = g.iloc[0]
        regions.append({
            "mt_id": rid, "kind": kind, "study": r0.study, "first_author": r0.first_author, "year": r0.year, "pmid": r0.pmid,
            "doi": r0.doi, "source_db": "; ".join(sorted(set(g.source_db))), "chromosome": chrom, "placement": place,
            "start": lo, "end": hi, "unit": unit, "span": hi - lo,
            "utx_v2_1_start_mb": g.pos.min() / 1e6 if g.pos.notna().any() else np.nan,
            "utx_v2_1_end_mb": g.pos.max() / 1e6 if g.pos.notna().any() else np.nan,
            "n_traits": len(traits), "n_categories": g.trait_category.nunique(), "traits": "; ".join(traits),
            "categories": "; ".join(sorted(set(g.trait_category))), "n_records": len(g),
            "markers": "; ".join(sorted(set(g.lead_marker.dropna())))[:400],
            "qtl_names": "; ".join(sorted(set(g.qtl_name.dropna())))[:400],
            "broad": (hi - lo) > (20e6 if unit == "bp" else 40)})
        members.extend({"mt_id": rid, "record_id": x, "trait_harmonized": t} for x, t in zip(g.record_id, g.trait_harmonized))

    # 1a linkage QTL with physical intervals
    q = d[d.record_type == "QTL"]
    qp = q[q.phys_start.notna() & q.chromosome.notna()].copy()
    qp["lo"] = qp.phys_start.where(qp.phys_end.notna() & (qp.phys_end > qp.phys_start), qp.phys_start - PEAK_BP)
    qp["hi"] = qp.phys_end.where(qp.phys_end.notna() & (qp.phys_end > qp.phys_start), qp.phys_start + PEAK_BP)
    for (_, c, _), g in qp.groupby(["study", "chromosome", qp.ref_genome.fillna("")]):
        if g.trait_harmonized.nunique() < 2:
            continue
        g = g.assign(grp=intervals_join(g, g.lo, g.hi))
        for _, h in g.groupby("grp"):
            emit("linkage QTL (physical)", h, "bp", h.lo.min(), h.hi.max(), c, f"{h.ref_genome.iloc[0]}")
    # 1b linkage QTL with genetic positions only
    qc = q[q.phys_start.isna() & (q.cm_start.notna() | q.cm_peak.notna()) & q.linkage_group.notna()].copy()
    pk = qc.cm_peak.fillna((qc.cm_start + qc.cm_stop) / 2).fillna(qc.cm_start)
    has = qc.cm_start.notna() & qc.cm_stop.notna() & (qc.cm_stop > qc.cm_start)
    qc["lo"] = qc.cm_start.where(has, pk - PEAK_CM)
    qc["hi"] = qc.cm_stop.where(has, pk + PEAK_CM)
    for (_, mp, lg), g in qc.groupby(["study", qc.map_name.fillna(""), "linkage_group"]):
        if g.trait_harmonized.nunique() < 2:
            continue
        g = g.assign(grp=intervals_join(g, g.lo, g.hi))
        for _, h in g.groupby("grp"):
            emit("linkage QTL (genetic map)", h, "cM", h.lo.min(), h.hi.max(), h.chromosome.dropna().iloc[0] if h.chromosome.notna().any() else lg,
                 f"{mp} {lg}".strip())
    # 2 GWAS: same SNP, or lead positions within 100 kb
    w = d[(d.record_type == "GWAS") & d.phys_start.notna() & d.chromosome.notna()].copy()
    w["lo"], w["hi"] = w.phys_start - GWAS_BP / 2, w.phys_start + GWAS_BP / 2
    for (_, c, _), g in w.groupby(["study", "chromosome", w.ref_genome.fillna("")]):
        if g.trait_harmonized.nunique() < 2:
            continue
        g = g.assign(grp=intervals_join(g, g.lo, g.hi))
        for _, h in g.groupby("grp"):
            if h.trait_harmonized.nunique() >= 2:
                emit("GWAS signal", h, "bp", h.phys_start.min(), h.phys_start.max(), c, f"{h.ref_genome.iloc[0]}")
    R = pd.DataFrame(regions)
    R.to_csv(f"{T}/multi_trait_qtl.tsv", sep="\t", index=False)
    pd.DataFrame(members).to_csv(f"{T}/multi_trait_qtl_members.tsv", sep="\t", index=False)

    # 3 multi-trait meta-QTL clusters
    m = pd.read_csv(f"{T}/meta_qtl.tsv", sep="\t")
    m = m[m.ci_width_mb <= MAX_CI_MB].copy()
    out = []
    for c, g in m.groupby("chromosome"):
        g = g.assign(grp=intervals_join(g, g.ci_start_mb, g.ci_end_mb))
        for _, h in g.groupby("grp"):
            if h.trait.nunique() < 2:
                continue
            out.append({"chromosome": c, "start_mb": h.ci_start_mb.min(), "end_mb": h.ci_end_mb.max(),
                        "core_start_mb": h.ci_start_mb.max(), "core_end_mb": h.ci_end_mb.min(),
                        "n_traits": h.trait.nunique(), "n_categories": h.category.nunique(),
                        "traits": "; ".join(sorted(set(h.trait))), "categories": "; ".join(sorted(set(h.category))),
                        "n_meta_qtl": len(h), "mqtl_ids": "; ".join(h.mqtl_id), "max_studies_per_mqtl": int(h.n_studies.max()),
                        "n_high_confidence": int((h.confidence == "high").sum()),
                        "hotspots": "; ".join(sorted(set(h.hotspot_id.dropna().astype(str)) - {""})),
                        "recurrent_candidate_genes": "; ".join(sorted({x.strip() for s in h.recurrent_candidate_genes.dropna() for x in str(s).split(";") if x.strip()}))[:500]})
    C = pd.DataFrame(out).sort_values(["n_traits", "n_meta_qtl"], ascending=False).reset_index(drop=True)
    C.insert(0, "mtc_id", [f"MTC{i + 1:04d}" for i in range(len(C))])
    C["span_mb"] = C.end_mb - C.start_mb
    C.to_csv(f"{T}/multi_trait_mqtl_clusters.tsv", sep="\t", index=False)
    import sqlite3
    db = f"{ROOT}/data/processed/cotton_qtl.sqlite"
    if os.path.exists(db):
        with sqlite3.connect(db) as con:
            R.to_sql("multi_trait_qtl", con, index=False, if_exists="replace")
            pd.DataFrame(members).to_sql("multi_trait_qtl_members", con, index=False, if_exists="replace")
            C.to_sql("multi_trait_mqtl_clusters", con, index=False, if_exists="replace")
    print(f"multi-trait QTL: {len(R)} regions ({R.kind.value_counts().to_dict()}), {R.broad.sum()} broad; "
          f"{R.study.nunique()} studies; multi-trait meta-QTL clusters: {len(C)} "
          f"(>=3 traits {(C.n_traits >= 3).sum()}, >=2 categories {(C.n_categories >= 2).sum()})")


if __name__ == "__main__":
    main()
