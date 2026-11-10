import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ColumnDef } from '@tanstack/react-table'
import PageHero from '../components/PageHero'
import DataTable from '../components/DataTable'
import AsyncBoundary from '../components/AsyncBoundary'
import GlossaryHeader from '../components/GlossaryHeader'
import ExprCount from '../components/ExprCount'
import { clip, evidenceColumn, referenceColumn } from '../components/cells'
import { useCSV } from '../lib/useCSV'
import { MetaQTLRecord, MQTLRecord, MQTLcmRecord, TraitCoverageRecord } from '../lib/types'
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
    id: 'genes', header: () => <span title="Genes in the 95% CI · fibre-preferential genes (FP); click to list them">Genes · FP</span>, enableSorting: false,
    cell: ({ row }) => <ExprCount id={row.original.mqtl_id} region={`${row.original.chromosome}:${row.original.ci_start_mb}-${row.original.ci_end_mb}`} />,
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

const numc = (key: keyof MQTLcmRecord) => (r: MQTLcmRecord) => Number(r[key])

const classic: ColumnDef<MQTLcmRecord, any>[] = [
  { accessorKey: 'mqtl_id', header: 'Meta-QTL' },
  { accessorKey: 'trait', header: () => <GlossaryHeader label="Trait" term="parameter" />, cell: clip(200) },
  { accessorKey: 'category', header: () => <GlossaryHeader label="Category" term="trait" /> },
  { accessorKey: 'chromosome', header: () => <GlossaryHeader label="Chr" term="chromosome" /> },
  { id: 'position_cm', header: 'Position (cM)', accessorFn: numc('position_cm') },
  { id: 'ci', header: '95% CI (cM)', accessorFn: (r) => `${r.ci_start_cm}–${r.ci_end_cm}`, enableSorting: false },
  { id: 'n_studies', header: () => <GlossaryHeader label="Studies" term="n_studies" />, accessorFn: numc('n_studies') },
  { accessorKey: 'confidence', header: () => <GlossaryHeader label="Confidence" term="confidence" /> },
  { id: 'n_initial_qtl', header: 'Initial QTL', accessorFn: numc('n_initial_qtl') },
  { accessorKey: 'left_marker', header: 'Left flanking marker' },
  { accessorKey: 'right_marker', header: 'Right flanking marker' },
  {
    id: 'physical', header: 'Physical (Mb, members)', enableSorting: false,
    accessorFn: (r) => (r.physical_q1_mb ? `${r.physical_q1_mb}–${r.physical_q3_mb}` : ''),
  },
  { accessorKey: 'physical_mqtl', header: 'Matching physical meta-QTL', cell: clip(220) },
  { accessorKey: 'studies', header: 'Studies (PMID / dataset)', cell: clip(260) },
]

