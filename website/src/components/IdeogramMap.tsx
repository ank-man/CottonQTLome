import { useMemo, useRef, useState } from 'react'
import { MapIcon } from 'lucide-react'
import {
  MapItem,
  MetaQTLItem,
  QTLItem,
  TraitCategory,
  TRAIT_COLORS,
  TRAIT_CATEGORIES,
  CHROMOSOME_LENGTHS,
  GENOME_COLOR_CLASS,
  chromosomeLength,
  homoeologOrder,
  genomeOf,
} from '../lib/map'
import { UserItem, UserColorMode, USER_SINGLE_CLASS, filterUserItems, valueScaler } from '../lib/userData'

interface IdeogramMapProps {
  items: MapItem[]
  showQTL: boolean
  showMetaQTL: boolean
  selectedTraits: string[]
  search?: string
  svgRef?: React.RefObject<SVGSVGElement>
  compact?: boolean
  showLabels?: boolean
  /** Show mqtl_name text beside MetaQTL brackets, thinning them out to avoid overlap. */
  showItemLabels?: boolean
  /** Restrict the chromosome skeleton to one subgenome. */
  genomeFilter?: 'all' | 'A' | 'D'
  /** Colour bars by subgenome (A/B/D); off falls back to a neutral wheat tone. */
  genomeColor?: boolean
  /** Uploaded loci, drawn in their own lane left of each chromosome. */
  userItems?: UserItem[]
  userColorMode?: UserColorMode
  showUserLabels?: boolean
  userValueLabel?: string
}

const MARGIN = { top: 24, right: 90, bottom: 40, left: 48 }
const COMPACT_MARGIN = { top: 18, right: 70, bottom: 32, left: 38 }
const CHROM_WIDTH = 30
const COMPACT_CHROM_WIDTH = 22
// Relative scale: the longest chromosome in view is always exactly this
// tall; every other bar is sized proportionally to it (not an absolute
// px-per-Mb), so the figure has a fixed, bounded height.
const MAX_BAR_HEIGHT = 1300
const COMPACT_MAX_BAR_HEIGHT = 920
// MapChart-style side lanes: a QTL density strip immediately right of the
// bar, then a stack of MetaQTL interval brackets further out - both beside
// the chromosome rather than drawn on top of it, so the karyotype colour
// stays legible underneath.
const QTL_LANE = 36
const COMPACT_QTL_LANE = 26
const META_LANE_WIDTH = 13
const COMPACT_META_LANE_WIDTH = 10
const MAX_META_LANES = 4
const QTL_BINS = 60
// Same-trait regions closer than this are drawn as one bar (labels off).
const JOIN_GAP_BP = 2_000_000
// Minimum vertical gap (px, in unscaled viewBox units) between two labels in
// the same column - "space aware": a label is only drawn when it won't
// collide with the previous one, rather than printing every name.
const MIN_LABEL_GAP = 13
// Row height of one item label (7px text). With labels on, the plot grows tall
// enough that every label on the densest chromosome gets its own row.
const LABEL_ROW = 9
const MAX_LABELLED_BAR_HEIGHT = 9000
// Reserved horizontal room for the name-label text column. Only added to the
// column spacing when labels are actually on, so inter-chromosome distance
// adapts to whether labels need the space instead of always paying for it.
const LABEL_WIDTH = 78
const COMPACT_LABEL_WIDTH = 58
const COL_GAP = 56 + QTL_LANE + META_LANE_WIDTH * MAX_META_LANES
const COMPACT_COL_GAP = 40 + COMPACT_QTL_LANE + COMPACT_META_LANE_WIDTH * MAX_META_LANES
// Scale ruler ticks, every N Mb.
const SCALE_STEP_MB = 20
// Lane for uploaded loci, left of the bar; mark length encodes the value column.
const USER_LANE = 22
const COMPACT_USER_LANE = 16
const USER_LABEL_WIDTH = 70
const COMPACT_USER_LABEL_WIDTH = 56

type Hover =
  | { kind: 'item'; x: number; y: number; item: MapItem }
  | { kind: 'chr'; x: number; y: number; chr: string }
  | { kind: 'user'; x: number; y: number; item: UserItem }

