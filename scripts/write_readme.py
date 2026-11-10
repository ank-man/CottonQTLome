#!/usr/bin/env python3
"""Write README.md with every count taken from the current build (run after the pipeline).

Usage: python3 scripts/write_readme.py
"""
import json
import os
from datetime import date

import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def rd(p, **kw):
    return pd.read_csv(f"{ROOT}/{p}", sep="\t", low_memory=False, **kw)


f = lambda v: f"{int(v):,}"  # noqa: E731
a = rd("data/processed/records_all.tsv", dtype=str, usecols=["record_type", "source_db", "duplicate_of", "locus_cluster_id", "trait_category"])
d = a[a.duplicate_of.isna()]
types = [("GWAS", "GWAS associations"), ("QTL", "QTL (linkage mapping)"), ("meta-QTL", "published meta-QTL"),
         ("QTL cluster", "QTL clusters / pleiotropic regions"), ("epistatic QTL", "epistatic QTL pairs"),
         ("MTL", "MTL (qualitative / Mendelian loci)")]
rows_t = "\n".join(f"| {lab} | {f((a.record_type == t).sum())} | {f((d.record_type == t).sum())} | "
                   f"{f(d[d.record_type == t].locus_cluster_id.nunique())} |" for t, lab in types)
src = a.source_db.value_counts()
s = json.load(open(f"{ROOT}/website/public/data/summary.json"))
c = s["counts"]
lit = pd.concat([rd(f"data/literature/{n}", dtype=str) for n in ("literature_index.tsv", "library_index.tsv")
                 if os.path.exists(f"{ROOT}/data/literature/{n}")])
cat = rd("data/literature/extracted/literature_table_catalog.tsv", dtype=str)
cat["n_records"] = pd.to_numeric(cat.n_records, errors="coerce").fillna(0)
lib = json.load(open(f"{ROOT}/data/literature/library_folders.json"))
ts = rd("data/processed/trait_summary.tsv")
named = ts[ts.trait_category != "unclassified"]
mq, mc = rd("analysis/tables/meta_qtl.tsv"), rd("analysis/tables/meta_qtl_cm.tsv")
cov = rd("analysis/tables/meta_qtl_cm_trait_coverage.tsv")
cm = rd("data/processed/consensus_map.tsv")
pj = rd("analysis/tables/qtl_consensus_projection.tsv")
hs = rd("analysis/tables/hotspots.tsv")
mtc, mtq = rd("analysis/tables/multi_trait_mqtl_clusters.tsv"), rd("analysis/tables/multi_trait_qtl.tsv")
cg = rd("data/processed/cloned_genes.tsv", dtype=str)
st = rd("data/processed/studies.tsv", dtype=str)
nq = (d.record_type == "QTL").sum()
match = mc.physical_mqtl.fillna("").ne("").sum(); withp = mc.physical_q1_mb.notna().sum()
dfrac = d.trait_category.ne("unclassified").mean()
n_amb = rd("data/processed/records_deduplicated.tsv", dtype=str, usecols=["stat_note"]).stat_note.fillna("").str.contains("numbering assumed").sum()

