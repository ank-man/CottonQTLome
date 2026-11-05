import { ColumnDef } from '@tanstack/react-table'
import { Link } from 'react-router-dom'
import PageHero from '../components/PageHero'
import DataTable from '../components/DataTable'
import AsyncBoundary from '../components/AsyncBoundary'
import { clip } from '../components/cells'
import { useCSV } from '../lib/useCSV'
import { ClonedGeneRecord } from '../lib/types'

const columns: ColumnDef<ClonedGeneRecord, any>[] = [
  { accessorKey: 'cloned_gene_id', header: 'ID' },
  {
    accessorKey: 'gene', header: 'Gene',
    cell: ({ getValue }) => <Link className="underline" to={`/genes?q=${encodeURIComponent(String(getValue()))}`}>{String(getValue())}</Link>,
  },
  { accessorKey: 'trait_harmonized', header: 'Trait' },
  { accessorKey: 'trait_category', header: 'Category' },
  { accessorKey: 'evidence_tier', header: 'Evidence' },
  { accessorKey: 'mapping_evidence', header: 'Mapping', cell: clip(180) },
  { accessorKey: 'validation_methods', header: 'Validation', cell: clip(220) },
  { accessorKey: 'species', header: 'Species' },
  { accessorKey: 'chromosome', header: 'Chr' },
  { accessorKey: 'utx_v2_1_mb', header: 'UTX v2.1 (Mb)' },
  { accessorKey: 'gene_type', header: 'Name type' },
  {
    id: 'paper', header: 'Paper', accessorFn: (r) => `${r.study_label} ${r.title}`,
    cell: ({ row }) => {
      const r = row.original
      return <a className="block truncate underline" style={{ maxWidth: 420 }} title={r.title} href={r.reference} target="_blank" rel="noreferrer">{r.study_label}: {r.title}</a>
    },
  },
]

export default function ClonedGenesPage() {
  const { data, loading, error } = useCSV<ClonedGeneRecord>('cloned_genes.csv')
  return (
    <div>
      <PageHero
        eyebrow="Data"
        title="Cloned and validated genes"
        subtitle="Cotton genes identified behind mapped loci, by map-based cloning, fine mapping, QTL or GWAS, with the method used to confirm them (VIGS, CRISPR/Cas9, RNAi, over-expression, complementation or causal variants)."
        variant="side"
      />
      <AsyncBoundary loading={loading} error={error}>
        <p className="mb-4 text-sm text-wheat-600">
          Compiled from the titles and abstracts of cotton genetics papers (Europe PMC). <strong>Evidence</strong>:
          <em> map-based cloning</em>; <em>mapped and functionally validated</em> (a mapped locus plus VIGS, CRISPR,
          RNAi, over-expression or complementation); <em>mapped; causal variant described</em>; <em>mapped candidate
          (not validated)</em>. Each row links to its paper. Gene names are as published; old-annotation IDs give the
          chromosome only.
        </p>
        <DataTable data={data} columns={columns} filename="cottonqtlome_cloned_genes.csv" />
      </AsyncBoundary>
    </div>
  )
}
