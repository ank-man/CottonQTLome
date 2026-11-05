#!/usr/bin/env python3
"""Export compact CSV/JSON files for the website from data/processed and analysis/.

Usage: export_site_data.py PROJECT_DIR
"""
import json
import os
import re
import shutil
import sys

import numpy as np
import pandas as pd

CATEGORY_LABEL = {
    "fiber quality": "Fiber quality", "yield": "Yield", "plant architecture": "Plant architecture",
    "phenology": "Phenology", "morphology": "Morphology", "biotic stress": "Biotic stress",
    "abiotic stress": "Abiotic stress", "seed quality": "Seed quality", "physiology": "Physiology",
    "growth and vigor": "Growth and vigor", "fertility": "Fertility",
    "unclassified": "Unclassified",
}
WINDOW = 2_000_000


def link(doi, pmid):
    if isinstance(doi, str) and doi:
        return doi if doi.startswith("http") else f"https://doi.org/{doi}"
    if isinstance(pmid, str) and pmid:
        return f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"
    return ""


def fmt(x, nd=2):
    if pd.isna(x):
        return ""
    return f"{x:.{nd}f}".rstrip("0").rstrip(".") if abs(x) >= 0.01 or x == 0 else f"{x:.2e}"


def position(r):
    if pd.notna(r.phys_start):
        a, b = int(r.phys_start), int(r.phys_end)
        return (str(a) if a == b else f"{a}-{b}"), "bp"
    if pd.notna(r.cm_peak) and pd.notna(r.cm_start) and pd.notna(r.cm_stop):
        return f"{fmt(r.cm_peak)}({fmt(r.cm_start)}-{fmt(r.cm_stop)})", "cM"
    if pd.notna(r.cm_peak):
        return fmt(r.cm_peak), "cM"
    if pd.notna(r.cm_start) and pd.notna(r.cm_stop):
        return f"{fmt(r.cm_start)}-{fmt(r.cm_stop)}", "cM"
    return "", ""


def base_frame(d):
    pos = [position(r) for r in d.itertuples()]
    mx = d.groupby("source_dataset")["r2_pct"].transform("max")
    pve = np.where(mx <= 1.0, d["r2_pct"] * 100, d["r2_pct"])
    ref = (d["first_author"].fillna("").str.replace(r"\s+et al\.?$", "", regex=True).str.strip() + " "
           + d["year"].fillna("")).str.strip()
    ref = ref.where(ref != "", d["citation"].fillna("").str[:60])
    cross = (d["maternal_parent"].fillna("") + " × " + d["paternal_parent"].fillna("")).str.strip(" ×")
    return pd.DataFrame({
        "id": d["record_id"], "species": d["species"], "trait": d["trait_category"].map(CATEGORY_LABEL),
        "parameter": d["trait_harmonized"], "trait_original": d["trait_original"].fillna("").str[:80],
        "qtl_name": d["qtl_name"].fillna("").str[:70], "chromosome": d["chromosome"].fillna(""),
        "position_interval": [p[0] for p in pos], "position_unit": [p[1] for p in pos],
        "map_bp": d["map_bp"].map(lambda v: "" if pd.isna(v) else str(int(v))),
        # chromosome on the UTX v2.1 axis (differs from `chromosome` where the source assembly was misassembled)
        "map_chr": d["map_chr"].fillna("").where(d["map_bp"].notna(), ""),
        # how map_bp was obtained: aligned (genome anchors) or approximate (relative position)
        "map_method": np.where(d["map_bp"].isna(), "",
                               np.where(d["map_method"].fillna("").str.startswith("aligned"), "aligned", "approximate")),
        "ref_genome": d["ref_genome"].fillna("").str.replace(r"^assembly not stated.*", "not stated", regex=True),
        "associated_markers": (d["lead_marker"].fillna("")
                               + np.where((d["lead_marker"].fillna("") != "") &
                                          (d["flanking_markers"].fillna("") != ""), "; ", "")
                               + d["flanking_markers"].fillna("")).str[:120],
        "lod": d["lod"].map(fmt), "pve": pd.Series(pve, index=d.index).map(fmt),
        "neg_log10_p": d["neg_log10_p"].map(fmt), "candidate_gene": d["candidate_genes"].fillna("").str[:120],
        "cross": cross, "population": d["population"].fillna("").str[:80], "environment": d["environment"].fillna("").str[:40],
        "reference": ref, "doi": [link(a, b) for a, b in zip(d["doi"], d["pmid"])], "source": d["source_db"],
        "evidence": np.where(d["source_db"] == "Literature", "auto-extracted", "database"),
        "locus_id": d["locus_cluster_id"], "hotspot_id": d["hotspot_id"].fillna(""),
    }, index=d.index)


