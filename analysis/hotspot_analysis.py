#!/usr/bin/env python3
"""Genome-wide analysis of cotton QTL/GWAS loci: chromosome and subgenome distribution,
trait x chromosome enrichment, study-supported hotspots, homoeolog comparison, effect sizes.

Usage: hotspot_analysis.py PROJECT_DIR
Outputs: analysis/tables/*.tsv, analysis/figures/*.{png,svg}, analysis/insights.json
"""
import json
import os
import re
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy import stats

WINDOW = 2_000_000
N_PERM = 2000
FDR = 0.01
RNG = np.random.default_rng(20261010)

# G. hirsutum TM-1 UTX v2.1 (NCBI GCF_007990345.1) chromosome lengths: the common display axis.
CHR_LEN = {"A01": 119761559, "A02": 108141443, "A03": 113693209, "A04": 89180822, "A05": 111098753,
           "A06": 128195338, "A07": 98902531, "A08": 127495948, "A09": 85335976, "A10": 118182687,
           "A11": 124181751, "A12": 109474314, "A13": 111646624, "D01": 65205008, "D02": 72186496,
           "D03": 54956272, "D04": 58229188, "D05": 66484719, "D06": 66684206, "D07": 59440927,
           "D08": 69427147, "D09": 54445796, "D10": 68089194, "D11": 72823778, "D12": 63255146,
           "D13": 65099798}
CHRS = list(CHR_LEN)

# Reference chart palette (validated categorical order; blue/orange carry the two subgenomes).
INK, MUTED, GRID, SURFACE = "#0b0b0b", "#52514e", "#e4e3df", "#ffffff"
C_A, C_D = "#2a78d6", "#eb6834"
CAT_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"]
plt.rcParams.update({
    "font.family": ["Arial", "Helvetica", "DejaVu Sans"], "font.size": 9, "pdf.fonttype": 42, "axes.edgecolor": MUTED, "axes.labelcolor": INK,
    "text.color": INK, "xtick.color": MUTED, "ytick.color": MUTED, "axes.spines.top": False,
    "axes.spines.right": False, "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.6,
    "axes.axisbelow": True, "figure.facecolor": SURFACE, "axes.facecolor": SURFACE,
    "savefig.facecolor": SURFACE, "axes.titlesize": 10, "axes.titleweight": "bold",
    "axes.titlelocation": "left", "svg.fonttype": "none"})


def save(fig, out, name):
    """Journal figures carry no title: the message goes in the legend text of the manuscript."""
    for a in fig.axes:
        a.set_title("")
    if fig._suptitle is not None:
        fig._suptitle.set_text("")
    for ext in ("png", "pdf", "svg"):
        fig.savefig(f"{out}/figures/{name}.{ext}", dpi=300, bbox_inches="tight")
    plt.close(fig)


def bh(p):
    p = np.asarray(p, float)
    n = len(p)
    order = np.argsort(p)
    q = np.empty(n)
    q[order] = np.minimum.accumulate((p[order] * n / np.arange(1, n + 1))[::-1])[::-1]
    return np.minimum(q, 1)


def load(proj):
    use = ["record_id", "record_type", "source_db", "source_dataset", "qtl_name", "trait_original",
           "trait_harmonized", "trait_category", "species", "genome_group", "chromosome", "ref_genome",
           "phys_start", "phys_end", "lod", "r2_pct", "neg_log10_p", "candidate_genes", "pmid", "citation",
           "year", "locus_cluster_id", "stat_note"]
    d = pd.read_csv(f"{proj}/data/processed/records_deduplicated.tsv", sep="\t", usecols=use,
                    dtype=str, low_memory=False)
    for c in ["phys_start", "phys_end", "lod", "r2_pct", "neg_log10_p"]:
        d[c] = pd.to_numeric(d[c], errors="coerce")
    d = d[d["record_type"].isin(["QTL", "GWAS"]) & (d["genome_group"] == "AD")
          & d["chromosome"].isin(CHRS)].copy()
    d["study"] = d["pmid"].fillna("").where(d["pmid"].fillna("") != "", d["source_dataset"].fillna(""))
    d["study"] = d["study"].where(d["study"] != "", d["citation"].fillna("").str[:60])
    d["subgenome"] = d["chromosome"].str[0].map({"A": "At", "D": "Dt"})
    return d


