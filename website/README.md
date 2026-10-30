# CottonQTLome website

Static site (React + Vite + Tailwind) for the cotton QTL / GWAS compilation, adapted from
[WheatQTLdb V3.0](https://github.com/ank-man/WheatQTLdbV3.0).

```
npm install
npm run dev        # http://localhost:5173
npm run build      # -> dist/
```

## Data

`public/data/` and `public/figures/` are generated - do not edit by hand:

```
python3 ../analysis/hotspot_analysis.py ..     # hotspots, tables, figures, insights.json
Rscript ../analysis/meta_qtl.R ..              # computed meta-QTL (R)
python3 ../scripts/export_site_data.py ..      # CSV/JSON for the site + copies figures
```

| File | Content |
|---|---|
| `qtl.csv` | linkage QTL, one row per de-duplicated record |
| `gwas.csv` | GWAS loci (lead association per locus, with counts) |
| `mqtl.csv` | meta-QTL computed by this project (consensus position, 95% CI, supporting studies) |
| `mqtl_trait_coverage.csv` | every database trait, with counts and the reason no meta-QTL was called |
| `metaqtl.csv` (rows from published meta-analyses), `epistatic.csv`, `clusters.csv`, `mtl.csv` | other record types |
| `maps.csv`, `maps/<id>.csv` | linkage maps (index and loci per map) |
| `markers.csv` | trait-linked markers graded by evidence |
| `marker_primers.csv` | primer catalogue for ~448k markers (download only; not loaded by the site) |
| `hotspots.csv`, `windows.csv` | hotspot regions and per-2-Mb-window study support |
| `literature.csv` | indexed papers with study-type tags |
| `summary.json` | counts and analysis results used by Home, Statistics and Insights |

## What differs from the wheat site

- 26 chromosomes A01–D13 on the TM-1 UTX v2.1 axis (`src/lib/map.ts`); no centromeres drawn.
- Trait categories come from the data (`trait` column) instead of being re-derived in the browser.
- New pages: GWAS loci, Qualitative trait loci, Hotspots, Insights, Literature, Linkage maps (with viewer), Trait-linked markers.
- Epistatic pairs are drawn as chords in the Circos view (physical pairs; chromosome-level pairs optional).
- Core QTL/GWAS views show named categories; the meta-QTL view also shows `Unclassified` labels where replicated evidence exists, with a review caveat.
- The map's interval track shows the computed meta-QTL or the hotspot regions; no epistatic chords.
- Every record carries an `evidence` flag (database vs auto-extracted).

## Deploy

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on push to `main`, with
`VITE_BASE=/<repo-name>/`. Set it to `/` if you add a custom domain (`public/CNAME`).

## User guide

The Tutorial page and `public/CottonQTLome_User_Guide.docx` are generated together from the
sections listed in `scripts/guide/capture.cjs` (annotated screenshots in `public/images/guide/`,
text in `src/lib/guide.json`). After any change to the pages or data, rebuild them:

```
npm run build
PYTHON=python3.13 CHROME=<chromium binary> NODE_PATH=<dir with playwright-core and docx> scripts/guide/build.sh
npm run build      # so the Tutorial page picks up the new guide.json
```

A callout whose element is not on screen is reported and left out, so check the script's output.
