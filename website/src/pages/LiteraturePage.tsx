import { useMemo, useState } from 'react'
import { ColumnDef } from '@tanstack/react-table'
import PageHero from '../components/PageHero'
import DataTable from '../components/DataTable'
import AsyncBoundary from '../components/AsyncBoundary'
import { clip } from '../components/cells'
import { useCSV } from '../lib/useCSV'
import { groupBy } from '../lib/rowColors'
import { LiteratureRecord } from '../lib/types'

const TYPES = ['Linkage QTL', 'GWAS', 'Meta-QTL', 'Epistasis', 'Multi-trait', 'QTL×E', 'Fine mapping', 'BSA', 'eQTL/omics', 'Review']

const columns: ColumnDef<LiteratureRecord, any>[] = [
  { accessorKey: 'year', header: 'Year' },
  {
    accessorKey: 'title',
    header: 'Title',
    cell: ({ row }) => {
      const r = row.original
      const title = plainTitle(r.title)
      const inner = <span className="block truncate" style={{ maxWidth: 560 }} title={title}>{title}</span>
      return r.doi ? <a className="underline" href={r.doi} target="_blank" rel="noreferrer">{inner}</a> : inner
    },
  },
  { accessorKey: 'authors', header: 'Authors', cell: clip(200) },
  { accessorKey: 'journal', header: 'Journal', cell: clip(200) },
  {
    accessorKey: 'study_type',
    header: 'Study type',
    cell: ({ getValue }) => (
      <div className="flex gap-1">
        {String(getValue() ?? '').split('; ').filter(Boolean).map((t) => <span key={t} className="badge">{t}</span>)}
      </div>
    ),
  },
  { accessorKey: 'open_access', header: 'Open access' },
  { accessorKey: 'records_extracted', header: 'Records in database' },
  { accessorKey: 'pmid', header: 'PMID' },
]

// Titles from Europe PMC can carry (sometimes escaped) markup such as <i>Gossypium</i>.
function plainTitle(t: string): string {
  const doc = new DOMParser().parseFromString(t ?? '', 'text/html')
  const once = doc.body.textContent ?? ''
  return /<\/?[a-z]/i.test(once) ? (new DOMParser().parseFromString(once, 'text/html').body.textContent ?? once) : once
}

const byStudyType = groupBy<LiteratureRecord>((r) => r.study_type.split('; ')[0] || undefined)

export default function LiteraturePage() {
  const { data, loading, error } = useCSV<LiteratureRecord>('literature.csv')
  const [type, setType] = useState('')
  const [withData, setWithData] = useState(false)
  const rows = useMemo(
    () => data.filter((r) => (!type || r.study_type.split('; ').includes(type)) && (!withData || Number(r.records_extracted) > 0)),
    [data, type, withData],
  )
  return (
    <div>
      <PageHero
        eyebrow="Literature"
        title="Cotton QTL & GWAS literature index"
        subtitle="Papers on QTL mapping, GWAS, meta-QTL and epistasis in Gossypium indexed from Europe PMC, tagged by study type from title and abstract."
        variant="side"
      />
      <AsyncBoundary loading={loading} error={error}>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <select className="input w-auto" value={type} onChange={(e) => setType(e.target.value)} aria-label="Study type">
            <option value="">All study types</option>
            {TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-wheat-600" checked={withData} onChange={(e) => setWithData(e.target.checked)} />
            Only papers with records extracted into the database
          </label>
        </div>
        <p className="mb-4 text-sm text-wheat-600">
          “Records in database” counts rows parsed automatically from the paper’s tables and supplements. Zero does
          not mean the paper has no QTL: it may be paywalled, report results only in PDF supplements or figures, or
          already be covered through CottonGen.
        </p>
        <DataTable data={rows} columns={columns} filename="cottonqtlome_literature.csv" rowGroup={byStudyType} groupLabel="Main study type" />
      </AsyncBoundary>
    </div>
  )
}
