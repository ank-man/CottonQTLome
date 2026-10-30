import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ColumnDef } from '@tanstack/react-table'
import { Eye } from 'lucide-react'
import PageHero from '../components/PageHero'
import DataTable from '../components/DataTable'
import AsyncBoundary from '../components/AsyncBoundary'
import LinkageMapViewer from '../components/LinkageMapViewer'
import { clip } from '../components/cells'
import { useCSV } from '../lib/useCSV'
import { groupBy } from '../lib/rowColors'
import { LinkageMapRecord } from '../lib/types'

const bySource = groupBy<LinkageMapRecord>((r) => r.source || undefined)

export default function LinkageMapsPage() {
  const { data, loading, error } = useCSV<LinkageMapRecord>('maps.csv')
  const [params] = useSearchParams()
  // /linkage-maps?map=CG009 opens that map in the viewer
  const [selected, setSelected] = useState<string | null>(params.get('map'))
  useEffect(() => {
    if (params.get('map') && data.length) document.getElementById('viewer')?.scrollIntoView()
  }, [params, data.length])
  const [source, setSource] = useState('')
  const current = data.find((m) => m.map_id === (selected ?? data[0]?.map_id))
  const rows = useMemo(() => data.filter((m) => !source || m.source === source), [data, source])
  const sources = useMemo(() => Array.from(new Set(data.map((m) => m.source))), [data])

  const columns = useMemo<ColumnDef<LinkageMapRecord, any>[]>(() => [
    {
      id: 'view', header: 'View', enableSorting: false,
      cell: ({ row }) => (
        <button className="btn !px-2 !py-1 text-xs" onClick={() => { setSelected(row.original.map_id); document.getElementById('viewer')?.scrollIntoView({ behavior: 'smooth' }) }}>
          <Eye className="h-3.5 w-3.5" />View
        </button>
      ),
    },
    {
      id: 'download', header: 'Download', enableSorting: false,
      cell: ({ row }) => (
        <a className="underline" href={`${import.meta.env.BASE_URL}data/maps/${row.original.map_id}.csv`} download={`${row.original.map_id}_linkage_map.csv`}>CSV</a>
      ),
    },
    { accessorKey: 'map_id', header: 'ID' },
    { accessorKey: 'name', header: 'Map', cell: clip(300) },
    { accessorKey: 'source', header: 'Source' },
    { accessorKey: 'map_type', header: 'Type' },
    { accessorKey: 'species', header: 'Species', cell: clip(220) },
    { accessorKey: 'parents', header: 'Parents', cell: clip(240) },
    { id: 'n_linkage_groups', header: 'Linkage groups', accessorFn: (r) => Number(r.n_linkage_groups) },
    { id: 'n_loci', header: 'Loci', accessorFn: (r) => Number(r.n_loci) },
    { id: 'length_cm', header: 'Length (cM)', accessorFn: (r) => Number(r.length_cm) },
    { accessorKey: 'marker_types', header: 'Marker types', cell: clip(160) },
    { accessorKey: 'n_qtl', header: 'QTL on map' },
    {
      accessorKey: 'reference', header: 'Reference',
      cell: ({ row }) => {
        const r = row.original
        const inner = <span className="block truncate" style={{ maxWidth: 380 }} title={r.reference}>{r.reference}</span>
        return r.doi ? <a className="underline" href={r.doi} target="_blank" rel="noreferrer">{inner}</a> : inner
      },
    },
  ], [])

  return (
    <div>
      <PageHero
        eyebrow="Linkage maps"
        title="Genetic linkage maps"
        subtitle="Marker orders and cM positions of cotton linkage maps, from CottonGen and from the supplementary files of mapping papers. View any map in the browser or download it as CSV."
        variant="side"
      />
      <AsyncBoundary loading={loading} error={error}>
        <div className="space-y-6">
          <div className="card" id="viewer">
            {current && (
              <>
                <div className="mb-3">
                  <h3 className="text-lg font-semibold text-wheat-900">{current.name}</h3>
                  <p className="text-sm text-wheat-600">
                    {current.map_id} · {current.source}{current.species ? ` · ${current.species}` : ''}{current.parents ? ` · ${current.parents}` : ''}
                  </p>
                </div>
                <LinkageMapViewer mapId={current.map_id} name={current.name} />
              </>
            )}
          </div>
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <select className="input w-auto" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
                <option value="">All sources</option>
                {sources.map((s) => <option key={s}>{s}</option>)}
              </select>
              <span className="text-sm text-wheat-600">
                {data.length} maps · {data.reduce((a, m) => a + Number(m.n_loci), 0).toLocaleString()} loci in total
              </span>
            </div>
            <DataTable data={rows} columns={columns} filename="cottonqtlome_linkage_maps.csv" pageSize={10} rowGroup={bySource} groupLabel="Source" />
          </div>
          <p className="text-xs text-wheat-500">
            Maps from literature supplements were recognised automatically (a table with a marker, a linkage group and a cM
            position per row) and are named after the paper and sheet; population details are in the linked paper.
            Linkage-group names are kept as published.
          </p>
        </div>
      </AsyncBoundary>
    </div>
  )
}
