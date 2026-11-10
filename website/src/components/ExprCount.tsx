import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Grid3x3 } from 'lucide-react'
import { intervalExpression } from '../lib/genes'
import { openHeatmap } from './ExpressionHeatmap'

type Counts = Record<string, [number, number, number, number, number]>
let cached: Counts | null = null

/**
 * Genes and fibre-preferential genes inside a hotspot or meta-QTL interval: the counts open the gene list
 * (all, or narrowed to fibre-preferential genes), the grid button opens the organ-expression heatmap.
 */
export default function ExprCount({ id, title, chr, start, end }: { id: string; title: string; chr: string; start: number; end: number }) {
  const [c, setC] = useState<Counts | null>(cached)
  useEffect(() => {
    if (cached) return
    let live = true
    intervalExpression().then((x) => { cached = x; if (live) setC(x) }).catch(() => {})
    return () => { live = false }
  }, [])
  const region = `${chr}:${Math.round(start)}-${Math.round(end)}bp`
  const to = (e?: string) => `/genes?r=${encodeURIComponent(region)}${e ? `&e=${e}` : ''}`
  const v = c?.[id]
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums">
      {v ? (
        <>
          <Link className="underline" to={to()} title="All genes in the interval">{v[0].toLocaleString()}</Link>
          <span className="text-wheat-400">·</span>
          <Link className="underline decoration-accent" to={to('fpref')} title="Fibre-preferential genes (TM-1 organ RNA-seq)">{v[2]} FP</Link>
        </>
      ) : <Link className="underline" to={to()}>list</Link>}
      <button
        type="button"
        className="rounded border border-wheat-300 p-0.5 text-wheat-600 hover:border-accent hover:text-accent"
        title="Organ-expression heatmap of the genes in this interval"
        aria-label={`Expression heatmap for ${title}`}
        onClick={(e) => { e.stopPropagation(); openHeatmap({ id, title, chr, start, end, region }) }}
      >
        <Grid3x3 className="h-3.5 w-3.5" />
      </button>
    </span>
  )
}
