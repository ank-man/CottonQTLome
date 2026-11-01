#!/usr/bin/env python3
"""Merge every collected source into one harmonised cotton QTL/GWAS table and resolve redundancy.

Inputs  : data/raw/* (database exports) and data/literature/extracted/literature_records.tsv
Outputs : data/processed/*.tsv and data/processed/cotton_qtl.sqlite

Redundancy is handled in three explicit layers (nothing is deleted, only flagged):
  1. within-source row expansion is collapsed to one record per source identifier;
  2. duplicate_of     - the same result reported by several sources / tables
                        (same study or panel, same trait, same position and statistics);
  3. locus_cluster_id - different records for the same harmonised trait that co-localise
                        (physical: same assembly + chromosome, intervals within CLUSTER_BP;
                         genetic: same map + linkage group, intervals within CLUSTER_CM).

Usage: build_database.py PROJECT_DIR
"""
import glob
import os
import re
import sqlite3
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harmonize as H  # noqa: E402

CLUSTER_BP = 500_000
CLUSTER_CM = 5.0
HOTSPOT_BP = 500_000
GVD_MIN_LOGP = 6.0
SOURCE_PRIORITY = ["CottonGen", "Literature", "GWAS Atlas", "CottonMD", "CottonGVD"]
MAX_CLUSTER_INTERVAL_BP = 10_000_000  # wider intervals are kept as their own locus so they cannot chain neighbours
PVE_FRACTION_MIN_ROWS = 5             # a table/dataset whose PVE values are all <= 1 reports fractions, not %

# Papers returned by the literature search that are not about cotton (checked by hand). Excluded from the database.
EXCLUDE_PMIDS = {
    "37534296": "maize study (Aspergillus flavus resistance meta-analysis), not cotton",
    "21044310": "Arabidopsis thaliana study (Verticillium), not cotton",
    "31500566": "jute (Corchorus) study, not cotton",
    "39879173": "Helicoverpa armigera (insect) study, not cotton",
    "26679476": "rapeseed heterosis study, not cotton",
}
# Tables whose columns were mapped wrongly by the extractor (checked against the source file).
EXCLUDE_TABLES = {
    "PMC8793229|supplementary/12870_2022_3443_MOESM1_ESM.xlsx|Table S4":
        "summary table: SNP counts read as -log10(P), trait codes read as markers, no positions",
    "PMC9168987|Table 1":
        "linkage-disequilibrium table of SSR marker pairs, not QTL",
    "10.1002_csc2.20937|csc220937-sup-0001-tabless2-s10.xlsx|Supp Table 2":
        "re-export of CottonGen QTL (duplicates CottonGen); Start/Stop are cM but were read as Mb",
}
# Trait codes a paper defines in its text (key: source_dataset, trait_original).
TRAIT_OVERRIDES = {
    ("PMC9046884", "O"): "kernel oil content",
}

COLS = ["record_id", "record_type", "record_subtype", "source_db", "source_dataset", "source_record_id",
        "qtl_name", "trait_original", "trait_harmonized", "trait_category", "species", "genome_group",
        "population", "maternal_parent", "paternal_parent", "sample_size", "environment",
        "chromosome", "ref_genome", "seqid", "phys_start", "phys_end",
        "map_name", "linkage_group", "cm_start", "cm_stop", "cm_peak",
        "lead_marker", "flanking_markers", "candidate_genes",
        "p_value", "neg_log10_p", "lod", "r2_pct", "additive_effect", "stat_note",
        "partner_locus", "partner_chromosome", "partner_pos_bp", "partner_cm", "partner_marker",
        "pmid", "doi", "year", "first_author", "citation", "n_source_rows"]


def join_unique(values):
    seen = []
    for v in values:
        if isinstance(v, str) and v.strip() and v not in seen:
            seen.append(v)
    return "; ".join(seen)


def norm_title(t):
    return re.sub(r"[^a-z0-9]+", " ", str(t).lower()).strip()


def to_num(s):
    return pd.to_numeric(s, errors="coerce")


