import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, X } from 'lucide-react'
import { downloadCSV } from '../lib/csv'
import { Expr, ExprMeta, Gene, classTPM, exprMeta, expressionOn, genesOn } from '../lib/genes'

/**
 * Organ-expression heatmap of the genes inside one hotspot or meta-QTL interval, opened from any table cell
 * with openHeatmap(). A single host (<ExpressionHeatmapHost/>, mounted in Layout) draws the dialog.
 */
export type HeatmapTarget = { id: string; title: string; chr: string; start: number; end: number; region: string }

let listener: ((t: HeatmapTarget | null) => void) | null = null
export function openHeatmap(t: HeatmapTarget) {
  listener?.(t)
}

type Show = 'fpref' | 'expressed' | 'all'
type Sort = 'peak' | 'tpm' | 'position'
type Scale = 'gene' | 'absolute'
const CLASSES = ['root', 'stem', 'leaf', 'flower', 'seed', 'fibre']
const MAX_ROWS = 300

export function ExpressionHeatmapHost() {
  const [t, setT] = useState<HeatmapTarget | null>(null)
  useEffect(() => {
    listener = setT
    return () => { listener = null }
  }, [])
  if (!t) return null
  return <HeatmapDialog key={t.id} t={t} onClose={() => setT(null)} />
}

type Row = { g: Gene; e: Expr }