export default function IdeogramMap({
  items,
  showQTL,
  showMetaQTL,
  selectedTraits,
  search = '',
  svgRef,
  compact = false,
  showLabels = true,
  showItemLabels = false,
  genomeFilter = 'all',
  genomeColor = true,
  userItems = [],
  userColorMode = 'trait',
  showUserLabels = false,
  userValueLabel = '',
}: IdeogramMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<Hover | null>(null)

  // Full wheat chromosome skeleton by default; a subgenome filter drops the
  // other chromosomes out entirely instead of leaving empty columns. All
  // chromosomes are plotted in a single row, side by side.
  const chromosomes = useMemo(() => {
    const all = Object.keys(CHROMOSOME_LENGTHS).sort((a, b) => homoeologOrder(a) - homoeologOrder(b))
    return genomeFilter === 'all' ? all : all.filter((c) => c.startsWith(genomeFilter))
  }, [genomeFilter])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((item) => {
      if (item.type === 'qtl' && !showQTL) return false
      if (item.type === 'metaqtl' && !showMetaQTL) return false
      if (selectedTraits.length > 0 && !selectedTraits.includes(item.trait)) return false
      if (q) {
        const hay = `${item.name} ${item.trait} ${item.raw.parameter || ''} ${item.raw.candidate_gene || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [items, showQTL, showMetaQTL, selectedTraits, search])

  // QTLs are far too numerous per chromosome (thousands) to draw as individual
  // marks legibly, so bin them along the physical length and draw a density
  // strip instead - bar length is proportional to local count, colour is the
  // bin's dominant trait.
  const qtlDensity = useMemo(() => {
    const byChr = new Map<string, { count: number; traits: Map<string, number>; only: QTLItem | null }[]>()
    chromosomes.forEach((c) =>
      byChr.set(c, Array.from({ length: QTL_BINS }, () => ({ count: 0, traits: new Map<string, number>(), only: null })))
    )
    filtered.forEach((item) => {
      if (item.type !== 'qtl') return
      const bins = byChr.get(item.chromosome)
      if (!bins) return
      const len = chromosomeLength(item.chromosome)
      const idx = Math.min(QTL_BINS - 1, Math.max(0, Math.floor((item.point / len) * QTL_BINS)))
      const bin = bins[idx]
      bin.count++
      bin.traits.set(item.trait, (bin.traits.get(item.trait) ?? 0) + 1)
      // Only worth a name label when the bin resolves to exactly one QTL -
      // once a second lands here there's no single name left to print.
      bin.only = bin.count === 1 ? item : null
    })
    let max = 1
    byChr.forEach((bins) => bins.forEach((b) => { if (b.count > max) max = b.count }))
    return { byChr, max }
  }, [filtered, chromosomes])

  const dominantTrait = (traits: Map<string, number>): string => {
    let best = ''
    let bestCount = -1
    traits.forEach((c, t) => { if (c > bestCount) { bestCount = c; best = t } })
    return best
  }

  // ~40 meta-QTL per chromosome, each ~2 Mb: drawn one by one they read as a
  // cloud of squares. Intervals of the same trait that overlap or lie within
  // JOIN_GAP_BP of each other are joined into
  // one bar (member IDs kept for the tooltip), like the long MetaQTL bars of
  // WheatQTLdb. With labels on, every region is drawn on its own.
  const regions = useMemo(() => {
    const metas = filtered.filter((i): i is MetaQTLItem => i.type === 'metaqtl')
    if (showItemLabels) return metas
    const groups = new Map<string, MetaQTLItem[]>()
    metas.forEach((m) => {
      const k = `${m.chromosome}|${m.trait}`
      const g = groups.get(k)
      if (g) g.push(m)
      else groups.set(k, [m])
    })
    const out: MetaQTLItem[] = []
    groups.forEach((list) => {
      list.sort((a, b) => a.start - b.start)
      let cur: MetaQTLItem | null = null
      list.forEach((m) => {
        if (cur && m.start <= cur.end + JOIN_GAP_BP) {
          cur.end = Math.max(cur.end, m.end)
          cur.members!.push(m.name)
        } else {
          cur = { ...m, members: [m.name] }
          out.push(cur)
        }
      })
    })
    out.forEach((m) => {
      if (m.members!.length > 1) {
        m.id = `${m.id}+${m.members!.length}`
        m.name = `${m.members!.length} clustered regions`
        m.point = (m.start + m.end) / 2
      }
    })
    return out
  }, [filtered, showItemLabels])

  // Stack overlapping MetaQTL intervals into side-by-side bracket lanes, per
  // chromosome, so overlapping intervals don't collide.
  const metaLanes = useMemo(() => {
    const lanes = new Map<string, number>()
    const lastEndByChrLane = new Map<string, number[]>()
    regions
      .slice()
      .sort((a, b) => a.start - b.start)
      .forEach((m) => {
        const ends = lastEndByChrLane.get(m.chromosome) ?? []
        let lane = ends.findIndex((end) => m.start >= end)
        if (lane === -1) {
          lane = ends.length
          ends.push(0)
        }
        ends[lane] = m.end
        lastEndByChrLane.set(m.chromosome, ends)
        lanes.set(m.id, Math.min(lane, MAX_META_LANES - 1))
      })
    return lanes
  }, [regions])

  const userFiltered = useMemo(() => filterUserItems(userItems, selectedTraits, search), [userItems, selectedTraits, search])
  const userByChr = useMemo(() => {
    const g = new Map<string, UserItem[]>()
    userFiltered.forEach((u) => {
      const a = g.get(u.chromosome)
      if (a) a.push(u)
      else g.set(u.chromosome, [u])
    })
    g.forEach((list) => list.sort((a, b) => b.point - a.point))
    return g
  }, [userFiltered])
  const scaleValue = useMemo(() => valueScaler(userFiltered), [userFiltered])
  const hasUser = userItems.length > 0

  const margin = compact ? COMPACT_MARGIN : MARGIN
  const userLane = hasUser ? (compact ? COMPACT_USER_LANE : USER_LANE) : 0
  const userLabelWidth = hasUser && showUserLabels ? (compact ? COMPACT_USER_LABEL_WIDTH : USER_LABEL_WIDTH) : 0
  const chromWidth = compact ? COMPACT_CHROM_WIDTH : CHROM_WIDTH
  const labelWidth = showItemLabels ? (compact ? COMPACT_LABEL_WIDTH : LABEL_WIDTH) : 0
  const colGap = (compact ? COMPACT_COL_GAP : COL_GAP) + labelWidth + userLane + userLabelWidth
  const baseBarHeight = compact ? COMPACT_MAX_BAR_HEIGHT : MAX_BAR_HEIGHT
  // Labels on: make the longest bar tall enough that the chromosome with the
  // most labels per Mb fits them all one row apart.
  const maxBarHeight = useMemo(() => {
    if (!showItemLabels) return baseBarHeight
    const longest = Math.max(...chromosomes.map((c) => chromosomeLength(c)))
    let need = Math.round(baseBarHeight * 1.5)
    chromosomes.forEach((c) => {
      const n = regions.filter((m) => m.chromosome === c).length +
        (showQTL ? (qtlDensity.byChr.get(c) ?? []).filter((b) => b.only).length : 0)
      need = Math.max(need, ((n + 2) * LABEL_ROW * longest) / chromosomeLength(c))
    })
    return Math.min(MAX_LABELLED_BAR_HEIGHT, Math.ceil(need))
  }, [showItemLabels, baseBarHeight, chromosomes, regions, qtlDensity, showQTL])
  const qtlLane = compact ? COMPACT_QTL_LANE : QTL_LANE
  const metaLaneWidth = compact ? COMPACT_META_LANE_WIDTH : META_LANE_WIDTH

  const pxPerMb = useMemo(() => {
    const longestMb = Math.max(...chromosomes.map((c) => chromosomeLength(c) / 1_000_000))
    return maxBarHeight / longestMb
  }, [chromosomes, maxBarHeight])

  const svgWidth = margin.left + chromosomes.length * colGap + margin.right
  const svgHeight = margin.top + maxBarHeight + margin.bottom

  const yFor = (chr: string, value: number) => {
    const len = chromosomeLength(chr)
    const h = (len / 1_000_000) * pxPerMb
    const ratio = Math.max(0, Math.min(1, value / len))
    return h - ratio * h
  }

  const qtlCount = filtered.filter((i) => i.type === 'qtl').length
  const metaCount = filtered.filter((i) => i.type === 'metaqtl').length

  if (chromosomes.length === 0) {
    return (
      <div className="card flex flex-col items-center justify-center py-16 text-center">
        <MapIcon className="h-10 w-10 text-wheat-400 dark:text-wheat-500" />
        <p className="mt-3 text-wheat-700 dark:text-wheat-300">No chromosomes match the current genome filter.</p>
      </div>
    )
  }

  const scaleTicks = []
  for (let mb = 0; mb <= 200; mb += SCALE_STEP_MB) scaleTicks.push(mb)

  return (
    <div className="card overflow-hidden">
      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-center gap-2">
          <MapIcon className="h-5 w-5 text-wheat-600 dark:text-wheat-400" />
          <h3 className="text-lg font-semibold text-wheat-900 dark:text-wheat-50">Ideogram view</h3>
          <span className="text-sm text-wheat-600 dark:text-wheat-400">
            — {chromosomes.length} chromosome{chromosomes.length === 1 ? '' : 's'}, coloured by subgenome
          </span>
        </div>
        <div className="flex flex-col items-start gap-2 lg:items-end">
          <div className="text-sm text-wheat-700 dark:text-wheat-300">
            <span className="font-semibold text-wheat-900 dark:text-wheat-50">{qtlCount.toLocaleString()}</span> QTLs ·{' '}
            <span className="font-semibold text-wheat-900 dark:text-wheat-50">{metaCount.toLocaleString()}</span> regions
            {hasUser && (
              <>
                {' '}· <span className="font-semibold text-wheat-900 dark:text-wheat-50">{userFiltered.length.toLocaleString()}</span> of your loci
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] lg:justify-end">
            {TRAIT_CATEGORIES.map((trait) => (
              <span key={trait} className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: TRAIT_COLORS[trait] }} />
                {trait}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div ref={containerRef} className="flex justify-center overflow-x-auto">
        <svg
          ref={svgRef}
          width={svgWidth}
          height={svgHeight}
          className={`block h-auto ${showItemLabels || showUserLabels ? 'shrink-0' : ''}`}
          style={{ width: svgWidth, maxWidth: showItemLabels || showUserLabels ? 'none' : '100%' }}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <filter id="ideoShadow" x="-30%" y="-5%" width="160%" height="110%">
              <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="#000" floodOpacity={0.12} />
            </filter>
          </defs>

          {/* Mb scale ruler on the left */}
          <g>
            {scaleTicks.map((mb) => {
              const y = margin.top + maxBarHeight - mb * pxPerMb
              if (y < margin.top - 2) return null
              return (
                <g key={mb}>
                  <line
                    x1={margin.left - 3}
                    x2={svgWidth - margin.right}
                    y1={y}
                    y2={y}
                    stroke="currentColor"
                    strokeWidth={0.5}
                    strokeDasharray="2 4"
                    className="text-wheat-300 dark:text-ink-600 pointer-events-none"
                  />
                  <line
                    x1={margin.left - 8}
                    x2={margin.left - 3}
                    y1={y}
                    y2={y}
                    stroke="currentColor"
                    strokeWidth={0.75}
                    className="text-wheat-400 dark:text-wheat-500"
                  />
                  <text
                    x={margin.left - 11}
                    y={y + 3}
                    textAnchor="end"
                    className="fill-current text-[9px] text-wheat-500 dark:text-wheat-400"
                  >
                    {mb}
                  </text>
                </g>
              )
            })}
            <text
              x={margin.left - 11}
              y={margin.top - 10}
              textAnchor="end"
              className="fill-current text-[9px] font-semibold text-wheat-500 dark:text-wheat-400"
            >
              Mb
            </text>
          </g>

          {chromosomes.map((chr, idx) => {
            // Shift right by the user lane (+ labels) so it fits left of the bar.
            const cx = margin.left + idx * colGap + colGap / 2 + (userLane + userLabelWidth) / 2
            const len = chromosomeLength(chr)
            const h = (len / 1_000_000) * pxPerMb
            const rowTop = margin.top + (maxBarHeight - h)
            const half = chromWidth / 2
            const genome = genomeOf(chr)
            const colorClass = genomeColor
              ? GENOME_COLOR_CLASS[genome] ?? 'text-wheat-400 dark:text-wheat-500'
              :'text-wheat-300 dark:text-wheat-600'
            const qtlBins = qtlDensity.byChr.get(chr) ?? []
            const metaqtls = regions.filter((i) => i.chromosome === chr)
            // Shared label column for both QTL and MetaQTL name labels, past
            // all the side lanes.
            const labelX = cx + half + qtlLane + MAX_META_LANES * metaLaneWidth + 12
            const labels: { key: string; y: number; x0: number; color: string; text: string }[] = []

            return (
              <g key={chr}>
                <rect
                  x={cx - half}
                  y={rowTop}
                  width={chromWidth}
                  height={h}
                  rx={half}
                  ry={half}
                  fill="currentColor"
                  className={`cursor-pointer ${colorClass}`}
                  stroke="currentColor"
                  strokeOpacity={0.35}
                  strokeWidth={1}
                  filter="url(#ideoShadow)"
                  onMouseEnter={(e) => setHover({ kind: 'chr', x: e.clientX, y: e.clientY, chr })}
                  onMouseMove={(e) => setHover({ kind: 'chr', x: e.clientX, y: e.clientY, chr })}
                  onMouseLeave={() => setHover(null)}
                />
                {/* QTL density strip: bar length proportional to local count,
                    colour is the bin's dominant trait. A bin that resolves to
                    exactly one QTL can carry its name (space aware, like
                    MetaQTL below) - a bin with several QTLs has no single
                    name to print. */}
                {showQTL &&
                  (() => {
                    return qtlBins.map((bin, i) => {
                      if (bin.count === 0) return null
                      const yTop = rowTop + h * (1 - (i + 1) / QTL_BINS)
                      const yMid = yTop + (h / QTL_BINS) / 2
                      const binH = h / QTL_BINS
                      const trait = dominantTrait(bin.traits)
                      const color = TRAIT_COLORS[trait as TraitCategory] ?? '#888'
                      // Minimum length is deliberately generous (not just a
                      // couple of px) - a bin with even one QTL needs to read
                      // as a visible mark next to dozens of chromosome bars,
                      // not disappear at this zoomed-out, side-by-side scale.
                      const barLen = Math.max(6, (bin.count / qtlDensity.max) * qtlLane)
                      if (showItemLabels && bin.only) labels.push({ key: `q${i}`, y: yMid, x0: cx + half + barLen, color, text: bin.only.name })
                      return (
                        <g key={i}>
                          <rect
                            x={cx + half}
                            y={yTop}
                            width={barLen}
                            height={Math.max(binH, 3.5)}
                            fill={color}
                            fillOpacity={0.92}
                            stroke={color}
                            strokeOpacity={0.5}
                            strokeWidth={0.5}
                          >
                            <title>{`${bin.count.toLocaleString()} QTL(s), mostly ${trait}`}</title>
                          </rect>
                        </g>
                      )
                    })
                  })()}

                {/* MetaQTL brackets: stacked in lanes beside the bar, with a
                    thin leader line back to the bar at the interval's midpoint.
                    Labels share one text column past the lanes and are
                    "space aware": a name is only printed when it won't
                    collide with the previous label on this chromosome. */}
                {showMetaQTL &&
                  (() => {
                    return metaqtls.map((m) => {
                      const yStart = rowTop + yFor(chr, m.start)
                      const yEnd = rowTop + yFor(chr, m.end)
                      const yMid = (yStart + yEnd) / 2
                      const lane = metaLanes.get(m.id) ?? 0
                      const laneX = cx + half + qtlLane + lane * metaLaneWidth
                      const color = TRAIT_COLORS[m.trait as TraitCategory] ?? '#888'
                      if (showItemLabels) labels.push({ key: m.id, y: yMid, x0: laneX + metaLaneWidth - 2, color, text: m.name })
                      return (
                        <g key={m.id}>
                          <rect
                            x={laneX}
                            y={yEnd}
                            width={metaLaneWidth - 2}
                            height={Math.max(yStart - yEnd, 5)}
                            rx={1.5}
                            fill={color}
                            fillOpacity={0.7}
                            stroke={color}
                            strokeWidth={0.75}
                            className="cursor-pointer hover:fill-opacity-95"
                            onMouseEnter={(e) => setHover({ kind: 'item', x: e.clientX, y: e.clientY, item: m })}
                            onMouseLeave={() => setHover(null)}
                            onMouseMove={(e) => setHover({ kind: 'item', x: e.clientX, y: e.clientY, item: m })}
                          />
                        </g>
                      )
                    })
                  })()}

                {/* Item labels: every label is drawn, nudged apart so none
                    overlap, with an elbow leader back to its mark. */}
                {labels.length > 0 &&
                  (() => {
                    labels.sort((a, b) => a.y - b.y)
                    const ys = labels.map((l) => l.y)
                    for (let k = 1; k < ys.length; k++) ys[k] = Math.max(ys[k], ys[k - 1] + LABEL_ROW)
                    const bottom = rowTop + h + LABEL_ROW
                    if (ys[ys.length - 1] > bottom) {
                      ys[ys.length - 1] = bottom
                      for (let k = ys.length - 2; k >= 0; k--) ys[k] = Math.min(ys[k], ys[k + 1] - LABEL_ROW)
                    }
                    return (
                      <g className="pointer-events-none">
                        {labels.map((l, k) => (
                          <g key={l.key}>
                            <polyline
                              points={`${l.x0},${l.y} ${labelX - 8},${l.y} ${labelX - 2},${ys[k]}`}
                              fill="none"
                              stroke={l.color}
                              strokeWidth={0.6}
                              strokeOpacity={0.6}
                            />
                            <text x={labelX} y={ys[k] + 2.5} className="fill-current text-[7px] text-wheat-700 dark:text-wheat-300">
                              {l.text.length > 16 ? `${l.text.slice(0, 15)}…` : l.text}
                            </text>
                          </g>
                        ))}
                      </g>
                    )
                  })()}

                {/* Uploaded loci: ticks (points) or bars (intervals) left of
                    the chromosome; length is proportional to the value column. */}
                {hasUser &&
                  (() => {
                    const list = userByChr.get(chr) ?? []
                    const edge = cx - half - 2
                    let lastLabelY = -Infinity
                    return (
                      <g className={userColorMode === 'single' ? USER_SINGLE_CLASS : undefined}>
                        {list.map((u) => {
                          const len = Math.max(4, scaleValue(u) * userLane)
                          const color = userColorMode === 'single' ? 'currentColor' : TRAIT_COLORS[u.trait] ?? '#888'
                          const yS = rowTop + yFor(chr, u.start)
                          const yE = rowTop + yFor(chr, u.end)
                          const yMid = (yS + yE) / 2
                          const on = (e: React.MouseEvent) => setHover({ kind: 'user', x: e.clientX, y: e.clientY, item: u })
                          const canLabel = showUserLabels && Math.abs(yMid - lastLabelY) >= MIN_LABEL_GAP
                          if (canLabel) lastLabelY = yMid
                          const name = u.name.length > 14 ? `${u.name.slice(0, 13)}…` : u.name
                          return (
                            <g key={u.id} onMouseEnter={on} onMouseMove={on} onMouseLeave={() => setHover(null)} className="cursor-pointer">
                              {u.isInterval && yS - yE >= 1.5 ? (
                                <rect x={edge - len} y={yE} width={len} height={yS - yE} fill={color} fillOpacity={0.55} stroke={color} strokeWidth={0.6} />
                              ) : (
                                <line x1={edge - len} x2={edge} y1={yMid} y2={yMid} stroke={color} strokeWidth={1.6} strokeLinecap="round" />
                              )}
                              {canLabel && (
                                <text x={edge - userLane - 3} y={yMid + 2.5} textAnchor="end" className="fill-current text-[7px] text-wheat-700 dark:text-wheat-300">
                                  {name}
                                </text>
                              )}
                            </g>
                          )
                        })}
                      </g>
                    )
                  })()}

                {showLabels && (
                  <text
                    x={cx}
                    y={margin.top + maxBarHeight + 18}
                    textAnchor="middle"
                    className="fill-current text-xs font-semibold text-wheat-900 dark:text-wheat-50"
                  >
                    {chr}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-wheat-200 dark:border-ink-700 pt-4 text-xs">
        {genomeColor &&
          (['A', 'D'] as const).map((g) => (
            <span key={g} className="inline-flex items-center gap-1.5 text-wheat-600 dark:text-wheat-400">
              <span className={`h-2.5 w-2.5 rounded-full ${GENOME_COLOR_CLASS[g]}`} style={{ backgroundColor: 'currentColor' }} />
              {g} genome
            </span>
          ))}
        <span className="text-wheat-500 dark:text-wheat-400">
          Bars: real physical length{genomeColor ? ', coloured by subgenome' : ''}. Beside each bar: QTL density strip (length ∝ local count) and region brackets, both coloured by trait.
          {hasUser && (
            <> Left of each bar: your loci (ticks = positions, bars = intervals{userValueLabel ? `, length ∝ ${userValueLabel}` : ''}).</>
          )}
        </span>
      </div>

      {hover && (
        <div
          className="fixed z-50 max-w-xs rounded border border-wheat-200 dark:border-ink-700 bg-wheat-50 dark:bg-ink-800 p-3 text-xs shadow-xl"
          style={{ left: hover.x + 14, top: hover.y + 14 }}
        >
          {hover.kind === 'chr' && (
            <>
              <div className="font-semibold text-wheat-900 dark:text-wheat-50">Chromosome {hover.chr}</div>
              <div className="text-wheat-700 dark:text-wheat-300">
                {(chromosomeLength(hover.chr) / 1_000_000).toFixed(1)} Mb · {genomeOf(hover.chr)}t subgenome
              </div>
            </>
          )}
          {hover.kind === 'user' && <UserTooltip item={hover.item} valueLabel={userValueLabel} single={userColorMode === 'single'} />}
          {hover.kind === 'item' && (
            <>
              <div
                className="mb-2 rounded-md px-2 py-1 text-xs font-semibold text-white"
                style={{ backgroundColor: TRAIT_COLORS[hover.item.trait as TraitCategory] ?? '#888' }}
              >
                {hover.item.type === 'qtl' ? 'QTL' : 'Region'} · {hover.item.name}
              </div>
              <div className="space-y-0.5 text-wheat-700 dark:text-wheat-300">
                <div><span className="font-medium">Chromosome:</span> {hover.item.chromosome}</div>
                <div><span className="font-medium">Trait:</span> {hover.item.trait}</div>
                {hover.item.type === 'metaqtl' && (
                  <div>
                    <span className="font-medium">Interval:</span>{' '}
                    {(hover.item.start / 1_000_000).toFixed(2)} – {(hover.item.end / 1_000_000).toFixed(2)} Mb
                  </div>
                )}
                <div><span className="font-medium">Position:</span> {(hover.item.point / 1_000_000).toFixed(2)} Mb</div>
                {hover.item.type === 'metaqtl' && hover.item.members && hover.item.members.length > 1 && (
                  <div>
                    <span className="font-medium">Merged:</span> {hover.item.members.slice(0, 8).join(', ')}
                    {hover.item.members.length > 8 ? ` +${hover.item.members.length - 8} more` : ''}
                    <div className="text-[10px] text-wheat-500 dark:text-wheat-400">Turn on “Region labels” to draw each one.</div>
                  </div>
                )}
                {(!('members' in hover.item) || (hover.item.members?.length ?? 0) <= 1) && hover.item.raw.parameter && (
                  <div><span className="font-medium">Parameter:</span> {hover.item.raw.parameter}</div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export function UserTooltip({ item, valueLabel, single }: { item: UserItem; valueLabel: string; single: boolean }) {
  const extra = Object.entries(item.raw).filter(([, v]) => v).slice(0, 8)
  return (
    <>
      <div
        className={`mb-2 rounded-md px-2 py-1 text-xs font-semibold ${single ? 'bg-ink-800 text-white' : 'text-white'}`}
        style={single ? undefined : { backgroundColor: TRAIT_COLORS[item.trait] ?? '#888' }}
      >
        Your data · {item.name}
      </div>
      <div className="space-y-0.5 text-wheat-700 dark:text-wheat-300">
        <div>
          <span className="font-medium">Position:</span> {item.chromosome}:{' '}
          {item.isInterval
            ? `${(item.start / 1e6).toFixed(3)}–${(item.end / 1e6).toFixed(3)} Mb`
            : `${(item.point / 1e6).toFixed(3)} Mb`}
        </div>
        {item.traitText && <div><span className="font-medium">Trait:</span> {item.traitText} ({item.trait})</div>}
        {item.value != null && <div><span className="font-medium">{valueLabel || 'Value'}:</span> {item.value.toFixed(2)}</div>}
        <div className="mt-1 border-t border-wheat-200 dark:border-ink-700 pt-1 text-[10px] text-wheat-500 dark:text-wheat-400">
          {extra.map(([k, v]) => (
            <div key={k} className="truncate"><span className="font-medium">{k}:</span> {v}</div>
          ))}
        </div>
      </div>
    </>
  )
}
