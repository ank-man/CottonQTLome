import { useMemo, useState } from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import PageHero from '../components/PageHero'
import DataTable from '../components/DataTable'
import AsyncBoundary from '../components/AsyncBoundary'
import GlossaryHeader from '../components/GlossaryHeader'
import HotspotKaryotype from '../components/HotspotKaryotype'
import ExprCount from '../components/ExprCount'
import { clip } from '../components/cells'
import { useCSV } from '../lib/useCSV'
import { useJSON } from '../lib/useJSON'
import { HotspotRecord, Summary, WindowRecord } from '../lib/types'
import { CHROMOSOME_LENGTHS } from '../lib/map'

const HOT = '#e34948'
const BASE = { A: '#2a78d6', D: '#eb6834' } as const

const mb = (v: string) => (Number(v) / 1e6).toFixed(0)

const columns: ColumnDef<HotspotRecord, any>[] = [
  { accessorKey: 'hotspot_id', header: () => <GlossaryHeader label="Hotspot" term="hotspot" /> },
  { accessorKey: 'chromosome', header: () => <GlossaryHeader label="Chr" term="chromosome" /> },
  { id: 'region', header: 'Region (Mb)', accessorFn: (r) => `${mb(r.start)}–${mb(r.end)}` },
  {
    id: 'genes', header: () => <span title="Genes in the hotspot · fibre-preferential genes (FP); click to list them">Genes · FP</span>, enableSorting: false,
    cell: ({ row }) => <ExprCount id={row.original.hotspot_id} region={`${row.original.chromosome}:${row.original.start}-${row.original.end}bp`} />,
  },
  { accessorKey: 'peak_window_studies', header: 'Peak studies / 2 Mb', sortingFn: 'alphanumeric' },
  { accessorKey: 'n_studies', header: () => <GlossaryHeader label="Studies" term="n_studies" />, sortingFn: 'alphanumeric' },
  { accessorKey: 'n_loci', header: 'Loci', sortingFn: 'alphanumeric' },
  { accessorKey: 'n_qtl_records', header: 'QTL records', sortingFn: 'alphanumeric' },
  { accessorKey: 'n_gwas_records', header: 'GWAS records', sortingFn: 'alphanumeric' },
  { accessorKey: 'n_traits', header: 'Traits', sortingFn: 'alphanumeric' },
  { accessorKey: 'top_traits', header: 'Top traits (studies)', cell: clip(420) },
  { accessorKey: 'example_qtl', header: 'Example QTL', cell: clip(320) },
  { accessorKey: 'recurrent_candidate_genes', header: () => <GlossaryHeader label="Recurrent cand. genes" term="candidate_gene" />, cell: clip(300) },
  { accessorKey: 'species', header: 'Species', cell: clip(260) },
  { accessorKey: 'min_q', header: 'Min FDR q', cell: ({ getValue }) => Number(getValue()).toExponential(1) },
]

