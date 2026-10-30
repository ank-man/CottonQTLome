import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Upload, X, FileDown, Play, AlertTriangle, ClipboardPaste, Search, GitCompare, Dna } from 'lucide-react'
import PageHero from '../components/PageHero'
import LinkagePlotView from '../components/LinkagePlotView'
import { ParsedTable } from '../lib/userData'
import {
  GroupMatch, MapMatch, MapMapping, QtlMapping, buildLinkage, compareWithDatabase, guessMapMapping,
  guessQtlMapping, loadMarkerIndex, parseLinkageText, readLinkageFile,
} from '../lib/linkageData'
import { useCSV } from '../lib/useCSV'
import { LinkageMapRecord, MarkerRecord } from '../lib/types'
import { downloadCSV } from '../lib/csv'

const DEMO = `${import.meta.env.BASE_URL}data/demo/`
const ACCEPT = '.csv,.tsv,.txt,.tab,.map,.mct,.loc,.json,.xlsx,.xls,.ods,.gz'

type Field = { key: string; label: string; required?: boolean }
const MAP_FIELDS: Field[] = [
  { key: 'marker', label: 'Marker' },
  { key: 'group', label: 'Linkage group / chromosome', required: true },
  { key: 'cm', label: 'Position (cM)', required: true },
]
const QTL_FIELDS: Field[] = [
  { key: 'name', label: 'QTL name' },
  { key: 'group', label: 'Linkage group', required: true },
  { key: 'start', label: 'Start / left (cM)', required: true },
  { key: 'end', label: 'End / right (cM)' },
  { key: 'peak', label: 'Peak (cM)' },
  { key: 'trait', label: 'Trait' },
  { key: 'value', label: 'LOD / PVE' },
]

interface Slot<M> { table: ParsedTable | null; mapping: M | null; file: File | null; error: string | null }

// Uploaded maps survive moving between pages (not a reload).
let saved: { map: Slot<MapMapping>; qtl: Slot<QtlMapping> } | null = null