function HeatmapDialog({ t, onClose }: { t: HeatmapTarget; onClose: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [nGenes, setNGenes] = useState(0)
  const [meta, setMeta] = useState<ExprMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [show, setShow] = useState<Show>('fpref')
  const [organ, setOrgan] = useState('fibre')
  const [sort, setSort] = useState<Sort>('tpm')
  const [scale, setScale] = useState<Scale>('gene')
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    Promise.all([genesOn(t.chr), expressionOn(t.chr), exprMeta()])
      .then(([genes, ex, m]) => {
        if (!live) return
        // genes whose midpoint lies in the interval, as in the counts of the tables
        const inside = genes.filter((g) => { const mid = (g.start + g.end) / 2; return mid >= t.start && mid < t.end })
        setNGenes(inside.length)
        setRows(inside.flatMap((g) => { const e = ex.get(g.id); return e ? [{ g, e }] : [] }))
        setMeta(m)
      })
      .catch((e) => live && setError(String(e)))
    return () => { live = false }
  }, [t])

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    box.current?.focus()
    const o = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = o }
  }, [onClose])

  // with no fibre-preferential gene, open on the expressed genes instead of an empty map
  useEffect(() => {
    if (rows && show === 'fpref' && !rows.some((r) => r.e.fibrePref)) setShow('expressed')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows])

  const shown = useMemo(() => {
    if (!rows || !meta) return []
    let x = rows.filter((r) => (show === 'all' ? true : show === 'expressed' ? !!r.e.peak : r.e.fibrePref))
    const tpm = (r: Row) => classTPM(r.e, meta, organ)
    if (sort === 'tpm') x = [...x].sort((a, b) => tpm(b) - tpm(a))
    if (sort === 'position') x = [...x].sort((a, b) => a.g.start - b.g.start)
    if (sort === 'peak') {
      const rank = (r: Row) => (r.e.peak ? CLASSES.indexOf(r.e.peak) : 99)
      x = [...x].sort((a, b) => rank(a) - rank(b) || b.e.max - a.e.max)
    }
    return x
  }, [rows, meta, show, organ, sort])

  useEffect(() => setHover(null), [show, sort, organ, scale])
  const globalMax = useMemo(() => Math.max(1, ...shown.map((r) => r.e.max)), [shown])
  const level = (r: Row, v: number) => {
    const top = scale === 'gene' ? r.e.max : globalMax
    return top < 1 ? 0 : Math.log2(v + 1) / Math.log2(top + 1)
  }
  const counts = rows ? { fp: rows.filter((r) => r.e.fibrePref).length, ex: rows.filter((r) => r.e.peak).length } : null

  const csv = () => meta && downloadCSV(`expression_${t.id}.csv`, shown.map(({ g, e }) => {
    const o: Record<string, unknown> = { gene_id: g.id, chromosome: g.chr, start: g.start, end: g.end, arabidopsis: g.arabidopsis, symbol: g.symbol, description: g.description }
    meta.organs.forEach((n, i) => { o[`tpm_${n.replace(/ /g, '_')}`] = e.tpm[i] })
    o.peak_class = e.peak ?? ''
    o.tau = e.tau ?? ''
    o.fibre_preferential = e.fibrePref
    return o
  }))

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-2 sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Organ expression of genes in ${t.title}`}
        className="card flex max-h-[94vh] w-full max-w-6xl flex-col outline-none">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-wheat-900">Organ expression · {t.title}</h3>
            <p className="text-sm text-wheat-600 tabular-nums">
              {t.chr}:{(t.start / 1e6).toFixed(2)}–{(t.end / 1e6).toFixed(2)} Mb · {nGenes.toLocaleString()} genes
              {counts && <> · {counts.ex.toLocaleString()} expressed · {counts.fp} fibre-preferential</>}
            </p>
          </div>
          <button className="rounded p-1 text-wheat-600 hover:bg-wheat-100" onClick={onClose} aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <label className="flex items-center gap-1 whitespace-nowrap">Show
            <select className="input py-1" value={show} onChange={(e) => setShow(e.target.value as Show)}>
              <option value="fpref">fibre-preferential</option>
              <option value="expressed">expressed (≥ 1 TPM)</option>
              <option value="all">all genes</option>
            </select>
          </label>
          <label className="flex items-center gap-1 whitespace-nowrap">Sort by
            <select className="input py-1" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="tpm">TPM in organ</option>
              <option value="peak">peak organ</option>
              <option value="position">position</option>
            </select>
          </label>
          {sort === 'tpm' && (
            <label className="flex items-center gap-1 whitespace-nowrap">Organ
              <select className="input py-1" value={organ} onChange={(e) => setOrgan(e.target.value)}>
                {CLASSES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
          )}
          <label className="flex items-center gap-1 whitespace-nowrap">Colour
            <select className="input py-1" value={scale} onChange={(e) => setScale(e.target.value as Scale)}>
              <option value="gene">relative to each gene's maximum</option>
              <option value="absolute">same scale for all genes</option>
            </select>
          </label>
          <span className="flex-1" />
          <Link className="text-sm underline" to={`/genes?r=${encodeURIComponent(t.region)}${show === 'fpref' ? '&e=fpref' : show === 'expressed' ? '&e=expressed' : ''}`} onClick={onClose}>Open as gene list</Link>
          <button className="btn inline-flex items-center gap-1" onClick={csv} disabled={!shown.length}><Download className="h-4 w-4" />CSV</button>
        </div>

        {error && <p className="text-sm text-red-700">{error}</p>}
        {!rows && !error && <p className="text-sm text-wheat-600">Loading…</p>}
        {rows && meta && (shown.length === 0 ? (
          <p className="text-sm text-wheat-600">No gene in this interval matches. Choose “expressed” or “all genes”.</p>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto" onMouseLeave={() => setHover(null)}>
            <table className="border-separate text-xs" style={{ borderSpacing: 1 }}>
              <thead className="sticky top-0 z-10 bg-wheat-50">
                <tr>
                  <th className="sticky left-0 z-20 bg-wheat-50" />
                  {CLASSES.map((c) => {
                    const n = meta.organ_class.filter((k) => k === c).length
                    return <th key={c} colSpan={n} className={`border-b px-1 pt-1 text-center font-medium ${c === 'fibre' ? 'border-accent text-accent-strong' : 'border-wheat-300 text-wheat-700'}`}>{c}</th>
                  })}
                  <th />
                </tr>
                <tr>
                  <th className="sticky left-0 z-20 bg-wheat-50 pb-1 pr-2 text-left font-medium text-wheat-600">Gene</th>
                  {meta.organs.map((o) => (
                    <th key={o} className="h-20 w-7 min-w-7 align-bottom font-normal text-wheat-600">
                      <span className="inline-block whitespace-nowrap" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>{o}</span>
                    </th>
                  ))}
                  <th className="pl-2 text-left align-bottom font-medium text-wheat-600">Peak · description</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, MAX_ROWS).map((r) => (
                  <tr key={r.g.id}>
                    <td className="sticky left-0 bg-wheat-50 pr-2 font-mono whitespace-nowrap">
                      <Link className="underline decoration-wheat-300 hover:decoration-accent" to={`/genes?q=${r.g.id}`} onClick={onClose}>{r.g.id.replace('Gohir.', '')}</Link>
                    </td>
                    {r.e.tpm.map((v, i) => (
                      <td key={i} className="h-4 w-7 min-w-7 p-0"
                        onMouseMove={(ev) => setHover({ x: ev.clientX, y: ev.clientY, text: `${r.g.id} · ${meta.organs[i]}: ${v} TPM` })}
                        aria-label={`${meta.organs[i]} ${v} TPM`}>
                        <span className="block h-4 w-full rounded-[2px]" style={{ background: `rgb(var(--accent) / ${(0.05 + 0.95 * level(r, v)).toFixed(3)})` }} />
                      </td>
                    ))}
                    <td className="max-w-[28rem] truncate pl-2 text-wheat-700" title={r.g.description}>
                      <span className="text-wheat-900">{r.e.peak ?? '–'}</span>
                      {r.e.fibrePref && <span className="ml-1 rounded bg-accent/15 px-1 text-accent-strong">FP</span>}
                      {r.g.symbol && <span className="ml-1 text-wheat-600">{r.g.symbol}</span>}
                      <span className="ml-1">{r.g.description}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length > MAX_ROWS && <p className="mt-2 text-xs text-wheat-600">First {MAX_ROWS} of {shown.length.toLocaleString()} genes; the CSV has all.</p>}
          </div>
        ))}

        {meta && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-wheat-200 pt-2 text-xs text-wheat-600">
            <span className="flex items-center gap-1.5">
              {scale === 'gene' ? 'gene minimum' : '0 TPM'}
              <span className="inline-block h-2.5 w-28 rounded-sm" style={{ background: 'linear-gradient(to right, rgb(var(--accent) / 0.05), rgb(var(--accent) / 1))' }} />
              {scale === 'gene' ? 'gene maximum' : `${Math.round(globalMax).toLocaleString()} TPM`} (log₂ TPM + 1)
            </span>
            <span>FP = fibre-preferential: highest in fibre and ≥ 2× every other organ group. TM-1 RNA-seq, PRJNA248163 (Zhang et al. 2015); one library per organ.</span>
          </div>
        )}
        {hover && (
          <div className="pointer-events-none fixed z-[60] rounded bg-wheat-900 px-2 py-1 text-xs text-wheat-50 shadow" style={{ left: hover.x + 12, top: hover.y + 12 }}>
            {hover.text}
          </div>
        )}
      </div>
    </div>
  )
}
