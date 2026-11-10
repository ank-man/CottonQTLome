import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { intervalExpression } from '../lib/genes'

type Counts = Record<string, [number, number, number, number, number]>
let cached: Counts | null = null

/** Genes and fibre-preferential genes inside a hotspot or meta-QTL CI; the count opens the narrowed gene list. */
export default function ExprCount({ id, region }: { id: string; region: string }) {
  const [c, setC] = useState<Counts | null>(cached)
  useEffect(() => {
    if (cached) return
    let live = true
    intervalExpression().then((x) => { cached = x; if (live) setC(x) }).catch(() => {})
    return () => { live = false }
  }, [])
  const v = c?.[id]
  const to = (e?: string) => `/genes?r=${encodeURIComponent(region)}${e ? `&e=${e}` : ''}`
  if (!v) return <Link className="underline" to={to()}>list</Link>
  return (
    <span className="whitespace-nowrap tabular-nums">
      <Link className="underline" to={to()} title="All genes in the interval">{v[0].toLocaleString()}</Link>
      {' · '}
      <Link className="underline decoration-accent" to={to('fpref')} title="Fibre-preferential genes (TM-1 organ RNA-seq)">{v[2]} FP</Link>
    </span>
  )
}
