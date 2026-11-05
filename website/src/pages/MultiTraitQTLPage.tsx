import { useState } from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { Link } from 'react-router-dom'
import PageHero from '../components/PageHero'
import DataTable from '../components/DataTable'
import AsyncBoundary from '../components/AsyncBoundary'
import GlossaryHeader from '../components/GlossaryHeader'
import { clip, evidenceColumn, referenceColumn } from '../components/cells'
import { useCSV } from '../lib/useCSV'
import { ClusterRecord, MultiTraitQTLRecord, MultiTraitClusterRecord } from '../lib/types'

const reported: ColumnDef<ClusterRecord, any>[] = [
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

const link = (url: string, label: string) => (url ? <a className="underline" href={url} target="_blank" rel="noreferrer">{label || 'link'}</a> : label)

const withinStudy: ColumnDef<MultiTraitQTLRecord, any>[] = [
  { accessorKey: 'mt_id', header: 'ID' },
  { accessorKey: 'kind', header: 'Evidence' },
  { accessorKey: 'chromosome', header: 'Chr' },
  { id: 'interval', header: 'Interval (own assembly / map)', accessorFn: (r) => `${r.start}–${r.end} ${r.unit}` },
  { accessorKey: 'placement', header: 'Assembly / map', cell: clip(200) },
  { id: 'utx', header: 'UTX v2.1 (Mb)', accessorFn: (r) => (r.utx_v2_1_start_mb ? `${r.utx_v2_1_start_mb}–${r.utx_v2_1_end_mb}` : '') },
  { id: 'n_traits', header: 'Traits (n)', accessorFn: (r) => Number(r.n_traits) },
  { accessorKey: 'traits', header: 'Traits', cell: clip(320) },
  { accessorKey: 'categories', header: 'Categories', cell: clip(200) },
  { id: 'n_records', header: 'Records', accessorFn: (r) => Number(r.n_records) },
  { accessorKey: 'markers', header: 'Markers', cell: clip(200) },
  { accessorKey: 'qtl_names', header: 'QTL names', cell: clip(220) },
  { id: 'study', header: 'Study', accessorFn: (r) => r.study_label, cell: ({ row }) => link(row.original.reference, row.original.study_label) },
]

const clusters: ColumnDef<MultiTraitClusterRecord, any>[] = [
  { accessorKey: 'mtc_id', header: 'ID' },
  { accessorKey: 'chromosome', header: 'Chr' },
  { id: 'core', header: 'Shared core (Mb)', accessorFn: (r) => `${r.core_start_mb}–${r.core_end_mb}` },
  { id: 'span', header: 'Extent (Mb)', accessorFn: (r) => `${r.start_mb}–${r.end_mb}` },
  { id: 'n_traits', header: 'Traits (n)', accessorFn: (r) => Number(r.n_traits) },
  { id: 'n_categories', header: 'Categories (n)', accessorFn: (r) => Number(r.n_categories) },
  { accessorKey: 'traits', header: 'Traits', cell: clip(360) },
  { id: 'n_meta_qtl', header: 'Meta-QTL', accessorFn: (r) => Number(r.n_meta_qtl) },
  { accessorKey: 'mqtl_ids', header: 'Meta-QTL IDs', cell: clip(260) },
  { id: 'n_high', header: 'High-confidence', accessorFn: (r) => Number(r.n_high_confidence) },
  { accessorKey: 'hotspots', header: 'Hotspot' },
  { accessorKey: 'recurrent_candidate_genes', header: 'Recurrent candidate genes', cell: clip(260) },
]

export default function MultiTraitQTLPage() {
  const rep = useCSV<ClusterRecord>('clusters.csv')
  const ws = useCSV<MultiTraitQTLRecord>('multitrait_qtl.csv')
  const cl = useCSV<MultiTraitClusterRecord>('multitrait_mqtl_clusters.csv')
  const [tab, setTab] = useState<'clusters' | 'within' | 'reported'>('clusters')
  const tabs = [
    ['clusters', `Multi-trait meta-QTL clusters (${cl.data.length.toLocaleString()})`],
    ['within', `Multi-trait QTL within studies (${ws.data.length.toLocaleString()})`],
    ['reported', `Reported by authors (${rep.data.length.toLocaleString()})`],
  ] as const
  return (
    <div>
      <PageHero
        eyebrow="Data"
        title="Multi-trait QTL"
        subtitle="Regions where loci for several traits map together: clusters of meta-QTL across studies, co-localising QTL and shared GWAS signals within a study, and the clusters and pleiotropic regions reported by the authors."
        variant="side"
      />
      <AsyncBoundary loading={rep.loading || ws.loading || cl.loading} error={rep.error ?? ws.error ?? cl.error}>
        <div className="mb-4 inline-flex flex-wrap rounded border border-wheat-200 bg-wheat-100 p-1">
          {tabs.map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${tab === k ? 'bg-wheat-50 text-wheat-900 shadow-sm' : 'text-wheat-600 hover:text-wheat-900'}`}>
              {label}
            </button>
          ))}
        </div>
        {tab === 'clusters' ? (
          <>
            <p className="mb-4 text-sm text-wheat-600">
              Physical <Link className="underline" to="/data/metaqtl">meta-QTL</Link> of different traits whose 95%
              confidence intervals all overlap one shared core interval on TM-1 UTX v2.1. Only meta-QTL with a CI of 5 Mb
              or less take part, so wide intervals near the centromeres cannot link distant loci.
            </p>
            <DataTable data={cl.data} columns={clusters} filename="cottonqtlome_multitrait_meta_qtl_clusters.csv" />
          </>
        ) : tab === 'within' ? (
          <>
            <p className="mb-4 text-sm text-wheat-600">
              Within one study: linkage QTL for two or more traits whose intervals overlap (same assembly in Mb, or same
              map and linkage group in cM), and GWAS signals for two or more traits at the same SNP or within 100 kb.
              Intervals are on the study's own assembly or map; the UTX v2.1 column gives the common-reference position.
            </p>
            <DataTable data={ws.data} columns={withinStudy} filename="cottonqtlome_multitrait_qtl_within_studies.csv" />
          </>
        ) : (
          <>
            <p className="mb-4 text-sm text-wheat-600">
              Rows from tables that the authors themselves labelled as clusters, hotspots or pleiotropic regions. For
              regions supported by many studies, see <Link className="underline" to="/hotspots">QTL hotspots</Link>.
            </p>
            <DataTable data={rep.data} columns={reported} filename="cottonqtlome_qtl_clusters.csv" />
          </>
        )}
      </AsyncBoundary>
    </div>
  )
}