export default function HotspotsPage() {
  const hs = useCSV<HotspotRecord>('hotspots.csv')
  const win = useCSV<WindowRecord>('windows.csv')
  const { data: summary } = useJSON<Summary>('summary.json')
  const [chr, setChr] = useState('A07')
  const h = summary?.insights.hotspots

  const series = useMemo(
    () => win.data.filter((w) => w.chromosome === chr).map((w) => ({
      mb: Number(w.start) / 1e6,
      studies: Number(w.n_studies),
      loci: Number(w.n_loci),
      traits: Number(w.n_traits),
      hot: w.significant === 'True',
    })),
    [win.data, chr],
  )
  const onChr = hs.data.filter((x) => x.chromosome === chr)

  return (
    <div>
      <PageHero
        eyebrow="Analysis"
        title="QTL hotspots"
        subtitle="Regions of the cotton genome where QTL and GWAS loci from many independent studies fall together - candidates for stable, breeding-relevant loci and for pleiotropic or tightly linked genes."
        variant="side"
      />
      <AsyncBoundary loading={hs.loading || win.loading} error={hs.error ?? win.error}>
        <div className="space-y-6">
          {h && (
            <p className="max-w-4xl leading-relaxed text-wheat-800">
              <strong>{h.n_hotspots} hotspot regions</strong> ({h.hotspots_At} on At, {h.hotspots_Dt} on Dt) cover{' '}
              {(h.genome_fraction * 100).toFixed(1)}% of the genome and hold {(h.fraction_loci_in_hotspots * 100).toFixed(1)}% of placed loci.
              A hotspot window has loci from at least {h.threshold_studies} independent studies, where about {h.null_mean.toFixed(0)} are
              expected by chance (FDR &lt; {h.fdr}). The scan uses {h.records_placed.toLocaleString()} records with physical positions
              from {h.studies_placed} studies.
            </p>
          )}

          <div className="card">
            <h3 className="text-lg font-semibold text-wheat-900">Hotspots across the genome</h3>
            <p className="mb-3 mt-1 text-sm text-wheat-600">
              The 26 chromosomes to scale. Hover a window or a red bracket for details; click a chromosome to see its profile below.
            </p>
            <HotspotKaryotype windows={win.data} hotspots={hs.data} threshold={h?.threshold_studies} selected={chr} onSelect={setChr} />
          </div>

          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-wheat-900">Study support along chromosome {chr}</h3>
              <label className="flex items-center gap-2 text-sm">
                Chromosome
                <select className="input w-auto" value={chr} onChange={(e) => setChr(e.target.value)}>
                  {Object.keys(CHROMOSOME_LENGTHS).map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-wheat-600">
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: BASE[chr[0] as 'A' | 'D'] }} />2-Mb window</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: HOT }} />hotspot window (FDR &lt; 0.01)</span>
              {h && <span className="inline-flex items-center gap-1.5"><span className="inline-block w-5 border-t border-dashed border-wheat-800" />threshold ({h.threshold_studies} studies)</span>}
            </div>
            <div className="mt-3 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series} margin={{ top: 8, right: 16, bottom: 18, left: 0 }} barCategoryGap={1}>
                  <CartesianGrid vertical={false} stroke="rgb(var(--n-200))" />
                  <XAxis dataKey="mb" tick={{ fontSize: 11, fill: 'rgb(var(--n-600))' }} tickLine={false} axisLine={{ stroke: 'rgb(var(--n-400))' }}
                    label={{ value: 'Position (Mb, TM-1 UTX v2.1 axis)', position: 'insideBottom', offset: -10, fontSize: 11, fill: 'rgb(var(--n-600))' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'rgb(var(--n-600))' }} tickLine={false} axisLine={false}
                    label={{ value: 'Independent studies', angle: -90, position: 'insideLeft', fontSize: 11, fill: 'rgb(var(--n-600))' }} />
                  <Tooltip
                    cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const p = payload[0].payload
                      return (
                        <div className="rounded-md border border-wheat-200 bg-wheat-50 px-3 py-2 text-xs shadow">
                          <div className="font-semibold text-wheat-900">{chr}: {p.mb}–{p.mb + 2} Mb{p.hot ? ' · hotspot' : ''}</div>
                          <div>{p.studies} studies · {p.loci} loci · {p.traits} traits</div>
                        </div>
                      )
                    }}
                  />
                  {h && <ReferenceLine y={h.threshold_studies} stroke="rgb(var(--n-900))" strokeDasharray="4 3" />}
                  <Bar dataKey="studies" radius={[2, 2, 0, 0]} isAnimationActive={false}>
                    {series.map((s, i) => <Cell key={i} fill={s.hot ? HOT : BASE[chr[0] as 'A' | 'D']} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-sm text-wheat-700">
              {onChr.length
                ? <>Hotspots on {chr}: {onChr.map((x) => `${x.hotspot_id} (${mb(x.start)}–${mb(x.end)} Mb)`).join(', ')}.</>
                : <>No window on {chr} reaches the hotspot threshold.</>}
            </p>
          </div>

          <div className="card">
            <h3 className="mb-3 text-lg font-semibold text-wheat-900">All hotspot regions</h3>
            <DataTable data={hs.data} columns={columns} filename="cottonqtlome_hotspots.csv" pageSize={10} />
          </div>

          <div className="card text-sm leading-relaxed text-wheat-700">
            <h3 className="mb-2 text-lg font-semibold text-wheat-900">How hotspots are defined - and what they are not</h3>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>QTL and GWAS records from allotetraploid cotton with a physical position are placed on the TM-1 UTX v2.1 axis (by sequence alignment where the source assembly is available, otherwise by relative position along the chromosome), then counted in 2-Mb windows.</li>
              <li>The score of a window is the number of <em>independent studies</em> with at least one locus in it, so one large study cannot create a hotspot alone.</li>
              <li>Significance comes from 2,000 permutations in which every study keeps its number of occupied windows but places them uniformly across the genome; windows with FDR &lt; 0.01 are hotspots, and adjacent ones are merged.</li>
              <li>Records placed by relative position (assembly not stated or not available) move boundaries by up to a few Mb. Use hotspots to prioritise regions, not to define intervals.</li>
              <li>The null model is uniform. Gene density and recombination are higher toward chromosome ends in cotton, so part of the distal enrichment reflects where genes and mappable recombination are, not only trait biology.</li>
              <li>Fiber-quality and yield traits dominate because they dominate the literature. Linkage QTL reported only in cM (about two thirds of them) could not be placed and are not counted.</li>
            </ul>
          </div>
        </div>
      </AsyncBoundary>
    </div>
  )
}
