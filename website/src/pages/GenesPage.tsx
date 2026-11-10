import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ExternalLink, Grid3x3, Search } from 'lucide-react'
import { openHeatmap } from '../components/ExpressionHeatmap'
import PageHero from '../components/PageHero'
import AsyncBoundary from '../components/AsyncBoundary'
import { downloadCSV } from '../lib/csv'
import {
  CHRS, Expr, ExprMeta, Gene, Interval, SearchResult, classTPM, exprMeta, expressionOn, geneLinks, genesOn, idLink, intervalsOn,
  overlapping, searchGene,
} from '../lib/genes'

const KIND: Record<Interval['kind'], { label: string; to: string }> = {
  M: { label: 'Meta-QTL', to: '/data/metaqtl' },
  H: { label: 'Hotspot', to: '/hotspots' },
  Q: { label: 'Linkage QTL', to: '/data/qtl' },
  G: { label: 'GWAS locus', to: '/data/gwas' },
}
const mb = (bp: number) => (bp / 1e6).toFixed(bp < 1e7 ? 3 : 2)

/** "A07:90.1-91.3" (Mb) or "A07:90100000-91300000" (bp) -> region */
function parseRegion(s: string): { chr: string; start: number; end: number } | null {
  const m = s.trim().replace(/,/g, '').match(/^([AD])t?0?(\d{1,2})\s*:\s*([\d.]+)\s*[-–]\s*([\d.]+)\s*(mb|kb|bp)?$/i)
  if (!m) return null
  const chr = `${m[1].toUpperCase()}${m[2].padStart(2, '0')}`
  if (!CHRS.includes(chr)) return null
  let a = parseFloat(m[3])
  let b = parseFloat(m[4])
  const unit = (m[5] ?? (Math.max(a, b) < 1000 ? 'mb' : 'bp')).toLowerCase()
  const f = unit === 'mb' ? 1e6 : unit === 'kb' ? 1e3 : 1
  a *= f
  b *= f
  return { chr, start: Math.min(a, b), end: Math.max(a, b) }
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="inline-flex items-center gap-0.5 underline decoration-wheat-300 underline-offset-2 hover:decoration-accent" href={href} target="_blank" rel="noreferrer">
      {children}
      <ExternalLink className="h-3 w-3 opacity-60" aria-hidden="true" />
    </a>
  )
}

