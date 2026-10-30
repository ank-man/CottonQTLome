import { useMemo, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { HotspotRecord, WindowRecord } from '../lib/types'
import { CHROMOSOME_LENGTHS } from '../lib/map'
import { exportSVG } from '../lib/exportMap'
import { rampColor, rampStops, useTheme } from '../lib/ramp'

const HOT = '#e34948'
const CHRS = Object.keys(CHROMOSOME_LENGTHS)
const COL = 40
const BAR = 16
const TOP = 30
const HEIGHT = 420
const LEFT = 46

interface Props {
  windows: WindowRecord[]
  hotspots: HotspotRecord[]
  threshold?: number
  selected: string
  onSelect: (chromosome: string) => void
}
interface Hover { x: number; y: number; title: string; lines: string[] }

/** All 26 chromosomes to scale; each 2-Mb window shaded by the number of independent
 *  studies with a locus in it, hotspot regions bracketed and labelled. */
export default function HotspotKaryotype({ windows, hotspots, threshold, selected, onSelect }: Props) {
  const [hover, setHover] = useState<Hover | null>(null)
  const theme = useTheme()
  const RAMP = rampStops(theme)
  const ramp = (t: number) => rampColor(theme, t)
  const svgRef = useRef<SVGSVGElement>(null)
  const byChr = useMemo(() => {
    const m = new Map<string, WindowRecord[]>()
    windows.forEach((w) => { if (!m.has(w.chromosome)) m.set(w.chromosome, []); m.get(w.chromosome)!.push(w) })
    return m
  }, [windows])
  const maxStudies = Math.max(1, ...windows.map((w) => Number(w.n_studies)))
  const maxLen = Math.max(...Object.values(CHROMOSOME_LENGTHS))
  const px = HEIGHT / maxLen
  const width = LEFT + CHRS.length * COL + 16

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 text-xs text-wheat-600">
        <span className="font-medium text-wheat-800">Independent studies per 2-Mb window</span>
        <span>0</span>
        <span className="h-2.5 w-40 rounded-sm border border-wheat-200" style={{ background: `linear-gradient(to right, ${RAMP.join(',')})` }} />
        <span>{maxStudies}</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-1 rounded-sm" style={{ background: HOT }} />hotspot region{threshold ? ` (≥ ${threshold} studies, FDR < 0.01)` : ''}</span>
        <span className="flex-1" />
        <button className="btn text-xs" onClick={() => svgRef.current && exportSVG(svgRef.current, 'cotton_qtl_hotspots.svg')}>
          <Download className="h-3.5 w-3.5" />SVG
        </button>
      </div>
      <div className="mt-2 overflow-x-auto">
        <svg ref={svgRef} viewBox={`0 0 ${width} ${HEIGHT + TOP + 30}`} width="100%" style={{ minWidth: 640, maxHeight: '72vh' }} preserveAspectRatio="xMidYMin meet" role="img" aria-label="Karyotype of study support and QTL hotspots across the 26 cotton chromosomes">
          {Array.from({ length: Math.floor(maxLen / 2e7) + 1 }, (_, i) => i * 20).map((mb) => (
            <g key={mb}>
              <line x1={LEFT - 4} x2={width} y1={TOP + mb * 1e6 * px} y2={TOP + mb * 1e6 * px} stroke="rgb(var(--n-100))" strokeWidth={1} />
              <text x={LEFT - 8} y={TOP + mb * 1e6 * px + 3} textAnchor="end" className="fill-wheat-500 text-[10px]">{mb}</text>
            </g>
          ))}
          <text x={6} y={14} className="fill-wheat-500 text-[10px]">Mb</text>
          {CHRS.map((chr, i) => {
            const cx = LEFT + i * COL + COL / 2
            const h = CHROMOSOME_LENGTHS[chr] * px
            const active = chr === selected
            const clip = `hk-${chr}`
            return (
              <g key={chr} className="cursor-pointer" onClick={() => onSelect(chr)}>
                <clipPath id={clip}><rect x={cx - BAR / 2} y={TOP} width={BAR} height={h} rx={BAR / 2} /></clipPath>
                <g clipPath={`url(#${clip})`}>
                  {(byChr.get(chr) ?? []).map((w, k) => {
                    const y0 = TOP + Number(w.start) * px
                    const hh = (Number(w.end) - Number(w.start)) * px
                    return (
                      <rect key={k} x={cx - BAR / 2} y={y0} width={BAR} height={hh + 0.4} fill={ramp(Number(w.n_studies) / maxStudies)}
                        onMouseMove={(e) => setHover({
                          x: e.clientX, y: e.clientY,
                          title: `${chr}: ${(Number(w.start) / 1e6).toFixed(0)}–${(Number(w.end) / 1e6).toFixed(0)} Mb`,
                          lines: [`${w.n_studies} studies · ${w.n_loci} loci · ${w.n_traits} traits`, ...(w.significant === 'True' ? ['Hotspot window'] : [])],
                        })}
                        onMouseLeave={() => setHover(null)} />
                    )
                  })}
                </g>
                <rect x={cx - BAR / 2} y={TOP} width={BAR} height={h} rx={BAR / 2} fill="none" stroke={active ? 'rgb(var(--n-900))' : 'rgb(var(--n-500))'} strokeWidth={active ? 2 : 1} pointerEvents="none" />
                {hotspots.filter((x) => x.chromosome === chr).map((x) => {
                  const y0 = TOP + Number(x.start) * px
                  const y1 = TOP + Number(x.end) * px
                  return (
                    <g key={x.hotspot_id}
                      onMouseMove={(e) => setHover({
                        x: e.clientX, y: e.clientY,
                        title: `${x.hotspot_id} · ${chr}: ${(Number(x.start) / 1e6).toFixed(0)}–${(Number(x.end) / 1e6).toFixed(0)} Mb`,
                        lines: [`${x.n_studies} studies · ${x.n_loci} loci · ${x.n_traits} traits`, x.top_traits.split('; ').slice(0, 3).join('; ')],
                      })}
                      onMouseLeave={() => setHover(null)}>
                      <rect x={cx + BAR / 2 + 3} y={y0} width={4} height={Math.max(3, y1 - y0)} rx={2} fill={HOT} />
                      <rect x={cx + BAR / 2} y={y0 - 2} width={14} height={Math.max(7, y1 - y0 + 4)} fill="transparent" />
                    </g>
                  )
                })}
                <text x={cx} y={TOP - 10} textAnchor="middle" className={`text-[10px] font-semibold ${active ? 'fill-accent' : 'fill-wheat-800'}`}>{chr}</text>
              </g>
            )
          })}
        </svg>
      </div>
      {hover && (
        <div className="pointer-events-none fixed z-40 max-w-sm rounded-md border border-wheat-200 bg-wheat-50 px-3 py-2 text-xs shadow" style={{ left: hover.x + 14, top: hover.y + 10 }}>
          <div className="font-semibold text-wheat-900">{hover.title}</div>
          {hover.lines.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
    </div>
  )
}