# ----------------------------------------------------------------------------- sources
def load_cottongen(proj, lit):
    raw = pd.read_csv(f"{proj}/data/raw/cottongen/megasearch/cottongen_megasearch_ALL.tsv",
                      sep="\t", dtype=str, low_memory=False)
    multi = ["GWAS Marker", "Gene", "Genome", "Standardized chromosome", "Location", "Map",
             "Standardized Linkage Group", "Linkage Group", "Start (cM)", "Stop (cM)", "QTL Peak",
             "Colocalizing Marker", "Neighboring Marker", "Population/GWAS panel",
             "Maternal Parent", "Paternal Parent", "Citation", "Dataset", "Published Symbol",
             "Trait Name", "Trait Category", "P value", "LOD", "R2"]
    # Layer 1: CottonGen repeats a label once per marker / alignment / citation.
    g = raw.groupby("QTL/GWAS Label", sort=False)
    d = g.agg({**{c: "first" for c in ["Organism", "Genome Group", "Type"]},
               **{c: join_unique for c in multi}})
    d["n_source_rows"] = g.size()
    d = d.reset_index()

    first = lambda s: s.str.split("; ").str[0]  # noqa: E731
    out = pd.DataFrame({
        "record_type": d["Type"].map({"QTL": "QTL", "GWAS": "GWAS", "MTL": "MTL"}),
        "source_db": "CottonGen", "source_dataset": d["Dataset"], "source_record_id": d["QTL/GWAS Label"],
        "qtl_name": d["Published Symbol"].where(d["Published Symbol"] != "", d["QTL/GWAS Label"]),
        "trait_original": first(d["Trait Name"]), "species": d["Organism"], "genome_group": d["Genome Group"],
        "population": d["Population/GWAS panel"], "maternal_parent": d["Maternal Parent"],
        "paternal_parent": d["Paternal Parent"], "ref_genome": first(d["Genome"]),
        "map_name": first(d["Map"]), "linkage_group": first(d["Linkage Group"]),
        "cm_start": to_num(first(d["Start (cM)"])), "cm_stop": to_num(first(d["Stop (cM)"])),
        "cm_peak": to_num(first(d["QTL Peak"])),
        "lead_marker": d["GWAS Marker"].where(d["GWAS Marker"] != "", d["Colocalizing Marker"]),
        "flanking_markers": d["Neighboring Marker"], "candidate_genes": d["Gene"],
        "p_value": to_num(first(d["P value"])), "lod": to_num(first(d["LOD"])),
        "r2_pct": to_num(first(d["R2"])), "citation": d["Citation"], "n_source_rows": d["n_source_rows"],
    })
    cat = first(d["Trait Category"])
    hz = [H.harmonise_trait(t, c) for t, c in zip(out["trait_original"], cat)]
    out["trait_harmonized"], out["trait_category"] = [x[0] for x in hz], [x[1] for x in hz]
    loc = [H.parse_location(x.split("; ")[0]) for x in d["Location"]]
    out["seqid"] = [x[0] for x in loc]
    out["phys_start"] = [x[1] for x in loc]
    out["phys_end"] = [x[2] for x in loc]
    chrom = first(d["Standardized chromosome"]).map(H.std_chromosome)
    lg = first(d["Standardized Linkage Group"]).map(H.std_chromosome)
    out["chromosome"] = chrom.where(chrom != "", lg)
    out["record_subtype"] = np.where(out["qtl_name"].str.contains(r"QEI|QTL ?[x×] ?E", regex=True, na=False),
                                     "QTL x environment", "")
    # Some CottonGen GWAS datasets carry values in the P-value field that are not p-values.
    med = out[out.record_type == "GWAS"].groupby("source_dataset")["p_value"].median()
    bad = set(med[med > 0.05].index)
    out["stat_note"] = np.where(out["source_dataset"].isin(bad) & (out["record_type"] == "GWAS"),
                                "p_value field as exported by CottonGen is not a valid p-value for this "
                                "dataset (values ~0.65-1.5); see original paper", "")
    out.loc[out["stat_note"] != "", "p_value"] = np.nan
    # Resolve citation -> PMID/DOI through the literature index (title containment).
    titles = [(norm_title(t), p, doi, y) for t, p, doi, y in
              zip(lit["title"], lit["pmid"], lit["doi"], lit["year"]) if len(norm_title(t)) > 30]
    cmap = {}
    for c in out["citation"].unique():
        nc = norm_title(c)
        hit = next((x for x in titles if x[0] in nc), None)
        cmap[c] = hit[1:] if hit else ("", "", "")
    out["pmid"] = out["citation"].map(lambda c: cmap[c][0])
    out["doi"] = out["citation"].map(lambda c: cmap[c][1])
    yr = out["citation"].str.extract(r"((?:19|20)\d\d)")[0]
    out["year"] = out["citation"].map(lambda c: cmap[c][2]).where(lambda s: s != "", yr)
    out["first_author"] = out["citation"].str.extract(r"^([A-Z][A-Za-z'\-]+)")[0]
    return out


def load_gwas_atlas(proj):
    g = pd.read_csv(f"{proj}/data/raw/gwas_atlas/gwas_association_result_for_cotton.txt", sep="\t", dtype=str)
    g.columns = [c.replace("\xa0", " ").strip() for c in g.columns]  # header has a no-break space
    out = pd.DataFrame({
        "record_type": "GWAS", "source_db": "GWAS Atlas", "source_dataset": g["StudyId"],
        "source_record_id": "GaP" + g["#GaP_id"], "qtl_name": "", "trait_original": g["Trait"],
        "species": "Gossypium hirsutum", "genome_group": "AD", "population": g["Species/Population"],
        "sample_size": g["Sample size"],
        "environment": (g["Sampling spot"].fillna("") + " " + g["Sampling year"].fillna("") + " "
                        + g["Sampling condition"].fillna("")).str.strip(),
        "chromosome": g["Chr"].map(H.std_chromosome), "ref_genome": "G. hirsutum TM-1 BGI v1 (Ghir.BGI)",
        "seqid": g["Chr"], "phys_start": to_num(g["Pos"]), "phys_end": to_num(g["Pos"]),
        "lead_marker": g["Reported location"], "p_value": to_num(g["P-value"]), "r2_pct": to_num(g["R2(%)"]),
        "stat_note": "position lifted to Ghir.BGI by GWAS Atlas; lead_marker holds the reported location; model: "
                     + g["GWAS model"].fillna(""),
        "pmid": g["PMID"], "year": g["Published time"].str[:4], "first_author": g["First author"],
        "citation": g["First author"] + " " + g["Journal"] + " " + g["Published time"].str[:4] + ". " + g["Title"],
    })
    # GWAS Atlas re-maps every association to Ghir.BGI, but that conversion is unreliable: for 76% of rows its
    # chromosome differs from the chromosome in the authors' reported location, and the BGI positions run past
    # the BGI chromosome ends. The reported location (e.g. "Ghir.NAUv1:A01_21348964") is what the paper
    # published; its positions fit the NAU-NBI v1.1 chromosome lengths exactly, so use it whenever present.
    rep = g["Reported location"].fillna("").str.extract(r"Ghir\.NAUv1:([AD])(\d{1,2})_(\d+)$")
    has = rep[0].notna()
    out.loc[has, "chromosome"] = rep.loc[has, 0] + rep.loc[has, 1].astype(int).map("{:02d}".format)
    out.loc[has, "seqid"] = g.loc[has, "Reported location"]
    out.loc[has, "phys_start"] = out.loc[has, "phys_end"] = rep.loc[has, 2].astype(float)
    out.loc[has, "ref_genome"] = "G. hirsutum TM-1 NAU-NBI v1.1 (reported location, via GWAS Atlas)"
    out.loc[has, "stat_note"] = ("position as reported by the authors on NAU-NBI v1 (GWAS Atlas's Ghir.BGI "
                                 "re-mapping not used); model: " + g.loc[has, "GWAS model"].fillna(""))
    hz = [H.harmonise_trait(t) for t in out["trait_original"]]
    out["trait_harmonized"], out["trait_category"] = [x[0] for x in hz], [x[1] for x in hz]
    return out


