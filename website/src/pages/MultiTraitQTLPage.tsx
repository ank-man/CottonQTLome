import { ColumnDef } from '@tanstack/react-table'
import { Link } from 'react-router-dom'
import PageHero from '../components/PageHero'
import DataTable from '../components/DataTable'
import AsyncBoundary from '../components/AsyncBoundary'
import GlossaryHeader from '../components/GlossaryHeader'
import { clip, evidenceColumn, referenceColumn } from '../components/cells'
import { useCSV } from '../lib/useCSV'
import { ClusterRecord } from '../lib/types'

const columns: ColumnDef<ClusterRecord, any>[] = [
  { accessorKey: 'id', header: 'ID' },
  { accessorKey: 'species', header: 'Species' },
  { accessorKey: 'qtl_name', header: 'Cluster / QTL', cell: clip(240) },
  { accessorKey: 'trait', header: () => <GlossaryHeader label="Category" term="trait" /> },
  { accessorKey: 'parameter', header: () => <GlossaryHeader label="Trait" term="parameter" />, cell: clip(220) },
  { accessorKey: 'trait_original', header: () => <GlossaryHeader label="Original trait" term="trait_original" />, cell: clip(200) },
  { accessorKey: 'chromosome', header: () => <GlossaryHeader label="Chr" term="chromosome" /> },
  { accessorKey: 'position_interval', header: () => <GlossaryHeader label="Position / interval" term="position_interval" /> },
  { accessorKey: 'position_unit', header: () => <GlossaryHeader label="Unit" term="position_unit" /> },
  { accessorKey: 'associated_markers', header: () => <GlossaryHeader label="Markers" term="associated_markers" />, cell: clip(220) },
  { accessorKey: 'lod', header: () => <GlossaryHeader label="LOD" term="lod" /> },
  { accessorKey: 'pve', header: () => <GlossaryHeader label="PVE %" term="pve" /> },
  evidenceColumn<ClusterRecord>(),
  referenceColumn<ClusterRecord>(),
]

export default function MultiTraitQTLPage() {
  const { data, loading, error } = useCSV<ClusterRecord>('clusters.csv')
  return (
    <div>
      <PageHero
        eyebrow="Data"
        title="Multi-trait QTL clusters"
        subtitle="QTL clusters, pleiotropic regions and co-localised QTL as reported by the original studies - regions where QTL for several traits map together."
        variant="side"
      />
      <AsyncBoundary loading={loading} error={error}>
        <p className="mb-4 text-sm text-wheat-600">
          These rows come from tables that the authors themselves labelled as clusters, hotspots or pleiotropic
          regions. For regions derived across <em>all</em> studies in this database, see{' '}
          <Link className="underline" to="/hotspots">QTL hotspots</Link>.
        </p>
        <DataTable data={data} columns={columns} filename="cottonqtlome_qtl_clusters.csv" />
      </AsyncBoundary>
    </div>
  )
}