def common_axis(d):
    """Project physical positions from every assembly onto the UTX v2.1 axis by relative position."""
    p = d[d["phys_start"].notna()].copy()
    p["mid"] = (p["phys_start"] + p["phys_end"]) / 2
    p = p[(p["phys_end"] - p["phys_start"]) <= 20_000_000]
    # coordinates below 100 kb are mostly cM or row numbers mistaken for bp (CottonGVD bins start at 0 legitimately)
    p = p[(p["phys_end"] >= 100_000) | (p["source_db"] == "CottonGVD")]
    utx = p["chromosome"].map(CHR_LEN)
    grp = p.groupby(["ref_genome", "chromosome"])["phys_end"]
    gmax, gn = grp.transform("max"), grp.transform("size")
    ratio = gmax / utx
    # dense groups reach the chromosome ends, so their span estimates that assembly's length
    scaled = (gn >= 30) & ratio.between(0.6, 1.25)
    p["pos"] = np.where(scaled, p["mid"] / gmax * utx, p["mid"])
    p["projection"] = np.where(scaled, "scaled to UTX v2.1 by relative position", "used as reported")
    # Positions aligned to UTX v2.1 through genome anchors (scripts/liftover.py) replace the relative-position
    # estimate wherever the source assembly was available; the rest keep it (marked "approximate" there).
    lifted = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tables", "coordinates_lifted.tsv")
    if os.path.exists(lifted):
        lt = pd.read_csv(lifted, sep="\t", dtype={"record_id": str},
                         usecols=["record_id", "hub_method", "Gh_UTX_v2.1_chr", "Gh_UTX_v2.1_start", "Gh_UTX_v2.1_end"])
        lt = lt[~lt["hub_method"].str.startswith("approximate")].set_index("record_id")
        hit = p["record_id"].isin(lt.index)
        ids = p.loc[hit, "record_id"]
        p.loc[hit, "chromosome"] = lt.loc[ids, "Gh_UTX_v2.1_chr"].values
        p.loc[hit, "pos"] = ((lt.loc[ids, "Gh_UTX_v2.1_start"] + lt.loc[ids, "Gh_UTX_v2.1_end"]) / 2).values
        p.loc[hit, "projection"] = "aligned to UTX v2.1 (" + lt.loc[ids, "hub_method"].values + ")"
        utx = p["chromosome"].map(CHR_LEN)
    p = p[p["pos"].between(0, utx)]          # drops mis-scaled coordinates
    p["window"] = (p["pos"] // WINDOW).astype(int)
    return p


def main(proj):
    out = f"{proj}/analysis"
    d = load(proj)
    ins = {"n_records": int(len(d)), "n_loci": int(d["locus_cluster_id"].nunique()),
           "n_studies": int(d["study"].nunique())}

    # ---------------------------------------------------------------- 1. chromosomes / subgenomes
    loci = d.drop_duplicates("locus_cluster_id")
    per_chr = pd.DataFrame({
        "length_mb": pd.Series(CHR_LEN) / 1e6,
        "loci": loci.groupby("chromosome").size(),
        "qtl_loci": loci[loci.record_type == "QTL"].groupby("chromosome").size(),
        "gwas_loci": loci[loci.record_type == "GWAS"].groupby("chromosome").size(),
        "studies": d.groupby("chromosome")["study"].nunique(),
        "traits": d.groupby("chromosome")["trait_harmonized"].nunique(),
    }).fillna(0).loc[CHRS]
    per_chr["loci_per_mb"] = per_chr["loci"] / per_chr["length_mb"]
    per_chr.index.name = "chromosome"
    per_chr.to_csv(f"{out}/tables/per_chromosome.tsv", sep="\t")

    # subgenome bias: unit = study x trait x chromosome (one vote per study), tested against
    # equal chromosome numbers (13 vs 13) and against physical length
    votes = d.drop_duplicates(["study", "trait_harmonized", "chromosome"])
    len_a = sum(v for k, v in CHR_LEN.items() if k[0] == "A")
    frac_a_len = len_a / sum(CHR_LEN.values())
    rows = []
    cats = ["all"] + [c for c in votes["trait_category"].value_counts().index if c != "unclassified"]
    for cat in cats:
        v = votes if cat == "all" else votes[votes.trait_category == cat]
        a, dd = int((v.subgenome == "At").sum()), int((v.subgenome == "Dt").sum())
        if a + dd < 30:
            continue
        rows.append({"trait_category": cat, "At": a, "Dt": dd, "frac_Dt": dd / (a + dd),
                     "p_vs_equal": stats.binomtest(dd, a + dd, 0.5).pvalue,
                     "p_vs_length": stats.binomtest(dd, a + dd, 1 - frac_a_len).pvalue})
    sub = pd.DataFrame(rows)
    sub["q_vs_equal"], sub["q_vs_length"] = bh(sub["p_vs_equal"]), bh(sub["p_vs_length"])
    sub.to_csv(f"{out}/tables/subgenome_bias.tsv", sep="\t", index=False)
    ins["subgenome"] = {"frac_Dt_length": 1 - frac_a_len, **sub.iloc[0].to_dict()}

    # ---------------------------------------------------------------- 2. trait x chromosome enrichment
    top = [c for c in votes["trait_category"].value_counts().index if c != "unclassified"][:8]
    tab = pd.crosstab(votes[votes.trait_category.isin(top)]["trait_category"],
                      votes[votes.trait_category.isin(top)]["chromosome"]).reindex(index=top, columns=CHRS, fill_value=0)
    chi2, pval, dof, exp = stats.chi2_contingency(tab.values)
    resid = (tab.values - exp) / np.sqrt(exp * (1 - tab.sum(axis=1).values[:, None] / tab.values.sum())
                                         * (1 - tab.sum(axis=0).values[None, :] / tab.values.sum()))
    resid = pd.DataFrame(resid, index=top, columns=CHRS)
    tab.to_csv(f"{out}/tables/trait_by_chromosome_counts.tsv", sep="\t")
    resid.to_csv(f"{out}/tables/trait_by_chromosome_residuals.tsv", sep="\t")
    pcell = 2 * stats.norm.sf(np.abs(resid.values))
    qcell = bh(pcell.ravel()).reshape(pcell.shape)
    enr = [{"trait_category": top[i], "chromosome": CHRS[j], "observed": int(tab.values[i, j]),
            "expected": float(exp[i, j]), "residual": float(resid.values[i, j]), "q": float(qcell[i, j])}
           for i in range(len(top)) for j in range(len(CHRS)) if qcell[i, j] < 0.05 and resid.values[i, j] > 0]
    enr = sorted(enr, key=lambda x: -x["residual"])
    pd.DataFrame(enr).to_csv(f"{out}/tables/trait_chromosome_enrichment.tsv", sep="\t", index=False)
    ins["trait_chr"] = {"chi2": float(chi2), "dof": int(dof), "p": float(pval), "top": enr[:10]}

    # ---------------------------------------------------------------- 3. hotspots on a common axis
    p = common_axis(d)
    offsets, n_win = {}, 0
    for c in CHRS:
        offsets[c] = n_win
        n_win += int(np.ceil(CHR_LEN[c] / WINDOW))
    p["gw"] = p["chromosome"].map(offsets) + p["window"]
    occ = p.drop_duplicates(["study", "gw"])
    obs = np.bincount(occ["gw"], minlength=n_win)
    k = occ.groupby("study").size().clip(upper=n_win).values
    null = np.zeros((N_PERM, n_win), dtype=np.int32)
    for i in range(N_PERM):          # each study keeps its number of occupied windows, placed uniformly
        for ks in k:
            null[i, RNG.choice(n_win, ks, replace=False)] += 1
    null_sorted = np.sort(null.ravel())
    pvals = (len(null_sorted) - np.searchsorted(null_sorted, obs, side="left") + 1) / (len(null_sorted) + 1)
    qvals = bh(pvals)
    thr = int(obs[qvals < FDR].min()) if (qvals < FDR).any() else None
    win = pd.DataFrame({"gw": np.arange(n_win), "n_studies": obs, "p": pvals, "q": qvals})
    win["chromosome"] = np.repeat(CHRS, [int(np.ceil(CHR_LEN[c] / WINDOW)) for c in CHRS])
    win["start"] = (win["gw"] - win["chromosome"].map(offsets)) * WINDOW
    win["end"] = np.minimum(win["start"] + WINDOW, win["chromosome"].map(CHR_LEN))
    g = p.groupby("gw")
    win["n_loci"] = g["locus_cluster_id"].nunique().reindex(win["gw"]).fillna(0).astype(int).values
    win["n_traits"] = g["trait_harmonized"].nunique().reindex(win["gw"]).fillna(0).astype(int).values
    win["significant"] = win["q"] < FDR
    win.to_csv(f"{out}/tables/windows_2mb.tsv", sep="\t", index=False)

    # merge adjacent significant windows into hotspot regions
    sig = win[win["significant"]].copy()
    sig["block"] = ((sig["chromosome"] != sig["chromosome"].shift()) | (sig["gw"] - sig["gw"].shift() > 1)).cumsum()
    hs = []
    for _, b in sig.groupby("block"):
        recs = p[p["gw"].between(b["gw"].min(), b["gw"].max())]
        known = recs[recs.trait_category != "unclassified"]
        tc = known.drop_duplicates(["study", "trait_harmonized"])["trait_harmonized"].value_counts()
        cc = known.drop_duplicates(["study", "trait_category"])["trait_category"].value_counts()
        genes = pd.Series([x.strip() for v in recs["candidate_genes"].dropna() for x in re.split(r"[;,]", v)
                           if re.match(r"G[hboa]\w*[_.]?[AD]\d\dG\d+", x.strip())]).value_counts()
        names = recs[recs.record_type == "QTL"]["qtl_name"].dropna()
        names = names[names.str.match(r"^q[A-Za-z]")].drop_duplicates()
        hs.append({
            "chromosome": b["chromosome"].iloc[0], "start": int(b["start"].min()), "end": int(b["end"].max()),
            "size_mb": (b["end"].max() - b["start"].min()) / 1e6, "n_studies": int(recs["study"].nunique()),
            "peak_window_studies": int(b["n_studies"].max()), "min_q": float(b["q"].min()),
            "n_loci": int(recs["locus_cluster_id"].nunique()), "n_records": int(len(recs)),
            "n_qtl_records": int((recs.record_type == "QTL").sum()), "n_gwas_records": int((recs.record_type == "GWAS").sum()),
            "n_traits": int(known["trait_harmonized"].nunique()), "n_trait_categories": int(known["trait_category"].nunique()),
            "top_traits": "; ".join(f"{t} ({n})" for t, n in tc.head(6).items()),
            "trait_categories": "; ".join(f"{t} ({n})" for t, n in cc.items()),
            "dominant_category": cc.index[0] if len(cc) else "",
            "species": "; ".join(sorted(recs["species"].dropna().unique()))[:200],
            "sources": "; ".join(sorted(recs["source_db"].dropna().unique())) if "source_db" in recs else "",
            "example_qtl": "; ".join(names.head(8)), "recurrent_candidate_genes": "; ".join(genes.head(6).index),
            "pmids": "; ".join(sorted({x for x in recs["pmid"].dropna() if x}))[:600],
        })
    hs = pd.DataFrame(hs).sort_values(["peak_window_studies", "n_studies"], ascending=False).reset_index(drop=True)
    hs.insert(0, "hotspot_id", ["CHS" + str(i + 1).zfill(3) for i in range(len(hs))])
    hs.to_csv(f"{out}/tables/hotspots.tsv", sep="\t", index=False)
    p[["record_id", "chromosome", "pos", "projection", "study", "trait_harmonized", "trait_category", "record_type"]] \
        .to_csv(f"{out}/tables/records_common_axis.tsv", sep="\t", index=False)
    ins["hotspots"] = {
        "window_mb": WINDOW / 1e6, "n_windows": int(n_win), "records_placed": int(len(p)),
        "studies_placed": int(p["study"].nunique()), "threshold_studies": thr, "fdr": FDR,
        "n_sig_windows": int(win["significant"].sum()), "n_hotspots": int(len(hs)),
        "genome_fraction": float((sig["end"] - sig["start"]).sum() / sum(CHR_LEN.values())),
        "fraction_loci_in_hotspots": float(p[p["gw"].isin(sig["gw"])]["locus_cluster_id"].nunique() / p["locus_cluster_id"].nunique()),
        "hotspots_At": int((hs.chromosome.str[0] == "A").sum()), "hotspots_Dt": int((hs.chromosome.str[0] == "D").sum()),
        "null_mean": float(null.mean()), "null_p99": float(np.percentile(null, 99)),
        "projection": p["projection"].value_counts().to_dict(), "top": hs.head(12).to_dict("records")}

    # position along the chromosome: are hotspots distal?
    win["rel"] = ((win["start"] + win["end"]) / 2) / win["chromosome"].map(CHR_LEN)
    win["dist_to_end"] = np.minimum(win["rel"], 1 - win["rel"])
    rho, prho = stats.spearmanr(win["dist_to_end"], win["n_studies"])
    ins["distal"] = {"spearman_rho": float(rho), "p": float(prho),
                     "mean_studies_distal20": float(win[win.dist_to_end < 0.2]["n_studies"].mean()),
                     "mean_studies_central": float(win[win.dist_to_end >= 0.2]["n_studies"].mean())}

    # ---------------------------------------------------------------- 4. homoeologous chromosomes
    nb = 20
    prof = {}
    for c in CHRS:
        x = occ[occ.chromosome == c]
        rel = np.clip(p.loc[x.index, "pos"] / CHR_LEN[c], 0, 0.999999)
        prof[c] = np.bincount((rel * nb).astype(int), minlength=nb)
    homo = [stats.spearmanr(prof[f"A{i:02d}"], prof[f"D{i:02d}"])[0] for i in range(1, 14)]
    non = [stats.spearmanr(prof[f"A{i:02d}"], prof[f"D{j:02d}"])[0] for i in range(1, 14) for j in range(1, 14) if i != j]
    u, pu = stats.mannwhitneyu(homo, non, alternative="greater")
    pd.DataFrame({"pair": [f"A{i:02d}-D{i:02d}" for i in range(1, 14)], "spearman_rho": homo}) \
        .to_csv(f"{out}/tables/homoeolog_profile_correlation.tsv", sep="\t", index=False)
    ins["homoeolog"] = {"median_rho_homoeologous": float(np.median(homo)), "median_rho_other": float(np.median(non)),
                        "mannwhitney_p": float(pu), "note": "relative-position bins; ignores known A/D translocations"}

    # ---------------------------------------------------------------- 5. effect sizes of linkage QTL
    q = d[(d.record_type == "QTL") & d["r2_pct"].notna()].copy()
    mx = q.groupby("source_dataset")["r2_pct"].transform("max")
    q["pve"] = np.where(mx <= 1.0, q["r2_pct"] * 100, q["r2_pct"])   # datasets reporting fractions
    q = q[(q["pve"] > 0) & (q["pve"] <= 100)]
    eff = q[q.trait_category != "unclassified"].groupby("trait_category")["pve"].agg(
        n="size", median="median", frac_major=lambda s: float((s >= 10).mean()),
        frac_large=lambda s: float((s >= 20).mean())).sort_values("n", ascending=False)
    eff = eff[eff["n"] >= 100]
    eff.to_csv(f"{out}/tables/qtl_effect_sizes.tsv", sep="\t")
    ins["effects"] = {"n": int(len(q)), "median_pve": float(q["pve"].median()),
                      "frac_ge10": float((q["pve"] >= 10).mean()), "frac_ge20": float((q["pve"] >= 20).mean())}

    # ---------------------------------------------------------------- 6. literature over time
    lit = pd.read_csv(f"{proj}/data/literature/literature_index.tsv", sep="\t", dtype=str).fillna("")
    lit = lit[lit.year.str.fullmatch(r"\d{4}")]
    lit["year"] = lit.year.astype(int)
    lit = lit[lit.year.between(1994, 2025)]
    ty = pd.DataFrame({"Linkage QTL": lit[lit.is_qtl_linkage == "1"].groupby("year").size(),
                       "GWAS": lit[lit.is_gwas == "1"].groupby("year").size(),
                       "Meta-QTL / epistasis": lit[(lit.is_meta_qtl == "1") | (lit.is_epistasis == "1")].groupby("year").size()}
                      ).reindex(range(1994, 2026)).fillna(0).astype(int)
    ty.index.name = "year"
    ty.to_csv(f"{out}/tables/papers_per_year.tsv", sep="\t")
    ins["literature"] = {"last_year": int(ty.index[-1]), "gwas_last": int(ty["GWAS"].iloc[-1]),
                         "linkage_last": int(ty["Linkage QTL"].iloc[-1]), "gwas_2015": int(ty.loc[2015, "GWAS"]),
                         "linkage_2015": int(ty.loc[2015, "Linkage QTL"])}

    # ================================================================ figures
    # Fig 1: loci per chromosome (density per Mb), At vs Dt
    fig, ax = plt.subplots(figsize=(9.5, 3.4))
    x = np.arange(26)
    cols = [C_A if c[0] == "A" else C_D for c in CHRS]
    ax.bar(x, per_chr["loci_per_mb"], color=cols, width=0.72)
    ax.set_xticks(x, CHRS, rotation=60, ha="right")
    ax.set_ylabel("Loci per Mb")
    ax.set_title("Dt chromosomes carry more reported loci per megabase than At chromosomes")
    ax.grid(axis="x", visible=False)
    ax.legend(handles=[plt.Rectangle((0, 0), 1, 1, color=C_A), plt.Rectangle((0, 0), 1, 1, color=C_D)],
              labels=["At subgenome", "Dt subgenome"], frameon=False, loc="upper left", ncols=2)
    save(fig, out, "fig1_loci_density_per_chromosome")

    # Fig 2: trait x chromosome residual heatmap (diverging, neutral midpoint)
    from matplotlib.colors import LinearSegmentedColormap, TwoSlopeNorm
    cmap = LinearSegmentedColormap.from_list("div", ["#2a78d6", "#f0efec", "#e34948"])
    fig, ax = plt.subplots(figsize=(10.5, 3.6))
    lim = float(np.ceil(np.abs(resid.values).max()))
    im = ax.imshow(resid.values, cmap=cmap, norm=TwoSlopeNorm(0, -lim, lim), aspect="auto")
    ax.set_xticks(range(26), CHRS, rotation=60, ha="right")
    ax.set_yticks(range(len(top)), top)
    ax.grid(False)
    for i in range(len(top)):
        for j in range(26):
            if qcell[i, j] < 0.05:
                ax.text(j, i, "•", ha="center", va="center", color=INK, fontsize=9)
    ax.set_xticks(np.arange(-.5, 26), minor=True)
    ax.set_yticks(np.arange(-.5, len(top)), minor=True)
    ax.grid(which="minor", color=SURFACE, linewidth=2)
    ax.tick_params(which="both", length=0)
    for s in ax.spines.values():
        s.set_visible(False)
    cb = fig.colorbar(im, ax=ax, fraction=0.025, pad=0.015)
    cb.set_label("Adjusted residual\n(fewer ← expected → more)", fontsize=8)
    cb.outline.set_visible(False)
    n_enr = int((qcell < 0.05).sum())
    ax.set_title(f"Trait categories differ across chromosomes ({n_enr} cells at FDR < 0.05, marked •)" if n_enr else
                 "No chromosome is significantly enriched for any trait category (FDR < 0.05)")
    save(fig, out, "fig2_trait_by_chromosome_enrichment")

    # Fig 3: genome-wide study support per 2-Mb window with hotspot threshold
    fig, ax = plt.subplots(figsize=(11, 3.6))
    bounds = [offsets[c] for c in CHRS] + [n_win]
    for i, c in enumerate(CHRS):
        w = win[win.chromosome == c]
        ax.bar(w["gw"], w["n_studies"], width=1.0, color=C_A if c[0] == "A" else C_D, linewidth=0,
               alpha=1.0 if i % 2 == 0 else 0.62)
    if thr:
        ax.axhline(thr, color=INK, linewidth=0.9, linestyle=(0, (4, 3)))
        ax.text(n_win, thr, f" FDR {FDR:g}\n (≥{thr} studies)", va="center", ha="left", fontsize=7.5, color=MUTED)
    ax.set_xticks([(bounds[i] + bounds[i + 1]) / 2 for i in range(26)], CHRS, rotation=60, ha="right")
    ax.set_xlim(0, n_win)
    ax.set_ylabel("Independent studies per 2-Mb window")
    ax.grid(axis="x", visible=False)
    lab = hs.head(8).assign(xm=lambda t: [offsets[c] + (a + b) / 2 / WINDOW for c, a, b in
                                          zip(t.chromosome, t.start, t.end)]).sort_values("xm")
    last_x, level = -1e9, 0
    for _, h in lab.iterrows():
        level = level + 1 if h.xm - last_x < 25 else 0      # stagger labels of neighbouring hotspots
        last_x = h.xm
        ax.annotate(h.hotspot_id, (h.xm, h.peak_window_studies), xytext=(0, 4 + 9 * level), textcoords="offset points",
                    ha="center", fontsize=7, color=INK,
                    arrowprops=dict(arrowstyle="-", color=MUTED, lw=0.5) if level else None)
    ax.set_title(f"{len(hs)} hotspot regions are supported by more independent studies than expected by chance")
    ax.legend(handles=[plt.Rectangle((0, 0), 1, 1, color=C_A), plt.Rectangle((0, 0), 1, 1, color=C_D)],
              labels=["At subgenome", "Dt subgenome"], frameon=False, loc="upper left", ncols=2)
    save(fig, out, "fig3_genomewide_hotspots")

    # Fig 4: karyotype of hotspots (sequential single hue = study support)
    from matplotlib.cm import ScalarMappable
    from matplotlib.colors import Normalize
    seq = LinearSegmentedColormap.from_list("seq", ["#dce9f8", "#2a78d6", "#0d2f5c"])
    fig, ax = plt.subplots(figsize=(11, 4.6))
    vmax = max(int(win["n_studies"].max()), 1)
    for i, c in enumerate(CHRS):
        w = win[win.chromosome == c]
        ax.bar(np.full(len(w), i), (w["end"] - w["start"]) / 1e6, bottom=w["start"] / 1e6, width=0.5,
               color=seq(Normalize(0, vmax)(w["n_studies"])), linewidth=0)
        ax.add_patch(plt.Rectangle((i - 0.25, 0), 0.5, CHR_LEN[c] / 1e6, fill=False, edgecolor=MUTED, linewidth=0.6))
        for _, h in hs[hs.chromosome == c].iterrows():
            ax.plot([i + 0.33, i + 0.33], [h.start / 1e6, h.end / 1e6], color="#e34948", linewidth=2.4, solid_capstyle="butt")
    ax.set_xticks(range(26), CHRS, rotation=60, ha="right")
    ax.set_ylabel("Position (Mb, TM-1 UTX v2.1 axis)")
    ax.invert_yaxis()
    ax.grid(False)
    ax.spines["bottom"].set_visible(False)
    ax.tick_params(axis="x", length=0)
    cb = fig.colorbar(ScalarMappable(Normalize(0, vmax), seq), ax=ax, fraction=0.02, pad=0.01)
    cb.set_label("Independent studies per 2-Mb window", fontsize=8)
    cb.outline.set_visible(False)
    ax.plot([], [], color="#e34948", linewidth=2.4, label="Hotspot region (FDR < 0.01)")
    ax.legend(frameon=False, loc="lower right", bbox_to_anchor=(1.0, 0.0))
    ax.set_title("Hotspots concentrate toward chromosome ends on both subgenomes")
    save(fig, out, "fig4_hotspot_karyotype")

    # Fig 5: subgenome share per trait category
    s2 = sub.sort_values("frac_Dt")
    fig, ax = plt.subplots(figsize=(7.2, 3.6))
    ax.barh(s2["trait_category"], s2["frac_Dt"] * 100, color=C_D, height=0.62)
    ax.axvline(50, color=MUTED, linewidth=0.9, label="Equal share (13 of 26 chromosomes)")
    ax.axvline((1 - frac_a_len) * 100, color=INK, linewidth=0.9, linestyle=(0, (4, 3)),
               label=f"Dt share of assembled length ({(1 - frac_a_len) * 100:.1f}%)")
    ax.legend(frameon=False, loc="upper center", bbox_to_anchor=(0.5, -0.2), ncol=2, fontsize=7.5)
    for y, (f, n) in enumerate(zip(s2["frac_Dt"], s2["At"] + s2["Dt"])):
        ax.text(f * 100 + 0.6, y, f"{f * 100:.0f}%  (n={n:,})", va="center", fontsize=7.5, color=MUTED)
    ax.set_xlim(0, 75)
    ax.set_xlabel("Share of study-level loci on the Dt subgenome (%)")
    ax.grid(axis="y", visible=False)
    ax.set_title("The smaller Dt subgenome holds about half of all reported loci")
    save(fig, out, "fig5_subgenome_share_by_trait")

    # Fig 6: papers per year
    fig, ax = plt.subplots(figsize=(7.6, 3.2))
    for (name, col) in zip(ty.columns, CAT_COLORS[:3]):
        ax.plot(ty.index, ty[name], color=col, linewidth=2)
        ax.text(ty.index[-1] + 0.3, ty[name].iloc[-1], name, color=INK, fontsize=8, va="center")
    ax.set_xlim(1994, 2031)
    ax.set_ylabel("Papers per year")
    ax.grid(axis="x", visible=False)
    ax.set_title(f"GWAS papers have nearly caught up with linkage-mapping papers "
                 f"({ty['GWAS'].iloc[-1]} vs {ty['Linkage QTL'].iloc[-1]} in {ty.index[-1]})")
    save(fig, out, "fig6_papers_per_year")

    # Fig 7: effect sizes
    fig, ax = plt.subplots(figsize=(7.2, 3.2))
    bins = np.arange(0, 62, 2)
    ax.hist(np.clip(q["pve"], 0, 60), bins=bins, color=C_A, edgecolor=SURFACE, linewidth=0.8)
    ax.axvline(10, color=INK, linewidth=0.9, linestyle=(0, (4, 3)))
    ax.text(10.6, ax.get_ylim()[1] * 0.92, "10% (major-effect convention)", fontsize=7.5, color=MUTED)
    ax.set_xlabel("Phenotypic variance explained per linkage QTL (%, values above 60 pooled)")
    ax.set_ylabel("QTL records")
    ax.grid(axis="x", visible=False)
    ax.set_title(f"Most linkage QTL are small: median PVE {q['pve'].median():.1f}%")
    save(fig, out, "fig7_qtl_effect_sizes")

    with open(f"{out}/insights.json", "w") as fh:
        json.dump(ins, fh, indent=1, default=float)
    print(json.dumps({k: v for k, v in ins.items() if k not in ("hotspots", "trait_chr")}, indent=1, default=float))
    print("hotspots:", {k: v for k, v in ins["hotspots"].items() if k != "top"})
    print(hs.head(15)[["hotspot_id", "chromosome", "start", "end", "peak_window_studies", "n_studies", "n_loci", "n_traits", "top_traits"]].to_string())
    print(pd.DataFrame(enr[:8]).to_string())
    print(sub.to_string()); print(eff.to_string()); print(per_chr.to_string())


if __name__ == "__main__":
    main(sys.argv[1])
