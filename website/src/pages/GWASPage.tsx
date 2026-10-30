import { ColumnDef } from '@tanstack/react-table'
import PageHero from '../components/PageHero'
import DataTable from '../components/DataTable'
import AsyncBoundary from '../components/AsyncBoundary'
import GlossaryHeader from '../components/GlossaryHeader'
import { clip, evidenceColumn, referenceColumn } from '../components/cells'
import { useCSV } from '../lib/useCSV'
import { GWASRecord } from '../lib/types'

const columns: ColumnDef<GWASRecord, any>[] = [
  { accessorKey: 'id', header: 'Locus ID' },
  { accessorKey: 'species', header: 'Species' },
  { accessorKey: 'trait', header: () => <GlossaryHeader label="Category" term="trait" /> },
  { accessorKey: 'parameter', header: () => <GlossaryHeader label="Trait" term="parameter" />, cell: clip(200) },
  { accessorKey: 'trait_original', header: () => <GlossaryHeader label="Original trait" term="trait_original" />, cell: clip(160) },
  { accessorKey: 'chromosome', header: () => <GlossaryHeader label="Chr" term="chromosome" /> },
  { accessorKey: 'position_interval', header: () => <GlossaryHeader label="Position / interval" term="position_interval" /> },
  { accessorKey: 'position_unit', header: () => <GlossaryHeader label="Unit" term="position_unit" /> },
  { accessorKey: 'neg_log10_p', header: () => <GlossaryHeader label="−log10(P)" term="neg_log10_p" /> },
  { accessorKey: 'pve', header: () => <GlossaryHeader label="PVE %" term="pve" /> },
  { accessorKey: 'n_associations', header: 'Associations' },
  { accessorKey: 'n_studies', header: () => <GlossaryHeader label="Studies" term="n_studies" /> },
  { accessorKey: 'associated_markers', header: () => <GlossaryHeader label="Lead marker" term="associated_markers" />, cell: clip(220) },
  { accessorKey: 'candidate_gene', header: () => <GlossaryHeader label="Cand. gene" term="candidate_gene" />, cell: clip(180) },
  { accessorKey: 'population', header: () => <GlossaryHeader label="Panel" term="population" />, cell: clip(180) },
  { accessorKey: 'ref_genome', header: () => <GlossaryHeader label="Assembly" term="ref_genome" />, cell: clip(200) },
  { accessorKey: 'hotspot_id', header: () => <GlossaryHeader label="Hotspot" term="hotspot" /> },
  { accessorKey: 'source', header: 'Source' },
  evidenceColumn<GWASRecord>(),
  referenceColumn<GWASRecord>(),
]

export default function GWASPage() {
  const { data, loading, error } = useCSV<GWASRecord>('gwas.csv')
  return (
    <div>
      <PageHero
        eyebrow="Data"
        title="GWAS loci"
        subtitle="Marker–trait associations from genome-wide association studies, collapsed to one row per locus: associations for the same trait on the same assembly within 500 kb are grouped and the most significant one is shown."
        variant="side"
      />
      <AsyncBoundary loading={loading} error={error}>
        <p className="mb-4 text-sm text-wheat-600">
          The SNP-level table behind these loci is too large for the browser; it is part of the downloadable
          database (<code>records_deduplicated.tsv</code>, <code>cotton_qtl.sqlite</code>) described on the About page.
        </p>
        <DataTable data={data} columns={columns} filename="cottonqtlome_gwas_loci.csv" />
      </AsyncBoundary>
    </div>
  )
}