MAX_BP = 2.5e8     # longest cotton chromosomes are ~150 Mb
MAX_CM = 1000      # per linkage group; larger values are bp written into a cM field


def sanitise(df, log_path):
    """Range checks applied to every source. Values that cannot be right are removed (never guessed) and logged."""
    log = []

    def drop(mask, cols, why):
        mask = mask.fillna(False)
        for rid, src in zip(df.loc[mask, "source_record_id"], df.loc[mask, "source_db"]):
            log.append((src, rid, ",".join(cols), why))
        df.loc[mask, cols] = np.nan
        return int(mask.sum())

    # P column holding -log10(P): move it
    m = df["p_value"].gt(1) & (df["neg_log10_p"].isna() | df["neg_log10_p"].le(0))
    for rid, src in zip(df.loc[m, "source_record_id"], df.loc[m, "source_db"]):
        log.append((src, rid, "p_value", "P > 1 is a -log10(P); moved to neg_log10_p"))
    df.loc[m, "neg_log10_p"] = df.loc[m, "p_value"]
    df.loc[m, "p_value"] = np.nan
    n = {"p_moved": int(m.sum())}
    n["p_out_of_range"] = drop(df["p_value"].le(0) | df["p_value"].gt(1), ["p_value"], "P outside (0, 1]")
    n["neg_log10_p_negative"] = drop(df["neg_log10_p"].lt(0), ["neg_log10_p"], "-log10(P) < 0")
    # PVE given as a fraction: every value of a table / dataset <= 1. Rescale to %.
    unit = df["source_record_id"].fillna("").str.rsplit("|", n=1).str[0].where(
        df["source_db"] == "Literature", df["source_dataset"].fillna(""))
    g = df.groupby(unit)["r2_pct"].agg(["max", "count"])
    frac_units = g[(g["max"] <= 1) & (g["count"] >= PVE_FRACTION_MIN_ROWS)].index
    m = unit.isin(frac_units) & df["r2_pct"].notna()
    for rid, src in zip(df.loc[m, "source_record_id"], df.loc[m, "source_db"]):
        log.append((src, rid, "r2_pct", "PVE reported as a fraction (all values of the table <= 1); multiplied by 100"))
    df.loc[m, "r2_pct"] = df.loc[m, "r2_pct"] * 100
    df.loc[m, "stat_note"] = df.loc[m, "stat_note"].fillna("") + "; PVE converted from a fraction to %"
    n["pve_fraction_rescaled"] = int(m.sum())
    n["pve_out_of_range"] = drop(df["r2_pct"].lt(0) | df["r2_pct"].gt(100), ["r2_pct"], "PVE outside 0-100 %")
    # additive effect: normalise minus signs, strip footnote marks; non-numeric text (SnpEff annotations, '+') removed
    ae = df["additive_effect"].fillna("").astype(str).str.strip()
    clean = (ae.str.replace("−", "-", regex=False).str.replace(r"^[–—]", "-", regex=True)
               .str.replace(r"(?<=\d)\s*[*a-zA-Z†‡]+$", "", regex=True))
    ok = pd.to_numeric(clean, errors="coerce").notna()
    changed = (ae != "") & ok & (clean != ae)
    df.loc[changed, "additive_effect"] = clean[changed]
    n["additive_effect_cleaned"] = int(changed.sum())
    # ranges such as "-1.21 – -0.86" are kept with plain minus signs; text without a number is removed
    rng = (ae != "") & ~ok & clean.str.fullmatch(r"-?\d*\.?\d+\s*[–~-]+\s*-?\d*\.?\d+")
    df.loc[rng, "additive_effect"] = clean[rng].str.replace(r"\s*[–~]+\s*|(?<=\d)-(?=-|\d)", " to ", regex=True)
    bad = (ae != "") & ~ok & ~rng
    for rid, src, v in zip(df.loc[bad, "source_record_id"], df.loc[bad, "source_db"], ae[bad]):
        log.append((src, rid, "additive_effect", f"not a number ({v[:40]}); removed"))
    df.loc[bad, "stat_note"] = df.loc[bad, "stat_note"].fillna("") + "; additive effect column held text: " + ae[bad].str[:40]
    df.loc[bad, "additive_effect"] = ""
    n["additive_effect_removed"] = int(bad.sum())
    n["lod_negative"] = drop(df["lod"].lt(0), ["lod"], "LOD < 0")
    for c in ("cm_start", "cm_stop", "cm_peak"):
        n[c + "_too_large"] = drop(df[c].gt(MAX_CM), [c], f"cM > {MAX_CM} (a bp value)")
    big = df["phys_start"].gt(MAX_BP) | df["phys_end"].gt(MAX_BP)
    n["phys_too_large"] = drop(big, ["phys_start", "phys_end"], "position > 250 Mb")
    # diploid genomes have 13 chromosomes named after their own genome letter
    dip = df["genome_group"].isin(["A", "D"]) & (df["chromosome"] != "")
    wrong = dip & (df["chromosome"].str[0] != df["genome_group"])
    for rid, src, c in zip(df.loc[wrong, "source_record_id"], df.loc[wrong, "source_db"], df.loc[wrong, "chromosome"]):
        log.append((src, rid, "chromosome", f"{c} is not a chromosome of this diploid genome (unplaced scaffold)"))
    df.loc[wrong, ["chromosome", "phys_start", "phys_end"]] = ["", np.nan, np.nan]
    n["diploid_unplaced"] = int(wrong.sum())
    # tetraploid records placed by CottonGen on a wild diploid genome (F08, K13, ...): not an A/D chromosome
    tet = (df["genome_group"] == "AD") & (df["chromosome"] != "") & ~df["chromosome"].str.fullmatch(r"[AD](0[1-9]|1[0-3])")
    for rid, src, c in zip(df.loc[tet, "source_record_id"], df.loc[tet, "source_db"], df.loc[tet, "chromosome"]):
        log.append((src, rid, "chromosome", f"{c} is not an A/D chromosome (placed on another species' genome)"))
    df.loc[tet, ["chromosome", "phys_start", "phys_end"]] = ["", np.nan, np.nan]
    n["tetraploid_other_genome"] = int(tet.sum())
    pd.DataFrame(log, columns=["source_db", "source_record_id", "field", "reason"]).to_csv(log_path, sep="\t", index=False)
    print("sanitised:", {k: v for k, v in n.items() if v}, flush=True)
    return df


