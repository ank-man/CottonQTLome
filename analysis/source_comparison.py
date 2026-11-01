#!/usr/bin/env python3
"""Compare what each source contributes to the integrated cotton QTLome.

Run after scripts/export_site_data.py (it reads the exported maps/markers tables and adds a
`comparison` block to website/public/data/summary.json).

Usage: source_comparison.py PROJECT_DIR
"""
import json
import shutil
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.colors import LinearSegmentedColormap, LogNorm

INK, MUTED, GRID, SURFACE = "#0b0b0b", "#52514e", "#e4e3df", "#ffffff"
plt.rcParams.update({"font.family": ["Arial", "Helvetica", "DejaVu Sans"], "font.size": 9, "pdf.fonttype": 42, "text.color": INK, "axes.labelcolor": INK,
                     "xtick.color": MUTED, "ytick.color": MUTED, "figure.facecolor": SURFACE, "axes.facecolor": SURFACE,
                     "savefig.facecolor": SURFACE, "axes.titlesize": 10, "axes.titleweight": "bold",
                     "axes.titlelocation": "left", "svg.fonttype": "none", "axes.spines.top": False, "axes.spines.right": False})
SOURCES = ["CottonGen", "GWAS Atlas", "CottonMD", "CottonGVD", "Literature"]
TYPES = ["QTL", "GWAS", "meta-QTL", "epistatic QTL", "QTL cluster", "MTL"]