function IntervalTable({ items }: { items: Interval[] }) {
  if (!items.length) return <p className="text-sm text-wheat-600">None.</p>
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="text-left text-wheat-600">
          <tr><th className="py-1 pr-3">Type</th><th className="pr-3">ID</th><th className="pr-3">Trait</th><th className="pr-3">Interval (Mb)</th><th className="pr-3">Support</th></tr>
        </thead>
        <tbody>
          {items.map((iv) => (
            <tr key={iv.kind + iv.id} className="border-t border-wheat-100 align-top">
              <td className="py-1 pr-3 whitespace-nowrap">{KIND[iv.kind].label}</td>
              <td className="pr-3"><Link className="underline" to={`${KIND[iv.kind].to}?q=${encodeURIComponent(iv.id)}`}>{iv.id}</Link></td>
              <td className="pr-3">{iv.trait}</td>
              <td className="pr-3 tabular-nums whitespace-nowrap">
                <Link className="underline" to={`/genes?r=${encodeURIComponent(`${chrOf(iv)}:${iv.start}-${iv.end}bp`)}`}>
                  {mb(iv.start)}–{mb(iv.end)}
                </Link>
                {iv.method === 'approximate' && <span className="ml-1 text-xs text-wheat-500" title="Placed by relative position; error up to a few Mb">≈</span>}
              </td>
              <td className="pr-3 tabular-nums">
                {iv.kind === 'Q' ? (iv.support ? `LOD ${iv.support}` : '') : `${iv.support} ${iv.support === '1' ? 'study' : 'studies'}`}
                {iv.kind === 'M' && iv.method ? ` · ${iv.method}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
// interval rows do not carry their chromosome; it is attached when they are loaded
const chrOf = (iv: Interval) => (iv as Interval & { chr?: string }).chr ?? ''

const SOURCE_NOTE = 'TM-1 organ RNA-seq (PRJNA248163; Zhang et al. 2015), one library per organ: values rank organs for a gene but are not replicated measurements.'

/** One gene's TPM in the 11 organs; fibre organs in the accent colour. */
function ExpressionPanel({ e, meta }: { e: Expr; meta: ExprMeta }) {
  const top = Math.max(e.max, 1)
  return (
    <div>
      <h4 className="mb-1 text-sm font-semibold text-wheat-900">Expression in TM-1 organs (TPM)</h4>
      <p className="mb-2 text-sm text-wheat-700">
        {e.peak ? (
          <>Highest in <b>{e.peak}</b> · tissue specificity τ = {e.tau?.toFixed(2)} (0 even, 1 one organ only)
            {e.fibrePref && <span className="ml-2 rounded bg-accent/15 px-1.5 py-0.5 text-xs font-medium text-accent-strong">fibre-preferential</span>}</>
        ) : 'Not expressed (below 1 TPM in every organ).'}
      </p>
      <div className="grid max-w-xl grid-cols-[7.5rem_1fr_3.5rem] items-center gap-x-2 gap-y-1 text-xs" role="table" aria-label="TPM per organ">
        {meta.organs.map((o, i) => (
          <div key={o} className="contents" role="row">
            <span className="text-wheat-700" role="rowheader">{o}</span>
            <span className="h-3 rounded-sm bg-wheat-100" role="presentation">
              <span className={`block h-3 rounded-sm ${meta.organ_class[i] === 'fibre' ? 'bg-accent' : 'bg-wheat-500'}`}
                style={{ width: `${(100 * e.tpm[i]) / top}%`, minWidth: e.tpm[i] > 0 ? 2 : 0 }} />
            </span>
            <span className="text-right tabular-nums text-wheat-800" role="cell">{e.tpm[i]}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-wheat-500">{SOURCE_NOTE}</p>
    </div>
  )
}

/** 11 small cells, log2(TPM+1) scaled to the gene's maximum; a compact profile for gene lists. */
function ExprStrip({ e, meta }: { e: Expr; meta: ExprMeta }) {
  const m = Math.log2(e.max + 1) || 1
  return (
    <span className="inline-flex gap-px align-middle" title={meta.organs.map((o, i) => `${o}: ${e.tpm[i]} TPM`).join('\n')}>
      {e.tpm.map((t, i) => (
        <span key={i} className={`inline-block h-3 w-2 ${meta.organ_class[i] === 'fibre' ? 'bg-accent' : 'bg-wheat-700'}`}
          style={{ opacity: e.max < 1 ? 0.06 : 0.08 + 0.92 * (Math.log2(t + 1) / m) }} />
      ))}
    </span>
  )
}

export function HeatmapButton({ label, id, title, chr, start, end }: { label: string; id: string; title: string; chr: string; start: number; end: number }) {
  return (
    <button type="button" className="btn inline-flex items-center gap-1"
      onClick={() => openHeatmap({ id, title, chr, start, end, region: `${chr}:${Math.round(start)}-${Math.round(end)}bp` })}>
      <Grid3x3 className="h-4 w-4" />{label}
    </button>
  )
}

const EXAMPLES: { label: string; value: string; hint: string }[] = [
  { label: 'Gohir.A07G197200', value: 'Gohir.A07G197200', hint: 'JGI gene ID (RABA5E, fibre-preferential)' },
  { label: 'LOC107955386', value: 'LOC107955386', hint: 'NCBI RefSeq ID of the same gene' },
  { label: 'AT1G05810', value: 'AT1G05810', hint: 'Arabidopsis homolog: lists the cotton genes whose best hit it is' },
  { label: 'RABA5E', value: 'RABA5E', hint: 'Gene symbol' },
  { label: 'A07:86-96', value: 'A07:86-96', hint: 'Region in Mb: the A07 fiber hotspot (CHS007)' },
  { label: 'D11:22-26', value: 'D11:22-26', hint: 'Region in Mb: the D11 fiber hotspot (CHS004)' },
]

function Examples({ onPick }: { onPick: (v: string) => void }) {
  return (
    <div className="flex w-full flex-wrap items-center gap-1.5 text-xs">
      <span className="text-wheat-600">Try:</span>
      {EXAMPLES.map((x) => (
        <button key={x.value} type="button" title={x.hint} onClick={() => onPick(x.value)}
          className="rounded-full border border-wheat-300 px-2 py-0.5 font-mono text-wheat-800 hover:border-accent hover:text-accent">
          {x.label}
        </button>
      ))}
    </div>
  )
}

function GeneCard({ g }: { g: Gene }) {
  const [ivs, setIvs] = useState<Interval[] | null>(null)
  const [expr, setExpr] = useState<{ e: Expr | undefined; meta: ExprMeta } | null>(null)
  useEffect(() => {
    let live = true
    intervalsOn(g.chr).then((all) => {
      if (live) setIvs(overlapping(all.map((x) => ({ ...x, chr: g.chr })), g.start, g.end, 3e8))
    })
    Promise.all([expressionOn(g.chr), exprMeta()]).then(([m, meta]) => live && setExpr({ e: m.get(g.id), meta })).catch(() => {})
    return () => { live = false }
  }, [g])
  const order: Interval['kind'][] = ['M', 'H', 'Q', 'G']
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h3 className="font-mono text-lg font-semibold text-wheat-900">{g.id}</h3>
        <span className="text-sm text-wheat-600 tabular-nums">
          {g.chr}:{g.start.toLocaleString()}–{g.end.toLocaleString()} ({g.strand}) · TM-1 UTX v2.1
        </span>
        <span className="flex flex-wrap gap-3 text-sm">{geneLinks(g).map((l) => <ExtLink key={l.label} href={l.url}>{l.label}</ExtLink>)}</span>
        <HeatmapButton label="Heatmap of genes within 250 kb" id={`near-${g.id}`} title={`genes within 250 kb of ${g.id}`}
          chr={g.chr} start={Math.max(0, g.start - 250000)} end={g.end + 250000} />
      </div>
      {g.description && <p className="text-sm text-wheat-800">{g.description}</p>}
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        {g.locus_tag && <><dt className="text-wheat-600">GenBank locus tag</dt><dd className="font-mono"><ExtLink href={idLink(g.locus_tag)}>{g.locus_tag}</ExtLink></dd></>}
        {g.refseq && <><dt className="text-wheat-600">RefSeq gene</dt><dd className="font-mono"><ExtLink href={g.ncbi_gene_id ? `https://www.ncbi.nlm.nih.gov/gene/${g.ncbi_gene_id}` : idLink(g.refseq)}>{g.refseq}</ExtLink>{g.ncbi_gene_id && <span className="ml-2 text-wheat-500">GeneID {g.ncbi_gene_id}</span>}</dd></>}
        {g.arabidopsis && <><dt className="text-wheat-600">Arabidopsis best hit</dt><dd className="font-mono"><ExtLink href={idLink(g.arabidopsis)}>{g.arabidopsis}</ExtLink>{g.symbol && <span className="ml-2 font-sans text-wheat-600">({g.symbol})</span>}</dd></>}
      </dl>
      {expr?.e && <ExpressionPanel e={expr.e} meta={expr.meta} />}
      <div>
        <h4 className="mb-1 text-sm font-semibold text-wheat-900">Loci overlapping this gene</h4>
        {ivs === null ? <p className="text-sm text-wheat-600">Loading…</p> : (
          <IntervalTable items={[...ivs].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || (b.end - b.start < a.end - a.start ? 1 : -1))} />
        )}
      </div>
    </div>
  )
}

type ExprFilter = 'all' | 'expressed' | 'peak' | 'fpref'
type SortBy = 'position' | 'tpm' | 'tau'
const CLASSES = ['root', 'stem', 'leaf', 'flower', 'seed', 'fibre']

function RegionView({ chr, start, end, initialFilter }: { chr: string; start: number; end: number; initialFilter: ExprFilter }) {
  const [genes, setGenes] = useState<Gene[] | null>(null)
  const [expr, setExpr] = useState<Map<string, Expr> | null>(null)
  const [meta, setMeta] = useState<ExprMeta | null>(null)
  const [ef, setEf] = useState<ExprFilter>(initialFilter)
  const [organ, setOrgan] = useState('fibre')
  const [minTPM, setMinTPM] = useState(0)
  const [sortBy, setSortBy] = useState<SortBy>(initialFilter === 'all' ? 'position' : 'tpm')
  const [ivs, setIvs] = useState<Interval[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  useEffect(() => {
    let live = true
    setGenes(null)
    Promise.all([genesOn(chr), intervalsOn(chr)])
      .then(([g, iv]) => {
        if (!live) return
        setGenes(overlapping(g, start, end))
        setIvs(overlapping(iv.map((x) => ({ ...x, chr })), start, end, 3e8).filter((x) => x.kind === 'M' || x.kind === 'H'))
      })
      .catch((e) => live && setError(String(e)))
    Promise.all([expressionOn(chr), exprMeta()])
      .then(([m, mt]) => { if (live) { setExpr(m); setMeta(mt) } })
      .catch(() => {}) // expression is optional; the gene list works without it
    return () => { live = false }
  }, [chr, start, end])
  const tpmOf = (id: string) => {
    const e = expr?.get(id)
    return e && meta ? classTPM(e, meta, organ) : 0
  }
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    let out = !genes || !q ? genes ?? [] : genes.filter((g) => [g.id, g.locus_tag, g.refseq, g.arabidopsis, g.symbol, g.description].join(' ').toLowerCase().includes(q))
    if (expr && meta) {
      out = out.filter((g) => {
        const e = expr.get(g.id)
        if (ef !== 'all' && !e) return false
        if (ef === 'expressed' && !e!.peak) return false
        if (ef === 'peak' && e!.peak !== organ) return false
        if (ef === 'fpref' && !e!.fibrePref) return false
        return minTPM <= 0 || (!!e && classTPM(e, meta, organ) >= minTPM)
      })
      if (sortBy === 'tpm') out = [...out].sort((a, b) => tpmOf(b.id) - tpmOf(a.id))
      if (sortBy === 'tau') out = [...out].sort((a, b) => (expr.get(b.id)?.tau ?? -1) - (expr.get(a.id)?.tau ?? -1))
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genes, filter, expr, meta, ef, organ, minTPM, sortBy])
  const csvRows = () => shown.map((g) => {
    const e = expr?.get(g.id)
    const row: Record<string, unknown> = { ...g }
    meta?.organs.forEach((o, i) => { row[`tpm_${o.replace(/ /g, '_')}`] = e?.tpm[i] ?? '' })
    row.peak_class = e?.peak ?? ''
    row.tau = e?.tau ?? ''
    row.fibre_preferential = e ? e.fibrePref : ''
    return row
  })
  const narrowed = ef !== 'all' || minTPM > 0
  const tooWide = end - start > 20e6
  return (
    <AsyncBoundary loading={!genes && !error} error={error}>
      <div className="space-y-4">
        <div className="card">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-lg font-semibold text-wheat-900">
              {narrowed && genes ? `${shown.length.toLocaleString()} of ${genes.length.toLocaleString()}` : shown.length.toLocaleString()} genes in {chr}:{mb(start)}–{mb(end)} Mb
              <span className="ml-2 text-sm font-normal text-wheat-600">TM-1 UTX v2.1, JGI annotation</span>
            </h3>
            <div className="flex gap-2">
              <input className="input w-56" placeholder="Filter by ID or description" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <HeatmapButton label="Expression heatmap" id={`region-${chr}-${start}-${end}`} title={`${chr}:${mb(start)}–${mb(end)} Mb`} chr={chr} start={start} end={end} />
              <button className="btn" onClick={() => downloadCSV(`genes_${chr}_${Math.round(start)}_${Math.round(end)}.csv`, csvRows())}>Download CSV</button>
            </div>
          </div>
          {meta && (
            <div className="mb-3 rounded border border-wheat-200 bg-wheat-50/60 p-2 text-sm">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="font-medium text-wheat-800">Narrow by expression</span>
                <label className="flex items-center gap-1 whitespace-nowrap">Show
                  <select className="input py-1" value={ef} onChange={(e) => setEf(e.target.value as ExprFilter)}>
                    <option value="all">all genes</option>
                    <option value="expressed">expressed (≥ 1 TPM)</option>
                    <option value="peak">highest in organ</option>
                    <option value="fpref">fibre-preferential</option>
                  </select>
                </label>
                <label className="flex items-center gap-1 whitespace-nowrap">Organ
                  <select className="input py-1" value={organ} onChange={(e) => setOrgan(e.target.value)}>
                    {CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-1 whitespace-nowrap">at least
                  <input className="input w-20 py-1" type="number" min={0} step={1} value={minTPM} onChange={(e) => setMinTPM(Math.max(0, Number(e.target.value) || 0))} />
                  TPM
                </label>
                <label className="flex items-center gap-1 whitespace-nowrap">Sort by
                  <select className="input py-1" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
                    <option value="position">position</option>
                    <option value="tpm">TPM in {organ}</option>
                    <option value="tau">tissue specificity (τ)</option>
                  </select>
                </label>
                {narrowed && <button className="text-xs underline text-wheat-600" onClick={() => { setEf('all'); setMinTPM(0); setSortBy('position') }}>reset</button>}
              </div>
              <p className="mt-1 text-xs text-wheat-500">
                Fibre-preferential: highest in fibre (10 and 20 dpa) and at least twice the TPM of every other organ group ({(100 * meta.fibre_preferential_share).toFixed(1)}% of all genes).
                Organ TPM is the mean of its libraries (leaf includes cotyledon; flower = petal, stamen, pistil; seed = ovule 10 dpa and seed). {SOURCE_NOTE}
              </p>
            </div>
          )}
          {tooWide && <p className="mb-2 text-sm text-wheat-600">This interval is wider than 20 Mb; most of its genes are unlikely to be causal.</p>}
          <div className="max-h-[32rem] overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-wheat-50 text-left text-wheat-600">
                <tr>
                  <th className="py-1 pr-3">Gene</th><th className="pr-3">Start</th><th className="pr-3">End</th>
                  {meta && <><th className="pr-3" title={meta.organs.join(', ')}>Organs</th><th className="pr-3 text-right">{organ} TPM</th><th className="pr-3">Peak</th></>}
                  <th className="pr-3">RefSeq</th><th className="pr-3">Arabidopsis</th><th>Description</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 3000).map((g) => (
                  <tr key={g.id} className="border-t border-wheat-100 align-top">
                    <td className="py-1 pr-3 font-mono"><Link className="underline" to={`/genes?q=${g.id}`}>{g.id}</Link></td>
                    <td className="pr-3 tabular-nums">{g.start.toLocaleString()}</td>
                    <td className="pr-3 tabular-nums">{g.end.toLocaleString()}</td>
                    {meta && (() => {
                      const e = expr?.get(g.id)
                      return <>
                        <td className="pr-3">{e && <ExprStrip e={e} meta={meta} />}</td>
                        <td className="pr-3 text-right tabular-nums">{e ? (tpmOf(g.id) < 10 ? tpmOf(g.id).toFixed(1) : Math.round(tpmOf(g.id))) : ''}</td>
                        <td className="pr-3 whitespace-nowrap">{e?.peak ?? (e ? '–' : '')}{e?.fibrePref && <span className="ml-1 rounded bg-accent/15 px-1 text-xs text-accent-strong" title="fibre-preferential">FP</span>}</td>
                      </>
                    })()}
                    <td className="pr-3 font-mono">{g.refseq && <ExtLink href={g.ncbi_gene_id ? `https://www.ncbi.nlm.nih.gov/gene/${g.ncbi_gene_id}` : idLink(g.refseq)}>{g.refseq}</ExtLink>}</td>
                    <td className="pr-3 font-mono">{g.arabidopsis && <ExtLink href={idLink(g.arabidopsis)}>{g.arabidopsis}</ExtLink>}</td>
                    <td className="text-wheat-700">{g.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length > 3000 && <p className="mt-2 text-sm text-wheat-600">First 3,000 shown; the CSV has all {shown.length.toLocaleString()}.</p>}
          </div>
        </div>
        <div className="card">
          <h4 className="mb-1 text-sm font-semibold text-wheat-900">Meta-QTL and hotspots overlapping this interval</h4>
          {ivs && <IntervalTable items={ivs} />}
        </div>
      </div>
    </AsyncBoundary>
  )
}

export default function GenesPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const r = params.get('r') ?? ''
  const region = useMemo(() => (r ? parseRegion(r) : null), [r])
  const ePar = params.get('e')
  const initialFilter: ExprFilter = ePar === 'fpref' || ePar === 'expressed' ? ePar : 'all'
  const [text, setText] = useState(q || r)
  const [res, setRes] = useState<SearchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setText(q || r), [q, r])
  useEffect(() => {
    if (!q) { setRes(null); return }
    let live = true
    setBusy(true)
    setError(null)
    searchGene(q)
      .then((x) => live && setRes(x))
      .catch((e) => live && setError(String(e)))
      .finally(() => live && setBusy(false))
    return () => { live = false }
  }, [q])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    setParams(parseRegion(t) ? { r: t } : { q: t })
  }

  return (
    <div>
      <PageHero
        eyebrow="Search"
        title="Genes and intervals"
        subtitle="Find a gene by any of its identifiers and see which meta-QTL, hotspots, QTL and GWAS loci cover it, or list the genes inside an interval and narrow them by organ expression (TM-1 RNA-seq of 11 organs). Genes are those of the G. hirsutum TM-1 UTX v2.1 annotation (JGI), the assembly on which every map position in CottonQTLome is drawn."
        variant="side"
      />
      <form onSubmit={submit} className="card mb-4 flex flex-wrap items-center gap-2">
        <input
          className="input min-w-[18rem] flex-1 font-mono"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Gohir.A07G180000, ERO13_A07G180000v2, LOC107936969, AT5G65110, Gh_D11G2028 · or a region: A07:90.1-91.3"
          aria-label="Gene identifier or region"
        />
        <button className="btn inline-flex items-center gap-1" type="submit"><Search className="h-4 w-4" />Search</button>
        <p className="w-full text-xs text-wheat-600">
          Accepted: JGI (Gohir.*), GenBank locus tags (ERO13_*), NCBI RefSeq (LOC*, GeneID), Arabidopsis homologs (AT*G*), Swiss-Prot gene symbols,
          and candidate-gene IDs as written in the papers (NAU Gh_*, HAU Ghir_*, G. barbadense and others). Regions in Mb, kb or bp.
        </p>
        <Examples onPick={(t) => { setText(t); setParams(parseRegion(t) ? { r: t } : { q: t }) }} />
      </form>

      {region && <RegionView key={`${r}|${ePar ?? ''}`} {...region} initialFilter={initialFilter} />}
      {r && !region && <p className="card text-sm text-red-700">Could not read “{r}” as a region. Use the form A07:90.1-91.3 (Mb).</p>}

      {q && (
        <AsyncBoundary loading={busy} error={error}>
          {res && (
            <div className="space-y-4">
              {res.genes.map((g) => <GeneCard key={g.id} g={g} />)}
              {res.homologOf.length > 0 && (
                <div className="card">
                  <h3 className="mb-1 text-lg font-semibold text-wheat-900">{res.homologOf.length} cotton genes whose best Swiss-Prot hit is named {q.toUpperCase()}</h3>
                  <p className="mb-2 text-sm text-wheat-600">Homology by BLASTP best hit; a shared name does not establish orthology.</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-sm">
                    {res.homologOf.map((g) => <Link key={g.id} className="underline" to={`/genes?q=${g.id}`}>{g.id}</Link>)}
                  </div>
                </div>
              )}
              {res.mentions.length > 0 && (
                <div className="card">
                  <h3 className="mb-1 text-lg font-semibold text-wheat-900">Named as a candidate gene in {res.mentions.length} record{res.mentions.length > 1 ? 's' : ''}</h3>
                  <p className="mb-2 text-sm text-wheat-600">
                    As written by the authors, often on an older annotation. <ExtLink href={idLink(q)}>Look up {q}</ExtLink>
                  </p>
                  <table className="min-w-full text-sm">
                    <thead className="text-left text-wheat-600"><tr><th className="py-1 pr-3">Record</th><th className="pr-3">Type</th><th className="pr-3">Trait</th><th className="pr-3">Chr</th><th>Study</th></tr></thead>
                    <tbody>
                      {res.mentions.map((m) => (
                        <tr key={m.record} className="border-t border-wheat-100">
                          <td className="py-1 pr-3 font-mono"><Link className="underline" to={`${m.type === 'GWAS' ? '/data/gwas' : m.type === 'meta-QTL' ? '/data/metaqtl' : '/data/qtl'}?q=${m.record}`}>{m.record}</Link></td>
                          <td className="pr-3">{m.type}</td><td className="pr-3">{m.trait}</td><td className="pr-3">{m.chr}</td><td>{m.study}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {!res.genes.length && !res.mentions.length && !res.homologOf.length && (
                <div className="card text-sm text-wheat-700">
                  No gene or candidate-gene record matches “{q}”. Identifiers are matched exactly (case and version suffix ignored).{' '}
                  <ExtLink href={idLink(q)}>Search {q} in an external database</ExtLink>
                </div>
              )}
            </div>
          )}
        </AsyncBoundary>
      )}
    </div>
  )
}
