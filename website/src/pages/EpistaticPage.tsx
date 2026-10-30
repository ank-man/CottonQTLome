import { ColumnDef } from '@tanstack/react-table'
import PageHero from '../components/PageHero'
import DataTable from '../components/DataTable'
import AsyncBoundary from '../components/AsyncBoundary'
import GlossaryHeader from '../components/GlossaryHeader'
import { clip, evidenceColumn, referenceColumn } from '../components/cells'
import { useCSV } from '../lib/useCSV'
import { EpistaticRecord } from '../lib/types'

const columns: ColumnDef<EpistaticRecord, any>[] = [
  { accessorKey: 'id', header: 'ID' },
  { accessorKey: 'species', header: 'Species' },
  { accessorKey: 'trait', header: () => <GlossaryHeader label="Category" term="trait" /> },
  { accessorKey: 'parameter', header: () => <GlossaryHeader label="Trait" term="parameter" />, cell: clip(200) },
  { accessorKey: 'chromosome', header: () => <GlossaryHeader label="Chr 1" term="chromosome" /> },
  { accessorKey: 'pos1_bp', header: 'Pos 1 (bp)' },
  { accessorKey: 'markers1', header: () => <GlossaryHeader label="Locus 1 markers" term="epistatic" />, cell: clip(200) },
  { accessorKey: 'chromosome2', header: () => <GlossaryHeader label="Chr 2" term="chromosome" /> },
  { accessorKey: 'pos2_bp', header: 'Pos 2 (bp)' },
  { accessorKey: 'markers2', header: () => <GlossaryHeader label="Locus 2 markers" term="epistatic" />, cell: clip(200) },
  { accessorKey: 'placement', header: 'Placement' },
  { accessorKey: 'lod', header: () => <GlossaryHeader label="LOD" term="lod" /> },
  { accessorKey: 'neg_log10_p', header: () => <GlossaryHeader label="−log10(P)" term="neg_log10_p" /> },
  { accessorKey: 'pve', header: () => <GlossaryHeader label="PVE %" term="pve" /> },
  { accessorKey: 'effect', header: 'Effect' },
  evidenceColumn<EpistaticRecord>(),
  referenceColumn<EpistaticRecord>(),
]

export default function EpistaticPage() {
  const { data, loading, error } = useCSV<EpistaticRecord>('epistatic.csv')
  return (
    <div>
      <PageHero
        eyebrow="Data"
        title="Epistatic QTL"
        subtitle="QTL × QTL (digenic) interactions from two-locus tables in the literature, with both loci resolved to chromosome and, where reported, physical position. Pairs can be drawn as chords on the Circos genome map."
        variant="side"
      />
      <AsyncBoundary loading={loading} error={error}>
        <DataTable data={data} columns={columns} filename="cottonqtlome_epistatic.csv" />
      </AsyncBoundary>
    </div>
  )
}
