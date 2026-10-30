# CottonQTLDb — collected cotton (*Gossypium*) QTL / GWAS data

Snapshot built 2026-10-10. Everything here was downloaded from public databases and the
literature, then harmonised into one schema with explicit redundancy flags.

## Layout

```
data/raw/                     untouched downloads, one folder per database
  cottongen/megasearch/       CottonGen QTL/GWAS/MTL export (ALL + per type)
  gwas_atlas/                 GWAS Atlas cotton associations + PPTO ontology
  cottonmd/                   CottonMD GWAS: 500-kb bins and SNPs with p<1e-5, per trait
  cottongvd/                  CottonGVD GWAS: best -log10(P) per 500-kb bin, per trait
  cottonqtlome_archive/        Wayback copy of CottonQTLdb pages (traits, 92 source references)
data/literature/
  literature_index.tsv        1,434 cotton QTL/GWAS papers (Europe PMC) with study-type flags
  papers/<PMCID>/             full-text XML, tables/*.tsv, supplementary/*
  springer_esm/<doi>/         openly served supplements of Springer papers not in PMC
  fulltext_status.tsv, springer_esm_status.tsv
  extracted/literature_table_catalog.tsv   every table/sheet seen, its class, records produced
  extracted/literature_records.tsv         records auto-extracted from those tables
data/processed/               the harmonised database (see below)
scripts/                      everything needed to rebuild
logs/
```

## Processed outputs (`data/processed/`)

| File | Content |
|---|---|
| `records_all.tsv` | every harmonised record, with redundancy flags |
| `records_deduplicated.tsv` | same, without records flagged `duplicate_of` |
| `loci_nonredundant.tsv` | one row per locus cluster with a representative record and support counts |
| `multitrait_hotspots.tsv` | regions where loci for ≥2 harmonised traits co-localise |
| `by_type/` | de-duplicated records split by type: `qtl`, `gwas`, `meta_qtl`, `epistatic_qtl`, `qtl_cluster`, `qtl_qtl_x_environment`, `mtl` |
| `trait_dictionary.tsv` | original trait name → harmonised trait / category, per source |
| `trait_summary.tsv`, `studies.tsv` | per-trait and per-study counts |
| `cotton_qtl.sqlite` | all of the above as tables, plus computed `meta_qtl`, `meta_qtl_members`, `meta_qtl_models`, and `meta_qtl_trait_coverage` |

### Record counts in this build

| Record type | Records | After de-duplication | Loci |
|---|---|---|---|
| GWAS associations | 288,002 | 138,288 | 32,768 |
| QTL (linkage mapping) | 55,858 | 52,653 | 38,310 |
| meta-QTL | 4,653 | 4,309 | 2,492 |
| QTL clusters / pleiotropic regions | 3,084 | 2,765 | 2,621 |
| epistatic QTL pairs | 1,025 | 941 | 770 |
| MTL (qualitative / Mendelian loci) | 208 | 208 | 208 |

| Source | Records | Notes |
|---|---|---|
| CottonGen | 68,422 | curated; 9,271 QTL, 58,943 GWAS, 208 MTL from 257 citations |
| Literature | 237,941 | auto-extracted from 553 tables of 253 papers |
| CottonGVD | 24,295 | loci = 500-kb bins with -log10(P) ≥ 6; 5 panels, 1,278 trait files downloaded, 992 with loci |
| GWAS Atlas | 21,955 | curated SNP associations, 4 publications |
| CottonMD | 217 | genome-wide significant loci, 45 traits |

## Key columns of `records_all.tsv`

`record_id`, `record_type`, `record_subtype`, `source_db`, `source_dataset`, `source_record_id`,
`qtl_name`, `trait_original`, `trait_harmonized`, `trait_category`, `species`, `genome_group`,
`population`, parents, `sample_size`, `environment`, `chromosome` (A01–A13 / D01–D13; c1–c26 converted),
`ref_genome`, `seqid`, `phys_start`, `phys_end`, `map_name`, `linkage_group`, `cm_start`, `cm_stop`,
`cm_peak`, `lead_marker`, `flanking_markers`, `candidate_genes`, `p_value`, `neg_log10_p`, `lod`,
`r2_pct`, `additive_effect`, `stat_note`, `partner_locus` (second locus of an epistatic pair),
`pmid`, `doi`, `year`, `first_author`, `citation`, `n_source_rows`,
`duplicate_of`, `locus_cluster_id`, `cluster_basis`, `multitrait_hotspot_id`.

## How redundancy is handled

Nothing is deleted; redundancy is flagged in three layers.

1. **Within-source expansion.** CottonGen lists a QTL once per marker/alignment/citation
   (88,769 rows → 68,422 records). Multi-valued fields are joined with `; `; `n_source_rows` keeps the count.
2. **`duplicate_of`.** Same record type, study, trait, environment/QTL name, chromosome, position and
   statistics. The kept copy follows the priority CottonGen > Literature > GWAS Atlas > CottonMD > CottonGVD.
   Most hits are supplementary tables that repeat one SNP per annotated gene.
3. **`locus_cluster_id`.** Records for the same harmonised trait that co-localise:
   `PL…` physical (same assembly and chromosome, intervals within 500 kb),
   `GL…` genetic (same map and linkage group, within 5 cM),
   `UL…` unplaced (no comparable coordinates; each record is its own locus).
   `loci_nonredundant.tsv` gives one representative per cluster plus `n_records`, `n_sources`, `n_studies`.