def merge_hits(df, gap):
    """Single-linkage merge of sorted positions (per trait/chromosome) into loci."""
    df = df.sort_values(["key", "chr", "pos"])
    new = (df["key"] != df["key"].shift()) | (df["chr"] != df["chr"].shift()) | (df["pos"] - df["end"].shift() > gap)
    df["locus"] = new.cumsum()
    return df


def load_cottonmd(proj):
    traits = pd.read_csv(f"{proj}/data/raw/cottonmd/cottonmd_gwas_traits.tsv", sep="\t", dtype=str).fillna("")
    recs = []
    for _, t in traits.iterrows():
        fn = f"{proj}/data/raw/cottonmd/gwas_significant_snps/{re.sub(r'[^A-Za-z0-9_.-]', '_', t.table_id)}.tsv"
        if not os.path.exists(fn):
            continue
        s = pd.read_csv(fn, sep="\t")
        if s.empty:
            continue
        thr = 1.0 / float(t.n_snps_for_threshold) if t.n_snps_for_threshold else 1e-6
        s["key"], s["end"] = t.table_id, s["pos"]
        s = merge_hits(s, CLUSTER_BP)
        for _, loc in s.groupby("locus"):
            lead = loc.loc[loc["p_value"].idxmin()]
            if lead.p_value > thr:
                continue  # keep genome-wide significant loci; suggestive SNPs stay in data/raw
            recs.append({
                "record_type": "GWAS", "source_db": "CottonMD", "source_dataset": t.panel_study,
                "source_record_id": f"{t.table_id}|{lead.chr}:{int(lead.pos)}", "qtl_name": "",
                "trait_original": t.trait, "species": "Gossypium hirsutum", "genome_group": "AD",
                "population": t.panel_study, "sample_size": (re.findall(r"\((\d+)\)", t.panel_study) or [""])[-1],
                "chromosome": H.std_chromosome(lead.chr), "ref_genome": "G. hirsutum TM-1 WHU v1 (CottonMD)",
                "seqid": lead.chr, "phys_start": int(loc.pos.min()), "phys_end": int(loc.pos.max()),
                "lead_marker": f"{lead.chr}:{int(lead.pos)} {lead.ref}>{lead.alt}", "p_value": lead.p_value,
                "stat_note": f"locus = {len(loc)} SNPs with p<1e-5 merged within {CLUSTER_BP // 1000} kb; "
                             f"lead SNP passes p<{thr:.2e}",
                "citation": "CottonMD GWAS panel " + t.panel_study, "n_source_rows": len(loc),
                "year": (re.findall(r"(20\d\d)", t.panel_study) or [""])[0],
            })
    out = pd.DataFrame(recs)
    hz = [H.harmonise_trait(t) for t in out["trait_original"]]
    out["trait_harmonized"], out["trait_category"] = [x[0] for x in hz], [x[1] for x in hz]
    return out


# Reference assemblies as declared by CottonGVD (written with CottonGen's genome names so that
# loci from both resources can cluster on the same coordinates).
GVD_A2 = "Gossypium arboreum (A2) 'SXY1' genome CRI-updated_v1"
GVD_AD1 = "Gossypium hirsutum (AD1) 'TM-1' genome CRI_v1"
GVD_AD2 = "Gossypium barbadense (AD2) '3-79' genome HAU_v2_a1"
GVD_POP = {
    "cottonA2.215": ("Gossypium arboreum", "A", GVD_A2, "CottonGVD panel A2.215 (Du et al. 2018 Nat Genet)", ""),
    "cottonAD1.419": ("Gossypium hirsutum", "AD", GVD_AD1, "CottonGVD panel AD1.419 (Ma et al. 2018 Nat Genet)", "29736016"),
    "cottonAD1.1245": ("Gossypium hirsutum", "AD", GVD_AD1, "CottonGVD panel AD1.1245", ""),
    "cottonAD1.383": ("Gossypium hirsutum", "AD", GVD_AD1, "CottonGVD panel AD1.383", ""),
    "cottonAD2.365": ("Gossypium barbadense", "AD", GVD_AD2, "CottonGVD panel AD2.365", ""),
}