text = f"""# CottonQTLome — integrated cotton (*Gossypium*) QTL, GWAS and meta-QTL database

Website: https://cottonqtlome.org (mirror: https://ank-man.github.io/CottonQTLome/) · Build of {date.today():%Y-%m-%d}.
Every record was collected from public databases or extracted from published tables, harmonised into one
schema, placed on one physical reference (*G. hirsutum* TM-1 UTX v2.1), and traced to its source table.

## At a glance

| | |
|---|---|
| Records (all / after de-duplication) | {f(len(a))} / {f(len(d))} |
| Linkage QTL · GWAS associations · GWAS loci | {f(c['qtl'])} · {f(c['gwas_associations'])} · {f(c['gwas_loci'])} |
| Epistatic pairs · QTL clusters · MTL | {f(c['epistatic'])} · {f(c['clusters'])} · {f(c['mtl'])} |
| Studies with data · papers indexed | {f(len(st))} · {f(len(lit))} |
| Harmonised traits (named / total) | {f(len(named))} / {f(len(ts))}, in {named.trait_category.nunique()} categories ({dfrac:.0%} of records named) |
| Study-supported hotspots | {f(len(hs))} |
| Multi-trait meta-QTL clusters · multi-trait QTL within studies | {f(len(mtc))} · {f(len(mtq))} |
| Cloned / validated genes behind mapped loci | {f(cg.gene.str.lower().nunique())} genes from {f(cg.doi.fillna(cg.pmid).nunique())} papers |
| Physical meta-QTL (TM-1 UTX v2.1, Mb) | {f(len(mq))} for {mq.trait.nunique()} traits; {f((mq.confidence == 'high').sum())} high confidence |
| Genetic-map meta-QTL (consensus map, cM) | {f(len(mc))} for {mc.trait.nunique()} traits; {match / max(withp, 1):.0%} of comparable ones match a physical meta-QTL |
| Consensus genetic map | {f(len(cm))} markers, {f(cm.groupby('chromosome').cM.max().sum())} cM |
| Linkage maps · marker–trait links · primer entries | {f(c['maps'])} · {f(c['markers'])} · {f(c['primer_catalog'])} |

Every table can be downloaded from the website's Downloads page (https://cottonqtlome.org/downloads);
the complete files (all records, extracted tables, SQLite) are attached to the GitHub releases.

## Layout

```
data/raw/                     untouched downloads, one folder per database (not in the repository)
  cottongen/                  CottonGen QTL/GWAS/MTL export, genetic maps, marker positions, primers
  gwas_atlas/, cottonmd/, cottongvd/
  cottonqtlome_archive/       Wayback copy of the Cotton QTLdb pages (traits, source references)
data/literature/
  literature_index.tsv        papers found by the Europe PMC / Crossref search, with study-type flags
  library_index.tsv           papers added from files obtained through institutional library access
  library_folders.json        library folder -> DOI;  library_status.tsv: downloaded file -> DOI
  papers/, springer_esm/      open-access full text and supplements (not in the repository)
  library/                    licensed article files (never published; only values extracted from them are)
  extracted/                  table catalog, extracted records, linkage maps and primers
data/processed/               the harmonised database (below)
scripts/, analysis/           everything needed to rebuild
website/                      static site adapted from WheatQTLdb V3.0
```

## Processed outputs (`data/processed/`)

| File | Content |
|---|---|
| `records_all.tsv` | every harmonised record, with redundancy flags |
| `records_deduplicated.tsv` | the same, without records flagged `duplicate_of` |
| `loci_nonredundant.tsv` | one row per locus cluster with a representative record and support counts |
| `by_type/` | de-duplicated records split by type |
| `trait_dictionary.tsv`, `trait_summary.tsv`, `studies.tsv` | trait mapping and per-trait / per-study counts |
| `consensus_map.tsv` | consensus genetic map: marker, chromosome, cM, first map placing it, number of maps |
| `excluded_records.tsv`, `sanitise_log.tsv` | records removed by hand and values removed as impossible, with reasons |
| `cotton_qtl.sqlite` | all of the above as tables, plus the computed meta-QTL |

### Record counts

| Record type | Records | After de-duplication | Loci |
|---|---|---|---|
{rows_t}

| Source | Records |
|---|---|
""" + "\n".join(f"| {k} | {f(v)} |" for k, v in src.items()) + f"""

## Literature mining

- {f(len(lit))} papers indexed; {f(cat.paper_id.nunique())} papers with tables read; {f((cat.n_records > 0).sum())} tables gave records.
- Sources of tables: PubMed Central full-text XML and supplements, openly served Springer supplements, and
  {f(len(lib))} papers obtained through institutional library access. Files are matched to papers by DOI,
  publisher file-name patterns (resolved through Crossref) or the DOI printed on the first pages.
- Spreadsheets, delimited text, Word files and PDF tables are read. PDF tables are located from their captions
  and rebuilt from word positions (`scripts/pdf_tables.py`); records from PDFs say so in `stat_note`.
- Chromosome numbers 14–26 mean different chromosomes in the classical and the assembly-order numbering; each
  table is resolved from marker evidence, SNP names or positions, and the decision is written to `stat_note`.

## How redundancy is handled

Nothing is deleted; redundancy is flagged.

1. **Within-source expansion** — CottonGen rows repeated per marker or citation are collapsed to one record.
2. **`duplicate_of`, exact** — same record type, study, trait, environment / QTL name, chromosome, position and
   statistics. Priority of the kept copy: CottonGen > Literature > GWAS Atlas > CottonMD > CottonGVD.
3. **`duplicate_of`, copies** — one result held in two places (CottonGen and the paper, or one table read from
   the article and a supplement): same study, type, harmonised trait, chromosome and exact position, different
   source or table, no conflicting environment, every shared statistic within 0.5 %.
4. **`locus_cluster_id`** — co-localising records of one trait: `PL…` physical (≤ 500 kb, same assembly),
   `GL…` genetic (≤ 5 cM, same map and linkage group), `UL…` unplaced.

## Meta-QTL

- **Physical** (`analysis/meta_qtl.R`): QTL and GWAS loci on TM-1 UTX v2.1, one observation per study and locus,
  Gaussian mixture with per-observation variances (Goffinet & Gerber 2000), number of meta-QTL by BIC.
- **Genetic map** (`scripts/consensus_map.py`, `analysis/meta_qtl_cm.R`): a consensus map built around the AD
  genome-wide reference map (2009) by iterative projection of CottonGen and published maps through shared
  markers (as in BioMercator); linkage QTL projected from their own map or placed by flanking markers
  ({f(len(pj))} of {f(nq)} QTL); the same mixture model per trait and chromosome, in cM, with flanking markers.
- **Multi-trait QTL** (`analysis/multi_trait.py`): physical meta-QTL of different traits sharing one core interval
  (CI <= 5 Mb, no chaining) form multi-trait meta-QTL clusters; within a study, overlapping QTL intervals or GWAS
  signals at one SNP (<= 100 kb) for >= 2 traits form multi-trait QTL. Author-labelled clusters are kept as records.
- Every database trait is listed with the outcome of both analyses in `analysis/tables/meta_qtl_cm_trait_coverage.tsv`
  and on the website (Meta-QTL → All traits).

## Cloned and validated genes

`scripts/cloned_genes.py` searches Europe PMC titles and abstracts for cotton papers that tie a mapped locus
(map-based cloning, fine mapping, QTL, GWAS, BSA, mapped mutants) to a named gene, records how the gene was
confirmed (VIGS, CRISPR/Cas9, RNAi, over-expression, complementation, causal variant) and grades the evidence.
Output: `data/processed/cloned_genes.tsv` (decisions per paper in `data/literature/cloned_genes_papers_decisions.tsv`).

## Known limits — read before using

- **Mined records are unreviewed.** Column mapping is heuristic; `source_record_id` points to the table and row.
  PDF tables are more error-prone than XML or spreadsheets.
- **Positions:** many papers do not state their assembly; such positions are placed on UTX v2.1 by relative
  position and can be off by a few Mb (`projection` column of `analysis/tables/records_common_axis.tsv`).
- **Chromosome numbers:** {f(n_amb)} records whose numbering stayed ambiguous (classical numbering assumed) carry a note
  and may be misplaced.
- **Genetic-map meta-QTL** include only QTL on maps sharing markers with the consensus; QTL on maps with private
  SNP names are covered by the physical analysis only.
- **Traits:** {f(len(ts) - len(named))} trait names remain `unclassified` (mostly codes defined only in a paper's text).
- **Coverage:** not every paper outside PubMed Central could be obtained; the original Cotton QTLdb data table
  was never archived.
- **Cloned genes** are compiled from titles and abstracts; the evidence tier is assigned by rules and gene names are
  as published, so genes named only under old annotations are placed by chromosome, not position.
- eQTL / TWAS data were deliberately left out.

## Rebuild

```
python3 scripts/cottongen_megasearch.py data/raw/cottongen/megasearch ALL QTL GWAS MTL
python3 scripts/cottonmd_gwas.py        data/raw/cottonmd
python3 scripts/cottongvd_gwas.py       data/raw/cottongvd
python3 scripts/literature_harvest.py   data/literature all
python3 scripts/springer_esm.py         data/literature
python3 scripts/library_files.py . data/literature/uga_pdfs     # match downloaded files to papers (optional)
python3 scripts/extract_literature.py   .
python3 scripts/build_database.py       .
python3 scripts/cottongen_maps_markers.py data/raw/cottongen
python3 scripts/cottongen_primers.py      data/raw/cottongen
python3 scripts/liftover.py
python3 analysis/hotspot_analysis.py .
Rscript analysis/meta_qtl.R .
python3 scripts/consensus_map.py .
Rscript analysis/meta_qtl_cm.R .
python3 scripts/integrate_meta_qtl.py .
python3 analysis/multi_trait.py .
python3 scripts/cloned_genes.py .           # Europe PMC search cached in data/literature/cloned_genes_papers.tsv
python3 analysis/source_comparison.py .
python3 scripts/export_site_data.py .
python3 scripts/export_assemblies.py
python3 scripts/export_marker_index.py
python3 scripts/validate_data.py            # writes analysis/tables/validation_report.md; exit 1 on a failure
python3 scripts/export_gene_index.py
python3 analysis/expression_overlay.py && python3 scripts/export_expression.py   # organ expression (needs ../PolyploidQTLome quantifications)
python3 scripts/export_downloads.py         # download bundles + manifest for the Downloads page
python3 scripts/write_readme.py
cd website && npm run build
```

Requires Python ≥ 3.10 (pandas, openpyxl, xlrd, PyMuPDF), R with data.table, and Node 20 for the website.
GWAS Atlas file: `ftp://download.big.ac.cn/gwas_atlas/gwas_association_result_for_cotton.txt.gz`.
"""
open(f"{ROOT}/README.md", "w").write(text)
print("README.md written")