def primer_catalog(proj, out):
    """Primer sequences for as many markers as possible: CottonGen (all marker types) first, then
    primer tables mined from paper supplements. Returns {MARKER NAME (upper case): primers}."""
    rows = []
    pdir = f"{proj}/data/raw/cottongen/primers"
    for fn in sorted(os.listdir(pdir)) if os.path.isdir(pdir) else []:
        t = pd.read_csv(f"{pdir}/{fn}", sep="\t", dtype=str).fillna("")
        t = t[(t["Primers"] != "") & ~t["Primers"].str.contains(r":\s*N/?A\b", case=False)].drop_duplicates("Marker Name")
        # "NAME_F:SEQ|NAME_R:SEQ" -> "F:SEQ|R:SEQ"
        seqs = t["Primers"].map(lambda v: "|".join(
            (x.rsplit(":", 1)[0].rsplit("_", 1)[-1][:12] + ":" + x.rsplit(":", 1)[1].replace(" ", "")) if ":" in x
            else x.replace(" ", "") for x in v.split("|")))
        rows.append(pd.DataFrame({"marker": t["Marker Name"], "marker_type": t["Marker Type"], "primers": seqs,
                                  "source": "CottonGen", "reference": ""}))
    lp = pd.read_csv(f"{proj}/data/literature/extracted/literature_primers.tsv", sep="\t", dtype=str).fillna("")
    lp = lp[lp["marker"].str.len() > 1]
    # KASP assays span several rows under one marker name: join their oligos
    g = lp.groupby(["paper_id", "marker"], sort=False)
    lit = g.agg(marker_type=("marker_type", "first"), primers=("primers", lambda s: "|".join(dict.fromkeys("|".join(s).split("|")))),
                reference=("first_author", "first"), year=("year", "first")).reset_index()
    # more than 4 oligos under one name is not one assay but a block of rows under a section label
    # (e.g. "At_chr1", "A6"): the sequences cannot be attributed to a marker, so leave them out
    lit = lit[lit["primers"].str.count(r"\|") < 4]
    rows.append(pd.DataFrame({"marker": lit["marker"], "marker_type": lit["marker_type"], "primers": lit["primers"],
                              "source": "Literature supplement", "reference": (lit["reference"] + " " + lit["year"]).str.strip()}))
    cat = pd.concat(rows, ignore_index=True)
    cat["key"] = cat["marker"].str.upper().str.replace(r"[\s_-]+", "", regex=True)
    cat = cat.drop_duplicates("key")                      # CottonGen entry wins over a literature one
    cat.drop(columns="key").to_csv(f"{out}/marker_primers.csv", index=False)
    print("primer catalogue:", len(cat), cat["source"].value_counts().to_dict())
    return dict(zip(cat["key"], cat["primers"])), len(cat)


def primer_key(name):
    return re.sub(r"[\s_-]+", "", str(name).upper())


SSR_RX = re.compile(r"\b(?:BNL|NAU|CIR|JESPR|DPL|MUSS|MUCS|HAU|SWU|TMB|CGR|DC|CER|STV|MGHES|CM|Gh|ICR|COT|PGML|SHIN|"
                    r"MON_[A-Z]+|TM|GH|SNP|Marker|i)\d{2,7}[A-Za-z]{0,3}\b")


def paper_label(lit):
    key = lit["pmcid"].where(lit["pmcid"] != "", "doi:" + lit["doi"])
    first = lit["authors"].str.split(",").str[0].str.split(" ").str[0]
    return dict(zip(key, zip(first + " " + lit["year"], lit["title"], lit["doi"], lit["pmid"])))