def load_cottongvd(proj):
    recs = []
    for pop, (species, grp, ref, cite, pmid) in GVD_POP.items():
        for fn in sorted(glob.glob(f"{proj}/data/raw/cottongvd/gwas_500kb_bins/{pop}/*.tsv")):
            b = pd.read_csv(fn, sep="\t")
            b = b[b["best_neg_log10_p"] >= GVD_MIN_LOGP]
            if b.empty:
                continue
            se = b["bin"].str.extract(r":(\d+)-(\d+)$").astype(float)
            b = b.assign(pos=se[0], end=se[1], key=b["trait"])
            b = merge_hits(b, 1)  # adjacent 500-kb bins form one locus
            for _, loc in b.groupby("locus"):
                lead = loc.loc[loc["best_neg_log10_p"].idxmax()]
                recs.append({
                    "record_type": "GWAS", "source_db": "CottonGVD", "source_dataset": pop,
                    "source_record_id": f"{pop}|{lead.trait}|{lead['bin']}", "qtl_name": "",
                    "trait_original": lead.trait, "species": species, "genome_group": grp, "population": pop,
                    "sample_size": pop.rsplit(".", 1)[1], "environment": "_".join(str(lead.trait).split("_")[1:]),
                    "chromosome": H.std_chromosome(lead.chr), "ref_genome": ref, "seqid": lead.chr,
                    "phys_start": int(loc.pos.min()), "phys_end": int(loc["end"].max()),
                    "lead_marker": "", "neg_log10_p": float(lead.best_neg_log10_p),
                    "p_value": 10 ** -float(lead.best_neg_log10_p),
                    "stat_note": f"best -log10(P) per 500-kb bin (>= {GVD_MIN_LOGP}); adjacent bins merged; "
                                 "lead SNP not exported by CottonGVD",
                    "pmid": pmid, "citation": cite, "n_source_rows": len(loc),
                    "year": (re.findall(r"(20\d\d)", cite) or [""])[0],
                })
    out = pd.DataFrame(recs)
    if out.empty:
        return out
    hz = [H.harmonise_gvd(t) for t in out["trait_original"]]
    out["trait_harmonized"], out["trait_category"] = [x[0] for x in hz], [x[1] for x in hz]
    return out


# ----------------------------------------------------------------------------- redundancy
def round_sig(x, n=3):
    if pd.isna(x) or x == 0:
        return ""
    return f"{float(x):.{n}g}"


def flag_duplicates(df):
    """Layer 2: same result present more than once (across sources or repeated tables)."""
    study = df["pmid"].where(df["pmid"].fillna("") != "", df["first_author"].fillna("") + df["year"].fillna(""))
    study = study.where(study.fillna("") != "", df["source_dataset"].fillna(""))
    pos = np.where(df["phys_start"].notna(),
                   df["phys_start"].fillna(-1).astype("int64").astype(str) + "-"
                   + df["phys_end"].fillna(-1).astype("int64").astype(str),
                   "cM" + df["cm_start"].map(round_sig) + "-" + df["cm_stop"].map(round_sig)
                   + "@" + df["cm_peak"].map(round_sig) + "|" + df["linkage_group"].fillna(""))
    stat = (df["lod"].map(round_sig) + "|" + df["neg_log10_p"].map(round_sig) + "|" + df["r2_pct"].map(round_sig))
    # Environment-specific results are distinct: use the environment, else the published QTL symbol.
    env_or_name = df["environment"].where(df["environment"].fillna("") != "", df["qtl_name"].fillna(""))
    env = df["trait_original"].fillna("").str.lower() + "|" + env_or_name.fillna("").str.lower()
    key = (df["record_type"] + "|" + study.fillna("") + "|" + df["trait_harmonized"] + "|" + env + "|"
           + df["chromosome"].fillna("") + "|" + pd.Series(pos, index=df.index) + "|" + stat)
    # Records with neither a position nor a statistic cannot be judged duplicates.
    informative = df["phys_start"].notna() | df["cm_start"].notna() | df["cm_peak"].notna() | df["lod"].notna()
    prio = df["source_db"].map({s: i for i, s in enumerate(SOURCE_PRIORITY)}).fillna(99)
    order = df.assign(_k=key, _p=prio)[informative].sort_values(["_k", "_p", "record_id"])
    keeper = order.groupby("_k")["record_id"].transform("first")
    dup = keeper[keeper != order["record_id"]]
    df["duplicate_of"] = ""
    df.loc[dup.index, "duplicate_of"] = dup
    return df


