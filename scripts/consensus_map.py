#!/usr/bin/env python3
"""Consensus genetic map of tetraploid cotton and projection of linkage QTL onto it (classic meta-QTL input).

1. Map units: every linkage group of every CottonGen AD map, and every linkage group of the maps recovered
   from paper supplements. A unit's chromosome comes from CottonGen's standardised label; for paper maps it is
   voted from markers of known chromosome (>= 3 markers, >= 70 % agreement), else read from the label.
2. Consensus per chromosome, built like BioMercator's iterative projection: start from the AD genome-wide
   reference map (2009); repeatedly take the unit sharing most markers with the consensus (>= 3 anchors), orient
   it, drop anchors out of order (longest increasing subsequence), place its new markers by piecewise-linear
   interpolation between anchors (scaled extrapolation beyond the outermost anchors), and add them.
3. QTL projection: a QTL whose map is a projected unit has its support interval and peak projected the same way
   (homothetic projection). Otherwise its peak or flanking markers are placed directly from the consensus. QTL
   without a support interval get the median width of projected intervals (flagged).

Outputs: data/processed/consensus_map.tsv, analysis/tables/qtl_consensus_projection.tsv,
         analysis/tables/consensus_map_units.tsv
Usage: consensus_map.py PROJECT_DIR
"""
import glob
import os
import re
import sys
from bisect import bisect_left

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
import harmonize as H  # noqa: E402

MIN_ANCHORS = 3
REF_MAP = "AD-genome wide Reference Map (2009)"
CHROMS = [f"{g}{i:02d}" for g in "AD" for i in range(1, 14)]


def mkey(m):
    return re.sub(r"\s+", "", str(m)).upper()


def lgkey(lg):
    """'chr19', 'Chr.19', 'c19', 'LG19', 'ch19' -> '19'; keeps fragment suffixes ('19-1')."""
    return re.sub(r"^(chr|ch|c|lg)", "", re.sub(r"[\s._]", "", str(lg).lower()))


def lis_keep(b):
    """Indices of a longest non-decreasing subsequence of b (anchors in consistent order)."""
    tails, tails_i, prev = [], [], [-1] * len(b)
    for i, v in enumerate(b):
        j = bisect_left(tails, v + 1e-9)
        if j == len(tails):
            tails.append(v); tails_i.append(i)
        else:
            tails[j] = v; tails_i[j] = i
        prev[i] = tails_i[j - 1] if j else -1
    out, k = [], tails_i[-1] if tails_i else -1
    while k >= 0:
        out.append(k); k = prev[k]
    return out[::-1]


class Transform:
    """Piecewise-linear map from a unit's cM to consensus cM."""
    def __init__(self, a, b, flip, amax):
        self.a, self.b, self.flip, self.amax = np.asarray(a, float), np.asarray(b, float), flip, amax
        span_a, span_b = self.a[-1] - self.a[0], self.b[-1] - self.b[0]
        self.s = float(np.clip(span_b / span_a, 0.5, 2.0)) if span_a > 0 else 1.0

    def inside(self, x):
        x = self.amax - x if self.flip else x
        return self.a[0] <= x <= self.a[-1]

    def __call__(self, x):
        """Interpolate between anchors; beyond the outermost anchors extend with the map's scale, at most 10 cM."""
        x = np.asarray(x, float)
        x = self.amax - x if self.flip else x
        y = np.interp(x, self.a, self.b)
        y = np.where(x < self.a[0], self.b[0] - np.minimum((self.a[0] - x) * self.s, 10), y)
        return np.where(x > self.a[-1], self.b[-1] + np.minimum((x - self.a[-1]) * self.s, 10), y)


def fit(unit, cons):
    common = [m for m in unit if m in cons]
    if len(common) < MIN_ANCHORS:
        return None
    a = np.array([unit[m] for m in common]); b = np.array([cons[m] for m in common])
    amax = max(unit.values())
    flip = pd.Series(a).corr(pd.Series(b), method="spearman") < 0
    if flip:
        a = amax - a
    o = np.lexsort((b, a)); a, b = a[o], b[o]
    keep = lis_keep(list(b))
    if len(keep) < MIN_ANCHORS:
        return None
    a, b = a[keep], b[keep]
    a, idx = np.unique(a, return_index=True); b = b[idx]
    if len(a) < MIN_ANCHORS:
        return None
    return Transform(a, b, flip, amax), len(common), len(a)


