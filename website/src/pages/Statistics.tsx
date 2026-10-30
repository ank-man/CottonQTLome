import { ReactNode } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import PageHero from '../components/PageHero'
import AsyncBoundary from '../components/AsyncBoundary'
import { useJSON } from '../lib/useJSON'
import { Summary } from '../lib/types'
import { TRAIT_CATEGORIES } from '../lib/map'

// Categorical slots (validated order): blue, orange, aqua.
const S1 = '#2a78d6'
const S2 = '#eb6834'
const S3 = '#1baf7a'
const AXIS = { fontSize: 11, fill: 'rgb(var(--n-600))' }
const tooltipStyle = { fontSize: 12, borderRadius: 6, border: '1px solid #e7e7ea' }

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="mt-1 flex flex-wrap gap-4 text-xs text-wheat-600">
      {items.map(([label, color]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />{label}
        </span>
      ))}
    </div>
  )
}

function Panel({ title, note, legend, height = 300, children }: { title: string; note?: string; legend?: [string, string][]; height?: number; children: ReactNode }) {
  return (
    <div className="card">
      <h3 className="text-lg font-semibold text-wheat-900">{title}</h3>
      {note && <p className="mt-1 text-sm text-wheat-600">{note}</p>}
      {legend && <Legend items={legend} />}
      <div className="mt-3" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">{children as any}</ResponsiveContainer>
      </div>
    </div>
  )
}

export default function Statistics() {
  const { data, loading, error } = useJSON<Summary>('summary.json')
  return (
    <div>
      <PageHero
        eyebrow="Overview"
        title="Database statistics"
        subtitle="Counts by record type, trait, chromosome, species and source. All numbers refer to de-duplicated records."
        variant="side"
      />
      <AsyncBoundary loading={loading} error={error}>
        {data && <Charts s={data} />}
      </AsyncBoundary>
    </div>
  )
}