const coverageCols: ColumnDef<TraitCoverageRecord, any>[] = [
  { accessorKey: 'trait', header: () => <GlossaryHeader label="Trait" term="parameter" />, cell: clip(220) },
  { accessorKey: 'category', header: () => <GlossaryHeader label="Category" term="trait" /> },
  { id: 'n_database_records', header: 'Records', accessorFn: (r) => Number(r.n_database_records) },
  { id: 'n_database_qtl', header: 'Linkage QTL', accessorFn: (r) => Number(r.n_database_qtl) },
  { id: 'n_database_gwas', header: 'GWAS', accessorFn: (r) => Number(r.n_database_gwas) },
  { id: 'n_physical_meta_qtl', header: 'Physical meta-QTL', accessorFn: (r) => Number(r.n_physical_meta_qtl) },
  { accessorKey: 'status_physical', header: 'Physical analysis', cell: clip(220) },
  { id: 'n_cm_meta_qtl', header: 'Genetic-map meta-QTL', accessorFn: (r) => Number(r.n_cm_meta_qtl) },
  { accessorKey: 'status_cm', header: 'Genetic-map analysis', cell: clip(240) },
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
  const mc = useCSV<MQTLcmRecord>('mqtl_cm.csv')
  const cov = useCSV<TraitCoverageRecord>('mqtl_trait_coverage.csv')
  const [tab, setTab] = useState<'computed' | 'classic' | 'traits' | 'published'>('computed')
  const [cmConf, setCmConf] = useState('')
  const [traitQ, setTraitQ] = useState('')
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
  const cmRows = useMemo(
    () => mc.data.filter((m) =>
      (cmConf === '' || (cmConf === 'high' ? m.confidence === 'high' : m.confidence !== 'low')) &&
      (!cat || m.category === cat) && (!chr || m.chromosome === chr)),
    [mc.data, cmConf, cat, chr],
  )
  const covRows = useMemo(
    () => cov.data.filter((t) => (!traitQ || t.trait.toLowerCase().includes(traitQ.toLowerCase())) && (!cat || t.category === cat)),
    [cov.data, traitQ, cat],
  )
  const cmMatched = mc.data.filter((m) => m.physical_mqtl).length
  const cmWithPhys = mc.data.filter((m) => m.physical_q1_mb).length

  return (
    <div>
      <PageHero
        eyebrow="Data"
        title="Meta-QTL"
        subtitle="Consensus loci for each trait, computed from all QTL and GWAS loci in this database that have a physical position, and supported by at least two independent studies."
        variant="side"
      />
      <AsyncBoundary loading={mq.loading || pub.loading || mc.loading || cov.loading} error={mq.error ?? pub.error ?? mc.error ?? cov.error}>
        <div className="mb-4 inline-flex rounded border border-wheat-200 bg-wheat-100 p-1">
          {([['computed', `Physical meta-QTL (${mq.data.length.toLocaleString()})`], ['classic', `Genetic-map meta-QTL (${mc.data.length.toLocaleString()})`], ['traits', `All traits (${cov.data.length.toLocaleString()})`], ['published', `From published meta-analyses (${pub.data.length.toLocaleString()})`]] as const).map(([k, label]) => (
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
        ) : tab === 'classic' ? (
          <div className="space-y-4">
            <div className="card text-sm leading-relaxed text-wheat-700">
              <p>
                <span className="font-semibold text-wheat-900">{mc.data.length.toLocaleString()}</span> meta-QTL for{' '}
                {new Set(mc.data.map((m) => m.trait)).size} traits, computed the classic way (as in BioMercator and Cotton
                QTLdb) on a consensus genetic map. The map was built around the AD genome-wide reference map (2009) by
                projecting CottonGen and published maps through their shared markers; linkage QTL were projected from their
                own map, or placed by their flanking markers. Each trait was analysed separately on every chromosome, with one
                observation per study and locus; the number of meta-QTL was chosen by BIC.
              </p>
              <p className="mt-2">
                {cmMatched.toLocaleString()} of the {cmWithPhys.toLocaleString()} genetic-map meta-QTL whose member QTL have
                physical positions overlap a physical meta-QTL of the same trait. Only QTL on maps that share markers with the
                consensus can be included; QTL on maps with private SNP names are covered by the physical analysis.{' '}
                <a className="underline" href={`${import.meta.env.BASE_URL}data/consensus_map.csv`} download="cottonqtlome_consensus_map.csv">
                  Download the consensus map
                </a>.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select className="input w-auto" value={cmConf} onChange={(e) => setCmConf(e.target.value)} aria-label="Confidence">
                <option value="">All (≥ 2 studies)</option>
                <option value="moderate">High + moderate (≥ 3 studies)</option>
                <option value="high">High confidence (≥ 5 studies)</option>
              </select>
              <select className="input w-auto" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Trait category">
                <option value="">All categories</option>
                {TRAIT_CATEGORIES.map((t) => <option key={t}>{t}</option>)}
              </select>
              <select className="input w-auto" value={chr} onChange={(e) => setChr(e.target.value)} aria-label="Chromosome">
                <option value="">All chromosomes</option>
                {Object.keys(CHROMOSOME_LENGTHS).map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <DataTable data={cmRows} columns={classic} filename="cottonqtlome_meta_qtl_genetic_map.csv" />
          </div>
        ) : tab === 'traits' ? (
          <div className="space-y-4">
            <p className="text-sm text-wheat-600">
              Every trait in the database, with its records and what each meta-analysis found. Traits without meta-QTL
              are listed with the reason (no mapped loci, no replication across studies, or a trait name that needs review).
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <input className="input w-64" placeholder="Search traits" value={traitQ} onChange={(e) => setTraitQ(e.target.value)} aria-label="Search traits" />
              <select className="input w-auto" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Trait category">
                <option value="">All categories</option>
                {TRAIT_CATEGORIES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <DataTable data={covRows} columns={coverageCols} filename="cottonqtlome_trait_coverage.csv" />
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
