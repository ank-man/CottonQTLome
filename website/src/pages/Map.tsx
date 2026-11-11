import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { RotateCcw, Download, Image as ImageIcon, FileImage, Search, SlidersHorizontal, Moon, Sun, Upload, Route as RouteIcon, Dna } from 'lucide-react'
import PageHero from '../components/PageHero'
import IdeogramMap from '../components/IdeogramMap'
import CircosMap from '../components/CircosMap'
import AsyncBoundary from '../components/AsyncBoundary'
import { useCSV } from '../lib/useCSV'
import { QTLRecord, GWASRecord, HotspotRecord, MQTLRecord, EpistaticRecord } from '../lib/types'
import { prepareItems, prepareEpistaticLinks, TRAIT_CATEGORIES, TRAIT_COLORS, setChromosomeLengths, CHROMOSOME_LENGTHS } from '../lib/map'
import { HUB, useAssemblyIndex, useConverter } from '../lib/assemblies'
import { convertLinks, convertMapItems, convertUserItems } from '../lib/mapConvert'
import { exportSVG, exportRaster } from '../lib/exportMap'
import UserDataPanel from '../components/UserDataPanel'
import UserOverlap from '../components/UserOverlap'
import { MapResult, UserColorMode, getUserDataset } from '../lib/userData'

