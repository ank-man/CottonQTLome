#!/usr/bin/env python3
"""Download bundles and the manifest behind the website's Downloads page.

Writes website/public/data/downloads/*.csv.gz (tables not already served as CSV) and
website/public/data/downloads.json: one entry per file with group, title, description, rows, columns and size.
Run after export_site_data.py, export_assemblies.py and the meta-QTL scripts.
Usage: python3 scripts/export_downloads.py
"""
import glob
import gzip
import json
import os

import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = f"{ROOT}/website/public/data"
DL = f"{DATA}/downloads"
RELEASES = "https://github.com/ank-man/CottonQTLome/releases/latest"
os.makedirs(DL, exist_ok=True)


def gz(df, name):
    path = f"{DL}/{name}.csv.gz"
    with gzip.open(path, "wt", newline="") as fh:
        df.to_csv(fh, index=False)
    return f"downloads/{name}.csv.gz"


def tsv(p, **kw):
    return pd.read_csv(f"{ROOT}/{p}", sep="\t", low_memory=False, **kw)


bundles = {}
# all de-duplicated GWAS associations (the site's GWAS table shows loci)
cols = ["record_id", "source_db", "trait_original", "trait_harmonized", "trait_category", "species", "population",
        "environment", "chromosome", "ref_genome", "phys_start", "phys_end", "lead_marker", "candidate_genes", "p_value",
        "neg_log10_p", "r2_pct", "additive_effect", "locus_cluster_id", "pmid", "doi", "year", "first_author", "stat_note"]
dd = tsv("data/processed/records_deduplicated.tsv", dtype=str, usecols=cols + ["record_type"])
bundles["gwas_associations"] = gz(dd[dd.record_type == "GWAS"][cols], "gwas_associations")
# every linkage map in one file
maps = pd.read_csv(f"{DATA}/maps.csv", dtype=str)
parts = []
for mid, name in zip(maps.map_id, maps.name):
    p = f"{DATA}/maps/{mid}.csv"
    if os.path.exists(p):
        parts.append(pd.read_csv(p, dtype=str).assign(map_id=mid, map_name=name))
allmaps = pd.concat(parts, ignore_index=True)
bundles["linkage_maps_all"] = gz(allmaps[["map_id", "map_name"] + [c for c in allmaps.columns if c not in ("map_id", "map_name")]],
                                 "linkage_maps_all")
# meta-QTL members, consensus-map projection, models, trait dictionary, studies, validation
bundles["mqtl_members"] = gz(tsv("analysis/tables/meta_qtl_members.tsv"), "meta_qtl_physical_members")
bundles["mqtl_cm_members"] = gz(tsv("analysis/tables/meta_qtl_cm_members.tsv"), "meta_qtl_genetic_map_members")
bundles["mqtl_models"] = gz(pd.concat([tsv("analysis/tables/meta_qtl_models.tsv").assign(analysis="physical"),
                                       tsv("analysis/tables/meta_qtl_cm_models.tsv").assign(analysis="genetic map")]), "meta_qtl_models")
bundles["projection"] = gz(tsv("analysis/tables/qtl_consensus_projection.tsv"), "qtl_on_consensus_map")
bundles["units"] = gz(tsv("analysis/tables/consensus_map_units.tsv"), "consensus_map_construction")
bundles["traits"] = gz(tsv("data/processed/trait_dictionary.tsv"), "trait_dictionary")
bundles["studies"] = gz(tsv("data/processed/studies.tsv"), "studies")
bundles["validation"] = gz(tsv("analysis/tables/validation_issues.tsv"), "validation_issues")
bundles["windows"] = gz(tsv("analysis/tables/windows_2mb.tsv"), "study_support_2mb_windows")
bundles["mt_members"] = gz(tsv("analysis/tables/multi_trait_qtl_members.tsv"), "multi_trait_qtl_members")
bundles["common_axis"] = gz(tsv("analysis/tables/records_common_axis.tsv"), "records_on_utx_v2_1")

E = []


def add(group, title, path, desc):
    full = f"{DATA}/{path}"
    if not os.path.exists(full):
        print("missing", path); return
    t = pd.read_csv(full, dtype=str, low_memory=False)   # parsed, so quoted line breaks do not inflate the count
    E.append({"group": group, "title": title, "path": path, "description": desc, "rows": len(t),
              "columns": t.shape[1], "bytes": os.path.getsize(full)})


