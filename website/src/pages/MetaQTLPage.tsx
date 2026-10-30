import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ColumnDef } from '@tanstack/react-table'
import PageHero from '../components/PageHero'
import DataTable from '../components/DataTable'
import AsyncBoundary from '../components/AsyncBoundary'
import GlossaryHeader from '../components/GlossaryHeader'
import { clip, evidenceColumn, referenceColumn } from '../components/cells'
import { useCSV } from '../lib/useCSV'
import { MetaQTLRecord, MQTLRecord } from '../lib/types'
import { CHROMOSOME_LENGTHS, TRAIT_CATEGORIES } from '../lib/map'

const num = (key: keyof MQTLRecord) => (r: MQTLRecord) => Number(r[key])

const computed: ColumnDef<MQTLRecord, any>[] = [
  { accessorKey: 'mqtl_id', header: () => <GlossaryHeader label="Meta-QTL" term="metaqtl" /> },
  { accessorKey: 'trait', header: () => <GlossaryHeader label="Trait" term="parameter" />, cell: clip(200) },
  { accessorKey: 'category', header: () => <GlossaryHeader label="Category" term="trait" /> },
  { accessorKey: 'chromosome', header: () => <GlossaryHeader label="Chr" term="chromosome" /> },
  { id: 'position_mb', header: 'Position (Mb)', accessorFn: num('position_mb') },
  { id: 'ci', header: '95% CI (Mb)', accessorFn: (r) => `${r.ci_start_mb}–${r.ci_end_mb}`, enableSorting: false },
  {
    id: 'genes', header: 'Genes', enableSorting: false,
    cell: ({ row }) => <Link className="underline" to={`/genes?r=${row.original.chromosome}:${row.original.ci_start_mb}-${row.original.ci_end_mb}`}>list</Link>,
  },
  { id: 'n_studies', header: () => <GlossaryHeader label="Studies" term="n_studies" />, accessorFn: num('n_studies') },
  {
    accessorKey: 'confidence',
    header: () => <GlossaryHeader label="Confidence" term="confidence" />,
    cell: ({ getValue }) => {
      const v = String(getValue())
      return <span className={`badge ${v === 'high' ? 'border-accent/30 bg-wheat-50 text-accent' : ''}`}>{v}</span>
    },
  },
  { accessorKey: 'evidence_class', header: 'Support' },
  { id: 'n_linkage_qtl', header: 'Linkage QTL', accessorFn: num('n_linkage_qtl') },
  { id: 'n_gwas_associations', header: 'GWAS associations', accessorFn: num('n_gwas_associations') },
  { id: 'mean_pve', header: () => <GlossaryHeader label="Mean PVE %" term="pve" />, accessorFn: (r) => (r.mean_pve ? Number(r.mean_pve) : '') },
  { id: 'max_lod', header: () => <GlossaryHeader label="Max LOD" term="lod" />, accessorFn: (r) => (r.max_lod ? Number(r.max_lod) : '') },
  { accessorKey: 'hotspot_id', header: () => <GlossaryHeader label="Hotspot" term="hotspot" /> },
  { accessorKey: 'example_qtl', header: 'Member QTL (examples)', cell: clip(300) },
  { accessorKey: 'recurrent_candidate_genes', header: () => <GlossaryHeader label="Recurrent cand. genes" term="candidate_gene" />, cell: clip(260) },
  { accessorKey: 'references', header: 'Studies (examples)', cell: clip(320) },
  { accessorKey: 'species', header: 'Species', cell: clip(220) },
]

const published: ColumnDef<MetaQTLRecord, any>[] = [
  { accessorKey: 'id', header: 'ID' },
  { accessorKey: 'species', header: 'Species' },
  { accessorKey: 'trait', header: () => <GlossaryHeader label="Category" term="trait" /> },
  { accessorKey: 'parameter', header: () => <GlossaryHeader label="Trait" term="parameter" />, cell: clip(200) },
  { accessorKey: 'mqtl_name', header: 'Name', cell: clip(220) },
  { accessorKey: 'chromosome', header: () => <GlossaryHeader label="Chr" term="chromosome" /> },
  { accessorKey: 'position_interval', header: () => <GlossaryHeader label="Position / interval" term="position_interval" /> },
  { accessorKey: 'position_unit', header: () => <GlossaryHeader label="Unit" term="position_unit" /> },
  { accessorKey: 'lod', header: () => <GlossaryHeader label="LOD" term="lod" /> },
  { accessorKey: 'pve', header: () => <GlossaryHeader label="PVE %" term="pve" /> },
  { accessorKey: 'associated_markers', header: () => <GlossaryHeader label="Markers" term="associated_markers" />, cell: clip(220) },
  evidenceColumn<MetaQTLRecord>(),
  referenceColumn<MetaQTLRecord>(),
]