def load_units(proj):
    gm = pd.read_csv(f"{proj}/data/raw/cottongen/maps/cottongen_maps.tsv", sep="\t", dtype=str)
    ad_maps = set(gm.loc[gm["Genome Group"] == "AD", "Map Name"]) | {REF_MAP}   # the reference is filed as "in_silico / other"
    units = {}   # (source, map, lg) -> {"chrom":, "markers": {marker: cM}}
    for f in sorted(glob.glob(f"{proj}/data/raw/cottongen/maps/marker_positions/*.tsv")):
        x = pd.read_csv(f, sep="\t", dtype=str)
        x = x[x["Map"].isin(ad_maps)]
        x["cm"] = pd.to_numeric(x["Map Position (Start)"], errors="coerce")
        x = x[x["cm"].notna()]
        for (mp, lg, slg), g in x.groupby(["Map", "Linkage Group", "Standardized Linkage Group"], dropna=False):
            c = H.std_chromosome(slg) or H.std_chromosome(lg)
            if c in CHROMS:
                units[("CottonGen", mp, str(lg).lower())] = {"chrom": c, "markers": g.groupby(g["Marker Name"].map(mkey))["cm"].mean().to_dict()}
    from extract_literature import _marker_chromosomes
    known = _marker_chromosomes()[0]
    lm = pd.read_csv(f"{proj}/data/literature/extracted/literature_maps.tsv", sep="\t", dtype=str)
    lm["cm"] = pd.to_numeric(lm["position_cm"], errors="coerce")
    lm = lm[lm["cm"].notna()]
    for (tid, lg), g in lm.groupby(["table_id", "linkage_group"], dropna=False):
        mk = g["marker"].map(mkey)
        votes = mk.map(lambda m: known.get(m)).dropna()
        c = ""
        if len(votes) >= 3 and votes.value_counts(normalize=True).iloc[0] >= 0.7:
            c = votes.value_counts().index[0]
        elif re.search(r"[AD]t?[ _.-]?\d", str(lg) + " " + str(g["chromosome"].iloc[0]), re.I):
            c = H.std_chromosome(g["chromosome"].iloc[0]) or H.std_chromosome(lg)
        if c in CHROMS:
            units[("Literature", tid, str(lg).lower())] = {"chrom": c, "markers": g.assign(mk=mk).groupby("mk")["cm"].mean().to_dict(),
                                                           "paper": g["paper_id"].iloc[0]}
    return units


def build_consensus(units):
    cons_rows, transforms, log = [], {}, []
    for c in CHROMS:
        cu = {k: v for k, v in units.items() if v["chrom"] == c}
        ref = [k for k in cu if k[1] == REF_MAP]
        ref = max(ref or cu, key=lambda k: len(cu[k]["markers"]))
        cons = dict(cu[ref]["markers"]); src = {m: ref[1] for m in cons}; nmap = {m: 1 for m in cons}
        transforms[ref] = Transform(sorted(cons.values()), sorted(cons.values()), False, max(cons.values()))
        log.append((c, *ref, "reference", len(cons), len(cons), 0))
        left = {k for k in cu if k != ref}
        while left:
            scored = sorted(((sum(m in cons for m in cu[k]["markers"]), k) for k in left), reverse=True)
            n, k = scored[0]
            if n < MIN_ANCHORS:
                break
            left.discard(k)
            r = fit(cu[k]["markers"], cons)
            if r is None:
                log.append((c, *k, "anchors out of order", n, 0, 0)); continue
            t, n_common, n_used = r
            transforms[k] = t
            # only markers between the outermost anchors are placed: extrapolated ends would stretch the map
            new = [m for m in cu[k]["markers"] if m not in cons and t.inside(cu[k]["markers"][m])]
            pos = t([cu[k]["markers"][m] for m in new]) if new else []
            for m, p in zip(new, pos):
                cons[m] = float(p); src[m] = k[1]; nmap[m] = 1
            for m in cu[k]["markers"]:
                if m not in new:
                    nmap[m] = nmap.get(m, 1) + 1
            log.append((c, *k, "projected", n_common, n_used, len(new)))
        for k in left:
            log.append((c, *k, "too few shared markers", sum(m in cons for m in cu[k]["markers"]), 0, 0))
        lo = min(cons.values())
        cons_rows += [(c, m, round(p - lo, 2), src[m], nmap[m]) for m, p in cons.items()]
        for k in transforms:
            if cu.get(k):
                transforms[k].shift = lo
    cm = pd.DataFrame(cons_rows, columns=["chromosome", "marker", "cM", "first_map", "n_maps"]).sort_values(["chromosome", "cM"])
    lg = pd.DataFrame(log, columns=["chromosome", "source", "map", "linkage_group", "status", "shared_markers", "anchors_used", "markers_added"])
    return cm, transforms, lg