function FileSlot<M extends Record<string, string>>({
  title, hint, slot, fields, onFile, onPaste, onMapping, onClear, busy,
}: {
  title: string
  hint: string
  slot: Slot<M>
  fields: Field[]
  onFile: (f: File, sheet?: string) => void
  onPaste: (text: string) => void
  onMapping: (m: M) => void
  onClear: () => void
  busy: boolean
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [text, setText] = useState('')
  const t = slot.table
  return (
    <div className="rounded border border-wheat-200 p-4 dark:border-ink-700">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="font-semibold text-wheat-900 dark:text-wheat-50">{title}</h4>
        {t && <button className="btn text-xs" onClick={onClear}><X className="h-3.5 w-3.5" />Remove</button>}
      </div>
      {!t ? (
        <>
          <div
            role="button"
            tabIndex={0}
            onClick={() => ref.current?.click()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') ref.current?.click() }}
            onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onFile(f) }}
            className={`flex cursor-pointer flex-col items-center rounded border-2 border-dashed px-3 py-6 text-center transition ${
              drag ? 'border-wheat-600 bg-wheat-100 dark:bg-ink-800' : 'border-wheat-300 hover:border-wheat-500 dark:border-ink-700'
            }`}
          >
            <Upload className="h-6 w-6 text-wheat-500" />
            <p className="mt-1 text-sm font-medium text-wheat-800 dark:text-wheat-100">{busy ? 'Reading…' : 'Drop a file or click to choose'}</p>
            <p className="mt-1 text-xs text-wheat-600 dark:text-wheat-400">{hint}</p>
            <input ref={ref} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
          </div>
          <button className="btn mt-2 text-xs" onClick={() => setPasteOpen(!pasteOpen)}><ClipboardPaste className="h-3.5 w-3.5" />Paste</button>
          {pasteOpen && (
            <div className="mt-2 space-y-2">
              <textarea className="input h-28 w-full font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste cells with a header row" />
              <button className="btn text-xs" disabled={!text.trim()} onClick={() => onPaste(text)}>Use pasted data</button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-xs text-wheat-600 dark:text-wheat-400">
            <span className="font-medium text-wheat-800 dark:text-wheat-100">{t.fileName}</span> · {t.format} · {t.rows.length.toLocaleString()} rows
            {t.notes.length > 0 && <> · {t.notes.join(' ')}</>}
          </p>
          {t.sheets && t.sheets.length > 1 && slot.file && (
            <label className="mt-2 flex items-center gap-2 text-xs">
              Sheet
              <select className="input w-auto text-xs" value={t.sheet} onChange={(e) => onFile(slot.file!, e.target.value)}>
                {t.sheets.map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
          )}
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {fields.map((f) => (
              <label key={f.key} className="block">
                <span className="text-xs font-medium text-wheat-700 dark:text-wheat-300">{f.label}{f.required && <span className="text-red-600"> *</span>}</span>
                <select
                  className={`input mt-1 w-full text-sm ${f.required && !slot.mapping?.[f.key] ? 'border-red-400' : ''}`}
                  value={slot.mapping?.[f.key] ?? ''}
                  onChange={(e) => onMapping({ ...(slot.mapping as M), [f.key]: e.target.value })}
                >
                  <option value="">{f.required ? '— choose —' : '— none —'}</option>
                  {t.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            ))}
          </div>
        </>
      )}
      {slot.error && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-red-700 dark:text-red-400"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{slot.error}</p>
      )}
    </div>
  )
}

const empty = <M,>(): Slot<M> => ({ table: null, mapping: null, file: null, error: null })

export default function LinkagePlot() {
  const [mapSlot, setMapSlot] = useState<Slot<MapMapping>>(saved?.map ?? empty())
  const [qtlSlot, setQtlSlot] = useState<Slot<QtlMapping>>(saved?.qtl ?? empty())
  const [busy, setBusy] = useState(false)
  const [colorMode, setColorMode] = useState<'trait' | 'single'>('trait')
  const [showMarkers, setShowMarkers] = useState(true)
  const [showQtl, setShowQtl] = useState(true)
  const [query, setQuery] = useState('')
  const [minValue, setMinValue] = useState('')
  useEffect(() => { saved = { map: mapSlot, qtl: qtlSlot } }, [mapSlot, qtlSlot])

  const readInto = async <M,>(f: File, sheet: string | undefined, set: (s: Slot<M>) => void, guess: (c: string[]) => M) => {
    setBusy(true)
    try {
      const t = await readLinkageFile(f, sheet)
      set({ table: t, mapping: guess(t.columns), file: f, error: null })
    } catch (e) {
      set({ ...empty<M>(), error: `Could not read ${f.name}: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(false)
    }
  }
  const pasteInto = <M,>(text: string, set: (s: Slot<M>) => void, guess: (c: string[]) => M) => {
    try {
      const t = parseLinkageText(text, 'Pasted data')
      set({ table: t, mapping: guess(t.columns), file: null, error: null })
    } catch (e) {
      set({ ...empty<M>(), error: e instanceof Error ? e.message : String(e) })
    }
  }
  const loadDemo = async () => {
    setBusy(true)
    try {
      const [a, b] = await Promise.all(['demo_linkage_map.csv', 'demo_linkage_qtl.csv'].map(async (n) => {
        const r = await fetch(DEMO + n)
        if (!r.ok) throw new Error(`${n}: HTTP ${r.status}`)
        return new File([await r.blob()], n)
      }))
      await readInto(a, undefined, setMapSlot, guessMapMapping)
      await readInto(b, undefined, setQtlSlot, guessQtlMapping)
    } catch (e) {
      setMapSlot({ ...empty<MapMapping>(), error: `Demo could not be loaded: ${e instanceof Error ? e.message : String(e)}` })
      setBusy(false)
    }
  }
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('demo') && !mapSlot.table && !qtlSlot.table) loadDemo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const result = useMemo(
    () => buildLinkage(mapSlot.table, mapSlot.mapping, qtlSlot.table, qtlSlot.mapping),
    [mapSlot.table, mapSlot.mapping, qtlSlot.table, qtlSlot.mapping],
  )
  const threshold = minValue.trim() === '' ? null : Number(minValue)
  const groups = useMemo(() => {
    if (threshold == null || !Number.isFinite(threshold)) return result.groups
    return result.groups.map((g) => ({ ...g, qtl: g.qtl.filter((q) => q.value != null && q.value >= threshold) }))
  }, [result.groups, threshold])
  const hasTraits = groups.some((g) => g.qtl.some((q) => q.traitText))
  const title = (mapSlot.table?.fileName || qtlSlot.table?.fileName || 'my_map').replace(/\.[^.]+$/, '')

  return (
    <div>
      <PageHero
        eyebrow="Plot your data"
        title="Linkage map & QTL (cM)"
        subtitle="Draw your own genetic map and QTL support intervals in centimorgans, LinkageMapView style, then see which chromosome each of your linkage groups matches and which CottonQTLome maps and trait-linked markers share your markers. For physical (bp) positions use the genome plotter."
        variant="side"
      >
        <Link to="/plot/genome" className="btn text-xs"><Dna className="h-3.5 w-3.5" />Genome (bp) plotter</Link>
        <Link to="/linkage-maps" className="btn text-xs">Database linkage maps</Link>
      </PageHero>

      <div className="space-y-6">
        <div className="card">
          <div className="grid gap-4 lg:grid-cols-2">
            <FileSlot
              title="1 · Linkage map (markers)"
              hint="Columns marker, linkage group, cM — CSV, TSV, Excel, JSON, MapChart / JoinMap .map, or an R/qtl cross .csv"
              slot={mapSlot}
              fields={MAP_FIELDS}
              busy={busy}
              onFile={(f, sh) => readInto(f, sh, setMapSlot, guessMapMapping)}
              onPaste={(t) => pasteInto(t, setMapSlot, guessMapMapping)}
              onMapping={(m) => setMapSlot({ ...mapSlot, mapping: m })}
              onClear={() => setMapSlot(empty())}
            />
            <FileSlot
              title="2 · QTL (optional)"
              hint="Columns linkage group, start and end cM (or a peak, or a “12.3-18.0” range), with name, trait, LOD if you have them"
              slot={qtlSlot}
              fields={QTL_FIELDS}
              busy={busy}
              onFile={(f, sh) => readInto(f, sh, setQtlSlot, guessQtlMapping)}
              onPaste={(t) => pasteInto(t, setQtlSlot, guessQtlMapping)}
              onMapping={(m) => setQtlSlot({ ...qtlSlot, mapping: m })}
              onClear={() => setQtlSlot(empty())}
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <button className="btn text-xs" onClick={loadDemo} disabled={busy}><Play className="h-3.5 w-3.5" />Plot the demo map + QTL</button>
            <a className="btn text-xs" href={DEMO + 'demo_linkage_map.csv'} download><FileDown className="h-3.5 w-3.5" />Demo map (CSV)</a>
            <a className="btn text-xs" href={DEMO + 'demo_linkage_qtl.csv'} download><FileDown className="h-3.5 w-3.5" />Demo QTL (CSV)</a>
            <a className="underline text-wheat-600 dark:text-wheat-400" href={DEMO + 'README.txt'} download>About the demo files</a>
            <span className="text-wheat-500 dark:text-wheat-400">
              The demo map is a real published map (CottonGen CG009) with its groups renamed LG01–LG26; the QTL are synthetic. Files never leave your browser.
            </span>
          </div>
          {result.skipped.length > 0 && (
            <div className="mt-2 space-y-0.5 text-xs text-amber-700 dark:text-amber-400">
              {result.skipped.map((s) => <p key={s.reason}>{s.count.toLocaleString()} skipped: {s.reason}</p>)}
            </div>
          )}
        </div>

        {groups.length > 0 && (
          <>
            <div className="card flex flex-wrap items-center gap-x-5 gap-y-2">
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-wheat-600" checked={showMarkers} onChange={(e) => setShowMarkers(e.target.checked)} />Markers
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-wheat-600" checked={showQtl} onChange={(e) => setShowQtl(e.target.checked)} />QTL
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                Colour
                <select className="input w-auto text-sm" value={hasTraits ? colorMode : 'single'} disabled={!hasTraits} onChange={(e) => setColorMode(e.target.value as 'trait' | 'single')}>
                  <option value="trait">by trait category</option>
                  <option value="single">one colour</option>
                </select>
              </label>
              {result.valueLabel && (
                <label className="inline-flex items-center gap-2 text-sm">
                  QTL with {result.valueLabel} ≥
                  <input type="number" step="any" className="input w-24 text-sm" value={minValue} onChange={(e) => setMinValue(e.target.value)} placeholder="all" />
                </label>
              )}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-wheat-500" />
                <input className="input w-56 pl-8 text-sm" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Highlight marker…" />
              </div>
            </div>

            <LinkagePlotView
              groups={groups}
              colorMode={hasTraits ? colorMode : 'single'}
              showMarkers={showMarkers}
              showQtl={showQtl}
              query={query}
              valueLabel={result.valueLabel}
              title={title}
            />

            {result.nMarkers > 0 && <DatabaseComparison groups={groups} title={title} />}
          </>
        )}
      </div>
    </div>
  )
}

/** Chromosome assignment of each group, shared markers with database maps, and known trait-linked markers. */
function DatabaseComparison({ groups, title }: { groups: ReturnType<typeof buildLinkage>['groups']; title: string }) {
  const maps = useCSV<LinkageMapRecord>('maps.csv')
  const markers = useCSV<MarkerRecord>('markers.csv')
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [res, setRes] = useState<{ byGroup: GroupMatch[]; byMap: MapMatch[] } | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => { setState('idle'); setRes(null) }, [groups])

  const run = () => {
    setState('loading')
    loadMarkerIndex()
      .then((idx) => { setRes(compareWithDatabase(groups, idx)); setState('done') })
      .catch((e) => { setErr(e instanceof Error ? e.message : String(e)); setState('error') })
  }

  const mapName = (id: string) => maps.data.find((m) => m.map_id === id)?.name ?? id
  const known = useMemo(() => {
    const by = new Map(markers.data.map((m) => [m.marker.trim().toUpperCase(), m]))
    return groups.flatMap((g) => g.markers.flatMap((m) => {
      const k = by.get(m.marker.trim().toUpperCase())
      return k ? [{ ...m, info: k }] : []
    }))
  }, [groups, markers.data])

  return (
    <div className="card">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <GitCompare className="h-5 w-5 text-wheat-600 dark:text-wheat-400" />
        <h3 className="text-lg font-semibold text-wheat-900 dark:text-wheat-50">Your map vs. CottonQTLome</h3>
        <span className="flex-1" />
        {state !== 'done' && (
          <button className="btn text-xs" onClick={run} disabled={state === 'loading'}>
            {state === 'loading' ? 'Comparing…' : 'Compare with the 154 database maps'}
          </button>
        )}
        {res && (
          <button className="btn text-xs" onClick={() => downloadCSV(`${title}_chromosome_matches.csv`, res.byGroup.map((g) => ({
            linkage_group: g.group, markers: g.markers, shared_with_database: g.shared, chromosome: g.chromosome,
            agreement: g.agreement.toFixed(3), best_map: g.bestMap, shared_with_best_map: g.bestShared, order_spearman_rho: g.rho?.toFixed(3) ?? '',
          })))}>
            <FileDown className="h-3.5 w-3.5" />CSV
          </button>
        )}
      </div>
      {state === 'error' && <p className="text-sm text-red-600">{err}</p>}
      {state === 'idle' && (
        <p className="text-sm text-wheat-700 dark:text-wheat-300">
          Markers are matched to the database maps by name (case-insensitive). Each of your linkage groups is assigned to the
          chromosome most of its shared markers sit on, and marker order is compared with the best-matching map (Spearman ρ: near 1
          or −1 = collinear, near 0 = reordered).
        </p>
      )}
      {res && (
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="overflow-x-auto">
            <p className="mb-2 text-sm font-medium text-wheat-800 dark:text-wheat-100">Which chromosome is each group?</p>
            <table className="w-full text-left text-xs">
              <thead className="text-wheat-600 dark:text-wheat-400">
                <tr>
                  <th className="py-1 pr-3 font-medium">Group</th>
                  <th className="py-1 pr-3 text-right font-medium">Shared markers</th>
                  <th className="py-1 pr-3 font-medium">Chromosome</th>
                  <th className="py-1 pr-3 text-right font-medium">Agreement</th>
                  <th className="py-1 pr-3 font-medium">Best map</th>
                  <th className="py-1 pr-3 text-right font-medium">Order ρ</th>
                </tr>
              </thead>
              <tbody className="text-wheat-800 dark:text-wheat-200">
                {res.byGroup.map((g) => (
                  <tr key={g.group} className="border-t border-wheat-100 dark:border-ink-800">
                    <td className="py-1 pr-3 font-medium">{g.group}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{g.shared} / {g.markers}</td>
                    <td className="py-1 pr-3">{g.chromosome || '—'}</td>
                    <td className={`py-1 pr-3 text-right tabular-nums ${g.shared && g.agreement < 0.6 ? 'text-amber-700 dark:text-amber-400' : ''}`}>
                      {g.shared ? `${Math.round(g.agreement * 100)}%` : '—'}
                    </td>
                    <td className="py-1 pr-3">
                      {g.bestMap ? <Link className="underline" to={`/linkage-maps?map=${g.bestMap}`}>{g.bestMap}</Link> : '—'}
                      {g.bestMap && <span className="text-wheat-500"> ({g.bestShared})</span>}
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums">{g.rho == null ? '—' : g.rho.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[11px] text-wheat-500 dark:text-wheat-400">
              Agreement = share of shared markers that sit on that chromosome in the database (below 60% is flagged: a mixed or
              mis-assigned group, or markers with homoeologous At/Dt copies).
            </p>
          </div>
          <div className="space-y-6">
            <div className="overflow-x-auto">
              <p className="mb-2 text-sm font-medium text-wheat-800 dark:text-wheat-100">Database maps sharing the most markers</p>
              <table className="w-full text-left text-xs">
                <thead className="text-wheat-600 dark:text-wheat-400">
                  <tr><th className="py-1 pr-3 font-medium">Map</th><th className="py-1 pr-3 text-right font-medium">Shared</th><th className="py-1 pr-3 text-right font-medium">Your groups</th></tr>
                </thead>
                <tbody className="text-wheat-800 dark:text-wheat-200">
                  {res.byMap.slice(0, 10).map((m) => (
                    <tr key={m.mapId} className="border-t border-wheat-100 dark:border-ink-800">
                      <td className="py-1 pr-3"><Link className="underline" to={`/linkage-maps?map=${m.mapId}`}>{m.mapId}</Link> {mapName(m.mapId)}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{m.shared.toLocaleString()}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{m.groups}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!res.byMap.length && <p className="text-xs text-wheat-500">No marker names in common.</p>}
            </div>
            <div className="overflow-x-auto">
              <p className="mb-2 text-sm font-medium text-wheat-800 dark:text-wheat-100">
                Your markers that are known trait-linked markers ({known.length}) · <Link className="font-normal underline" to="/markers">primers</Link>
              </p>
              {known.length ? (
                <table className="w-full text-left text-xs">
                  <thead className="text-wheat-600 dark:text-wheat-400">
                    <tr><th className="py-1 pr-3 font-medium">Marker</th><th className="py-1 pr-3 font-medium">Your position</th><th className="py-1 pr-3 font-medium">Trait</th><th className="py-1 pr-3 text-right font-medium">Studies</th></tr>
                  </thead>
                  <tbody className="text-wheat-800 dark:text-wheat-200">
                    {known.slice(0, 40).map((k, i) => (
                      <tr key={i} className="border-t border-wheat-100 dark:border-ink-800">
                        <td className="py-1 pr-3 font-medium"><span title={k.info.primers ? `Primers: ${k.info.primers}` : undefined}>{k.marker}</span></td>
                        <td className="whitespace-nowrap py-1 pr-3">{k.group} · {k.cm.toFixed(1)} cM</td>
                        <td className="py-1 pr-3">{k.info.trait} ({k.info.category})</td>
                        <td className="py-1 pr-3 text-right tabular-nums">{k.info.n_studies}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="text-xs text-wheat-500">None of your marker names are in the trait-linked marker table.</p>}
              {known.length > 40 && <p className="mt-1 text-[11px] text-wheat-500">First 40 shown.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