def cluster_loci(df):
    """Layer 3: co-localising records of the same harmonised trait."""
    df["locus_cluster_id"] = ""
    df["cluster_basis"] = ""
    # physical clusters
    # Duplicates join their kept copy's locus (assigned at the end), so a locus never consists of duplicates only.
    orig = df["duplicate_of"] == ""
    placed = orig & df["phys_start"].notna() & (df["chromosome"].fillna("") != "") & (df["ref_genome"].fillna("") != "")
    wide = placed & ((df["phys_end"].fillna(df["phys_start"]) - df["phys_start"]) > MAX_CLUSTER_INTERVAL_BP)
    phys = df[placed & ~wide]
    phys = phys.sort_values(["trait_harmonized", "ref_genome", "chromosome", "phys_start"])
    grp = phys[["trait_harmonized", "ref_genome", "chromosome"]].agg("|".join, axis=1)
    run_end = phys.groupby(grp)["phys_end"].cummax().shift()
    new = (grp != grp.shift()) | (phys["phys_start"] - run_end > CLUSTER_BP)
    ids = new.cumsum()
    df.loc[phys.index, "locus_cluster_id"] = "PL" + ids.astype(str).str.zfill(6)
    df.loc[phys.index, "cluster_basis"] = f"physical (same assembly, <= {CLUSTER_BP // 1000} kb)"
    # genetic-map clusters for records without physical coordinates
    w = df.index[wide]
    df.loc[w, "locus_cluster_id"] = "PW" + pd.Series(range(1, len(w) + 1), index=w).astype(str).str.zfill(6)
    df.loc[w, "cluster_basis"] = f"physical, interval > {MAX_CLUSTER_INTERVAL_BP // 1_000_000} Mb (not clustered)"
    gen = df[orig & df["phys_start"].isna() & (df["map_name"].fillna("") != "")
             & (df["linkage_group"].fillna("") != "")].copy()
    gen["a"] = gen[["cm_start", "cm_peak", "cm_stop"]].min(axis=1)
    gen["b"] = gen[["cm_start", "cm_peak", "cm_stop"]].max(axis=1)
    gen = gen[gen["a"].notna()].sort_values(["trait_harmonized", "map_name", "linkage_group", "a"])
    grp = gen[["trait_harmonized", "map_name", "linkage_group"]].agg("|".join, axis=1)
    run_end = gen.groupby(grp)["b"].cummax().shift()
    new = (grp != grp.shift()) | (gen["a"] - run_end > CLUSTER_CM)
    ids = new.cumsum()
    df.loc[gen.index, "locus_cluster_id"] = "GL" + ids.astype(str).str.zfill(6)
    df.loc[gen.index, "cluster_basis"] = f"genetic (same map and linkage group, <= {CLUSTER_CM:g} cM)"
    # everything else is its own locus
    rest = (df["locus_cluster_id"] == "") & orig
    df.loc[rest, "locus_cluster_id"] = "UL" + pd.Series(range(1, rest.sum() + 1), index=df.index[rest]).astype(str).str.zfill(6)
    df.loc[rest, "cluster_basis"] = "unplaced (no comparable coordinates)"
    keep = df.set_index("record_id")[["locus_cluster_id", "cluster_basis"]]
    d = ~orig
    df.loc[d, "locus_cluster_id"] = df.loc[d, "duplicate_of"].map(keep["locus_cluster_id"]).values
    df.loc[d, "cluster_basis"] = df.loc[d, "duplicate_of"].map(keep["cluster_basis"]).values
    return df


def summarise_loci(df):
    d = df.copy()
    d["score"] = d["neg_log10_p"].fillna(0) + d["lod"].fillna(0)
    d["_prio"] = d["source_db"].map({s: i for i, s in enumerate(SOURCE_PRIORITY)}).fillna(99)
    d["_study"] = d["pmid"].where(d["pmid"].fillna("") != "", d["citation"].fillna("").str[:60])
    d["_dup"] = (d["duplicate_of"] != "").astype(int)
    rep = d.sort_values(["locus_cluster_id", "_dup", "score", "_prio"],
                        ascending=[True, True, False, True]).groupby("locus_cluster_id").head(1)
    g = d.groupby("locus_cluster_id")
    summ = pd.DataFrame({
        "n_records": g.size(), "n_unique_records": g["duplicate_of"].apply(lambda s: int((s == "").sum())),
        "n_sources": g["source_db"].nunique(), "sources": g["source_db"].agg(lambda s: "; ".join(sorted(set(s)))),
        "n_studies": g["_study"].nunique(), "record_types": g["record_type"].agg(lambda s: "; ".join(sorted(set(s)))),
        "cluster_phys_start": g["phys_start"].min(), "cluster_phys_end": g["phys_end"].max(),
        "cluster_cm_min": g[["cm_start", "cm_peak", "cm_stop"]].min().min(axis=1),
        "cluster_cm_max": g[["cm_start", "cm_peak", "cm_stop"]].max().max(axis=1),
        "max_neg_log10_p": g["neg_log10_p"].max(), "max_lod": g["lod"].max(), "max_r2_pct": g["r2_pct"].max(),
        "pmids": g["pmid"].agg(lambda s: "; ".join(sorted({x for x in s if isinstance(x, str) and x}))[:500]),
    }).reset_index()
    keep = ["locus_cluster_id", "cluster_basis", "trait_harmonized", "trait_category", "species", "chromosome",
            "ref_genome", "map_name", "linkage_group", "record_id", "qtl_name", "trait_original", "lead_marker",
            "candidate_genes", "citation"]
    rep = rep[keep].rename(columns={"record_id": "representative_record_id", "qtl_name": "representative_qtl_name",
                                    "trait_original": "representative_trait_original",
                                    "lead_marker": "representative_lead_marker", "citation": "representative_citation"})
    return rep.merge(summ, on="locus_cluster_id")


