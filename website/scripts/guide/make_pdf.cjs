/**
 * Build public/CottonQTLome_User_Guide.pdf from src/lib/guide.json and the
 * annotated screenshots in public/images/guide/ (same content as the Word guide).
 * The page is laid out as HTML and printed to A4 by Chromium.
 *
 * Usage: CHROME=<browser binary> node scripts/guide/make_pdf.cjs [output.pdf]
 */
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright-core')

const ROOT = path.join(__dirname, '..', '..')
const OUT = process.argv[2] || path.join(ROOT, 'public', 'CottonQTLome_User_Guide.pdf')
const guide = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'lib', 'guide.json'), 'utf8'))
const summary = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'summary.json'), 'utf8'))
const c = Object.fromEntries(Object.entries(summary.counts).map(([k, v]) => [k, typeof v === 'number' ? v.toLocaleString('en-US') : v]))
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const img = (f) => 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, 'public', 'images', 'guide', f)).toString('base64')

const sections = guide.map((s, i) => `
  <section>
    <h2>${i + 1}. ${esc(s.title)}</h2>
    <p class="intro">${esc(s.intro)}</p>
    <img src="${img(s.image)}" alt="${esc(s.title)}">
    <table>${s.callouts.map((k) => `<tr><td class="n"><span>${k.n}</span></td><td><b>${esc(k.label)}.</b> ${esc(k.text)}</td></tr>`).join('')}</table>
  </section>`).join('\n')

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 18mm 18mm 16mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #19191c; font-size: 10pt; line-height: 1.45; margin: 0; }
  .cover h1 { font-size: 26pt; margin: 40mm 0 4mm; color: #15803d; }
  .cover .sub { font-size: 14pt; color: #57575f; margin: 0 0 10mm; }
  .cover p { max-width: 150mm; }
  .muted { color: #57575f; }
  ol.toc { columns: 2; column-gap: 10mm; padding-left: 5mm; margin-top: 8mm; }
  ol.toc li { break-inside: avoid; padding-right: 2mm; }
  section { break-before: page; }
  h2 { font-size: 15pt; margin: 0 0 2mm; }
  .intro { color: #57575f; margin: 0 0 4mm; }
  img { width: 100%; border: 0.3mm solid #d1d1d6; }
  table { border-collapse: collapse; width: 100%; margin-top: 4mm; }
  tr { break-inside: avoid; }
  td { vertical-align: top; padding: 1.4mm 2mm; border-top: 0.2mm solid #d1d1d6; }
  td.n { width: 8mm; }
  td.n span { display: inline-block; width: 6mm; height: 6mm; border-radius: 50%; background: #d92d20; color: #fff;
              font-weight: bold; font-size: 8.5pt; text-align: center; line-height: 6mm; }
</style></head><body>
  <div class="cover">
    <h1>CottonQTLome</h1>
    <p class="sub">User guide</p>
    <p>A step-by-step tour of the database: how to search it, look up genes and intervals, browse and export its tables,
    use its genome maps, hotspots and linkage maps, and read its statistics. Each screenshot is numbered; the list under it
    explains every numbered item.</p>
    <p class="muted">When this guide was generated the database held ${c.qtl} linkage QTL, ${c.gwas_loci} GWAS loci
    (${c.gwas_associations} associations), ${c.mqtl} computed meta-QTL, ${c.epistatic} epistatic QTL pairs and ${c.hotspots}
    hotspot regions from ${c.studies_with_data} studies; ${c.papers_indexed} papers are indexed. Built ${esc(summary.built || '')}.</p>
    <p>Web site: https://ank-man.github.io/CottonQTLome/ · Code and data: https://github.com/ank-man/CottonQTLome</p>
    <ol class="toc">${guide.map((s) => `<li>${esc(s.title)}</li>`).join('')}</ol>
  </div>
  ${sections}
</body></html>`

;(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME })
  const page = await browser.newPage()
  await page.setContent(html, { waitUntil: 'load' })
  await page.pdf({
    path: OUT, format: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: '<div style="font-family:Arial;font-size:8px;color:#57575f;width:100%;text-align:center">CottonQTLome user guide · <span class="pageNumber"></span></div>',
  })
  await browser.close()
  console.log(`wrote ${path.relative(ROOT, OUT)}  (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB)`)
})().catch((e) => { console.error(e); process.exit(1) })
