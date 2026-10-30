import { useMemo, useRef, useState } from 'react'
import { Download, Image as ImageIcon } from 'lucide-react'
import { LinkageGroup, LinkageQtl } from '../lib/linkageData'
import { TRAIT_COLORS, TRAIT_CATEGORIES } from '../lib/map'
import { exportRaster, exportSVG } from '../lib/exportMap'

// LinkageMapView-style drawing of an uploaded map: every linkage group to one
// cM scale with its markers as ticks and QTL support intervals in lanes
// beside it; then one group at a time with every marker named.

const TOP = 44
const HEIGHT = 460
const BAR = 12
const LANE = 7
const MAX_LANES = 4
const COL = 34 + BAR + LANE * MAX_LANES
const LABEL_GAP = 11
const MAX_LABELS = 160

interface Props {
  groups: LinkageGroup[]
  colorMode: 'trait' | 'single'
  showMarkers: boolean
  showQtl: boolean
  query: string
  valueLabel: string
  title: string
}

interface Hover { x: number; y: number; title: string; lines: string[] }

function lanes(qtl: LinkageQtl[]): Map<string, number> {
  const out = new Map<string, number>()
  const ends: number[] = []
  ;[...qtl].sort((a, b) => a.start - b.start).forEach((q) => {
    let lane = ends.findIndex((e) => q.start > e)
    if (lane === -1) { lane = ends.length; ends.push(0) }
    ends[lane] = q.end
    out.set(q.id, Math.min(lane, MAX_LANES - 1))
  })
  return out
}

function spread(ys: number[], gap: number, lo: number, hi: number): number[] {
  const out = ys.slice()
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1] + gap)
  const over = out.length ? out[out.length - 1] - hi : 0
  if (over > 0) {
    out[out.length - 1] -= over
    for (let i = out.length - 2; i >= 0; i--) out[i] = Math.min(out[i], out[i + 1] - gap)
  }
  return out.map((y) => Math.max(lo, y))
}

const INK = 'rgb(var(--n-900))'
const MUTED = 'rgb(var(--n-500))'
const HIT = '#e34948'