export default function Map({ mode = 'database' }: { mode?: 'database' | 'upload' }) {
  const [params, setParams] = useSearchParams()
  const { assemblies, error: asmError } = useAssemblyIndex()
  // Display axis: the assembly every track is drawn on (?assembly=<key> to link to one).
  const viewAsm = params.get('assembly') || HUB
  const setViewAsm = (k: string) => {
    const next = new URLSearchParams(params)
    if (k === HUB) next.delete('assembly')
    else next.set('assembly', k)
    setParams(next, { replace: true })
  }
  // Assembly the uploaded positions are on; follows the display axis until chosen.
  const [userAsmChoice, setUserAsmChoice] = useState<string | null>(null)
  const userAsm = userAsmChoice ?? viewAsm
  const viewInfo = assemblies.find((a) => a.key === viewAsm)
  const toView = useConverter(HUB, viewAsm)
  const userToView = useConverter(userAsm, viewAsm)
  const userToHub = useConverter(userAsm, HUB)
  // Swap the chromosome lengths before the maps draw, and only once the
  // converter for that axis is ready, so the two never disagree.
  const [axisKey, setAxisKey] = useState(HUB)
  useLayoutEffect(() => {
    if (viewAsm !== HUB && !viewInfo) return
    if (!toView.converter || toView.converter.to !== viewAsm) return
    setChromosomeLengths(viewAsm === HUB ? undefined : viewInfo!.lengths)
    setAxisKey(viewAsm)
  }, [viewAsm, viewInfo, toView.converter])
  useEffect(() => () => setChromosomeLengths(), [])

  const qtl = useCSV<QTLRecord>('qtl.csv')
  const gwas = useCSV<GWASRecord>('gwas.csv')
  const hot = useCSV<HotspotRecord>('hotspots.csv')
  const mq = useCSV<MQTLRecord>('mqtl.csv')
  const epi = useCSV<EpistaticRecord>('epistatic.csv')
  const [showLinks, setShowLinks] = useState(false)
  const [chrLevelLinks, setChrLevelLinks] = useState(false)
  const [track, setTrack] = useState<'mqtl-high' | 'mqtl-all' | 'hotspots'>('mqtl-high')

  const [showQTL, setShowQTL] = useState(true)
  const [showMetaQTL, setShowMetaQTL] = useState(true)
  const [selectedTraits, setSelectedTraits] = useState<string[]>([])
  const [view, setView] = useState<'ideogram' | 'circos'>('ideogram')
  const [search, setSearch] = useState('')
  const [genomeFilter, setGenomeFilter] = useState<'all' | 'A' | 'D'>('all')
  const [compact, setCompact] = useState(true)
  const [showLabels, setShowLabels] = useState(true)
  const [showItemLabels, setShowItemLabels] = useState(false)
  const [genomeColor, setGenomeColor] = useState(true)
  const [plotDark, setPlotDark] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const [userResult, setUserResult] = useState<MapResult | null>(null)
  const [showDatabase, setShowDatabase] = useState(true)
  const [userColorMode, setUserColorMode] = useState<UserColorMode>('trait')
  const [showUserLabels, setShowUserLabels] = useState(false)
  const userItems = useMemo(() => userResult?.items ?? [], [userResult])
  const hasUser = userItems.length > 0
  // Uploaded files without a trait column have nothing to colour by.
  const userHasTraits = userItems.some((i) => i.traitText)
  const effectiveColorMode: UserColorMode = userHasTraits ? userColorMode : 'single'

  const loci = useMemo<QTLRecord[]>(() => [...qtl.data, ...gwas.data], [qtl.data, gwas.data])
  const allItems = useMemo(
    () => prepareItems(
      loci,
      track === 'hotspots' ? hot.data : [],
      track === 'hotspots' ? [] : mq.data.filter((m) => track === 'mqtl-all' || m.confidence === 'high'),
    ),
    [loci, hot.data, mq.data, track],
  )
  const hubLinks = useMemo(() => prepareEpistaticLinks(epi.data, chrLevelLinks), [epi.data, chrLevelLinks])
  const axisReady = axisKey === viewAsm && toView.converter?.to === axisKey
  // database items live on the hub (UTX v2.1) axis; move them onto the chosen one
  const moved = useMemo(() => {
    if (!axisReady || !toView.converter) return { items: [], dropped: 0, approximate: 0 }
    return convertMapItems(allItems, toView.converter, CHROMOSOME_LENGTHS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allItems, axisReady, toView.converter, axisKey])
  const links = useMemo(
    () => (axisReady && toView.converter ? convertLinks(hubLinks, toView.converter, CHROMOSOME_LENGTHS) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hubLinks, axisReady, toView.converter, axisKey],
  )
  const approxLoci = useMemo(() => loci.filter((r) => r.map_bp && r.map_method === 'approximate').length, [loci])

  // Only records with a physical position on an allotetraploid chromosome can
  // be drawn; say how many are left out so the map isn't read as exhaustive.
  const placed = useMemo(() => allItems.filter((i) => i.type === 'qtl').length, [allItems])
  const notPlaced = loci.length - placed

  const items = useMemo(() => {
    if (hasUser && !showDatabase) return []
    if (genomeFilter === 'all') return moved.items
    return moved.items.filter((item) => item.chromosome.startsWith(genomeFilter))
  }, [moved.items, genomeFilter, hasUser, showDatabase])
  // uploaded loci: drawn on the display axis, compared with the database on the hub axis
  const userOnView = useMemo(
    () => (axisReady && userToView.converter && userToView.converter.to === axisKey
      ? convertUserItems(userItems, userToView.converter, CHROMOSOME_LENGTHS)
      : { items: [], dropped: 0, approximate: 0 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userItems, userToView.converter, axisReady, axisKey],
  )
  const hubLengths = useMemo(() => assemblies.find((a) => a.key === HUB)?.lengths, [assemblies])
  const userOnHub = useMemo(
    () => (userToHub.converter && hubLengths ? convertUserItems(userItems, userToHub.converter, hubLengths) : { items: [], dropped: 0, approximate: 0 }),
    [userItems, userToHub.converter, hubLengths],
  )
  const userInView = useMemo(
    () => (genomeFilter === 'all' ? userOnView.items : userOnView.items.filter((i) => i.chromosome.startsWith(genomeFilter))),
    [userOnView.items, genomeFilter],
  )
  const userAsmInfo = assemblies.find((a) => a.key === userAsm)

  const reset = () => {
    setShowQTL(true)
    setShowMetaQTL(true)
    setSelectedTraits([])
    setSearch('')
    setGenomeFilter('all')
    setCompact(true)
    setShowLabels(true)
    setShowItemLabels(false)
    setGenomeColor(true)
  }

  const toggleTrait = (trait: string) => {
    setSelectedTraits((prev) =>
      prev.includes(trait) ? prev.filter((t) => t !== trait) : [...prev, trait]
    )
  }

  const selectableTraits = TRAIT_CATEGORIES

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const idx = parseInt(e.key, 10)
      if (isNaN(idx) || idx < 1 || idx > selectableTraits.length) return
      const trait = selectableTraits[idx - 1]
      if (trait) toggleTrait(trait)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectableTraits])

  const handleExport = (format: 'svg' | 'png' | 'jpeg') => {
    if (!svgRef.current) return
    if (format === 'svg') {
      exportSVG(svgRef.current)
    } else {
      exportRaster(svgRef.current, format)
    }
  }

  return (
    <div>
      {mode === 'upload' ? (
        <PageHero
          eyebrow="Plot your data"
          title="QTL & GWAS on a genome"
          subtitle="Upload loci with physical positions (CSV, Excel, BED, GFF3, VCF, JSON…), say which assembly they are on, and draw them on any of the supported cotton assemblies beside every QTL, GWAS locus, meta-QTL and hotspot in the database. For genetic-map (cM) positions use the linkage-map plotter."
          variant="side"
        >
          <Link to="/plot/linkage-map" className="btn text-xs"><RouteIcon className="h-3.5 w-3.5" /> Linkage-map plotter</Link>
          <Link to="/map" className="btn text-xs"><Dna className="h-3.5 w-3.5" /> Database map only</Link>
        </PageHero>
      ) : (
        <PageHero
          eyebrow="Visualization"
          title="Physical QTL map"
          subtitle="Genome-wide distribution of QTL, GWAS loci, meta-QTL and hotspots across the 26 chromosomes of allotetraploid cotton, coloured by trait category, on the assembly of your choice."
          variant="side"
        >
          <Link to="/plot/genome" className="btn text-xs"><Upload className="h-3.5 w-3.5" /> Plot your own QTL / GWAS</Link>
          <Link to="/plot/linkage-map" className="btn text-xs"><RouteIcon className="h-3.5 w-3.5" /> Plot your own linkage map</Link>
        </PageHero>
      )}

      <AsyncBoundary loading={qtl.loading || gwas.loading || hot.loading || mq.loading} error={qtl.error ?? gwas.error ?? hot.error ?? mq.error}>
        <div className={`space-y-6 ${plotDark ? 'dark' : ''}`}>
          {mode === 'upload' && (
            <UserDataPanel
              onChange={setUserResult}
              assemblies={assemblies}
              assembly={userAsm}
              onAssembly={setUserAsmChoice}
            />
          )}

          {/* Controls */}
          <div className="card">
            <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <label className="inline-flex items-center gap-2 text-sm">
                <span className="font-semibold text-wheat-800 dark:text-wheat-100">Assembly</span>
                <select
                  className="input w-auto text-sm"
                  value={viewAsm}
                  onChange={(e) => setViewAsm(e.target.value)}
                  aria-label="Assembly the map is drawn on"
                  disabled={!assemblies.length}
                >
                  {!assemblies.length && <option value={HUB}>G. hirsutum TM-1 UTX v2.1</option>}
                  {['Gossypium hirsutum', 'Gossypium barbadense'].map((sp) => (
                    <optgroup key={sp} label={sp}>
                      {assemblies.filter((a) => a.species === sp).map((a) => (
                        <option key={a.key} value={a.key}>
                          {a.label.replace(/^G\. (hirsutum|barbadense) /, '')}{a.key === HUB ? ' — default axis' : ''}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              {!axisReady && !asmError && <span className="text-xs text-wheat-500 dark:text-wheat-400">Loading assembly…</span>}
              {(asmError || toView.error) && <span className="text-xs text-red-600">Assembly data could not be loaded: {asmError || toView.error}</span>}
              {axisReady && viewAsm !== HUB && (
                <span className="text-xs text-wheat-600 dark:text-wheat-400">
                  Database positions converted from UTX v2.1 through {viewInfo?.anchors.toLocaleString()} sequence anchors
                  {moved.dropped > 0 && <> · {moved.dropped.toLocaleString()} {moved.dropped === 1 ? "item spans a rearrangement and is" : "items span a rearrangement and are"} not drawn</>}
                  {moved.approximate > 0 && <> · {moved.approximate.toLocaleString()} sit in rearranged regions (placed from the nearest anchor)</>}
                </span>
              )}
            </div>
            {hasUser && (
              <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded border border-wheat-200 dark:border-ink-700 bg-wheat-50 dark:bg-ink-900/40 px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-wheat-600 dark:text-wheat-400">Your data</span>
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <input type="checkbox" className="h-4 w-4 accent-wheat-600" checked={showDatabase} onChange={(e) => setShowDatabase(e.target.checked)} />
                  <span className="text-sm font-medium">Show database layers</span>
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <span className="font-medium">Colour</span>
                  <select
                    className="input w-auto text-sm"
                    value={effectiveColorMode}
                    onChange={(e) => setUserColorMode(e.target.value as UserColorMode)}
                    disabled={!userHasTraits}
                    title={userHasTraits ? undefined : 'Map a trait column to colour by trait'}
                  >
                    <option value="trait">by trait category</option>
                    <option value="single">one colour</option>
                  </select>
                </label>
                {view === 'ideogram' && (
                  <label className="inline-flex cursor-pointer items-center gap-2">
                    <input type="checkbox" className="h-4 w-4 accent-wheat-600" checked={showUserLabels} onChange={(e) => setShowUserLabels(e.target.checked)} />
                    <span className="text-sm font-medium">Label my loci</span>
                  </label>
                )}
              </div>
            )}
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-wheat-600"
                    checked={showQTL}
                    onChange={(e) => setShowQTL(e.target.checked)}
                  />
                  <span className="text-sm font-medium">QTL / GWAS loci</span>
                </label>
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-wheat-600"
                    checked={showMetaQTL}
                    onChange={(e) => setShowMetaQTL(e.target.checked)}
                  />
                  <span className="text-sm font-medium">Region track</span>
                </label>
                {view === 'circos' && (
                  <>
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input type="checkbox" className="h-4 w-4 accent-wheat-600" checked={showLinks} onChange={(e) => setShowLinks(e.target.checked)} />
                      <span className="text-sm font-medium">Epistatic links</span>
                    </label>
                    {showLinks && (
                      <label className="inline-flex cursor-pointer items-center gap-2" title="Pairs known only to the chromosome are drawn between chromosome midpoints">
                        <input type="checkbox" className="h-4 w-4 accent-wheat-600" checked={chrLevelLinks} onChange={(e) => setChrLevelLinks(e.target.checked)} />
                        <span className="text-sm font-medium">+ chromosome-level pairs</span>
                      </label>
                    )}
                  </>
                )}
                <select
                  className="input w-auto text-sm"
                  value={track}
                  onChange={(e) => setTrack(e.target.value as typeof track)}
                  aria-label="Region track content"
                >
                  <option value="mqtl-high">Meta-QTL (≥ 5 studies)</option>
                  <option value="mqtl-all">Meta-QTL (all)</option>
                  <option value="hotspots">Hotspots</option>
                </select>
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-wheat-600"
                    checked={compact}
                    onChange={(e) => setCompact(e.target.checked)}
                  />
                  <span className="text-sm font-medium">Compact</span>
                </label>
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-wheat-600"
                    checked={showLabels}
                    onChange={(e) => setShowLabels(e.target.checked)}
                  />
                  <span className="text-sm font-medium">Labels</span>
                </label>
                {view === 'ideogram' && (
                  <>
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-wheat-600"
                        checked={showItemLabels}
                        onChange={(e) => setShowItemLabels(e.target.checked)}
                      />
                      <span className="text-sm font-medium">Region labels</span>
                    </label>
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-wheat-600"
                        checked={genomeColor}
                        onChange={(e) => setGenomeColor(e.target.checked)}
                      />
                      <span className="text-sm font-medium">Subgenome colour</span>
                    </label>
                  </>
                )}
              </div>

              <div className="flex items-center rounded border border-wheat-200 dark:border-ink-700 bg-wheat-50 dark:bg-ink-900/40 p-1">
                <button
                  onClick={() => setView('ideogram')}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                    view === 'ideogram'
                      ? 'bg-wheat-50 dark:bg-ink-800 text-wheat-800 dark:text-wheat-100 shadow-sm'
                      :'text-wheat-600 dark:text-wheat-400 hover:text-wheat-800'
                  }`}
                >
                  Ideogram
                </button>
                <button
                  onClick={() => setView('circos')}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                    view === 'circos'
                      ? 'bg-wheat-50 dark:bg-ink-800 text-wheat-800 dark:text-wheat-100 shadow-sm'
                      :'text-wheat-600 dark:text-wheat-400 hover:text-wheat-800'
                  }`}
                >
                  Circos
                </button>
              </div>
              <button
                onClick={() => setPlotDark(!plotDark)}
                className="btn text-xs"
                title="Toggle dark theme for the plot"
                aria-pressed={plotDark}
              >
                {plotDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                {plotDark ? 'Light plot' : 'Dark plot'}
              </button>

              <div className="flex items-center gap-2">
                <span className="text-sm text-wheat-600 dark:text-wheat-400">Export:</span>
                <button onClick={() => handleExport('svg')} className="btn text-xs" title="Download SVG">
                  <Download className="h-3.5 w-3.5" />
                  SVG
                </button>
                <button onClick={() => handleExport('png')} className="btn text-xs" title="Download PNG">
                  <ImageIcon className="h-3.5 w-3.5" />
                  PNG
                </button>
                <button onClick={() => handleExport('jpeg')} className="btn text-xs" title="Download JPEG">
                  <FileImage className="h-3.5 w-3.5" />
                  JPEG
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-wheat-500 dark:text-wheat-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name, trait, parameter or candidate gene…"
                  className="input w-full pl-9"
                />
              </div>
              <div className="flex items-center gap-3 rounded border border-wheat-200 dark:border-ink-700 bg-wheat-50 dark:bg-ink-900/40 px-3 py-2">
                <SlidersHorizontal className="h-4 w-4 text-wheat-500 dark:text-wheat-400" />
                <span className="text-xs font-medium text-wheat-600 dark:text-wheat-400">Genome:</span>
                {(['all', 'A', 'D'] as const).map((g) => (
                  <label key={g} className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium">
                    <input
                      type="radio"
                      name="genome"
                      value={g}
                      checked={genomeFilter === g}
                      onChange={() => setGenomeFilter(g)}
                      className="h-3 w-3 accent-wheat-600"
                    />
                    {g === 'all' ? 'All' : `${g}t subgenome`}
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-wheat-700 dark:text-wheat-300">
                  Highlight traits (click or press 1-{Math.min(9, selectableTraits.length)} to toggle)
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedTraits([...selectableTraits])}
                    className="text-xs font-medium text-wheat-600 dark:text-wheat-400 underline-offset-2 hover:text-wheat-800 hover:underline"
                  >
                    Select all
                  </button>
                  <span className="text-wheat-300 dark:text-wheat-600">|</span>
                  <button
                    onClick={() => setSelectedTraits([])}
                    className="text-xs font-medium text-wheat-600 dark:text-wheat-400 underline-offset-2 hover:text-wheat-800 hover:underline"
                  >
                    Clear all
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectableTraits.map((trait, idx) => {
                  const active = selectedTraits.includes(trait)
                  return (
                    <button
                      key={trait}
                      onClick={() => toggleTrait(trait)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                        active
                          ? 'border-wheat-600 dark:border-wheat-500 bg-wheat-600 text-white'
                          :'border-wheat-300 dark:border-ink-700 bg-wheat-50 dark:bg-ink-800 text-wheat-700 dark:text-wheat-300 hover:bg-wheat-100'
                      }`}
                      title={`Toggle ${trait} (${idx < 9 ? `key ${idx + 1}` : ''})`}
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: TRAIT_COLORS[trait] }}
                      />
                      {trait}
                    </button>
                  )
                })}
                <button onClick={reset} className="btn text-xs">
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset
                </button>
              </div>
            </div>
          </div>

          <p className="text-xs text-wheat-500 dark:text-wheat-400">
            {placed.toLocaleString()} of {loci.length.toLocaleString()} QTL and GWAS loci are drawn. The other{' '}
            {notPlaced.toLocaleString()} have only a genetic-map (cM) position, no chromosome, or belong to a diploid species;
            they remain searchable in the data tables. Positions published on other assemblies were converted by sequence
            alignment (anchors every 50 kb); {approxLoci.toLocaleString()} loci whose assembly is not stated, or has no usable
            public sequence (HAU v1.1/v2, WHU v1, BGI v1; see FAQ), are placed approximately, by relative position (error up to a few Mb).{' '}
            <a className="underline" href={`${import.meta.env.BASE_URL}data/downloads/qtl_gwas_all_assemblies.csv.gz`} download>
              Download every locus on every assembly
            </a>.
          </p>
          {hasUser && (userOnView.dropped > 0 || userAsm !== viewAsm) && (
            <p className="text-xs text-wheat-600 dark:text-wheat-400">
              Your positions ({userAsmInfo?.label ?? userAsm}) were converted to {viewInfo?.label ?? viewAsm}
              {userOnView.dropped > 0 && <>; {userOnView.dropped.toLocaleString()} could not be placed (the two ends fall on different chromosomes)</>}
              {userOnView.approximate > 0 && <>; {userOnView.approximate.toLocaleString()} lie in rearranged regions and were placed from the nearest anchor</>}.
            </p>
          )}

          {!axisReady ? (
            <div className="card py-16 text-center text-sm text-wheat-600 dark:text-wheat-400">Loading {viewInfo?.label ?? 'assembly'}…</div>
          ) : view === 'ideogram' ? (
            <IdeogramMap
              key={`ideo-${axisKey}`}
              items={items}
              showQTL={showQTL}
              showMetaQTL={showMetaQTL}
              selectedTraits={selectedTraits}
              search={search}
              svgRef={svgRef}
              compact={compact}
              showLabels={showLabels}
              showItemLabels={showItemLabels}
              genomeFilter={genomeFilter}
              genomeColor={genomeColor}
              userItems={userInView}
              userColorMode={effectiveColorMode}
              showUserLabels={showUserLabels}
              userValueLabel={userResult?.valueLabel}
            />
          ) : (
            <CircosMap
              key={`circos-${axisKey}`}
              items={items}
              links={hasUser && !showDatabase ? [] : links}
              showQTL={showQTL}
              showMetaQTL={showMetaQTL}
              showLinks={showLinks}
              selectedTraits={selectedTraits}
              search={search}
              svgRef={svgRef}
              compact={compact}
              showLabels={showLabels}
              genomeFilter={genomeFilter}
              userItems={userInView}
              userColorMode={effectiveColorMode}
              userValueLabel={userResult?.valueLabel}
              axisLabel={viewInfo?.label.replace(/^G\. (hirsutum|barbadense) /, '') ?? 'TM-1 UTX v2.1'}
            />
          )}

          {hasUser && (
            <UserOverlap
              items={userOnHub.items}
              valueLabel={userResult?.valueLabel ?? ''}
              mqtl={mq.data}
              hotspots={hot.data}
              loci={loci}
              fileName={getUserDataset()?.table.fileName ?? 'my_data'}
            />
          )}

          {/* Legend / explanation */}
          <div className="card">
            <h3 className="mb-3 text-lg font-semibold text-wheat-900 dark:text-wheat-50">
              How to read this {view === 'ideogram' ? 'ideogram' : 'circos plot'}
            </h3>
            {view === 'ideogram' ? (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                <div>
                  <p className="font-medium text-wheat-800 dark:text-wheat-100">Chromosomes</p>
                  <p className="text-sm leading-relaxed text-wheat-700 dark:text-wheat-300">
                    The 26 chromosomes of allotetraploid cotton, A01–D13, coloured by subgenome (At/Dt). Height is proportional to physical length in the selected assembly ({viewInfo?.label ?? 'TM-1 UTX v2.1'}) against the Mb scale on the left. Centromeres are not drawn.
                  </p>
                </div>
                <div>
                  <p className="font-medium text-wheat-800 dark:text-wheat-100">Locus density strip</p>
                  <p className="text-sm leading-relaxed text-wheat-700 dark:text-wheat-300">
                    Thousands of loci per chromosome can't be drawn individually, so they're binned along the length; strip length is proportional to local count, coloured by that bin's dominant trait.
                  </p>
                </div>
                <div>
                  <p className="font-medium text-wheat-800 dark:text-wheat-100">Region brackets</p>
                  <p className="text-sm leading-relaxed text-wheat-700 dark:text-wheat-300">
                    Meta-QTL (bracket = 95% confidence interval of the consensus position) or hotspot regions, chosen with the “Region track” selector and coloured by trait category. Regions of one trait that overlap or lie within 2 Mb are drawn as one bar (hover to list them); enable “Region labels” to draw and name each one.
                  </p>
                </div>
                <div>
                  <p className="font-medium text-wheat-800 dark:text-wheat-100">Trait highlights</p>
                  <p className="text-sm leading-relaxed text-wheat-700 dark:text-wheat-300">
                    Click a trait button (or press keys 1–9) to highlight one or several traits. Use the search box or genome filter to narrow results further.
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                <div>
                  <p className="font-medium text-wheat-800 dark:text-wheat-100">Chromosomes</p>
                  <p className="text-sm leading-relaxed text-wheat-700 dark:text-wheat-300">
                    Arc length is proportional to physical length in the selected assembly.
                  </p>
                </div>
                <div>
                  <p className="font-medium text-wheat-800 dark:text-wheat-100">Locus density</p>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-3 w-24 rounded bg-gradient-to-r from-[hsl(48,90%,82%)] via-[hsl(24,90%,65%)] to-[hsl(0,90%,44%)]" />
                    <span className="text-xs text-wheat-600 dark:text-wheat-400">low → high</span>
                  </div>
                </div>
                <div>
                  <p className="font-medium text-wheat-800 dark:text-wheat-100">Region tracks</p>
                  <p className="text-sm leading-relaxed text-wheat-700 dark:text-wheat-300">
                    Meta-QTL or hotspot regions are drawn as bars on the ring of their trait category.
                  </p>
                </div>
                <div>
                  <p className="font-medium text-wheat-800 dark:text-wheat-100">QTL / GWAS tracks</p>
                  <p className="text-sm leading-relaxed text-wheat-700 dark:text-wheat-300">
                    Each trait category gets its own thin ring too (same order as the trait legend below), so a tick's radial position and colour both encode its trait.
                  </p>
                </div>
                <div>
                  <p className="font-medium text-wheat-800 dark:text-wheat-100">Epistatic links</p>
                  <p className="text-sm leading-relaxed text-wheat-700 dark:text-wheat-300">
                    Chords join the two loci of an epistatic pair, coloured by trait ({links.length.toLocaleString()} drawn).
                    Pairs with physical positions for both loci are placed exactly; chromosome-level pairs, if enabled,
                    join chromosome midpoints.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </AsyncBoundary>
    </div>
  )
}