G1, G2, G3, G4, G5 = "Trait loci", "Meta-QTL and hotspots", "Genetic maps and markers", "Traits, studies and literature", "Quality control"
add(G1, "Linkage QTL", "qtl.csv", "De-duplicated linkage-mapping QTL with trait, population, position, LOD, PVE, markers and source.")
add(G1, "GWAS loci", "gwas.csv", "GWAS associations grouped into loci (one row per locus), with lead SNP and strongest P.")
add(G1, "GWAS associations (all)", bundles["gwas_associations"], "Every de-duplicated GWAS association (SNP–trait), with position, P, PVE, candidate genes and source.")
add(G1, "Epistatic QTL pairs", "epistatic.csv", "QTL × QTL interaction pairs with both loci, statistics and source.")
add(G1, "QTL clusters reported by authors", "clusters.csv", "Clusters and pleiotropic regions as labelled in the source tables.")
add(G1, "Multi-trait QTL within studies", "multitrait_qtl.csv", "Overlapping linkage QTL (Mb or cM) and shared GWAS signals (same SNP or within 100 kb) for two or more traits in one study.")
add(G1, "Multi-trait QTL members", bundles["mt_members"], "Which records make up each within-study multi-trait QTL (mt_id, record_id, trait).")
add(G1, "Cloned and validated genes", "cloned_genes.csv", "Genes behind mapped loci (map-based cloning, fine mapping, QTL, GWAS) with validation method, trait, chromosome and paper.")
add(G1, "Qualitative trait loci (MTL)", "mtl.csv", "Mendelian trait loci and gene symbols from CottonGen.")
add(G1, "QTL and GWAS on every assembly", "downloads/qtl_gwas_all_assemblies.csv.gz", "Each placed QTL and GWAS locus with its position converted to every supported genome assembly.")
add(G1, "All loci on TM-1 UTX v2.1", bundles["common_axis"], "Position of every placed record on the common reference, and how it was converted.")
add(G2, "Physical meta-QTL", "mqtl.csv", "Meta-QTL on TM-1 UTX v2.1 (Mb) for each trait: position, 95% CI, studies, evidence, candidate genes, hotspot.")
add(G2, "Physical meta-QTL members", bundles["mqtl_members"], "Which records make up each physical meta-QTL (mqtl_id, record_id).")
add(G2, "Genetic-map meta-QTL", "mqtl_cm.csv", "Classic meta-QTL on the consensus genetic map (cM): position, 95% CI, flanking markers, studies, matching physical meta-QTL.")
add(G2, "Genetic-map meta-QTL members", bundles["mqtl_cm_members"], "Which linkage QTL make up each genetic-map meta-QTL (mqtl_id, record_id).")
add(G2, "Meta-QTL model selection", bundles["mqtl_models"], "Every trait × chromosome model fitted: observations, studies, components chosen by BIC (and AIC for the genetic map).")
add(G2, "Trait coverage of the meta-analyses", "mqtl_trait_coverage.csv", "Every database trait with its records and the outcome of the physical and genetic-map meta-analyses.")
add(G2, "Published meta-QTL", "metaqtl.csv", "Rows from the tables of published cotton meta-analyses (their own consensus maps, cM).")
add(G2, "Multi-trait meta-QTL clusters", "multitrait_mqtl_clusters.csv", "Physical meta-QTL of different traits sharing one core interval on UTX v2.1 (CI <= 5 Mb).")
add(G2, "Hotspots", "hotspots.csv", "Study-supported hotspot regions with traits, studies, example QTL and candidate genes.")
add(G2, "Study support per 2-Mb window", bundles["windows"], "Independent studies, loci and traits in every 2-Mb window, with the permutation q-value.")
add(G3, "Consensus genetic map", "consensus_map.csv", "Consensus map built around the AD genome-wide reference map (2009): marker, chromosome, cM, first map, number of maps.")
add(G3, "Consensus map construction", bundles["units"], "Every linkage group considered: shared markers, anchors used, markers added, or why it was left out.")
add(G3, "QTL on the consensus map", bundles["projection"], "Linkage QTL projected onto the consensus map (cM), with method and whether the interval was imputed.")
add(G3, "Linkage maps (index)", "maps.csv", "All genetic maps: population, parents, marker types, loci, length, source and reference.")
add(G3, "Linkage maps (all loci)", bundles["linkage_maps_all"], "Every marker of every linkage map in one file (map, marker, type, linkage group, chromosome, cM, primers).")
add(G3, "Trait-linked markers", "markers.csv", "Marker–trait links graded by evidence, with primers where known.")
add(G3, "Marker primers", "marker_primers.csv", "Primer sequences collected from CottonGen and mapping papers, by marker.")
add(G4, "Trait dictionary", bundles["traits"], "Original trait names and the harmonised trait and category assigned to each, by source.")
add(G4, "Studies", bundles["studies"], "Studies contributing records, with sources and record counts.")
add(G4, "Literature index", "literature.csv", "Cotton QTL / GWAS papers indexed, with study-type flags and links.")
add(G5, "Validation issues", bundles["validation"], "Every record flagged by the validation checks, with the check and the study.")

full = [{"title": "All records, de-duplicated records, loci, positions on UTX v2.1 (TSV, zipped)", "file": "cottonqtlome_records.zip"},
        {"title": "Records, linkage-map loci and primers extracted from published tables (TSV, zipped)", "file": "cottonqtlome_literature_extracted.zip"},
        {"title": "The whole database as one SQLite file (zipped)", "file": "cotton_qtl_sqlite.zip"}]
json.dump({"files": E, "release": RELEASES, "release_files": full}, open(f"{DATA}/downloads.json", "w"), indent=1)
print(f"{len(E)} downloads; bundles {sum(os.path.getsize(p) for p in glob.glob(f'{DL}/*.gz')) / 1e6:.1f} MB")
