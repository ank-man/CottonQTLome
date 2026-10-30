import { useMemo, useState } from 'react'
import { ColumnDef } from '@tanstack/react-table'
import PageHero from '../components/PageHero'
import DataTable from '../components/DataTable'
import AsyncBoundary from '../components/AsyncBoundary'
import GlossaryHeader from '../components/GlossaryHeader'
import { clip, referenceColumn } from '../components/cells'
import { useCSV } from '../lib/useCSV'
import { MarkerRecord } from '../lib/types'
import { TRAIT_CATEGORIES } from '../lib/map'

const TIERS: [string, string][] = [
  ['replicated QTL marker', 'Named as the peak or flanking marker of a QTL for the same trait by two or more independent studies.'],
  ['CottonGen trait-linked marker', 'Linked to the trait by CottonGen curation, with map positions and primers where available.'],
  ['primer table, validation / fine-mapping study', 'Listed with primer sequences in a paper whose table or text concerns KASP/CAPS assays, fine mapping, validation or marker-assisted selection.'],
  ['primer table from a mapping study', 'Listed with primer sequences in the supplement of a QTL or GWAS paper on this trait; not necessarily trait-linked.'],
]

const columns: ColumnDef<MarkerRecord, any>[] = [
  { accessorKey: 'marker', header: () => <GlossaryHeader label="Marker" term="associated_markers" />, cell: clip(200) },
  { accessorKey: 'trait', header: () => <GlossaryHeader label="Trait" term="parameter" />, cell: clip(200) },
  { accessorKey: 'category', header: () => <GlossaryHeader label="Category" term="trait" /> },
  {
    accessorKey: 'evidence', header: 'Evidence tier',
    cell: ({ getValue }) => {
      const v = String(getValue())
      return <span className={`badge ${v.startsWith('replicated') ? 'border-accent/30 bg-wheat-50 text-accent' : ''}`}>{v}</span>
    },
  },
  { id: 'n_studies', header: () => <GlossaryHeader label="Studies / maps" term="n_studies" />, accessorFn: (r) => Number(r.n_studies) },
  { accessorKey: 'marker_type', header: 'Type' },
  { accessorKey: 'chromosome', header: () => <GlossaryHeader label="Chr" term="chromosome" /> },
  { accessorKey: 'primers', header: 'Primers (5′→3′)', cell: ({ getValue }) => <span className="block truncate font-mono text-xs" style={{ maxWidth: 360 }} title={String(getValue() ?? '').replace(/\|/g, '\n')}>{String(getValue() ?? '')}</span> },
  { accessorKey: 'context', header: 'Context', cell: clip(300) },
  referenceColumn<MarkerRecord>(),
]

export default function MarkersPage() {
  const { data, loading, error } = useCSV<MarkerRecord>('markers.csv')
  const [tier, setTier] = useState('replicated QTL marker')
  const [cat, setCat] = useState('')
  const [primersOnly, setPrimersOnly] = useState(false)
  const rows = useMemo(
    () => data.filter((m) => (!tier || m.evidence === tier) && (!cat || m.category === cat) && (!primersOnly || m.primers)),
    [data, tier, cat, primersOnly],
  )
  return (
    <div>
      <PageHero
        eyebrow="Markers"
        title="Trait-linked markers"
        subtitle="Molecular markers associated with traits, graded by the strength of the evidence, with primer sequences where a source provides them."
        variant="side"
      />
      <AsyncBoundary loading={loading} error={error}>
        <div className="space-y-4">
          <div className="card text-sm leading-relaxed text-wheat-700">
            <p>
              No public cotton resource certifies markers as validated for breeding, so this table does not claim that either.
              It grades each marker–trait link by what supports it:
            </p>
            <dl className="mt-3 grid gap-3 md:grid-cols-2">
              {TIERS.map(([name, text]) => (
                <div key={name}>
                  <dt className="font-semibold text-wheat-900">{name} <span className="font-normal text-wheat-500">({data.filter((m) => m.evidence === name).length.toLocaleString()})</span></dt>
                  <dd>{text}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="card flex flex-wrap items-center gap-3 text-sm text-wheat-700">
            <div className="min-w-0 flex-1">
              <span className="font-semibold text-wheat-900">Primer catalogue.</span>{' '}
              Primer sequences for every marker we could find them for - CottonGen (all marker types) and primer tables in
              paper supplements - are in one file. Trait-linked markers below and every linkage-map download carry these
              primers where the marker name matches.
            </div>
            <a className="btn-primary" href={`${import.meta.env.BASE_URL}data/marker_primers.csv`} download="cottonqtlome_marker_primers.csv">
              Download all primers (CSV)
            </a>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <select className="input w-auto" value={tier} onChange={(e) => setTier(e.target.value)} aria-label="Evidence tier">
              <option value="">All evidence tiers</option>
              {TIERS.map(([t]) => <option key={t}>{t}</option>)}
            </select>
            <select className="input w-auto" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Trait category">
              <option value="">All categories</option>
              {TRAIT_CATEGORIES.map((t) => <option key={t}>{t}</option>)}
            </select>
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-wheat-600" checked={primersOnly} onChange={(e) => setPrimersOnly(e.target.checked)} />
              With primer sequences
            </label>
          </div>
          <DataTable data={rows} columns={columns} filename="cottonqtlome_trait_markers.csv" />
        </div>
      </AsyncBoundary>
    </div>
  )
}
