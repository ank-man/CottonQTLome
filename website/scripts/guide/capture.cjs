/**
 * Screenshots for the CottonQTLome user guide.
 *
 * Each section below is one annotated screenshot: the page to open, how to
 * prepare it, and the things to point at. For every callout the element's
 * position on the screenshot is recorded, so annotate.py can draw a numbered
 * arrow to it. The same list (titles, text, callouts) is written to
 * src/lib/guide.json, which the Tutorial page and the Word guide both read -
 * the site and the document cannot drift apart.
 *
 * Run through scripts/guide/build.sh (needs the built site served locally).
 */
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright-core')

const BASE = process.env.GUIDE_BASE || 'http://localhost:4874'
const RAW = process.env.GUIDE_RAW
const SCALE = 2
const W = 1400

// the site scrolls smoothly; jump instead, so the screenshot is not taken mid-scroll
const scrollTo = (y) => async (p) => { await p.evaluate((v) => window.scrollTo({ top: v, behavior: 'instant' }), y); await p.waitForTimeout(500) }
const scrollToHeading = (name, offset = 90) => async (p) => {
  const h = p.getByRole('heading', { name }).first()
  await h.waitFor({ timeout: 90000 })
  const top = await h.evaluate((e) => e.getBoundingClientRect().top + window.scrollY)
  await scrollTo(top - 56 - offset)(p)
}
// the innermost element that contains all the given texts
const around = (p, first, ...rest) => p.locator('main').getByText(first, { exact: true }).first()
  .locator(`xpath=ancestor::*[${rest.map((t) => `.//text()[normalize-space(.)="${t}"]`).join(' and ')}][1]`)
const tableReady = (p) => p.getByRole('button', { name: 'Export CSV' }).first().waitFor({ timeout: 90000 })

// side: where the numbered badge sits relative to the element it points at
const SECTIONS = [
  {
    id: 'home', title: 'Overview (home page)', url: '/', height: 1000,
    intro: 'The overview page is the starting point: search everything at once, see how much the database holds, and jump to any part of it.',
    callouts: [
      { find: (p) => p.locator('aside nav'), side: 'right', label: 'Side menu', text: 'Every page, grouped as Explore, QTLome (the data tables), Maps, Analysis and About. The button at the top left hides or shows it.' },
      { find: (p) => p.getByRole('radiogroup', { name: 'Colour theme' }), side: 'bottom', label: 'Colour theme', text: 'Changes the colours of the site; the choice is remembered in your browser.' },
      { find: (p) => p.getByPlaceholder('Search QTL, trait, marker, gene, reference…'), side: 'left', label: 'Search box', text: 'Type a QTL name, trait, marker, gene or author and press Search; the Advanced search page opens with the results.' },
      { find: (p) => p.getByRole('button', { name: 'fiber strength' }), side: 'left', label: 'Example searches', text: 'Run a ready-made search in one click.' },
      { find: (p) => p.getByRole('link', { name: 'Browse data' }), side: 'left', label: 'Quick links', text: 'Open the data tables, the Genome map, the Hotspots or the Linkage maps.' },
      { find: (p) => around(p, 'Linkage QTL', 'Indexed papers'), side: 'left', label: 'Live counts', text: 'Linkage QTL, GWAS loci, meta-QTL, epistatic pairs, hotspots, linkage maps, trait markers and papers, read from the current data. Click one to open that table.' },
    ],
  },
  {
    id: 'home-lower', title: 'Overview: traits, findings and the genome-wide view', url: '/', height: 1350,
    prep: scrollToHeading('Trait categories', 30),
    intro: 'Further down the overview page are the trait categories, the main findings and a genome-wide plot of where the loci are.',
    callouts: [
      { find: (p) => p.getByText('Fiber quality', { exact: true }).first(), side: 'left', label: 'Trait categories', text: 'Records per trait category. Click a category to search all of its loci.' },
      { find: (p) => p.getByRole('heading', { name: 'Findings from the compiled record' }), side: 'top', label: 'Findings', text: 'The headline results of the analysis. “All findings, with tests and figures” opens the Insights page.' },
      { find: (p) => p.getByRole('heading', { name: 'Where the loci are' }), side: 'left', label: 'Where the loci are', text: 'Independent studies per 2-Mb window along all 26 chromosomes. Peaks above the dashed line are hotspots; “Explore hotspots interactively” opens the Hotspots page.' },
    ],
  },
  {
    id: 'search', title: 'Advanced search', url: '/search', height: 1000,
    prep: async (p) => { await tableReady(p); await p.getByRole('button', { name: /A07 fiber hotspot/ }).click(); await p.waitForTimeout(800); await scrollTo(150)(p) },
    intro: 'Advanced search filters linkage QTL and GWAS loci together. Filters apply as you set them, and the table below updates at once. Here the example “A07 fiber hotspot, 86–96 Mb” has been clicked.',
    callouts: [
      { find: (p) => p.getByPlaceholder('QTL name, marker, gene, author…'), side: 'top', label: 'Keyword', text: 'Matches QTL name, marker, candidate gene, author and the other text fields.' },
      { find: (p) => p.locator('label', { hasText: 'Record type' }).locator('select'), side: 'top', label: 'Record type, species and source', text: 'Linkage QTL, GWAS loci or both; one species; one source database (CottonGen, CottonGVD, CottonMD, GWAS Atlas) or the literature.' },
      { find: (p) => p.locator('label', { hasText: 'Harmonised trait' }).locator('select'), side: 'top', label: 'Trait category and trait', text: 'A category such as Fiber quality, then a harmonised trait such as fiber strength. Trait names from different studies are merged into one harmonised name.' },
      { find: (p) => p.getByPlaceholder('from'), side: 'top', label: 'Chromosome and region', text: 'Pick a chromosome and give a start and end in Mb to list the loci in that window. Positions are projected onto TM-1 UTX v2.1, so the window is approximate; loci with only a cM position are never matched.' },
      { find: (p) => p.getByRole('button', { name: /Fiber length on D11/ }), side: 'bottom', label: 'Examples', text: 'Ready-made searches: a hotspot region, one trait on one chromosome, the records of a hotspot, and large-effect loci with a candidate gene. Click one to fill in the filters.' },
      { find: (p) => p.getByRole('button', { name: 'Expression heatmap' }), side: 'left', label: 'Genes in the region', text: 'Appears when a chromosome and a region of up to 30 Mb are set: list the genes in the region and narrow them by organ expression, or open their expression heatmap.' },
      { find: (p) => p.getByPlaceholder('e.g. 10'), side: 'left', label: 'Minimum PVE', text: 'Keep only loci that explain at least this percentage of phenotypic variance.' },
      { find: (p) => p.getByText('Curated database records only (exclude auto-extracted)'), side: 'right', label: 'Evidence filters', text: 'Keep only records from curated databases, only loci inside a hotspot, or only loci with a candidate gene.' },
      { find: (p) => p.locator('.badge', { hasText: 'rows' }).first(), side: 'bottom', label: 'Result count', text: 'The number of matching rows.' },
      { find: (p) => p.getByRole('button', { name: 'Export CSV' }), side: 'left', label: 'Export CSV', text: 'Downloads exactly the matching rows, with every column.' },
      { find: (p) => p.getByRole('button', { name: 'Reset' }), side: 'left', label: 'Reset', text: 'Clears every filter.' },
    ],
  },
  {
    id: 'data', title: 'All data tables', url: '/data', height: 1100,
    intro: 'The data page lists every table with its size. Each opens as a sortable, searchable table that can be exported.',
    callouts: [
      { find: (p) => p.getByRole('link', { name: 'QTL', exact: true }), side: 'left', label: 'QTL and GWAS loci', text: 'Linkage-mapping QTL, and GWAS loci (each locus summarises the associations reported at one position).' },
      { find: (p) => p.getByRole('link', { name: 'Meta-QTL', exact: true }), side: 'left', label: 'Meta-QTL, epistatic QTL, clusters, qualitative loci', text: 'Consensus loci computed across studies, QTL × QTL interactions, multi-trait clusters reported by authors, and Mendelian trait loci.' },
      { find: (p) => p.getByRole('link', { name: 'QTL hotspots' }), side: 'left', label: 'Hotspots, linkage maps and markers', text: 'Study-supported hotspot regions, genetic maps with their markers, and trait-linked markers with primers.' },
      { find: (p) => p.getByRole('link', { name: 'Literature index' }), side: 'left', label: 'Literature index', text: 'Every indexed cotton QTL and GWAS paper, tagged by study type.' },
    ],
  },
  {
    id: 'table', title: 'Working with a table', url: '/data/qtl', height: 900,
    prep: async (p) => { await tableReady(p); await scrollTo(200)(p) },
    intro: 'Every table works the same way, whether it is QTL, GWAS loci, meta-QTL, markers or the literature.',
    callouts: [
      { find: (p) => p.getByPlaceholder('Search across all fields…'), side: 'top', label: 'Search the table', text: 'Filters the rows as you type, across all columns.' },
      { find: (p) => p.locator('.badge', { hasText: 'rows' }).first(), side: 'top', label: 'Row count', text: 'The number of rows currently shown.' },
      { find: (p) => p.getByRole('button', { name: 'Export CSV' }), side: 'left', label: 'Export CSV', text: 'Downloads the rows currently shown.' },
      { find: (p) => p.locator('thead th', { hasText: 'Category' }), side: 'bottom', label: 'Sort and definitions', text: 'Click a column heading to sort by it; click again to reverse. Hover the small “?” for the definition of the column.' },
      { find: (p) => p.locator('thead th', { hasText: 'Original trait' }), side: 'bottom', label: 'Harmonised and original trait', text: 'Trait is the harmonised name used for searching; Original trait is the name the study used. Scroll the table sideways for position, LOD, PVE, markers, source, evidence and the reference.' },
    ],
  },
  {
    id: 'metaqtl', title: 'Meta-QTL', url: '/data/metaqtl', height: 1000,
    prep: async (p) => { await tableReady(p); await scrollTo(200)(p) },
    intro: 'Meta-QTL are consensus loci computed from all placed QTL and GWAS loci of a trait, each supported by at least two independent studies.',
    callouts: [
      { find: (p) => p.getByRole('button', { name: /Physical meta-QTL/ }), side: 'bottom', label: 'Four tabs', text: 'Physical meta-QTL computed by this project (Mb), classic meta-QTL on the consensus genetic map (cM), every trait with the outcome of both meta-analyses, and rows from published meta-analyses.' },
      { find: (p) => p.locator('main select').first(), side: 'left', label: 'Confidence', text: 'High (five or more studies), moderate (three or more) or all (two or more).' },
      { find: (p) => p.locator('main select').nth(3), side: 'top', label: 'Category, chromosome and support', text: 'Limit by trait category or chromosome, or to meta-QTL supported by linkage QTL, GWAS or both.' },
      { find: (p) => p.locator('thead th', { hasText: '95% CI' }), side: 'bottom', label: 'Position and interval', text: 'Consensus position and its 95% confidence interval in Mb on TM-1 UTX v2.1.' },
      { find: (p) => p.locator('thead th', { hasText: 'Genes · FP' }), side: 'bottom', label: 'Genes, fibre genes and heatmap', text: 'Genes in the 95% CI and how many of them are fibre-preferential (FP). Click the first number for the gene list, “FP” for the list narrowed to fibre-preferential genes, or the grid button for the expression heatmap.' },
      { find: (p) => p.locator('thead th', { hasText: 'Studies' }), side: 'bottom', label: 'Studies and confidence', text: 'How many independent studies support the meta-QTL, and the confidence level that follows from it.' },
    ],
  },
  {
    id: 'genes', title: 'Genes and intervals: find a gene', url: '/genes?q=Gohir.A07G197200', height: 1250,
    prep: async (p) => { await p.getByText('Expression in TM-1 organs (TPM)').first().waitFor({ timeout: 90000 }); await p.waitForTimeout(1500); await scrollTo(290)(p) },
    intro: 'Look up a gene by any of its names: see its expression in 11 cotton organs and which meta-QTL, hotspots, QTL and GWAS loci cover it.',
    callouts: [
      { find: (p) => p.locator('main form input').first(), side: 'left', label: 'Search box', text: 'Any identifier of a TM-1 gene: JGI Gohir ID, GenBank locus tag (ERO13_…), RefSeq LOC number, NCBI GeneID, the older Gh_ IDs, or an Arabidopsis AGI code or gene symbol of its best homolog. Version and transcript suffixes are ignored. A region such as A07:90.1-91.3 lists the genes in it instead.' },
      { find: (p) => p.getByRole('button', { name: 'D11:22-26' }), side: 'bottom', label: 'Examples', text: 'One click searches an example of each kind of identifier (JGI, RefSeq, Arabidopsis, gene symbol) or one of the two fibre hotspots.' },
      { find: (p) => p.locator('main h3.font-mono').first(), side: 'left', label: 'Gene and position', text: 'The JGI gene ID and its position on TM-1 UTX v2.1, the assembly every map position in the database is drawn on.' },
      { find: (p) => p.getByRole('link', { name: 'Phytozome' }).first(), side: 'top', label: 'Genome databases', text: 'Open the gene in Phytozome, CottonGen or NCBI Gene. The locus tag, RefSeq gene and Arabidopsis homolog below link to NCBI and TAIR.' },
      { find: (p) => p.getByRole('button', { name: 'Heatmap of genes within 250 kb' }), side: 'left', label: 'Neighbourhood heatmap', text: 'Expression of this gene and every gene within 250 kb, as a heatmap: useful to see whether the gene stands out from its neighbours.' },
      { find: (p) => p.getByText('Expression in TM-1 organs (TPM)').first(), side: 'left', label: 'Organ expression', text: 'Expression (TPM) in 11 TM-1 organs, from public RNA-seq (PRJNA248163; Zhang et al. 2015); fibre in green. Above the bars: the organ group where the gene is highest, its tissue specificity τ (0 even, 1 one organ only) and, when it applies, the fibre-preferential tag (highest in fibre and at least twice every other organ group). Each organ is a single library, so the values rank organs; they do not test differences.' },
      { find: (p) => p.getByText('Loci overlapping this gene').first(), side: 'left', label: 'Overlapping loci', text: 'Meta-QTL, hotspots, QTL and GWAS loci whose interval contains the gene. Click an ID to open it in its table, or an interval to list all genes in it. ≈ marks a position placed by relative position, accurate only to a few Mb.' },
    ],
  },
  {
    id: 'genes-region', title: 'Genes and intervals: narrow the genes of a region', url: '/genes?r=A07:86-96&e=fpref', height: 1100,
    prep: async (p) => { await p.getByText('Narrow by expression').waitFor({ timeout: 90000 }); await p.waitForTimeout(1500); await scrollTo(330)(p) },
    intro: 'Every gene in an interval, and tools to cut the list down by organ expression. Here the A07 fibre hotspot (86–96 Mb) is narrowed from 344 genes to its 14 fibre-preferential genes, ranked by fibre TPM. The Genes links in the Meta-QTL and Hotspots tables open this view for their interval.',
    callouts: [
      { find: (p) => p.getByText('Narrow by expression'), side: 'left', label: 'Narrow by expression', text: 'Show all genes, expressed genes (≥ 1 TPM in an organ), genes highest in a chosen organ group, or fibre-preferential genes; set a minimum TPM in that organ; and sort by position, by TPM in the organ or by tissue specificity (τ). “reset” clears these settings.' },
      { find: (p) => p.locator('main thead th', { hasText: 'Organs' }), side: 'top', label: 'Organ profile', text: 'Eleven small cells per gene, root to fibre 20 dpa (fibre in green), shaded by log₂(TPM + 1) relative to the gene’s highest organ. Hover for the values. The next columns give TPM in the chosen organ group and the peak organ; FP marks fibre-preferential genes.' },
      { find: (p) => p.getByRole('button', { name: 'Expression heatmap' }), side: 'top', label: 'Expression heatmap', text: 'Opens the genes of the region as a heatmap of the 11 organs (see “Expression heatmap” below).' },
      { find: (p) => p.getByPlaceholder('Filter by ID or description'), side: 'left', label: 'Filter', text: 'Narrow the list by any identifier or by words in the description, e.g. "kinase".' },
      { find: (p) => p.getByRole('button', { name: 'Download CSV' }), side: 'right', label: 'Download CSV', text: 'The genes currently listed, with all their identifiers, the description, TPM in every organ, peak organ, τ and the fibre-preferential call.' },
    ],
  },
  {
    id: 'map-ideogram', title: 'Genome map: ideogram view', url: '/map', height: 1150,
    prep: async (p) => { await p.getByText('Ideogram view').first().waitFor({ timeout: 120000 }); await p.waitForTimeout(2000); await scrollTo(150)(p) },
    intro: 'The Genome map draws loci, meta-QTL and hotspots on the 26 chromosomes of allotetraploid cotton, coloured by trait category.',
    callouts: [
      { find: (p) => p.getByText('QTL / GWAS loci', { exact: true }), side: 'top', label: 'Layers', text: 'Switch the loci and the region track on or off. The list chooses what the region track shows: high-confidence meta-QTL, all meta-QTL or hotspots.' },
      { find: (p) => p.getByRole('button', { name: 'Circos', exact: true }), side: 'top', label: 'Choose the view', text: 'Ideogram (chromosomes side by side) or Circos (all chromosomes in a circle). “Dark plot” draws the figure on a dark background.' },
      { find: (p) => p.getByRole('button', { name: 'PNG' }), side: 'top', label: 'Export', text: 'Save the current figure as SVG, PNG or JPEG.' },
      { find: (p) => p.getByPlaceholder('Search name, trait, parameter or candidate gene…'), side: 'left', label: 'Search the map', text: 'Shows only the loci whose name, trait or candidate gene matches.' },
      { find: (p) => p.getByText('Dt subgenome', { exact: true }), side: 'bottom', label: 'Subgenome', text: 'Show all chromosomes, or only the At (A01–A13) or Dt (D01–D13) subgenome.' },
      { find: (p) => p.getByRole('button', { name: 'Fiber quality' }).first(), side: 'left', label: 'Highlight traits', text: 'Click one or several categories (or press 1–9) to show only those; “Reset” shows all again. The colours are those of the plot.' },
      { find: (p) => p.getByText(/QTL and GWAS loci are drawn/), side: 'left', label: 'What is drawn', text: 'How many loci have a physical position and are drawn. The others (cM position only, or a diploid species) stay searchable in the tables.' },
    ],
  },
  {
    id: 'map-circos', title: 'Genome map: Circos view', url: '/map', height: 1300,
    prep: async (p) => { await p.getByText('Ideogram view').first().waitFor({ timeout: 120000 }); await p.getByRole('button', { name: 'Circos', exact: true }).click(); await p.waitForTimeout(3000); await scrollToHeading('Circos genome view', 400)(p) },
    intro: 'The Circos view puts all 26 chromosomes in one circle, with rings for locus density, regions and loci of each trait category.',
    callouts: [
      { find: (p) => p.getByText('Epistatic links', { exact: true }).first(), side: 'top', label: 'Epistatic links', text: 'Tick to draw chords joining the two loci of each epistatic pair.' },
      { find: (p) => p.locator('svg').filter({ has: p.locator('text', { hasText: 'CottonQTLome' }) }).last(), side: 'left', label: 'The plot', text: 'Outer ring: chromosomes, by subgenome. Next: locus density. Then one thin ring per trait category for regions and for loci. Hover any mark for its details.' },
      { find: (p) => p.getByText('Ring 2 — QTL density'), side: 'top', label: 'Key', text: 'What each ring shows, with the colour scale for density.' },
    ],
  },
  {
    id: 'hotspots', title: 'Hotspots', url: '/hotspots', height: 1000,
    prep: async (p) => { await p.getByRole('heading', { name: 'Hotspots across the genome' }).waitFor({ timeout: 90000 }); await p.waitForTimeout(1500); await scrollTo(140)(p) },
    intro: 'Hotspots are regions where loci from many independent studies fall together, more than expected by chance.',
    callouts: [
      { find: (p) => p.getByText(/hotspot regions/).first(), side: 'top', label: 'Summary', text: 'How many hotspots there are, how much of the genome they cover, and the study threshold used to call them.' },
      { find: (p) => p.getByRole('img', { name: /Karyotype of study support/ }), side: 'left', label: 'Karyotype', text: 'All 26 chromosomes to scale. Shading shows independent studies per 2-Mb window; red brackets are hotspots. Hover for details; click a chromosome to see its profile below.' },
      { find: (p) => p.getByRole('button', { name: 'SVG' }).first(), side: 'left', label: 'Save the figure', text: 'Downloads the karyotype as SVG.' },
    ],
  },
  {
    id: 'hotspots-table', title: 'Hotspots: chromosome profile and table', url: '/hotspots', height: 1000,
    prep: async (p) => { await tableReady(p); await scrollToHeading(/Study support along chromosome/, 30)(p) },
    intro: 'Below the karyotype, one chromosome is shown in detail, followed by the table of all hotspot regions.',
    callouts: [
      { find: (p) => p.locator('label', { hasText: 'Chromosome' }).locator('select').first(), side: 'left', label: 'Chromosome', text: 'Choose the chromosome whose study-support profile is drawn.' },
      { find: (p) => p.getByRole('heading', { name: /Study support along chromosome/ }), side: 'top', label: 'Profile', text: 'Independent studies per window along the chromosome; windows above the threshold form hotspots.' },
      { find: (p) => p.getByRole('heading', { name: 'All hotspot regions' }), side: 'left', label: 'Hotspot table', text: 'Each hotspot with its region, number of studies and loci, top traits, example QTL and recurrent candidate genes. The “Genes · FP · heatmap” column gives the genes in the hotspot, how many are fibre-preferential, and a grid button that opens their expression heatmap.' },
    ],
  },
  {
    id: 'heatmap', title: 'Expression heatmap of a hotspot or meta-QTL', url: '/hotspots', height: 1000,
    prep: async (p) => {
      await tableReady(p)
      await p.getByPlaceholder('Search across all fields…').fill('CHS007'); await p.waitForTimeout(600)
      await p.getByRole('button', { name: 'Expression heatmap for hotspot CHS007' }).click()
      await p.getByRole('dialog').getByText('Peak · description').waitFor({ timeout: 30000 }); await p.waitForTimeout(800)
    },
    intro: 'The grid button in the Genes column of the Hotspots and Meta-QTL tables, the “Expression heatmap” buttons of the gene search and the region bar of Advanced search all open this view: the genes of the interval against the 11 TM-1 organs. Here, the 14 fibre-preferential genes of hotspot CHS007 on A07.',
    callouts: [
      { find: (p) => p.getByRole('dialog').getByText(/fibre-preferential$/).first(), side: 'bottom', label: 'Interval summary', text: 'Position of the interval, its genes, how many are expressed and how many are fibre-preferential.' },
      { find: (p) => p.getByRole('dialog').locator('select').first(), side: 'bottom', label: 'Show', text: 'Fibre-preferential genes (the default when there are any), all expressed genes or every gene.' },
      { find: (p) => p.getByRole('dialog').locator('label', { hasText: 'Sort by' }).locator('select'), side: 'bottom', label: 'Sort', text: 'By TPM in a chosen organ group, by peak organ (genes grouped by the organ where they are highest), or by position.' },
      { find: (p) => p.getByRole('dialog').locator('label', { hasText: 'Colour' }).locator('select'), side: 'bottom', label: 'Colour scale', text: 'Relative to each gene’s maximum shows which organ a gene prefers; the same scale for all genes shows which genes are most highly expressed.' },
      { find: (p) => p.getByRole('dialog').locator('tbody tr').first().locator('td').nth(10), side: 'right', label: 'Cells', text: 'One row per gene, one column per organ, grouped into root, stem, leaf, flower, seed and fibre. Hover a cell for its TPM; click a gene ID to open the gene.' },
      { find: (p) => p.getByRole('dialog').getByRole('link', { name: 'Open as gene list' }), side: 'bottom', label: 'Gene list and CSV', text: 'Open the same genes in the gene list, or download the rows shown with TPM in every organ.' },
      { find: (p) => p.getByRole('dialog').getByText('gene minimum'), side: 'top', label: 'Key', text: 'The colour scale (log₂ TPM + 1) and the definition of fibre-preferential. Close with × or Esc.' },
    ],
  },
  {
    id: 'linkage-maps', title: 'Linkage maps', url: '/linkage-maps', height: 1000,
    prep: async (p) => { await p.getByPlaceholder('Highlight marker…').waitFor({ timeout: 90000 }); await p.waitForTimeout(1500); await scrollTo(170)(p) },
    intro: 'Marker orders and cM positions of cotton genetic maps, from CottonGen and from supplementary files of mapping papers.',
    callouts: [
      { find: (p) => p.getByPlaceholder('Highlight marker…'), side: 'top', label: 'Highlight a marker', text: 'Type a marker name to mark it on the map.' },
      { find: (p) => p.getByText('Map CSV'), side: 'top', label: 'Download', text: 'Download the whole map as CSV, or the density figure as SVG.' },
      { find: (p) => p.getByRole('img', { name: /Marker density map/ }), side: 'left', label: 'Density map', text: 'One bar per linkage group, drawn to the cM scale and shaded by marker density; the number below is its locus count. Click a group to list its markers.' },
    ],
  },
  {
    id: 'linkage-maps-list', title: 'Linkage maps: one group and the map list', url: '/linkage-maps', height: 1000,
    prep: async (p) => { await tableReady(p); await scrollToHeading(/^Linkage group/, 30)(p) },
    intro: 'The selected linkage group is drawn with its marker names; below it every available map is listed.',
    callouts: [
      { find: (p) => p.locator('label', { hasText: 'Group' }).locator('select'), side: 'top', label: 'Group and cM window', text: 'Choose a linkage group and the cM range to draw.' },
      { find: (p) => p.getByRole('img', { name: /^Linkage group/ }), side: 'left', label: 'Group view', text: 'Markers in map order at their cM positions.' },
      { find: (p) => p.getByRole('button', { name: 'View' }).first(), side: 'left', label: 'Choose a map', text: 'Click View on any map in the list to draw it above.' },
    ],
  },
  {
    id: 'markers', title: 'Markers and primers', url: '/markers', height: 1000,
    prep: async (p) => { await tableReady(p); await scrollTo(190)(p) },
    intro: 'Markers linked to traits, graded by the evidence behind the link, with primer sequences where a source gives them.',
    callouts: [
      { find: (p) => p.locator(':text-is("replicated QTL marker"):visible').first(), side: 'top', label: 'Evidence tiers', text: 'What each grade means. No public resource certifies cotton markers as validated for breeding, so the grade says what supports the link.' },
      { find: (p) => p.getByRole('link', { name: /Download all primers/ }).or(p.getByRole('button', { name: /Download all primers/ })), side: 'left', label: 'Primer catalogue', text: 'One CSV with primers for every marker found in CottonGen and in paper supplements.' },
      { find: (p) => p.locator('main select').first(), side: 'top', label: 'Filters', text: 'Limit by evidence tier or trait category, or to markers with primer sequences.' },
      { find: (p) => p.locator('thead th', { hasText: 'Primers' }), side: 'bottom', label: 'Primers', text: 'Forward (F) and reverse (R) primer, 5′→3′.' },
    ],
  },
  {
    id: 'statistics', title: 'Statistics', url: '/statistics', height: 1400,
    prep: async (p) => { await p.getByRole('heading', { name: 'Records by trait category' }).waitFor({ timeout: 90000 }); await p.waitForTimeout(1500); await scrollTo(130)(p) },
    intro: 'Counts by record type, trait, chromosome, species and source. All numbers refer to de-duplicated records.',
    callouts: [
      { find: (p) => p.getByText('QTL records', { exact: true }).first(), side: 'top', label: 'Totals', text: 'Records of every type, harmonised traits, studies with data and papers indexed.' },
      { find: (p) => p.getByRole('heading', { name: 'Records by trait category' }), side: 'top', label: 'Charts', text: 'Records by trait category, loci per Mb by chromosome, most studied traits, species, source, papers per year and the share of major-effect QTL. Hover a bar for its value.' },
    ],
  },
  {
    id: 'insights', title: 'Insights', url: '/insights', height: 1000,
    prep: scrollTo(200),
    intro: 'What the combined record says about where trait loci sit in the cotton genome, with the statistical test behind each statement.',
    callouts: [
      { find: (p) => p.getByRole('heading', { name: 'Key findings' }), side: 'top', label: 'Key findings', text: 'Each finding in one sentence, then the numbers and the test. Links open the data behind it.' },
      { find: (p) => p.locator('main ol li').first(), side: 'left', label: 'A finding', text: 'The figures further down the page illustrate each finding; “Read these with care” at the end lists the limits of the data.' },
    ],
  },
  {
    id: 'literature', title: 'Literature index', url: '/literature', height: 900,
    prep: async (p) => { await tableReady(p); await scrollTo(150)(p) },
    intro: 'Cotton QTL, GWAS, meta-QTL and epistasis papers indexed from Europe PMC and tagged by study type.',
    callouts: [
      { find: (p) => p.locator('main select').first(), side: 'top', label: 'Study type', text: 'Show only linkage QTL, GWAS, meta-QTL, epistasis or other study types.' },
      { find: (p) => p.getByText('Only papers with records extracted into the database'), side: 'right', label: 'Papers with records', text: 'Tick to show only papers whose results are in the data tables.' },
      { find: (p) => p.locator('tbody tr').first().locator('td').nth(1), side: 'bottom', label: 'Title', text: 'Opens the paper. Scroll sideways for the study type and the number of records taken from it.' },
    ],
  },
  {
    id: 'multi-trait', title: 'Multi-trait QTL', url: '/data/multi-trait', height: 950,
    prep: async (p) => { await tableReady(p) },
    intro: 'Regions where loci for several traits map together, seen three ways: clusters of meta-QTL across studies, overlapping QTL or shared GWAS signals within one study, and clusters reported by the authors.',
    callouts: [
      { find: (p) => p.getByRole('button', { name: /Multi-trait meta-QTL clusters/ }), side: 'bottom', label: 'Three views', text: 'Switch between meta-QTL clusters, multi-trait QTL within studies and the clusters reported by authors.' },
      { find: (p) => p.locator('thead th').filter({ hasText: 'Shared core' }).first(), side: 'bottom', label: 'Shared core', text: 'The interval that all meta-QTL of a cluster overlap, on TM-1 UTX v2.1.' },
      { find: (p) => p.locator('thead th').filter({ hasText: /^Traits$/ }).first(), side: 'bottom', label: 'Traits', text: 'The traits whose meta-QTL make up the cluster; the Meta-QTL IDs column links them to the Meta-QTL page.' },
    ],
  },
  {
    id: 'cloned-genes', title: 'Cloned and validated genes', url: '/data/cloned-genes', height: 950,
    prep: async (p) => { await tableReady(p) },
    intro: 'Genes identified behind mapped cotton loci, with how they were mapped and confirmed, and the paper that reports them.',
    callouts: [
      { find: (p) => p.locator('tbody tr').first().locator('td').nth(1), side: 'right', label: 'Gene', text: 'Opens the gene search, which lists every QTL, GWAS locus, meta-QTL and hotspot around the gene.' },
      { find: (p) => p.locator('thead th').filter({ hasText: 'Evidence' }).first(), side: 'bottom', label: 'Evidence', text: 'Map-based cloning; mapped and functionally validated; causal variant described; or mapped candidate.' },
      { find: (p) => p.locator('thead th').filter({ hasText: 'Validation' }).first(), side: 'bottom', label: 'Validation', text: 'VIGS, CRISPR/Cas9, RNAi, over-expression, complementation or allele evidence, as stated in the paper.' },
    ],
  },
  {
    id: 'downloads', title: 'Downloads', url: '/downloads', height: 1900,
    intro: 'Every table of the database as a file: loci, meta-QTL and their members, consensus and linkage maps, markers, traits, studies and validation results.',
    callouts: [
      { find: (p) => p.locator('main table').first().locator('tbody tr').first().locator('a'), side: 'right', label: 'Download a table', text: 'Click a name to download the file (CSV, or gzipped CSV for the large tables).' },
      { find: (p) => p.getByRole('link', { name: 'Gene expression in TM-1 organs' }), side: 'right', label: 'Gene expression', text: 'TPM of every TM-1 gene in the 11 organs, organ-group means, tissue specificity, peak organ and the fibre-preferential call.' },
      { find: (p) => p.getByRole('heading', { name: 'Complete database files' }), side: 'top', label: 'Complete database', text: 'All records, the extracted tables and the SQLite database are attached to the GitHub release.' },
    ],
  },
]

;(async () => {
  fs.mkdirSync(RAW, { recursive: true })
  const browser = await chromium.launch({ executablePath: process.env.CHROME })
  const out = []
  for (const [i, s] of SECTIONS.entries()) {
    const page = await browser.newPage({ viewport: { width: W, height: s.height }, deviceScaleFactor: SCALE })
    // light default theme, so every screenshot looks the same
    await page.addInitScript(() => { try { localStorage.setItem('cq-theme-v2', 'wheat') } catch (e) { /* ignore */ } })
    await page.goto(BASE + s.url, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    if (s.prep) await s.prep(page)
    await page.waitForTimeout(600)
    const file = `${String(i + 1).padStart(2, '0')}-${s.id}.png`
    const callouts = []
    for (const c of s.callouts) {
      let box = null
      try { box = await c.find(page).first().boundingBox({ timeout: 5000 }) } catch (e) { /* reported below */ }
      const visible = box && box.y + box.height > 0 && box.y < s.height && box.width > 0
      if (!visible) { console.log(`  ! ${s.id}: "${c.label}" not on screen - left out`); continue }
      callouts.push({ n: callouts.length + 1, label: c.label, text: c.text, side: c.side, box })
    }
    await page.screenshot({ path: path.join(RAW, file) })
    await page.close()
    out.push({ id: s.id, title: s.title, intro: s.intro, image: file, width: W * SCALE, height: s.height * SCALE, scale: SCALE, callouts })
    console.log(`${file}  ${callouts.length}/${s.callouts.length} callouts`)
  }
  await browser.close()
  fs.writeFileSync(path.join(RAW, 'sections.json'), JSON.stringify(out, null, 2))
})().catch((e) => { console.error(e); process.exit(1) })
