import { ColumnDef } from '@tanstack/react-table'
import PageHero from '../components/PageHero'
import DataTable from '../components/DataTable'
import AsyncBoundary from '../components/AsyncBoundary'
import GlossaryHeader from '../components/GlossaryHeader'
import { clip, evidenceColumn, referenceColumn } from '../components/cells'
import { useCSV } from '../lib/useCSV'
import { QTLRecord } from '../lib/types'

const columns: ColumnDef<QTLRecord, any>[] = [
  { accessorKey: 'id', header: 'ID' },
  { accessorKey: 'species', header: 'Species' },
  { accessorKey: 'trait', header: () => <GlossaryHeader label="Category" term="trait" /> },
  { accessorKey: 'parameter', header: () => <GlossaryHeader label="Trait" term="parameter" />, cell: clip(200) },
  { accessorKey: 'trait_original', header: () => <GlossaryHeader label="Original trait" term="trait_original" />, cell: clip(160) },
  { accessorKey: 'qtl_name', header: () => <GlossaryHeader label="QTL" term="qtl" />, cell: clip(200) },
  { accessorKey: 'chromosome', header: () => <GlossaryHeader label="Chr" term="chromosome" /> },
  { accessorKey: 'position_interval', header: () => <GlossaryHeader label="Position / interval" term="position_interval" /> },
  { accessorKey: 'position_unit', header: () => <GlossaryHeader label="Unit" term="position_unit" /> },
  { accessorKey: 'lod', header: () => <GlossaryHeader label="LOD" term="lod" /> },
  { accessorKey: 'pve', header: () => <GlossaryHeader label="PVE %" term="pve" /> },
  { accessorKey: 'associated_markers', header: () => <GlossaryHeader label="Markers" term="associated_markers" />, cell: clip(220) },
  { accessorKey: 'candidate_gene', header: () => <GlossaryHeader label="Cand. gene" term="candidate_gene" />, cell: clip(180) },
  { accessorKey: 'cross', header: () => <GlossaryHeader label="Cross" term="cross" />, cell: clip(200) },
  { accessorKey: 'population', header: () => <GlossaryHeader label="Population" term="population" />, cell: clip(180) },
  { accessorKey: 'ref_genome', header: () => <GlossaryHeader label="Assembly" term="ref_genome" />, cell: clip(200) },
  { accessorKey: 'hotspot_id', header: () => <GlossaryHeader label="Hotspot" term="hotspot" /> },
  { accessorKey: 'source', header: 'Source' },
  evidenceColumn<QTLRecord>(),
  referenceColumn<QTLRecord>(),
]

export default function QTLPage() {
  const { data, loading, error } = useCSV<QTLRecord>('qtl.csv')
  return (
    <div>
      <PageHero
        eyebrow="Data"
        title="QTL (linkage mapping)"
        subtitle="QTL detected by interval mapping in bi-parental and multi-parent populations, from CottonGen and from tables in the literature."
        variant="side"
      />
      <AsyncBoundary loading={loading} error={error}>
        <DataTable data={data} columns={columns} filename="cottonqtlome_qtl.csv" />
      </AsyncBoundary>
    </div>
  )
}