export default function MetaQTLPage() {
  const mq = useCSV<MQTLRecord>('mqtl.csv')
  const pub = useCSV<MetaQTLRecord>('metaqtl.csv')
  const [tab, setTab] = useState<'computed' | 'published'>('computed')
  const [params] = useSearchParams()
  const [conf, setConf] = useState(params.get('q') ? '' : 'high')
  const [cat, setCat] = useState('')
  const [chr, setChr] = useState('')
  const [support, setSupport] = useState('')

  const rows = useMemo(
    () => mq.data.filter((m) =>
      (conf === '' || (conf === 'high' ? m.confidence === 'high' : m.confidence !== 'low')) &&
      (!cat || m.category === cat) && (!chr || m.chromosome === chr) && (!support || m.evidence_class === support)),
    [mq.data, conf, cat, chr, support],
  )
  const nHigh = mq.data.filter((m) => m.confidence === 'high').length

  return (
    <div>
      <PageHero
        eyebrow="Data"
        title="Meta-QTL"
        subtitle="Consensus loci for each trait, computed from all QTL and GWAS loci in this database that have a physical position, and supported by at least two independent studies."
        variant="side"
      />
      <AsyncBoundary loading={mq.loading || pub.loading} error={mq.error ?? pub.error}>
        <div className="mb-4 inline-flex rounded border border-wheat-200 bg-wheat-100 p-1">
          {([['computed', `CottonQTLome meta-QTL (${mq.data.length.toLocaleString()})`], ['published', `From published meta-analyses (${pub.data.length.toLocaleString()})`]] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${tab === k ? 'bg-wheat-50 text-wheat-900 shadow-sm' : 'text-wheat-600 hover:text-wheat-900'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'computed' ? (
          <div className="space-y-4">
            <div className="card text-sm leading-relaxed text-wheat-700">
              <p>
                <span className="font-semibold text-wheat-900">{mq.data.length.toLocaleString()}</span> meta-QTL for{' '}
                {new Set(mq.data.map((m) => m.trait)).size} traits; <span className="font-semibold text-wheat-900">{nHigh.toLocaleString()}</span> are
                supported by five or more independent studies. For each trait and chromosome, loci are projected onto the
                TM-1 UTX v2.1 axis, each study contributes one observation per locus, and a Gaussian mixture model in which
                every observation keeps its own positional variance is fitted; the number of meta-QTL is chosen by BIC.
              </p>
              <p className="mt-2">
                The confidence interval is statistical only. Positions come from several genome assemblies, so allow a few
                Mb of extra uncertainty, and treat low-confidence (two-study) meta-QTL as leads rather than findings.
              </p>
              <p className="mt-2">
                Every database trait was assessed. Some have no meta-QTL because they lack mapped loci or replication;
                unclassified trait names need manual review before biological interpretation.{' '}
                <a className="underline" href={`${import.meta.env.BASE_URL}data/mqtl_trait_coverage.csv`} download="cottonqtlome_trait_coverage.csv">
                  Download trait coverage and status
                </a>.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select className="input w-auto" value={conf} onChange={(e) => setConf(e.target.value)} aria-label="Confidence">
                <option value="high">High confidence (≥ 5 studies)</option>
                <option value="moderate">High + moderate (≥ 3 studies)</option>
                <option value="">All (≥ 2 studies)</option>
              </select>
              <select className="input w-auto" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Trait category">
                <option value="">All categories</option>
                {TRAIT_CATEGORIES.map((t) => <option key={t}>{t}</option>)}
              </select>
              <select className="input w-auto" value={chr} onChange={(e) => setChr(e.target.value)} aria-label="Chromosome">
                <option value="">All chromosomes</option>
                {Object.keys(CHROMOSOME_LENGTHS).map((c) => <option key={c}>{c}</option>)}
              </select>
              <select className="input w-auto" value={support} onChange={(e) => setSupport(e.target.value)} aria-label="Support">
                <option value="">QTL and/or GWAS support</option>
                <option>QTL + GWAS</option><option>QTL only</option><option>GWAS only</option>
              </select>
            </div>
            <DataTable data={rows} columns={computed} filename="cottonqtlome_meta_qtl.csv" />
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-wheat-600">
              Rows extracted from the tables of published cotton meta-analyses: their consensus meta-QTL and, mostly, the
              initial QTL they compiled. Positions are on each study’s consensus genetic map (cM), so these cannot be
              placed on the genome map.
            </p>
            <DataTable data={pub.data} columns={published} filename="cottonqtlome_published_metaqtl.csv" />
          </div>
        )}
      </AsyncBoundary>
    </div>
  )
}