def main(proj):
    out = f"{proj}/analysis"
    d = pd.read_csv(f"{proj}/data/processed/records_deduplicated.tsv", sep="\t", dtype=str, low_memory=False,
                    usecols=["record_id", "record_type", "source_db", "source_dataset", "trait_harmonized", "trait_category",
                             "species", "pmid", "citation", "locus_cluster_id", "phys_start", "cm_peak", "cm_start"])
    d = d[d["trait_category"] != "unclassified"]
    d["study"] = d["pmid"].fillna("").where(d["pmid"].fillna("") != "", d["source_dataset"].fillna(""))
    d["study"] = d["study"].where(d["study"] != "", d["citation"].fillna("").str[:60])
    maps = pd.read_csv(f"{proj}/website/public/data/maps.csv")
    markers = pd.read_csv(f"{proj}/website/public/data/markers.csv")
    mq = pd.read_csv(f"{out}/tables/meta_qtl.tsv", sep="\t")
    hs = pd.read_csv(f"{out}/tables/hotspots.tsv", sep="\t")

    # ---- per-source contribution
    rows = []
    studies_by = {s: set(d[d.source_db == s]["study"]) for s in SOURCES}
    for s in SOURCES:
        x = d[d.source_db == s]
        others = set().union(*[v for k, v in studies_by.items() if k != s])
        r = {"source": s, **{t: int((x.record_type == t).sum()) for t in TYPES},
             "studies": int(x["study"].nunique()), "traits": int(x["trait_harmonized"].nunique()),
             "species": int(x["species"].nunique()), "unique_studies": int(len(studies_by[s] - others)),
             "with_physical_position": int(x["phys_start"].notna().sum()),
             "with_genetic_position": int((x["cm_peak"].notna() | x["cm_start"].notna()).sum())}
        rows.append(r)
    per = pd.DataFrame(rows)
    per.to_csv(f"{out}/tables/source_comparison.tsv", sep="\t", index=False)

    cg = d[d.source_db == "CottonGen"]
    core = d[d.record_type.isin(["QTL", "GWAS"])]
    db_studies = set().union(*[studies_by[s] for s in SOURCES if s != "Literature"])
    lit_only = studies_by["Literature"] - db_studies
    integrated = [
        {"label": "Linkage QTL", "cottongen": int((cg.record_type == "QTL").sum()), "integrated": int((d.record_type == "QTL").sum())},
        {"label": "GWAS loci", "cottongen": int(cg[cg.record_type == "GWAS"]["locus_cluster_id"].nunique()),
         "integrated": int(d[d.record_type == "GWAS"]["locus_cluster_id"].nunique())},
        {"label": "Studies", "cottongen": int(cg["study"].nunique()), "integrated": int(d["study"].nunique())},
        {"label": "Harmonised traits", "cottongen": int(cg["trait_harmonized"].nunique()), "integrated": int(d["trait_harmonized"].nunique())},
        {"label": "Linkage maps", "cottongen": int((maps.source == "CottonGen").sum()), "integrated": int(len(maps))},
        {"label": "Epistatic pairs", "cottongen": 0, "integrated": int((d.record_type == "epistatic QTL").sum())},
        {"label": "Meta-QTL (computed)", "cottongen": 0, "integrated": int(len(mq))},
        {"label": "Hotspot regions", "cottongen": 0, "integrated": int(len(hs))},
    ]
    comp = {"sources": per.to_dict("records"), "integrated": integrated,
            "studies_total": int(d["study"].nunique()), "studies_literature_only": int(len(lit_only)),
            "records_literature_only": int(d[d["study"].isin(lit_only)].shape[0]),
            "core_records_literature_only": int(core[core["study"].isin(lit_only)].shape[0]),
            "traits_only_via_literature": int(len(set(d[d.source_db == "Literature"]["trait_harmonized"])
                                                  - set(d[d.source_db != "Literature"]["trait_harmonized"])))}
    with open(f"{out}/comparison.json", "w") as fh:
        json.dump(comp, fh, indent=1)

    # ---- Fig 8: content matrix (counts span five orders of magnitude -> shaded table, log scale)
    cols = ["Linkage\nQTL", "GWAS\nassociations", "Meta-QTL", "Epistatic\npairs", "QTL\nclusters", "Qualitative\nloci",
            "Linkage\nmaps", "Trait-linked\nmarkers", "Hotspots", "Studies", "Harmonised\ntraits"]
    mat, labels = [], []
    for s in SOURCES:
        r = per[per.source == s].iloc[0]
        n_maps = int((maps.source == ("CottonGen" if s == "CottonGen" else "Literature supplement")).sum()) if s in ("CottonGen", "Literature") else 0
        n_mk = int(markers.evidence.str.startswith("CottonGen").sum()) if s == "CottonGen" else \
            int(markers.evidence.str.startswith("primer").sum()) if s == "Literature" else 0
        mat.append([r["QTL"], r["GWAS"], r["meta-QTL"], r["epistatic QTL"], r["QTL cluster"], r["MTL"], n_maps, n_mk, 0, r["studies"], r["traits"]])
        labels.append(s if s != "Literature" else "Literature mining\n(this study)")
    mat.append([0, 0, int(len(mq)), 0, 0, 0, 0, 0, int(len(hs)), 0, 0])
    labels.append("Computed\n(this study)")
    tot = [int((d.record_type == "QTL").sum()), int((d.record_type == "GWAS").sum()), int(len(mq)) + int((d.record_type == "meta-QTL").sum()),
           int((d.record_type == "epistatic QTL").sum()), int((d.record_type == "QTL cluster").sum()), int((d.record_type == "MTL").sum()),
           int(len(maps)), int(len(markers)), int(len(hs)), int(d["study"].nunique()), int(d["trait_harmonized"].nunique())]
    mat.append(tot)
    labels.append("CottonQTLome\n(integrated)")
    M = np.array(mat, dtype=float)
    seq = LinearSegmentedColormap.from_list("seq", ["#eef4fc", "#2a78d6", "#0d2f5c"])
    fig, ax = plt.subplots(figsize=(11, 4.4))
    ax.imshow(np.where(M > 0, M, np.nan), cmap=seq, norm=LogNorm(1, M.max()), aspect="auto")
    for i in range(M.shape[0]):
        for j in range(M.shape[1]):
            v = M[i, j]
            ax.text(j, i, f"{int(v):,}" if v > 0 else "–", ha="center", va="center", fontsize=8.5,
                    color="white" if v > 3000 else INK if v > 0 else MUTED, fontweight="bold" if i == M.shape[0] - 1 else "normal")
    ax.set_xticks(range(len(cols)), cols)
    ax.xaxis.tick_top()
    ax.set_yticks(range(len(labels)), labels)
    ax.set_xticks(np.arange(-.5, len(cols)), minor=True)
    ax.set_yticks(np.arange(-.5, len(labels)), minor=True)
    ax.grid(which="minor", color=SURFACE, linewidth=2)
    ax.tick_params(which="both", length=0)
    for sp in ax.spines.values():
        sp.set_visible(False)
    ax.axhline(M.shape[0] - 1.5, color=INK, linewidth=1)
    for ext in ("png", "pdf", "svg"):
        fig.savefig(f"{out}/figures/fig8_source_content_matrix.{ext}", dpi=300, bbox_inches="tight")
    plt.close(fig)

    # ---- Fig 9: studies per source, split into shared and exclusive
    fig, ax = plt.subplots(figsize=(7.2, 2.9))
    y = np.arange(len(SOURCES))[::-1]
    shared = per["studies"] - per["unique_studies"]
    ax.barh(y, shared, color="#2a78d6", height=0.6, label="Also in another source")
    ax.barh(y, per["unique_studies"], left=shared + 1.5, color="#eb6834", height=0.6, label="Only in this source")
    for yi, s, u in zip(y, per["studies"], per["unique_studies"]):
        ax.text(s + 6, yi, f"{s}  ({u} exclusive)", va="center", fontsize=8, color=MUTED)
    ax.set_yticks(y, [s if s != "Literature" else "Literature mining" for s in SOURCES])
    ax.set_xlabel("Studies (publications or panels) contributing records")
    ax.set_xlim(0, per["studies"].max() * 1.45)
    ax.grid(axis="x", color=GRID, linewidth=0.6)
    ax.set_axisbelow(True)
    ax.legend(frameon=False, loc="center right", fontsize=8)
    for ext in ("png", "pdf", "svg"):
        fig.savefig(f"{out}/figures/fig9_studies_by_source.{ext}", dpi=300, bbox_inches="tight")
    plt.close(fig)

    # ---- make the block available to the site
    sj = f"{proj}/website/public/data/summary.json"
    s = json.load(open(sj))
    s["comparison"] = comp
    json.dump(s, open(sj, "w"), indent=1)
    for f in ("fig8_source_content_matrix", "fig9_studies_by_source"):
        for ext in ("png", "svg"):
            shutil.copy(f"{out}/figures/{f}.{ext}", f"{proj}/website/public/figures/")
    print(per.to_string())
    print(json.dumps({k: v for k, v in comp.items() if k != "sources"}, indent=1))


if __name__ == "__main__":
    main(sys.argv[1])