function Charts({ s }: { s: Summary }) {
  const c = s.counts
  const tiles: [string, number][] = [
    ['QTL records', c.qtl], ['GWAS loci', c.gwas_loci], ['GWAS associations', c.gwas_associations],
    ['Meta-QTL', c.mqtl], ['Epistatic pairs', c.epistatic], ['Cluster rows', c.clusters],
    ['Qualitative loci', c.mtl], ['Hotspots', c.hotspots], ['Linkage maps', c.maps],
    ['Harmonised traits', c.traits], ['Studies with data', c.studies_with_data], ['Papers indexed', c.papers_indexed],
  ]
  const byCat = TRAIT_CATEGORIES.map((name) => ({ name, QTL: s.by_category[name]?.qtl ?? 0, 'GWAS loci': s.by_category[name]?.gwas_loci ?? 0 }))
  const traits = Object.entries(s.top_traits).map(([name, value]) => ({ name, value }))
  const species = Object.entries(s.by_species).map(([name, value]) => ({ name: name.replace('Gossypium', 'G.'), value }))
  const sources = Object.entries(s.by_source).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  const eff = s.effect_sizes.map((e) => ({ name: e.trait_category, value: +(e.frac_major * 100).toFixed(1), n: e.n, median: e.median }))

  return (
    <div className="space-y-6">
      <table className="w-full max-w-3xl text-[15px]">
        <tbody>
          {Array.from({ length: Math.ceil(tiles.length / 2) }, (_, r) => tiles.slice(r * 2, r * 2 + 2)).map((pair, r) => (
            <tr key={r} className="border-b border-wheat-200">
              {pair.map(([label, value]) => (
                <td key={label} className="py-1.5 pr-8">
                  <span className="inline-block w-24 text-right font-serif text-lg text-wheat-900">{value.toLocaleString()}</span>
                  <span className="ml-3 text-wheat-700">{label}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {s.comparison && (
        <div className="card">
          <h3 className="text-lg font-semibold text-wheat-900">How the sources compare</h3>
          <p className="mt-1 text-sm text-wheat-600">
            De-duplicated records each source contributes, and what the integrated resource holds.{' '}
            {s.comparison.studies_literature_only} of {s.comparison.studies_total} studies ({s.comparison.records_literature_only.toLocaleString()} records)
            enter only through literature mining and are in none of the source databases.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full divide-y divide-wheat-200 text-sm">
              <thead className="bg-wheat-100 text-left text-[13px] text-wheat-800">
                <tr>{['Source', 'Linkage QTL', 'GWAS assoc.', 'Meta-QTL rows', 'Epistatic', 'Clusters', 'Qualitative', 'Studies', 'Exclusive studies', 'Traits', 'Species'].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-wheat-100">
                {s.comparison.sources.map((r) => (
                  <tr key={r.source}>
                    <td className="px-3 py-1.5 font-medium text-wheat-900">{r.source === 'Literature' ? 'Literature mining' : r.source}</td>
                    {[r.QTL, r.GWAS, r['meta-QTL'], r['epistatic QTL'], r['QTL cluster'], r.MTL, r.studies, r.unique_studies, r.traits, r.species].map((v, i) => (
                      <td key={i} className="px-3 py-1.5 text-right">{v ? v.toLocaleString() : '–'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-5 grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
            {s.comparison.integrated.map((r) => (
              <div key={r.label}>
                <div className="text-xs text-wheat-500">{r.label}</div>
                <div className="text-sm text-wheat-800">
                  <span className="font-semibold text-wheat-900">{r.integrated.toLocaleString()}</span>{' '}
                  <span className="text-wheat-500">vs {r.cottongen ? r.cottongen.toLocaleString() : 'none'} in CottonGen</span>
                </div>
              </div>
            ))}
          </div>
          <img src={`${import.meta.env.BASE_URL}figures/fig8_source_content_matrix.png`} alt="Content contributed by each source and held by the integrated resource" loading="lazy" className="mt-5 w-full rounded border border-wheat-200" />
          <p className="mt-2 text-xs text-wheat-500">
            Counts for the source databases are what was harvested from them for this resource, not their full holdings of other data types.
          </p>
        </div>
      )}

      <Panel title="Records by trait category" note="Linkage QTL records and GWAS loci in each category." legend={[['QTL', S1], ['GWAS loci', S2]]} height={340}>
        <BarChart data={byCat} margin={{ top: 8, right: 12, bottom: 56, left: 0 }} barGap={2}>
          <CartesianGrid vertical={false} stroke="rgb(var(--n-200))" />
          <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={{ stroke: 'rgb(var(--n-400))' }} angle={-35} textAnchor="end" interval={0} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => v.toLocaleString()} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => v.toLocaleString()} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
          <Bar dataKey="QTL" fill={S1} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="GWAS loci" fill={S2} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </Panel>

      <Panel title="Loci per megabase by chromosome" note="QTL and GWAS loci in allotetraploid cotton, divided by chromosome length (TM-1 UTX v2.1)." legend={[['At subgenome', S1], ['Dt subgenome', S2]]}>
        <BarChart data={s.per_chromosome} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
          <CartesianGrid vertical={false} stroke="rgb(var(--n-200))" />
          <XAxis dataKey="chromosome" tick={AXIS} tickLine={false} axisLine={{ stroke: 'rgb(var(--n-400))' }} interval={0} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} />
          <Tooltip
            cursor={{ fill: 'rgba(0,0,0,0.04)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const p = payload[0].payload
              return (
                <div className="rounded-md border border-wheat-200 bg-wheat-50 px-3 py-2 text-xs shadow">
                  <div className="font-semibold text-wheat-900">{p.chromosome} · {p.length_mb.toFixed(0)} Mb</div>
                  <div>{p.loci_per_mb.toFixed(1)} loci per Mb</div>
                  <div>{p.loci.toLocaleString()} loci ({p.qtl_loci.toLocaleString()} QTL, {p.gwas_loci.toLocaleString()} GWAS) · {p.studies} studies</div>
                </div>
              )
            }}
          />
          <Bar dataKey="loci_per_mb" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {s.per_chromosome.map((r) => <Cell key={r.chromosome} fill={r.chromosome.startsWith('A') ? S1 : S2} />)}
          </Bar>
        </BarChart>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Most studied traits" note="Number of loci per harmonised trait (top 20)." height={520}>
          <BarChart data={traits} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 110 }}>
            <CartesianGrid horizontal={false} stroke="rgb(var(--n-200))" />
            <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => v.toLocaleString()} />
            <YAxis type="category" dataKey="name" tick={AXIS} tickLine={false} axisLine={{ stroke: 'rgb(var(--n-400))' }} width={170} interval={0} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [v.toLocaleString(), 'loci']} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
            <Bar dataKey="value" fill={S1} radius={[0, 3, 3, 0]} isAnimationActive={false} />
          </BarChart>
        </Panel>
        <div className="space-y-6">
          <Panel title="Records by species" note="QTL and GWAS records (top 10)." height={250}>
            <BarChart data={species} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 90 }}>
              <CartesianGrid horizontal={false} stroke="rgb(var(--n-200))" />
              <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => v.toLocaleString()} />
              <YAxis type="category" dataKey="name" tick={AXIS} tickLine={false} axisLine={{ stroke: 'rgb(var(--n-400))' }} width={160} interval={0} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [v.toLocaleString(), 'records']} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
              <Bar dataKey="value" fill={S1} radius={[0, 3, 3, 0]} isAnimationActive={false} />
            </BarChart>
          </Panel>
          <Panel title="Records by source" note="De-duplicated records of all types." height={170}>
            <BarChart data={sources} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 20 }}>
              <CartesianGrid horizontal={false} stroke="rgb(var(--n-200))" />
              <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => v.toLocaleString()} />
              <YAxis type="category" dataKey="name" tick={AXIS} tickLine={false} axisLine={{ stroke: 'rgb(var(--n-400))' }} width={90} interval={0} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [v.toLocaleString(), 'records']} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
              <Bar dataKey="value" fill={S1} radius={[0, 3, 3, 0]} isAnimationActive={false} />
            </BarChart>
          </Panel>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Papers per year" note="Cotton QTL/GWAS papers indexed from Europe PMC, by study type." legend={[['Linkage QTL', S1], ['GWAS', S2], ['Meta-QTL / epistasis', S3]]}>
          <LineChart data={s.papers_per_year} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid vertical={false} stroke="rgb(var(--n-200))" />
            <XAxis dataKey="year" tick={AXIS} tickLine={false} axisLine={{ stroke: 'rgb(var(--n-400))' }} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Line dataKey="Linkage QTL" stroke={S1} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line dataKey="GWAS" stroke={S2} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line dataKey="Meta-QTL / epistasis" stroke={S3} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </Panel>
        <Panel title="Share of major-effect QTL by category" note="Percentage of linkage QTL with PVE ≥ 10% (categories with at least 100 QTL reporting PVE).">
          <BarChart data={eff} margin={{ top: 8, right: 12, bottom: 48, left: 0 }}>
            <CartesianGrid vertical={false} stroke="rgb(var(--n-200))" />
            <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={{ stroke: 'rgb(var(--n-400))' }} angle={-30} textAnchor="end" interval={0} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} unit="%" />
            <Tooltip
              cursor={{ fill: 'rgba(0,0,0,0.04)' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const p = payload[0].payload
                return (
                  <div className="rounded-md border border-wheat-200 bg-wheat-50 px-3 py-2 text-xs shadow">
                    <div className="font-semibold text-wheat-900">{p.name}</div>
                    <div>{p.value}% with PVE ≥ 10%</div>
                    <div>median PVE {p.median.toFixed(1)}% · {p.n.toLocaleString()} QTL</div>
                  </div>
                )
              }}
            />
            <Bar dataKey="value" fill={S1} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </Panel>
      </div>
    </div>
  )
}
