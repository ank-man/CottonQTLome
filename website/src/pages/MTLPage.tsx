import { ColumnDef } from '@tanstack/react-table'
import PageHero from '../components/PageHero'
import DataTable from '../components/DataTable'
import AsyncBoundary from '../components/AsyncBoundary'
import GlossaryHeader from '../components/GlossaryHeader'
import { clip } from '../components/cells'
import { useCSV } from '../lib/useCSV'
import { MTLRecord } from '../lib/types'

const columns: ColumnDef<MTLRecord, any>[] = [
  { accessorKey: 'id', header: 'ID' },
  { accessorKey: 'species', header: 'Species' },
  { accessorKey: 'trait', header: () => <GlossaryHeader label="Category" term="trait" /> },
  { accessorKey: 'parameter', header: () => <GlossaryHeader label="Trait" term="parameter" />, cell: clip(220) },
  { accessorKey: 'trait_original', header: () => <GlossaryHeader label="Original trait" term="trait_original" />, cell: clip(220) },
  { accessorKey: 'qtl_name', header: 'Gene symbol(s)' },
  { accessorKey: 'citation', header: 'Citation', cell: clip(520) },
]

export default function MTLPage() {
  const { data, loading, error } = useCSV<MTLRecord>('mtl.csv')
  return (
    <div>
      <PageHero
        eyebrow="Data"
        title="Qualitative trait loci"
        subtitle="Mendelian (single-gene) trait loci and their gene symbols - leaf shape, glands, fuzz, colour, sterility, disease resistance - as catalogued by CottonGen from the classical cotton genetics literature."
        variant="side"
      />
      <AsyncBoundary loading={loading} error={error}>
        <DataTable data={data} columns={columns} filename="cottonqtlome_qualitative_loci.csv" />
      </AsyncBoundary>
    </div>
  )
}
