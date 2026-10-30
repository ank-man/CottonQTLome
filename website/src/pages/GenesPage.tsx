import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ExternalLink, Search } from 'lucide-react'
import PageHero from '../components/PageHero'
import AsyncBoundary from '../components/AsyncBoundary'
import { downloadCSV } from '../lib/csv'
import { CHRS, Gene, Interval, SearchResult, geneLinks, genesOn, idLink, intervalsOn, overlapping, searchGene } from '../lib/genes'

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
                {iv.kind === 'Q' ? (iv.support ? `LOD ${iv.support}` : '') : `${iv.support} studies`}
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

function GeneCard({ g }: { g: Gene }) {
  const [ivs, setIvs] = useState<Interval[] | null>(null)
  useEffect(() => {
    let live = true
    intervalsOn(g.chr).then((all) => {
      if (live) setIvs(overlapping(all.map((x) => ({ ...x, chr: g.chr })), g.start, g.end, 3e8))
    })
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
      </div>
      {g.description && <p className="text-sm text-wheat-800">{g.description}</p>}
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        {g.locus_tag && <><dt className="text-wheat-600">GenBank locus tag</dt><dd className="font-mono"><ExtLink href={idLink(g.locus_tag)}>{g.locus_tag}</ExtLink></dd></>}
        {g.refseq && <><dt className="text-wheat-600">RefSeq gene</dt><dd className="font-mono"><ExtLink href={g.ncbi_gene_id ? `https://www.ncbi.nlm.nih.gov/gene/${g.ncbi_gene_id}` : idLink(g.refseq)}>{g.refseq}</ExtLink>{g.ncbi_gene_id && <span className="ml-2 text-wheat-500">GeneID {g.ncbi_gene_id}</span>}</dd></>}
        {g.arabidopsis && <><dt className="text-wheat-600">Arabidopsis best hit</dt><dd className="font-mono"><ExtLink href={idLink(g.arabidopsis)}>{g.arabidopsis}</ExtLink>{g.symbol && <span className="ml-2 font-sans text-wheat-600">({g.symbol})</span>}</dd></>}
      </dl>
      <div>
        <h4 className="mb-1 text-sm font-semibold text-wheat-900">Loci overlapping this gene</h4>
        {ivs === null ? <p className="text-sm text-wheat-600">Loading…</p> : (
          <IntervalTable items={[...ivs].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || (b.end - b.start < a.end - a.start ? 1 : -1))} />
        )}
      </div>
    </div>
  )
}

function RegionView({ chr, start, end }: { chr: string; start: number; end: number }) {
  const [genes, setGenes] = useState<Gene[] | null>(null)
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
    return () => { live = false }
  }, [chr, start, end])
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return !genes || !q ? genes ?? [] : genes.filter((g) => [g.id, g.locus_tag, g.refseq, g.arabidopsis, g.symbol, g.description].join(' ').toLowerCase().includes(q))
  }, [genes, filter])
  const tooWide = end - start > 20e6
  return (
    <AsyncBoundary loading={!genes && !error} error={error}>
      <div className="space-y-4">
        <div className="card">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-lg font-semibold text-wheat-900">
              {shown.length.toLocaleString()} genes in {chr}:{mb(start)}–{mb(end)} Mb
              <span className="ml-2 text-sm font-normal text-wheat-600">TM-1 UTX v2.1, JGI annotation</span>
            </h3>
            <div className="flex gap-2">
              <input className="input w-56" placeholder="Filter by ID or description" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <button className="btn" onClick={() => downloadCSV(`genes_${chr}_${Math.round(start)}_${Math.round(end)}.csv`, shown)}>Download CSV</button>
            </div>
          </div>
          {tooWide && <p className="mb-2 text-sm text-wheat-600">This interval is wider than 20 Mb; most of its genes are unlikely to be causal.</p>}
          <div className="max-h-[32rem] overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-wheat-50 text-left text-wheat-600">
                <tr><th className="py-1 pr-3">Gene</th><th className="pr-3">Start</th><th className="pr-3">End</th><th className="pr-3">RefSeq</th><th className="pr-3">Arabidopsis</th><th>Description</th></tr>
              </thead>
              <tbody>
                {shown.slice(0, 3000).map((g) => (
                  <tr key={g.id} className="border-t border-wheat-100 align-top">
                    <td className="py-1 pr-3 font-mono"><Link className="underline" to={`/genes?q=${g.id}`}>{g.id}</Link></td>
                    <td className="pr-3 tabular-nums">{g.start.toLocaleString()}</td>
                    <td className="pr-3 tabular-nums">{g.end.toLocaleString()}</td>
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
        subtitle="Find a gene by any of its identifiers and see which meta-QTL, hotspots, QTL and GWAS loci cover it, or list the genes inside an interval. Genes are those of the G. hirsutum TM-1 UTX v2.1 annotation (JGI), the assembly on which every map position in CottonQTLome is drawn."
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
      </form>

      {region && <RegionView {...region} />}
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