def project_qtl(proj, units, transforms, cm):
    q = pd.read_csv(f"{proj}/data/processed/records_deduplicated.tsv", sep="\t", dtype=str, low_memory=False,
                    usecols=["record_id", "record_type", "source_db", "source_dataset", "map_name", "linkage_group", "chromosome",
                             "cm_start", "cm_stop", "cm_peak", "lead_marker", "flanking_markers", "trait_harmonized",
                             "trait_category", "pmid", "doi", "first_author", "year", "lod", "r2_pct", "qtl_name", "species"])
    q = q[(q.record_type == "QTL") & q.chromosome.isin(CHROMS)].copy()
    for col in ("cm_start", "cm_stop", "cm_peak"):
        q[col] = pd.to_numeric(q[col], errors="coerce")
    cpos = {(r.chromosome, r.marker): r.cM for r in cm.itertuples()}
    by_map = {}
    for k, v in units.items():
        if k in transforms:
            by_map.setdefault((k[0] == "CottonGen" and k[1] or v.get("paper"), v["chrom"]), []).append(k)
    out = []
    for r in q.itertuples():
        unit = None
        for key in ((r.map_name, r.chromosome), (r.source_dataset, r.chromosome)):
            cands = by_map.get(key, [])
            if cands:
                same = [k for k in cands if lgkey(k[2]) == lgkey(r.linkage_group)]
                unit = (same or (cands if len(cands) == 1 else []) or [None])[0]
                if unit:
                    break
        s = e = p = np.nan; how = ""
        vals = [v for v in (r.cm_start, r.cm_stop, r.cm_peak) if v == v]
        if unit and vals:
            t = transforms[unit]
            f = lambda v: float(t([v])[0]) - getattr(t, "shift", 0) if v == v else np.nan  # noqa: E731
            s, e, p = f(r.cm_start), f(r.cm_stop), f(r.cm_peak)
            how = "map projection"
        else:
            mks = [mkey(m) for m in [r.lead_marker] + str(r.flanking_markers).split(";") if m == m and str(m).strip() not in ("", "nan")]
            ps = [cpos[(r.chromosome, m)] for m in mks if (r.chromosome, m) in cpos]
            if ps:
                lead = cpos.get((r.chromosome, mkey(r.lead_marker))) if r.lead_marker == r.lead_marker else None
                s, e = (min(ps), max(ps)) if len(ps) > 1 else (np.nan, np.nan)
                p = lead if lead is not None else float(np.mean(ps))
                how = "marker placement"
        if not how:
            continue
        if s == s and e == e and s > e:
            s, e = e, s
        if p != p:
            p = (s + e) / 2
        out.append((r.record_id, r.trait_harmonized, r.trait_category, r.chromosome,
                    r.pmid if r.pmid == r.pmid else r.source_dataset, s, e, p, how, r.source_db))
    pj = pd.DataFrame(out, columns=["record_id", "trait", "category", "chromosome", "study", "cons_start", "cons_stop",
                                    "cons_peak", "method", "source_db"])
    w = (pj.cons_stop - pj.cons_start)
    med = float(w[(w > 0) & (w < 60)].median())
    pj["ci_imputed"] = ~((w > 0) & (w < 60))
    pj.loc[pj.ci_imputed, "cons_start"] = pj.cons_peak - med / 2
    pj.loc[pj.ci_imputed, "cons_stop"] = pj.cons_peak + med / 2
    print(f"QTL on tetraploid chromosomes: {len(q):,} | projected: {len(pj):,} "
          f"({(pj.method == 'map projection').sum():,} by map, {(pj.method == 'marker placement').sum():,} by markers) | "
          f"CI imputed for {int(pj.ci_imputed.sum()):,} (median width {med:.1f} cM)")
    return pj, len(q), med


def main(proj):
    units = load_units(proj)
    cm, transforms, lg = build_consensus(units)
    os.makedirs(f"{proj}/analysis/tables", exist_ok=True)
    cm.to_csv(f"{proj}/data/processed/consensus_map.tsv", sep="\t", index=False)
    lg.to_csv(f"{proj}/analysis/tables/consensus_map_units.tsv", sep="\t", index=False)
    ln = cm.groupby("chromosome").cM.max()
    print(f"units: {len(units):,} | projected into consensus: {int((lg.status != 'too few shared markers').sum()):,} | "
          f"consensus markers: {len(cm):,} | total length {ln.sum():,.0f} cM (median chromosome {ln.median():.0f} cM)")
    pj, n_q, med = project_qtl(proj, units, transforms, cm)
    pj.to_csv(f"{proj}/analysis/tables/qtl_consensus_projection.tsv", sep="\t", index=False)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
