import { useMemo, useState } from 'react'
import { Download, Layers } from 'lucide-react'
import { HotspotRecord, MQTLRecord, QTLRecord } from '../lib/types'
import { normalizeChromosome } from '../lib/map'
import { Region, UserItem, overlapWithDatabase } from '../lib/userData'
import { downloadCSV } from '../lib/csv'

interface Props {
  items: UserItem[]
  valueLabel: string
  mqtl: MQTLRecord[]
  hotspots: HotspotRecord[]
  loci: QTLRecord[]
  fileName: string
}

const FLANKS = [0, 0.5, 1, 2, 5]
const PAGE = 50

/** Which database meta-QTL, hotspots and loci sit on or near each uploaded locus. */
export default function UserOverlap({ items, valueLabel, mqtl, hotspots, loci, fileName }: Props) {
  const [flankMb, setFlankMb] = useState(1)
  const [onlyHits, setOnlyHits] = useState(false)
  const hasTraits = items.some((i) => i.traitText)
  const [sameCategory, setSameCategory] = useState(true)
  const matchTrait = hasTraits && sameCategory
  const [shown, setShown] = useState(PAGE)

  const mqRegions = useMemo<Region[]>(
    () =>
      mqtl.flatMap((m) => {
        const chr = normalizeChromosome(m.chromosome)
        const s = parseFloat(m.ci_start_mb) * 1e6
        const e = parseFloat(m.ci_end_mb) * 1e6
        return chr && Number.isFinite(s) && Number.isFinite(e)
          ? [{ id: m.mqtl_id, chromosome: chr, start: s, end: e, label: `${m.mqtl_id} (${m.trait}, ${m.n_studies} studies)`, category: m.category }]
          : []
      }),
    [mqtl],
  )
  const hsRegions = useMemo<Region[]>(
    () =>
      hotspots.flatMap((h) => {
        const chr = normalizeChromosome(h.chromosome)
        const s = parseFloat(h.start)
        const e = parseFloat(h.end)
        return chr && Number.isFinite(s) && Number.isFinite(e)
          ? [{ id: h.hotspot_id, chromosome: chr, start: s, end: e, label: `${h.hotspot_id} (${h.n_studies} studies, mostly ${h.dominant_category})`, category: h.dominant_category }]
          : []
      }),
    [hotspots],
  )
  const lociByChr = useMemo(() => {
    const g = new Map<string, number[]>()
    loci.forEach((r) => {
      const chr = normalizeChromosome(r.chromosome)
      const bp = r.map_bp ? parseFloat(r.map_bp) : NaN
      if (!chr || !Number.isFinite(bp)) return
      const a = g.get(chr)
      if (a) a.push(bp)
      else g.set(chr, [bp])
    })
    g.forEach((a) => a.sort((x, y) => x - y))
    return g
  }, [loci])

  const rows = useMemo(
    () => overlapWithDatabase(items, mqRegions, hsRegions, lociByChr, flankMb * 1e6, matchTrait),
    [items, mqRegions, hsRegions, lociByChr, flankMb, matchTrait],
  )
  const withHit = rows.filter((r) => r.regions.length || r.hotspots.length)
  const visible = onlyHits ? withHit : rows

  const exportRows = () =>
    downloadCSV(
      `${fileName.replace(/\.[^.]+$/, '')}_vs_CottonQTLome_${flankMb}Mb.csv`,
      rows.map((r) => ({
        name: r.item.name,
        chromosome: r.item.chromosome,
        start_bp: Math.round(r.item.start),
        end_bp: Math.round(r.item.end),
        trait: r.item.traitText,
        [valueLabel || 'value']: r.item.value ?? '',
        meta_qtl: r.regions.map((x) => x.id).join('; '),
        hotspots: r.hotspots.map((x) => x.id).join('; '),
        [`database_loci_within_${flankMb}Mb`]: r.nearbyLoci,
      })),
    )

  if (!items.length) return null

  return (
    <div className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-wheat-600 dark:text-wheat-400" />
          <h3 className="text-lg font-semibold text-wheat-900 dark:text-wheat-50">Your loci vs. CottonQTLome</h3>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="inline-flex items-center gap-2">
            <span className="text-wheat-700 dark:text-wheat-300">Flank</span>
            <select className="input w-auto text-sm" value={flankMb} onChange={(e) => setFlankMb(Number(e.target.value))}>
              {FLANKS.map((f) => <option key={f} value={f}>± {f} Mb</option>)}
            </select>
          </label>
          {hasTraits && (
            <label className="inline-flex cursor-pointer items-center gap-2" title="Only count meta-QTL and hotspots of the trait category your locus was matched to">
              <input type="checkbox" className="h-4 w-4 accent-wheat-600" checked={sameCategory} onChange={(e) => setSameCategory(e.target.checked)} />
              <span className="text-wheat-700 dark:text-wheat-300">Same trait category only</span>
            </label>
          )}
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-wheat-600" checked={onlyHits} onChange={(e) => setOnlyHits(e.target.checked)} />
            <span className="text-wheat-700 dark:text-wheat-300">Only loci in a meta-QTL or hotspot</span>
          </label>
          <button className="btn text-xs" onClick={exportRows}>
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
      </div>
      <p className="mb-3 text-sm text-wheat-700 dark:text-wheat-300">
        <span className="font-semibold">{withHit.length.toLocaleString()}</span> of {rows.length.toLocaleString()} uploaded loci fall in
        (or within ± {flankMb} Mb of) a meta-QTL confidence interval or a hotspot{matchTrait ? ' of the same trait category' : ''}. Overlap only means co-location on the
        TM-1 UTX v2.1 axis (your positions are converted to it first); it does not show the same causal gene.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-wheat-600 dark:text-wheat-400">
            <tr>
              <th className="py-1 pr-3 font-medium">Your locus</th>
              <th className="py-1 pr-3 font-medium">Position (Mb)</th>
              <th className="py-1 pr-3 font-medium">Trait</th>
              <th className="py-1 pr-3 font-medium">Meta-QTL</th>
              <th className="py-1 pr-3 font-medium">Hotspot</th>
              <th className="py-1 pr-3 text-right font-medium">Database loci ± {flankMb} Mb</th>
            </tr>
          </thead>
          <tbody className="text-wheat-800 dark:text-wheat-200">
            {visible.slice(0, shown).map((r) => (
              <tr key={r.item.id} className="border-t border-wheat-100 dark:border-ink-800 align-top">
                <td className="py-1 pr-3 font-medium">{r.item.name}</td>
                <td className="whitespace-nowrap py-1 pr-3">
                  {r.item.chromosome}:{(r.item.start / 1e6).toFixed(2)}
                  {r.item.isInterval && `–${(r.item.end / 1e6).toFixed(2)}`}
                </td>
                <td className="py-1 pr-3">{r.item.traitText || '—'}</td>
                <td className="py-1 pr-3"><RegionList regions={r.regions} /></td>
                <td className="py-1 pr-3"><RegionList regions={r.hotspots} /></td>
                <td className="py-1 pr-3 text-right tabular-nums">{r.nearbyLoci.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {visible.length > shown && (
        <button className="btn mt-3 text-xs" onClick={() => setShown(shown + PAGE * 4)}>
          Show more ({(visible.length - shown).toLocaleString()} left)
        </button>
      )}
    </div>
  )
}

/** First three regions, the rest behind a "+N more" toggle. */
function RegionList({ regions }: { regions: Region[] }) {
  const [all, setAll] = useState(false)
  if (!regions.length) return <>—</>
  const shown = all ? regions : regions.slice(0, 3)
  return (
    <>
      {shown.map((x) => <div key={x.id}>{x.label}</div>)}
      {regions.length > 3 && (
        <button className="text-wheat-600 underline dark:text-wheat-400" onClick={() => setAll(!all)}>
          {all ? 'show fewer' : `+${regions.length - 3} more`}
        </button>
      )}
    </>
  )
}