def multitrait_hotspots(loci):
    """Regions where loci for >= 2 different harmonised traits co-localise on the same assembly."""
    p = loci[loci["cluster_phys_start"].notna() & (loci["chromosome"].fillna("") != "")
             & ~loci["locus_cluster_id"].str.startswith("PW")]
    p = p.sort_values(["ref_genome", "chromosome", "cluster_phys_start"])
    grp = p["ref_genome"] + "|" + p["chromosome"]
    run_end = p.groupby(grp)["cluster_phys_end"].cummax().shift()
    new = (grp != grp.shift()) | (p["cluster_phys_start"] - run_end > HOTSPOT_BP)
    p = p.assign(hotspot=new.cumsum())
    g = p.groupby("hotspot")
    hs = pd.DataFrame({
        "ref_genome": g["ref_genome"].first(), "chromosome": g["chromosome"].first(),
        "start": g["cluster_phys_start"].min(), "end": g["cluster_phys_end"].max(),
        "n_traits": g["trait_harmonized"].nunique(), "n_trait_categories": g["trait_category"].nunique(),
        "n_loci": g.size(), "n_records": g["n_records"].sum(),
        "traits": g["trait_harmonized"].agg(lambda s: "; ".join(sorted(set(s)))),
        "trait_categories": g["trait_category"].agg(lambda s: "; ".join(sorted(set(s)))),
        "locus_cluster_ids": g["locus_cluster_id"].agg(lambda s: "; ".join(s)[:2000]),
    })
    hs = hs[hs["n_traits"] >= 2].sort_values(["n_traits", "n_records"], ascending=False).reset_index(drop=True)
    hs.insert(0, "hotspot_id", ["MT" + str(i + 1).zfill(5) for i in range(len(hs))])
    return hs