export default function LinkagePlotView({ groups, colorMode, showMarkers, showQtl, query, valueLabel, title }: Props) {
  const [hover, setHover] = useState<Hover | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const overviewRef = useRef<SVGSVGElement>(null)
  const detailRef = useRef<SVGSVGElement>(null)

  const q = query.trim().toLowerCase()
  const isHit = (m: string) => q !== '' && m.toLowerCase().includes(q)
  const color = (qt: LinkageQtl) => (colorMode === 'single' ? INK : TRAIT_COLORS[qt.trait] ?? '#888')

  const maxSpan = Math.max(1, ...groups.map((g) => g.max - g.min))
  const scale = HEIGHT / maxSpan
  const width = Math.max(360, 56 + groups.length * COL + 20)
  const laneMap = useMemo(() => new Map(groups.map((g) => [g.name, lanes(g.qtl)])), [groups])
  const traitsUsed = useMemo(() => new Set(groups.flatMap((g) => g.qtl.map((x) => x.trait))), [groups])

  const current = groups.find((g) => g.name === (selected ?? groups[0]?.name))

  const detail = useMemo(() => {
    if (!current) return null
    const lo = from !== '' && Number.isFinite(parseFloat(from)) ? parseFloat(from) : current.min
    const hi = to !== '' && Number.isFinite(parseFloat(to)) ? parseFloat(to) : current.max
    const a = Math.min(lo, hi)
    const b = Math.max(lo, hi)
    const inRange = current.markers.filter((m) => m.cm >= a && m.cm <= b)
    let labelled = inRange
    if (inRange.length > MAX_LABELS) {
      const step = inRange.length / MAX_LABELS
      const keep = new Set<number>()
      for (let i = 0; i < MAX_LABELS; i++) keep.add(Math.floor(i * step))
      labelled = inRange.filter((m, i) => keep.has(i) || isHit(m.marker))
    }
    const h = Math.max(480, labelled.length * LABEL_GAP + 20)
    const span = Math.max(b - a, 1e-9)
    const y = (cm: number) => TOP + ((Math.max(a, Math.min(b, cm)) - a) / span) * h
    const labelY = spread(labelled.map((m) => y(m.cm)), LABEL_GAP, TOP, TOP + h)
    const qtl = current.qtl.filter((x) => x.end >= a && x.start <= b)
    return { a, b, inRange, labelled, h, y, labelY, qtl, lanes: lanes(qtl) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, from, to, q])

  const qtlTip = (e: React.MouseEvent, x: LinkageQtl) =>
    setHover({
      x: e.clientX,
      y: e.clientY,
      title: x.name,
      lines: [
        `${x.group}: ${x.start.toFixed(1)}–${x.end.toFixed(1)} cM${x.peak != null ? ` (peak ${x.peak.toFixed(1)})` : ''}`,
        ...(x.traitText ? [`${x.traitText} → ${x.trait}`] : []),
        ...(x.value != null ? [`${valueLabel || 'value'}: ${x.value}`] : []),
      ],
    })

  // detail layout: cM labels | bar | QTL lanes | connectors | marker names
  const barX = 96
  const lanesX = barX + BAR + 6
  const namesX = lanesX + MAX_LANES * (LANE + 2) + 30
  const longest = detail ? Math.max(8, ...detail.labelled.map((m) => m.marker.length)) : 8
  const detailWidth = namesX + Math.min(longest, 40) * 6.2 + 20

  return (
    <div className="card">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h3 className="text-lg font-semibold text-wheat-900 dark:text-wheat-50">Linkage map</h3>
        <span className="text-xs text-wheat-500 dark:text-wheat-400">
          {groups.length} groups · {groups.reduce((s, g) => s + g.markers.length, 0).toLocaleString()} markers ·{' '}
          {groups.reduce((s, g) => s + g.qtl.length, 0).toLocaleString()} QTL · longest {maxSpan.toFixed(0)} cM
        </span>
        <span className="flex-1" />
        <button className="btn text-xs" onClick={() => overviewRef.current && exportSVG(overviewRef.current, `${title}_linkage_map.svg`)}>
          <Download className="h-3.5 w-3.5" />SVG
        </button>
        <button className="btn text-xs" onClick={() => overviewRef.current && exportRaster(overviewRef.current, 'png', `${title}_linkage_map.png`)}>
          <ImageIcon className="h-3.5 w-3.5" />PNG
        </button>
      </div>

      {showQtl && colorMode === 'trait' && traitsUsed.size > 0 && (
        <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-wheat-700 dark:text-wheat-300">
          {TRAIT_CATEGORIES.filter((t) => traitsUsed.has(t)).map((t) => (
            <span key={t} className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: TRAIT_COLORS[t] }} />{t}
            </span>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded border border-wheat-200 bg-wheat-50 dark:border-ink-700">
        <svg ref={overviewRef} width={width} height={HEIGHT + TOP + 40} role="img" aria-label={`Linkage map ${title}`}>
          <rect width={width} height={HEIGHT + TOP + 40} fill="rgb(var(--n-50))" />
          {Array.from({ length: Math.floor(maxSpan / 50) + 1 }, (_, i) => i * 50).map((t) => (
            <g key={t}>
              <line x1={44} x2={width} y1={TOP + t * scale} y2={TOP + t * scale} stroke="rgb(var(--n-200))" strokeWidth={1} />
              <text x={40} y={TOP + t * scale + 3} textAnchor="end" style={{ fill: MUTED, fontSize: 10 }}>{t}</text>
            </g>
          ))}
          <text x={8} y={16} style={{ fill: MUTED, fontSize: 10 }}>cM</text>
          {groups.map((g, i) => {
            const x0 = 64 + i * COL
            const h = Math.max(3, (g.max - g.min) * scale)
            const active = current?.name === g.name
            const ln = laneMap.get(g.name)!
            return (
              <g key={g.name}>
                <text x={x0 + BAR / 2} y={TOP - 22} textAnchor="middle" style={{ fill: active ? 'rgb(var(--accent))' : INK, fontSize: 10, fontWeight: 600 }}>
                  {g.name.length > 8 ? `${g.name.slice(0, 7)}…` : g.name}
                </text>
                {g.chromosome && g.chromosome !== g.name && (
                  <text x={x0 + BAR / 2} y={TOP - 10} textAnchor="middle" style={{ fill: MUTED, fontSize: 9 }}>{g.chromosome}</text>
                )}
                <rect
                  x={x0} y={TOP} width={BAR} height={h} rx={BAR / 2}
                  fill="rgb(var(--n-100))" stroke={active ? INK : MUTED} strokeWidth={active ? 2 : 1}
                  className="cursor-pointer"
                  onClick={() => { setSelected(g.name); setFrom(''); setTo('') }}
                  onMouseMove={(e) => setHover({ x: e.clientX, y: e.clientY, title: g.name, lines: [`${g.min.toFixed(1)}–${g.max.toFixed(1)} cM`, `${g.markers.length} markers · ${g.qtl.length} QTL`, 'Click to label this group'] })}
                  onMouseLeave={() => setHover(null)}
                />
                {showMarkers && g.markers.map((m, k) => (
                  <line key={k} x1={x0 + 1} x2={x0 + BAR - 1} y1={TOP + (m.cm - g.min) * scale} y2={TOP + (m.cm - g.min) * scale}
                    stroke={isHit(m.marker) ? HIT : INK} strokeWidth={isHit(m.marker) ? 1.6 : 0.5} strokeOpacity={isHit(m.marker) ? 1 : 0.5}
                    className="pointer-events-none" />
                ))}
                {q && g.markers.filter((m) => isHit(m.marker)).map((m, k) => (
                  <line key={`h${k}`} x1={x0 - 5} x2={x0 + BAR + 5} y1={TOP + (m.cm - g.min) * scale} y2={TOP + (m.cm - g.min) * scale} stroke={HIT} strokeWidth={1.6} />
                ))}
                {showQtl && g.qtl.map((x) => {
                  const lane = ln.get(x.id) ?? 0
                  const lx = x0 + BAR + 3 + lane * LANE
                  const y1 = TOP + (x.start - g.min) * scale
                  const y2 = TOP + (x.end - g.min) * scale
                  const c = color(x)
                  return (
                    <g key={x.id} className="cursor-pointer" onMouseMove={(e) => qtlTip(e, x)} onMouseLeave={() => setHover(null)}>
                      <rect x={lx} y={y1} width={LANE - 2} height={Math.max(2.5, y2 - y1)} rx={1.5} fill={c} fillOpacity={0.75} stroke={c} strokeWidth={0.6} />
                      {x.peak != null && (
                        <line x1={lx - 1} x2={lx + LANE - 1} y1={TOP + (x.peak - g.min) * scale} y2={TOP + (x.peak - g.min) * scale} stroke={INK} strokeWidth={1} />
                      )}
                    </g>
                  )
                })}
                <text x={x0 + BAR / 2} y={TOP + h + 14} textAnchor="middle" style={{ fill: MUTED, fontSize: 9 }}>{g.markers.length || ''}</text>
              </g>
            )
          })}
        </svg>
      </div>
      <p className="mt-2 text-xs text-wheat-500 dark:text-wheat-400">
        Each bar is a linkage group drawn to one cM scale from its first to its last position; ticks are markers (count below), and
        the bars beside it are QTL support intervals (line = peak), stacked when they overlap. Where a group name is a chromosome
        (e.g. “chr15”, “A05”) its standard name is shown underneath. Click a group to see it with marker names.
      </p>

      {current && detail && (
        <div className="mt-6">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <h4 className="font-semibold text-wheat-900 dark:text-wheat-50">
                {current.name}{current.chromosome && current.chromosome !== current.name ? ` (${current.chromosome})` : ''}
              </h4>
              <p className="text-xs text-wheat-500 dark:text-wheat-400">
                {current.markers.length.toLocaleString()} markers · {current.qtl.length} QTL · {current.min.toFixed(1)}–{current.max.toFixed(1)} cM
                {detail.labelled.length < detail.inRange.length && <> · labelling {detail.labelled.length} of {detail.inRange.length} markers in view; narrow the range to label all</>}
              </p>
            </div>
            <span className="flex-1" />
            <label className="text-xs text-wheat-700 dark:text-wheat-300">Group
              <select className="input mt-1 w-auto" value={current.name} onChange={(e) => { setSelected(e.target.value); setFrom(''); setTo('') }}>
                {groups.map((g) => <option key={g.name} value={g.name}>{g.name}</option>)}
              </select>
            </label>
            <label className="text-xs text-wheat-700 dark:text-wheat-300">From (cM)
              <input className="input mt-1 w-20" inputMode="decimal" value={from} onChange={(e) => setFrom(e.target.value)} placeholder={current.min.toFixed(0)} />
            </label>
            <label className="text-xs text-wheat-700 dark:text-wheat-300">To (cM)
              <input className="input mt-1 w-20" inputMode="decimal" value={to} onChange={(e) => setTo(e.target.value)} placeholder={current.max.toFixed(0)} />
            </label>
            <button className="btn text-xs" onClick={() => detailRef.current && exportSVG(detailRef.current, `${title}_${current.name}.svg`)}>
              <Download className="h-3.5 w-3.5" />SVG
            </button>
            <button className="btn text-xs" onClick={() => detailRef.current && exportRaster(detailRef.current, 'png', `${title}_${current.name}.png`)}>
              <ImageIcon className="h-3.5 w-3.5" />PNG
            </button>
          </div>
          <div className="mt-2 max-h-[80vh] overflow-auto rounded border border-wheat-200 bg-wheat-50 dark:border-ink-700">
            <svg ref={detailRef} width={detailWidth} height={detail.h + TOP + 24} role="img" aria-label={`Linkage group ${current.name}`}>
              <rect width={detailWidth} height={detail.h + TOP + 24} fill="rgb(var(--n-50))" />
              <text x={barX + BAR / 2} y={20} textAnchor="middle" style={{ fill: INK, fontSize: 12, fontWeight: 600 }}>{current.name}</text>
              <rect x={barX} y={TOP} width={BAR} height={detail.h} rx={BAR / 2} fill="rgb(var(--n-100))" stroke={MUTED} />
              {detail.inRange.map((m, k) => (
                <line key={k} x1={barX} x2={barX + BAR} y1={detail.y(m.cm)} y2={detail.y(m.cm)} stroke={isHit(m.marker) ? HIT : INK} strokeWidth={isHit(m.marker) ? 1.4 : 0.5} strokeOpacity={isHit(m.marker) ? 1 : 0.5} />
              ))}
              {detail.qtl.map((x) => {
                const lane = detail.lanes.get(x.id) ?? 0
                const lx = lanesX + lane * (LANE + 2)
                const y1 = detail.y(x.start)
                const y2 = detail.y(x.end)
                const c = color(x)
                return (
                  <g key={x.id} className="cursor-pointer" onMouseMove={(e) => qtlTip(e, x)} onMouseLeave={() => setHover(null)}>
                    <rect x={lx} y={y1} width={LANE} height={Math.max(3, y2 - y1)} rx={2} fill={c} fillOpacity={0.75} stroke={c} />
                    {x.peak != null && <line x1={lx - 2} x2={lx + LANE + 2} y1={detail.y(x.peak)} y2={detail.y(x.peak)} stroke={INK} strokeWidth={1.2} />}
                  </g>
                )
              })}
              {detail.labelled.map((m, k) => {
                const y0 = detail.y(m.cm)
                const y1 = detail.labelY[k]
                const hit = isHit(m.marker)
                const ink = hit ? HIT : MUTED
                const x1 = lanesX + MAX_LANES * (LANE + 2)
                return (
                  <g key={k}>
                    <polyline points={`${barX},${y0} ${barX - 12},${y0} ${barX - 22},${y1} ${barX - 28},${y1}`} fill="none" stroke={ink} strokeWidth={0.6} />
                    <polyline points={`${barX + BAR},${y0} ${x1 + 6},${y0} ${x1 + 18},${y1} ${namesX - 4},${y1}`} fill="none" stroke={ink} strokeWidth={0.6} />
                    <text x={barX - 31} y={y1 + 3} textAnchor="end" style={{ fill: MUTED, fontSize: 9 }}>{m.cm.toFixed(1)}</text>
                    <text x={namesX} y={y1 + 3} style={{ fill: hit ? HIT : INK, fontSize: 9, fontWeight: hit ? 600 : 400 }}>
                      {m.marker.length > 40 ? `${m.marker.slice(0, 39)}…` : m.marker || '(unnamed)'}
                    </text>
                  </g>
                )
              })}
            </svg>
          </div>
          {detail.qtl.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-wheat-600 dark:text-wheat-400">
                  <tr>
                    <th className="py-1 pr-3 font-medium">QTL</th>
                    <th className="py-1 pr-3 font-medium">Interval (cM)</th>
                    <th className="py-1 pr-3 font-medium">Peak</th>
                    <th className="py-1 pr-3 font-medium">Trait → category</th>
                    {valueLabel && <th className="py-1 pr-3 font-medium">{valueLabel}</th>}
                    <th className="py-1 pr-3 font-medium">Markers inside</th>
                  </tr>
                </thead>
                <tbody className="text-wheat-800 dark:text-wheat-200">
                  {detail.qtl.map((x) => {
                    const inside = current.markers.filter((m) => m.cm >= x.start && m.cm <= x.end)
                    return (
                      <tr key={x.id} className="border-t border-wheat-100 dark:border-ink-800 align-top">
                        <td className="py-1 pr-3 font-medium">
                          <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color(x) }} />{x.name}
                        </td>
                        <td className="whitespace-nowrap py-1 pr-3">{x.start.toFixed(1)}–{x.end.toFixed(1)}</td>
                        <td className="py-1 pr-3">{x.peak != null ? x.peak.toFixed(1) : '—'}</td>
                        <td className="py-1 pr-3">{x.traitText ? `${x.traitText} → ${x.trait}` : '—'}</td>
                        {valueLabel && <td className="py-1 pr-3">{x.value ?? '—'}</td>}
                        <td className="py-1 pr-3">
                          {inside.length ? `${inside.length}: ${inside.slice(0, 6).map((m) => m.marker).join(', ')}${inside.length > 6 ? '…' : ''}` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {hover && (
        <div className="pointer-events-none fixed z-40 max-w-xs rounded-md border border-wheat-200 bg-wheat-50 px-3 py-2 text-xs shadow dark:border-ink-700 dark:bg-ink-800" style={{ left: hover.x + 14, top: hover.y + 10 }}>
          <div className="font-semibold text-wheat-900 dark:text-wheat-50">{hover.title}</div>
          {hover.lines.map((m, i) => <div key={i}>{m}</div>)}
        </div>
      )}
    </div>
  )
}