Thresholds are constants at the top of `scripts/build_database.py`.

## Known limits — read before using

- **Literature records are machine-extracted and unreviewed.** Column mapping is heuristic; expect
  wrong or missing fields in a minority of tables. `source_record_id` points to the exact table and row,
  and `literature_table_catalog.tsv` lists every table with the class it was given.
- **No cross-assembly clustering.** Coordinates are compared only within one reference assembly;
  literature coordinates whose assembly is not stated are compared only within their own paper.
  Only 148 loci are supported by two sources for this reason. Linkage QTL from different maps are not
  merged (that needs projection onto a consensus map).
- **Coverage gaps.** 628 of 1,434 indexed papers are not in PMC; only their metadata (and, for 152
  Springer papers, supplements) were obtained. 595 supplementary files (mostly PDF) were downloaded but
  not parsed. The original CottonQTLdb site (Said et al. 2015) is offline and its QTL table was never archived.
- **CottonGen P-value field.** For six GWAS datasets the exported values (~0.65–1.5) are not p-values;
  they are blanked and explained in `stat_note`.
- **CottonMD** panel "Unpublished2 (248)" (12 traits) is listed by the site but its data are not served.
- **CottonGVD** exposes SNP-level results only 10 rows per request (5.6 M rows), so 500-kb bin
  summaries were taken instead; lead SNPs are not included. Panel AD1.383 uses undocumented trait codes.
- **Trait harmonisation** is rule-based (`scripts/harmonize.py`): 60 harmonised traits in 11 categories
  cover ~80 % of de-duplicated records; the rest keep their cleaned original name under `unclassified`.
- eQTL / TWAS data were deliberately left out.

## Rebuild

```
python3 scripts/cottongen_megasearch.py data/raw/cottongen/megasearch ALL QTL GWAS MTL
python3 scripts/cottonmd_gwas.py        data/raw/cottonmd
python3 scripts/cottongvd_gwas.py       data/raw/cottongvd
python3 scripts/literature_harvest.py   data/literature all
python3 scripts/springer_esm.py         data/literature
python3 scripts/extract_literature.py   .
python3 scripts/build_database.py       .
```
GWAS Atlas file: `ftp://download.big.ac.cn/gwas_atlas/gwas_association_result_for_cotton.txt.gz`.
Requires Python ≥ 3.10 with pandas, openpyxl, xlrd; `.doc` supplements are converted with macOS `textutil`.

## Analysis and website

```
analysis/hotspot_analysis.py   chromosome/subgenome distribution, study-supported hotspots, effect sizes
analysis/meta_qtl.R            physical meta-QTL per trait x chromosome in R (mixture model, BIC) -> tables/meta_qtl*.tsv
scripts/integrate_meta_qtl.py load computed meta-QTL and per-trait coverage into SQLite
analysis/source_comparison.py  what each source contributes; fig8-fig9; comparison block for the site
manuscript/                    manuscript source, verified references, build script, .md and .docx
analysis/tables/               hotspots.tsv, windows_2mb.tsv, per_chromosome.tsv, subgenome_bias.tsv, ...
analysis/figures/              fig1-fig7 (PNG + SVG)
analysis/insights.json         every number quoted on the site's Insights page
website/                       static site adapted from WheatQTLdb V3.0 (see website/README.md)
reference/WheatQTLdbV3.0/      untouched clone of the original wheat site
```

Rebuild after changing the database:

```
python3 scripts/cottongen_maps_markers.py data/raw/cottongen   # genetic maps, marker positions, trait markers
python3 scripts/cottongen_primers.py data/raw/cottongen        # primer sequences, all marker types
python3 scripts/liftover.py                                     # positions on every assembly (data/genomes/README.md)
python3 analysis/hotspot_analysis.py .
Rscript analysis/meta_qtl.R .
python3 scripts/integrate_meta_qtl.py .
python3 analysis/source_comparison.py .
python3 scripts/export_site_data.py .
python3 scripts/export_assemblies.py                            # assembly selector + all-assemblies download
python3 scripts/export_marker_index.py                          # marker lookup for the linkage-map plotter
python3 scripts/validate_data.py                                # checks every table; exit 1 on a failure
(cd manuscript && python3 build_manuscript.py)
cd website && npm run build
```

`scripts/validate_data.py` writes `analysis/tables/validation_report.md` (one line per check) and
`validation_issues.tsv` (every flagged record with its study). `build_database.py` removes values that
cannot be right (P > 1, PVE outside 0-100 %, cM fields holding bp, positions > 250 Mb, chromosomes of the
wrong genome) and lists each one in `data/processed/sanitise_log.tsv`.

The meta-QTL scan assesses every harmonised trait label. A component is reported only when
at least two independent studies support it on the same chromosome. Labels without a usable
trait name are excluded from model fitting; all other labels, including `unclassified` ones,
are evaluated. `analysis/tables/meta_qtl_trait_coverage.tsv` records the evidence count and
outcome for every database trait. Unclassified trait names and relative cross-assembly
positions require manual review before biological interpretation.

In this build, 163 trait labels were assessed: 41 yielded 4,372 computed meta-QTL; one
was modelled without a supported component; 81 lacked two studies on a common chromosome;
37 had no usable common-axis coordinates; and three labels did not name a trait.