# ----------------------------------------------------------------------------- main
def main(proj):
    out_dir = f"{proj}/data/processed"
    os.makedirs(out_dir, exist_ok=True)
    lit = pd.concat([pd.read_csv(f"{proj}/data/literature/{n}", sep="\t", dtype=str) for n in ("literature_index.tsv", "library_index.tsv") if os.path.exists(f"{proj}/data/literature/{n}")], ignore_index=True).fillna("")
    parts = [load_cottongen(proj, lit), load_gwas_atlas(proj), load_cottonmd(proj), load_cottongvd(proj)]
    lit_recs = f"{proj}/data/literature/extracted/literature_records.tsv"
    if os.path.exists(lit_recs):
        parts.append(pd.read_csv(lit_recs, sep="\t", dtype=str, low_memory=False))
    for p in parts:
        print(p["source_db"].iloc[0] if len(p) else "empty", len(p), flush=True)
    df = pd.concat([p for p in parts if len(p)], ignore_index=True)
    for c in COLS:
        if c not in df.columns:
            df[c] = np.nan
    # hand-checked exclusions: non-cotton papers and mis-extracted tables
    pm = df["pmid"].fillna("").astype(str)
    tbl = df["source_record_id"].fillna("").astype(str).str.rsplit("|", n=1).str[0]
    why = pm.map(EXCLUDE_PMIDS).fillna(tbl.where(df["source_db"] == "Literature").map(EXCLUDE_TABLES))
    ex = why.notna()
    df.loc[ex, ["source_db", "source_record_id", "pmid", "citation"]].assign(reason=why[ex]).to_csv(
        f"{out_dir}/excluded_records.tsv", sep="\t", index=False)
    print("excluded:", why[ex].value_counts().to_dict(), flush=True)
    df = df[~ex].reset_index(drop=True)
    for (ds, to), tn in TRAIT_OVERRIDES.items():
        m = (df["source_dataset"] == ds) & (df["trait_original"] == to)
        df.loc[m, "trait_original"] = tn
        hz = H.harmonise_trait(tn)
        df.loc[m, ["trait_harmonized", "trait_category"]] = [hz[0], hz[1]]
    for c in ["phys_start", "phys_end", "cm_start", "cm_stop", "cm_peak", "p_value", "neg_log10_p", "lod", "r2_pct"]:
        df[c] = to_num(df[c])
    for c in ["pmid", "doi", "year", "first_author", "citation", "environment", "map_name", "linkage_group",
              "chromosome", "ref_genome", "source_dataset", "record_subtype", "trait_original"]:
        df[c] = df[c].fillna("").astype(str)
    df = sanitise(df, f"{out_dir}/sanitise_log.tsv")
    # A table often omits the trait because the whole paper is about one trait. When a literature
    # record's trait cannot be resolved, fall back to the trait named in the paper's title.
    lit_title = {}
    for _, r in lit.iterrows():
        t, c = H.harmonise_trait(r["title"])
        if c != "unclassified":
            lit_title[r["pmcid"] or ("doi:" + r["doi"])] = (t, c)
    un = (df["source_db"] == "Literature") & (df["trait_category"] == "unclassified") & df["source_dataset"].isin(lit_title)
    df.loc[un, "stat_note"] = df.loc[un, "stat_note"].fillna("") + "; trait taken from the paper title"
    df.loc[un, "trait_category"] = df.loc[un, "source_dataset"].map(lambda k: lit_title[k][1])
    df.loc[un, "trait_harmonized"] = df.loc[un, "source_dataset"].map(lambda k: lit_title[k][0])
    df["trait_resolved"] = (df["trait_category"] != "unclassified").astype(int)

    # Literature coordinates rarely name their assembly. Borrow it from the CottonGen entry of the
    # same study when there is one; otherwise positions are only comparable within that paper.
    cg = df[(df["source_db"] == "CottonGen") & (df["pmid"] != "") & (df["ref_genome"] != "") & df["phys_start"].notna()]
    study_ref = cg.groupby("pmid")["ref_genome"].agg(lambda x: x.mode().iloc[0]).to_dict()
    need = (df["source_db"] == "Literature") & df["phys_start"].notna() & (df["ref_genome"] == "")
    borrowed = need & df["pmid"].isin(study_ref)
    df.loc[borrowed, "ref_genome"] = df.loc[borrowed, "pmid"].map(study_ref)
    df.loc[borrowed, "stat_note"] = df.loc[borrowed, "stat_note"].fillna("") + "; assembly assumed from the CottonGen entry of the same study"
    rest = need & ~borrowed
    df.loc[rest, "ref_genome"] = "assembly not stated (" + df.loc[rest, "source_dataset"] + ")"
    ok = df["p_value"].gt(0) & df["neg_log10_p"].isna()
    df.loc[ok, "neg_log10_p"] = -np.log10(df.loc[ok, "p_value"])
    df["n_source_rows"] = to_num(df["n_source_rows"]).fillna(1).astype(int)
    df["record_id"] = ["CQ" + str(i + 1).zfill(7) for i in range(len(df))]
    df = flag_duplicates(df[COLS + ["trait_resolved"]].copy())
    df = cluster_loci(df)
    df["phys_start"] = df["phys_start"].astype("Int64")
    df["phys_end"] = df["phys_end"].astype("Int64")

    loci = summarise_loci(df)
    hotspots = multitrait_hotspots(loci)
    hs_map = {}
    for hid, ids in zip(hotspots["hotspot_id"], hotspots["locus_cluster_ids"]):
        for i in ids.split("; "):
            hs_map[i] = hid
    df["multitrait_hotspot_id"] = df["locus_cluster_id"].map(hs_map).fillna("")

    df.to_csv(f"{out_dir}/records_all.tsv", sep="\t", index=False)
    nr = df[df["duplicate_of"] == ""]
    nr.to_csv(f"{out_dir}/records_deduplicated.tsv", sep="\t", index=False)
    loci.to_csv(f"{out_dir}/loci_nonredundant.tsv", sep="\t", index=False)
    hotspots.to_csv(f"{out_dir}/multitrait_hotspots.tsv", sep="\t", index=False)
    os.makedirs(f"{out_dir}/by_type", exist_ok=True)
    for old in glob.glob(f"{out_dir}/by_type/*.tsv"):
        os.remove(old)
    for (rt, st), sub in nr.groupby(["record_type", "record_subtype"]):
        name = re.sub(r"[^a-z0-9]+", "_", (rt + "_" + st).lower()).strip("_")
        sub.to_csv(f"{out_dir}/by_type/{name}.tsv", sep="\t", index=False)

    traits = (df.groupby(["trait_category", "trait_harmonized", "trait_original", "source_db"]).size()
              .rename("n_records").reset_index())
    traits.to_csv(f"{out_dir}/trait_dictionary.tsv", sep="\t", index=False)
    tsum = nr.groupby(["trait_category", "trait_harmonized"]).agg(
        n_records=("record_id", "size"), n_loci=("locus_cluster_id", "nunique"),
        n_qtl=("record_type", lambda s: int((s == "QTL").sum())),
        n_gwas=("record_type", lambda s: int((s == "GWAS").sum())),
        n_sources=("source_db", "nunique"), species=("species", lambda s: "; ".join(sorted(set(map(str, s))))[:300]),
    ).reset_index().sort_values("n_records", ascending=False)
    tsum.to_csv(f"{out_dir}/trait_summary.tsv", sep="\t", index=False)
    studies = df.assign(_s=df["pmid"].where(df["pmid"] != "", df["citation"].str[:150])).groupby("_s").agg(
        pmid=("pmid", "first"), doi=("doi", "first"), year=("year", "first"), citation=("citation", "first"),
        sources=("source_db", lambda s: "; ".join(sorted(set(s)))), n_records=("record_id", "size"),
        n_duplicates=("duplicate_of", lambda s: int((s != "").sum())),
        record_types=("record_type", lambda s: "; ".join(sorted(set(s)))),
        n_traits=("trait_harmonized", "nunique")).reset_index(drop=True).sort_values("n_records", ascending=False)
    studies.to_csv(f"{out_dir}/studies.tsv", sep="\t", index=False)

    db = f"{out_dir}/cotton_qtl.sqlite"
    if os.path.exists(db):
        os.remove(db)
    with sqlite3.connect(db) as con:
        df.to_sql("records", con, index=False)
        loci.to_sql("loci", con, index=False)
        hotspots.to_sql("multitrait_hotspots", con, index=False)
        tsum.to_sql("trait_summary", con, index=False)
        studies.to_sql("studies", con, index=False)
        lit.to_sql("literature_index", con, index=False)
        for ix in ["record_id", "trait_harmonized", "chromosome", "locus_cluster_id", "pmid", "record_type"]:
            con.execute(f"CREATE INDEX ix_records_{ix} ON records({ix})")

    print("\nrecords_all", len(df), "| deduplicated", len(nr), "| duplicates flagged", int((df.duplicate_of != "").sum()))
    print("loci", len(loci), "| multi-trait hotspots", len(hotspots))
    print(df.groupby(["source_db", "record_type", "record_subtype"]).agg(
        records=("record_id", "size"), duplicates=("duplicate_of", lambda s: int((s != "").sum())),
        loci=("locus_cluster_id", "nunique")).to_string())
    print(loci["cluster_basis"].value_counts().to_string())


if __name__ == "__main__":
    main(sys.argv[1])