def export_maps_and_markers(proj, out, d, lit):
    """Linkage maps (CottonGen + literature supplements) and trait-linked markers for the site."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import harmonize as H
    primers, n_primers = primer_catalog(proj, out)
    mdir = f"{out}/maps"
    shutil.rmtree(mdir, ignore_errors=True)
    os.makedirs(mdir)
    index = []
    # ---- CottonGen maps
    meta = pd.read_csv(f"{proj}/data/raw/cottongen/maps/cottongen_maps.tsv", sep="\t", dtype=str).fillna("")
    meta = meta.groupby("Map Name", sort=False).agg(lambda s: "; ".join(dict.fromkeys(x for x in s if x))).reset_index()
    n = 0
    for _, m in meta.iterrows():
        if m["Map Type"] == "physical":   # positions in bp; the map viewer works in cM
            continue
        fn = f"{proj}/data/raw/cottongen/maps/marker_positions/{re.sub(r'[^A-Za-z0-9._-]+', '_', m['Map Name'])}.tsv"
        if not os.path.exists(fn):
            continue
        p = pd.read_csv(fn, sep="\t", dtype=str).fillna("")
        if p.empty:
            continue
        p = pd.DataFrame({"marker": p["Marker Name"], "marker_type": p["Marker Type"], "linkage_group": p["Linkage Group"],
                          "chromosome": p["Standardized Linkage Group"].map(H.std_chromosome),
                          "position_cm": pd.to_numeric(p["Map Position (Start)"], errors="coerce")}).dropna(subset=["position_cm"])
        p = p.drop_duplicates(["marker", "linkage_group", "position_cm"]).sort_values(["linkage_group", "position_cm"])
        if p.empty:
            continue
        n += 1
        mid = f"CG{n:03d}"
        p["primers"] = p["marker"].map(lambda m: primers.get(primer_key(m), ""))
        p.to_csv(f"{mdir}/{mid}.csv", index=False)
        index.append({"map_id": mid, "name": m["Map Name"], "source": "CottonGen", "map_type": m["Map Type"],
                      "species": m["Organism"], "population": m["Population"],
                      "parents": " × ".join(x for x in [m["Maternal Parent"], m["Paternal Parent"]] if x),
                      "n_linkage_groups": p["linkage_group"].nunique(), "n_loci": len(p),
                      "length_cm": round(float(p.groupby("linkage_group")["position_cm"].max().sum()), 1),
                      "marker_types": "; ".join(p["marker_type"].value_counts().head(4).index),
                      "n_qtl": m["Number of QTL"].split(";")[0], "reference": m["Publication"][:260], "doi": ""})
    # ---- maps mined from paper supplements
    lm = pd.read_csv(f"{proj}/data/literature/extracted/literature_maps.tsv", sep="\t", dtype=str).fillna("")
    lm["position_cm"] = pd.to_numeric(lm["position_cm"], errors="coerce")
    labels = paper_label(lit)
    for k, (tid, p) in enumerate(lm.groupby("table_id", sort=False), 1):
        pid = p["paper_id"].iloc[0]
        lab = labels.get(pid, (pid, "", "", ""))
        mid = f"LT{k:03d}"
        p2 = p[["marker", "linkage_group", "chromosome", "position_cm"]].copy()
        p2.insert(1, "marker_type", "")
        p2 = p2.drop_duplicates().sort_values(["linkage_group", "position_cm"])
        p2["primers"] = p2["marker"].map(lambda m: primers.get(primer_key(m), ""))
        p2.to_csv(f"{mdir}/{mid}.csv", index=False)
        index.append({"map_id": mid, "name": f"{lab[0]} — {tid.rsplit('|', 1)[-1][:40]}", "source": "Literature supplement",
                      "map_type": "genetic", "species": "", "population": "", "parents": "",
                      "n_linkage_groups": p2["linkage_group"].nunique(), "n_loci": len(p2),
                      "length_cm": round(float(p2.groupby("linkage_group")["position_cm"].max().sum()), 1),
                      "marker_types": "", "n_qtl": "", "reference": lab[1][:260], "doi": link(lab[2], lab[3])})
    idx = pd.DataFrame(index)
    idx.to_csv(f"{out}/maps.csv", index=False)

    # ---- trait-linked markers
    rows = []
    # (a) CottonGen: markers the database links to a trait
    files = [os.path.join(dp, f) for dp, _, fs in os.walk(f"{proj}/data/raw/cottongen/markers") for f in sorted(fs) if f.endswith(".tsv")]
    seen = set()
    for fn in files:
        t = pd.read_csv(fn, sep="\t", dtype=str).fillna("")
        if t.empty or "Trait" not in t.columns:
            continue
        key = t["Marker Name"] + "|" + t["Trait"]          # category and per-trait exports overlap
        t = t[~key.isin(seen)]
        seen |= set(key)
        if t.empty:
            continue
        hz = {x: H.harmonise_trait(x) for x in t["Trait"].unique()}
        t["trait"] = t["Trait"].map(lambda x: hz[x][0])
        t["category"] = t["Trait"].map(lambda x: hz[x][1])
        t = t[t["category"] != "unclassified"]
        g = t.groupby(["Marker Name", "trait"], sort=False)
        j = lambda s: "; ".join(dict.fromkeys(x for x in s if x))  # noqa: E731
        a = g.agg(category=("category", "first"), marker_type=("Marker Type", "first"), species=("Organism", "first"),
                  chromosome=("Standardized Linkage Group", lambda s: j(H.std_chromosome(x) for x in s)),
                  maps=("Map", lambda s: j(s)[:160]), primers=("Primers", "first"), aliases=("Alias", lambda s: j(s)[:80]),
                  n_maps=("Map", "nunique"), reference=("Publications", lambda s: j(s)[:120])).reset_index()
        for r in a.itertuples():
            rows.append({"marker": r._1, "trait": r.trait, "category": r.category, "marker_type": r.marker_type,
                         "chromosome": r.chromosome, "n_studies": r.n_maps, "primers": r.primers,
                         "evidence": "CottonGen trait-linked marker", "context": r.maps, "species": r.species,
                         "reference": r.reference, "doi": ""})
    # (b) markers named as lead / flanking marker of the same trait by >= 2 independent studies
    q = d[d["record_type"].isin(["QTL", "GWAS"])].copy()
    q["study"] = q["pmid"].fillna("").where(q["pmid"].fillna("") != "", q["source_dataset"].fillna(""))
    text = q["lead_marker"].fillna("") + " " + q["flanking_markers"].fillna("")
    tok = text.map(lambda s: sorted(set(SSR_RX.findall(s))) if s.strip() else [])
    x = q.assign(marker=tok).explode("marker").dropna(subset=["marker"])
    x = x[~x["marker"].str.match(r"^(TM|SNP|Marker|i|GH)\d+$") | x["marker"].str.match(r"^(TM|i)\d+")]
    g = x.groupby(["marker", "trait_harmonized"])
    rep = g.agg(category=("trait_category", "first"), n_studies=("study", "nunique"),
                chromosome=("chromosome", lambda s: "; ".join(sorted({c for c in s if isinstance(c, str) and c}))[:40]),
                species=("species", lambda s: "; ".join(sorted(set(map(str, s))))[:80]),
                reference=("first_author", lambda s: "; ".join(sorted({str(a) for a in s if isinstance(a, str)}))[:120]),
                qtl=("qtl_name", lambda s: "; ".join(list(dict.fromkeys(a for a in s if isinstance(a, str) and a))[:4])[:120])
                ).reset_index()
    rep = rep[rep["n_studies"] >= 2]
    for r in rep.itertuples():
        rows.append({"marker": r.marker, "trait": r.trait_harmonized, "category": r.category, "marker_type": "",
                     "chromosome": r.chromosome, "n_studies": r.n_studies, "primers": "",
                     "evidence": "replicated QTL marker", "context": r.qtl, "species": r.species, "reference": r.reference, "doi": ""})
    # (c) targeted primer tables from papers (genome-wide primer catalogues are left in data/literature)
    pr = pd.read_csv(f"{proj}/data/literature/extracted/literature_primers.tsv", sep="\t", dtype=str).fillna("")
    pr["tbl"] = pr["table_id"].str.rsplit("|", n=1).str[0]
    size = pr.groupby("tbl")["marker"].transform("size")
    pr = pr[(size <= 400) & (pr["marker"].str.len() > 1)]
    labels = paper_label(lit)
    for r in pr.itertuples():
        lab = labels.get(r.paper_id, (r.first_author + " " + r.year, "", r.doi, r.pmid))
        ptrait = r.trait_harmonized or H.harmonise_trait(lab[1])[0] if (r.trait_harmonized or H.harmonise_trait(lab[1])[1] != "unclassified") else ""
        pcat = r.trait_category or (H.harmonise_trait(lab[1])[1] if ptrait else "")
        if not ptrait:
            continue
        rows.append({"marker": r.marker, "trait": ptrait, "category": pcat, "marker_type": r.marker_type,
                     "chromosome": r.chromosome, "n_studies": 1, "primers": r.primers,
                     "evidence": "primer table, validation / fine-mapping study" if r.validation_context == "1" else "primer table from a mapping study",
                     "context": r.caption[:160], "species": "", "reference": lab[0], "doi": link(lab[2], lab[3])})
    mk = pd.DataFrame(rows)
    # fill in primers from the catalogue wherever a trait-linked marker has none of its own
    looked = mk["marker"].map(lambda m: primers.get(primer_key(m), ""))
    mk["primers"] = mk["primers"].fillna("").where(mk["primers"].fillna("") != "", looked)
    mk["category"] = mk["category"].map(CATEGORY_LABEL)
    mk = mk.dropna(subset=["category"]).sort_values(["n_studies", "marker"], ascending=[False, True])
    mk.to_csv(f"{out}/markers.csv", index=False)
    print("maps:", len(idx), idx["source"].value_counts().to_dict(), "| loci:", int(idx["n_loci"].sum()),
          "| markers:", len(mk), mk["evidence"].value_counts().to_dict())
    print("trait-linked markers with primers:", int((mk["primers"] != "").sum()), "of", len(mk),
          "| replicated with primers:", int(((mk["primers"] != "") & (mk["evidence"] == "replicated QTL marker")).sum()))
    return len(idx), int(idx["n_loci"].sum()), len(mk), n_primers, int((mk["primers"] != "").sum())


def main(proj):
    out = f"{proj}/website/public/data"
    os.makedirs(out, exist_ok=True)
    d = pd.read_csv(f"{proj}/data/processed/records_deduplicated.tsv", sep="\t", dtype=str, low_memory=False)
    for c in ["phys_start", "phys_end", "cm_start", "cm_stop", "cm_peak", "lod", "r2_pct", "neg_log10_p"]:
        d[c] = pd.to_numeric(d[c], errors="coerce")
    n_unresolved = int((d["trait_category"] == "unclassified").sum())
    # records whose trait could not be harmonised are kept, under the category "Unclassified" with their own trait name
    # common-axis positions and hotspot membership from the analysis
    ax = pd.read_csv(f"{proj}/analysis/tables/records_common_axis.tsv", sep="\t",
                     usecols=["record_id", "chromosome", "pos", "projection"])
    d = d.merge(ax.rename(columns={"pos": "map_bp", "chromosome": "map_chr", "projection": "map_method"}),
                on="record_id", how="left")
    hs = pd.read_csv(f"{proj}/analysis/tables/hotspots.tsv", sep="\t")
    d["hotspot_id"] = ""
    for h in hs.itertuples():
        m = (d["chromosome"] == h.chromosome) & d["map_bp"].between(h.start, h.end - 1)
        d.loc[m, "hotspot_id"] = h.hotspot_id
    site = base_frame(d)
    site["record_type"] = d["record_type"]
    site["subtype"] = d["record_subtype"].fillna("")

    # QTL (linkage) - one row per record
    qtl = site[site.record_type == "QTL"].drop(columns=["record_type", "neg_log10_p"])
    qtl.to_csv(f"{out}/qtl.csv", index=False)

    # GWAS - one row per locus (lead = most significant record); SNP-level rows stay in data/processed
    g = site[site.record_type == "GWAS"].copy()
    g["_p"] = d.loc[g.index, "neg_log10_p"].fillna(-1)
    g["_study"] = d.loc[g.index, "pmid"].fillna("").where(d.loc[g.index, "pmid"].fillna("") != "", d.loc[g.index, "source_dataset"])
    grp = g.groupby("locus_id")
    lead = g.sort_values("_p", ascending=False).drop_duplicates("locus_id").set_index("locus_id")
    lead["n_associations"] = grp.size()
    lead["n_studies"] = grp["_study"].nunique()
    span = d.loc[g.index].assign(locus_id=g["locus_id"]).groupby("locus_id").agg(a=("phys_start", "min"), b=("phys_end", "max"))
    has = span["a"].notna()
    lead.loc[has[has].index, "position_interval"] = [
        str(int(a)) if a == b else f"{int(a)}-{int(b)}" for a, b in zip(span.loc[has, "a"], span.loc[has, "b"])]
    gwas = lead.reset_index().drop(columns=["record_type", "subtype", "_p", "_study", "lod", "cross"])
    gwas["lead_record"] = gwas["id"]          # record id of the lead association (key of coordinates_lifted)
    gwas["id"] = gwas["locus_id"]
    gwas.to_csv(f"{out}/gwas.csv", index=False)

    keep_meta = ["id", "species", "trait", "parameter", "trait_original", "qtl_name", "chromosome", "position_interval",
                 "position_unit", "associated_markers", "lod", "pve", "candidate_gene", "population", "reference", "doi",
                 "source", "evidence"]
    site[site.record_type == "meta-QTL"][keep_meta].rename(columns={"qtl_name": "mqtl_name"}).to_csv(f"{out}/metaqtl.csv", index=False)
    site[site.record_type == "QTL cluster"][keep_meta + ["map_bp", "hotspot_id"]].to_csv(f"{out}/clusters.csv", index=False)
    e = site[site.record_type == "epistatic QTL"].copy()
    e["locus2"] = d.loc[e.index, "partner_locus"].fillna("").str[:100]
    e["effect"] = d.loc[e.index, "additive_effect"].fillna("").str[:30]
    e["locus1"] = e["qtl_name"].where(e["qtl_name"] != "", e["associated_markers"])
    de = d.loc[e.index]
    e["chromosome2"] = de["partner_chromosome"].fillna("")
    p1 = pd.to_numeric(de["phys_start"], errors="coerce")
    p2 = pd.to_numeric(de["partner_pos_bp"], errors="coerce")
    e["pos1_bp"] = p1.map(lambda v: "" if pd.isna(v) else str(int(v)))
    e["pos2_bp"] = p2.map(lambda v: "" if pd.isna(v) else str(int(v)))
    e["markers1"] = de["lead_marker"].fillna("").str[:100]
    e["markers2"] = de["partner_marker"].fillna("").str[:100]
    e["neg_log10_p"] = de["neg_log10_p"].map(fmt)
    e["placement"] = np.where(p1.notna() & p2.notna(), "physical",
                              np.where((e["chromosome"] != "") & (e["chromosome2"] != ""), "chromosome only", "unplaced"))
    e[["id", "species", "trait", "parameter", "trait_original", "locus1", "chromosome", "pos1_bp", "markers1", "chromosome2",
       "pos2_bp", "markers2", "locus2", "lod", "neg_log10_p", "pve", "effect", "placement", "population", "reference", "doi",
       "evidence"]].to_csv(f"{out}/epistatic.csv", index=False)
    m = site[site.record_type == "MTL"]
    m[["id", "species", "trait", "parameter", "trait_original", "qtl_name", "reference", "doi"]].assign(
        citation=d.loc[m.index, "citation"].fillna("").str[:300]).to_csv(f"{out}/mtl.csv", index=False)

    hs_site = hs.copy()
    hs_site["start_mb"], hs_site["end_mb"] = hs_site["start"] / 1e6, hs_site["end"] / 1e6
    hs_site.to_csv(f"{out}/hotspots.csv", index=False)
    pd.read_csv(f"{proj}/analysis/tables/windows_2mb.tsv", sep="\t")[
        ["chromosome", "start", "end", "n_studies", "n_loci", "n_traits", "q", "significant"]].to_csv(f"{out}/windows.csv", index=False)

    mq = pd.read_csv(f"{proj}/analysis/tables/meta_qtl.tsv", sep="\t")
    mq["category"] = mq["category"].map(CATEGORY_LABEL)
    for c in ["position_mb", "ci_start_mb", "ci_end_mb", "ci_width_mb", "span_start_mb", "span_end_mb", "mean_pve",
              "max_lod", "max_neg_log10_p", "mean_membership"]:
        mq[c] = mq[c].round(2)
    mq.to_csv(f"{out}/mqtl.csv", index=False)
    cov = pd.read_csv(f"{proj}/analysis/tables/meta_qtl_trait_coverage.tsv", sep="\t")
    # classic meta-QTL on the consensus genetic map (analysis/meta_qtl_cm.R), and one coverage row per database trait
    cm_path = f"{proj}/analysis/tables/meta_qtl_cm.tsv"
    if os.path.exists(cm_path):
        mc = pd.read_csv(cm_path, sep="\t")
        mc["category"] = mc["category"].map(CATEGORY_LABEL).fillna(mc["category"])
        for c in ["position_cm", "ci_start_cm", "ci_end_cm", "ci_width_cm", "span_start_cm", "span_end_cm", "mean_membership",
                  "physical_median_mb", "physical_q1_mb", "physical_q3_mb"]:
            mc[c] = mc[c].round(2)
        mc.to_csv(f"{out}/mqtl_cm.csv", index=False)
        cc = pd.read_csv(f"{proj}/analysis/tables/meta_qtl_cm_trait_coverage.tsv", sep="\t")
        cc = cc[["trait", "n_projected_qtl", "n_cm_meta_qtl", "status"]].rename(
            columns={"n_projected_qtl": "n_qtl_on_consensus_map", "status": "status_cm"})
        cov = cov.rename(columns={"n_meta_qtl": "n_physical_meta_qtl", "status": "status_physical"}).merge(cc, on="trait", how="left")
        cov["n_cm_meta_qtl"] = cov["n_cm_meta_qtl"].fillna(0).astype(int)
        cov["n_qtl_on_consensus_map"] = cov["n_qtl_on_consensus_map"].fillna(0).astype(int)
        cmap = pd.read_csv(f"{proj}/data/processed/consensus_map.tsv", sep="\t")
        cmap.to_csv(f"{out}/consensus_map.csv", index=False)
    cov["category"] = cov["category"].map(CATEGORY_LABEL).fillna(cov["category"])
    cov.to_csv(f"{out}/mqtl_trait_coverage.csv", index=False)

    # computed multi-trait QTL (analysis/multi_trait.py) and cloned / validated genes (scripts/cloned_genes.py)
    n_mtq = n_mtc = n_cg = n_cg_genes = 0
    p_mt = f"{proj}/analysis/tables/multi_trait_qtl.tsv"
    if os.path.exists(p_mt):
        mt = pd.read_csv(p_mt, sep="\t", dtype={"pmid": str})
        mt["pmid"] = mt["pmid"].fillna("").str.replace(r"\.0$", "", regex=True)
        mt["reference"] = [link(a, b) for a, b in zip(mt["doi"].fillna(""), mt["pmid"])]
        mt["study_label"] = mt["first_author"].fillna("").astype(str) + " " + mt["year"].fillna(0).astype(int).astype(str).replace("0", "")
        for c in ("start", "end", "span"):
            mt[c] = np.where(mt.unit == "bp", (mt[c] / 1e6).round(3), mt[c].round(1))
        mt["unit"] = mt.unit.map({"bp": "Mb", "cM": "cM"})
        for c in ("utx_v2_1_start_mb", "utx_v2_1_end_mb"):
            mt[c] = mt[c].round(2)
        mt["categories"] = mt.categories.str.split("; ").map(lambda v: "; ".join(CATEGORY_LABEL.get(x, x) for x in v))
        mt[["mt_id", "kind", "study_label", "chromosome", "placement", "start", "end", "unit", "span", "utx_v2_1_start_mb",
            "utx_v2_1_end_mb", "n_traits", "traits", "categories", "n_records", "markers", "qtl_names", "broad", "source_db",
            "reference"]].to_csv(f"{out}/multitrait_qtl.csv", index=False)
        mtc = pd.read_csv(f"{proj}/analysis/tables/multi_trait_mqtl_clusters.tsv", sep="\t")
        for c in ("start_mb", "end_mb", "core_start_mb", "core_end_mb", "span_mb"):
            mtc[c] = mtc[c].round(2)
        mtc["categories"] = mtc.categories.str.split("; ").map(lambda v: "; ".join(CATEGORY_LABEL.get(x, x) for x in v))
        mtc.to_csv(f"{out}/multitrait_mqtl_clusters.csv", index=False)
        n_mtq, n_mtc = len(mt), len(mtc)
    p_cg = f"{proj}/data/processed/cloned_genes.tsv"
    if os.path.exists(p_cg):
        cg = pd.read_csv(p_cg, sep="\t", dtype=str).fillna("")
        cg["reference"] = [link(a, b) for a, b in zip(cg["doi"], cg["pmid"])]
        cg["trait_category"] = cg.trait_category.map(CATEGORY_LABEL).fillna(cg.trait_category)
        cg["utx_v2_1_mb"] = [f"{float(a) / 1e6:.3f}" if a else (f"{float(b):.2f}" if b else "")
                             for a, b in zip(cg.utx_v2_1_start, cg.utx_v2_1_mb_from_records)]
        cg["study_label"] = cg.first_author + " " + cg.year
        cg[["cloned_gene_id", "gene", "gene_type", "trait_harmonized", "trait_category", "traits_mentioned", "evidence_tier",
            "mapping_evidence", "validation_methods", "species", "chromosome", "utx_v2_1_gene", "utx_v2_1_mb",
            "n_records_naming_gene", "study_label", "journal", "title", "reference"]].to_csv(f"{out}/cloned_genes.csv", index=False)
        n_cg, n_cg_genes = len(cg), cg.gene.str.lower().nunique()

    lit = pd.concat([pd.read_csv(f"{proj}/data/literature/{n}", sep="\t", dtype=str) for n in ("literature_index.tsv", "library_index.tsv") if os.path.exists(f"{proj}/data/literature/{n}")], ignore_index=True).fillna("")
    n_maps, n_map_loci, n_markers, n_primers, n_markers_primers = export_maps_and_markers(proj, out, d, lit)
    cat = pd.read_csv(f"{proj}/data/literature/extracted/literature_table_catalog.tsv", sep="\t", dtype=str).fillna("")
    cat["n"] = cat["n_records"].astype(int)
    nrec = cat.groupby("paper_id")["n"].sum()
    pid = lit["pmcid"].where(lit["pmcid"] != "", "doi:" + lit["doi"])
    kinds = [("is_qtl_linkage", "Linkage QTL"), ("is_gwas", "GWAS"), ("is_meta_qtl", "Meta-QTL"), ("is_epistasis", "Epistasis"),
             ("is_multi_trait", "Multi-trait"), ("is_qtl_x_env", "QTL×E"), ("is_fine_mapping", "Fine mapping"),
             ("is_bsa", "BSA"), ("is_eqtl_omics", "eQTL/omics"), ("is_review", "Review")]
    pd.DataFrame({
        "pmid": lit["pmid"], "pmcid": lit["pmcid"], "year": lit["year"], "title": lit["title"].str[:260],
        "authors": lit["authors"].str[:80], "journal": lit["journal"].str[:60],
        "study_type": ["; ".join(lbl for col, lbl in kinds if r[col] == "1") for _, r in lit.iterrows()],
        "open_access": lit["is_open_access"], "records_extracted": pid.map(nrec).fillna(0).astype(int),
        "doi": [link(a, b) for a, b in zip(lit["doi"], lit["pmid"])],
    }).sort_values(["year", "title"], ascending=[False, True]).to_csv(f"{out}/literature.csv", index=False)

    # summary for the home / statistics / insights pages
    ins = json.load(open(f"{proj}/analysis/insights.json"))
    core = d[d.record_type.isin(["QTL", "GWAS"])]
    summary = {
        "built": __import__("datetime").date.today().isoformat(),
        "counts": {"qtl": int(len(qtl)), "gwas_loci": int(len(gwas)),
                   "gwas_associations": int((site.record_type == "GWAS").sum()),
                   "metaqtl": int((site.record_type == "meta-QTL").sum()),
                   "mqtl": int(len(mq)), "mqtl_high": int((mq.confidence == "high").sum()),
                   "mqtl_moderate": int((mq.confidence == "moderate").sum()),
                   "mqtl_in_hotspots": int(mq.hotspot_id.fillna("").ne("").sum()),
                   "mqtl_traits": int(mq.trait.nunique()), "mqtl_qtl_gwas": int((mq.evidence_class == "QTL + GWAS").sum()),
                   "mqtl_median_ci_mb": float(mq.ci_width_mb.median()),
                   "epistatic": int((site.record_type == "epistatic QTL").sum()),
                   "clusters": int((site.record_type == "QTL cluster").sum()), "mtl": int(len(m)),
                   "multitrait_qtl": n_mtq, "multitrait_mqtl_clusters": n_mtc, "cloned_gene_rows": n_cg, "cloned_genes": n_cg_genes,
                   "hotspots": int(len(hs)), "papers_indexed": int(len(lit)),
                   "studies_with_data": int(pd.read_csv(f"{proj}/data/processed/studies.tsv", sep="\t").shape[0]),
                   "loci": int(d["locus_cluster_id"].nunique()), "records_unresolved_trait": n_unresolved,
                   "maps": n_maps, "map_loci": n_map_loci, "markers": n_markers,
                   "primer_catalog": n_primers, "markers_with_primers": n_markers_primers,
                   "epistatic_physical": int((e["placement"] == "physical").sum()),
                   "traits": int(d[d.trait_category != "unclassified"]["trait_harmonized"].nunique()),
                   "species": int(d["species"].nunique()),
                   "trait_names": int(d["trait_original"].str.strip().str.lower().nunique()),
                   "categories": int(d["trait_category"].nunique()),
                   "papers_not_in_pmc": int((lit["in_pmc"] != "Y").sum())},
        "by_source": d.groupby("source_db").size().to_dict(),
        "by_species": core.groupby("species").size().sort_values(ascending=False).head(10).to_dict(),
        "by_category": {CATEGORY_LABEL[k]: {"qtl": int(((core.trait_category == k) & (core.record_type == "QTL")).sum()),
                                            "gwas_loci": int(core[(core.trait_category == k) & (core.record_type == "GWAS")]["locus_cluster_id"].nunique())}
                        for k in CATEGORY_LABEL},
        "top_traits": core.groupby("trait_harmonized")["locus_cluster_id"].nunique()
                      .sort_values(ascending=False).head(20).to_dict(),
        "per_chromosome": pd.read_csv(f"{proj}/analysis/tables/per_chromosome.tsv", sep="\t").to_dict("records"),
        "papers_per_year": pd.read_csv(f"{proj}/analysis/tables/papers_per_year.tsv", sep="\t").to_dict("records"),
        "subgenome_bias": pd.read_csv(f"{proj}/analysis/tables/subgenome_bias.tsv", sep="\t").to_dict("records"),
        "effect_sizes": pd.read_csv(f"{proj}/analysis/tables/qtl_effect_sizes.tsv", sep="\t").to_dict("records"),
        "insights": {k: v for k, v in ins.items() if k != "trait_chr"} | {"trait_chr": {k: v for k, v in ins["trait_chr"].items() if k != "top"}},
    }
    summary["insights"]["hotspots"].pop("top", None)
    # source comparison (analysis/source_comparison.py runs first; keep its block)
    if os.path.exists(f"{proj}/analysis/comparison.json"):
        summary["comparison"] = json.load(open(f"{proj}/analysis/comparison.json"))
    # the best supported hotspots and meta-QTL, quoted in the text of the Insights page
    summary["top_hotspots"] = [{"id": r.hotspot_id, "chr": r.chromosome, "start_mb": round(r.start / 1e6, 1),
                                "end_mb": round(r.end / 1e6, 1), "studies": int(r.n_studies)}
                               for r in hs.sort_values("n_studies", ascending=False).head(5).itertuples()]
    summary["top_mqtl"] = [{"id": r.mqtl_id, "trait": r.trait, "chr": r.chromosome, "pos_mb": round(r.position_mb, 1),
                            "studies": int(r.n_studies)}
                           for r in mq.sort_values(["n_studies", "n_observations"], ascending=False).head(3).itertuples()]
    with open(f"{out}/summary.json", "w") as fh:
        json.dump(summary, fh, indent=1, default=float)

    figs = f"{proj}/website/public/figures"
    os.makedirs(figs, exist_ok=True)
    for f in os.listdir(f"{proj}/analysis/figures"):
        shutil.copy(f"{proj}/analysis/figures/{f}", figs)
    for f in sorted(os.listdir(out)):
        print(f"{os.path.getsize(os.path.join(out, f)) / 1e6:8.2f} MB  {f}")
    print(json.dumps(summary["counts"]))


if __name__ == "__main__":
    main(sys.argv[1])
