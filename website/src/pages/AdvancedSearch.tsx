import { useEffect, useMemo, useState } from 'react'
import { ColumnDef } from '@tanstack/react-table'
import { Link, useSearchParams } from 'react-router-dom'
import { Filter, RotateCcw } from 'lucide-react'
import { HeatmapButton } from './GenesPage'
import PageHero from '../components/PageHero'
import DataTable from '../components/DataTable'
import AsyncBoundary from '../components/AsyncBoundary'
import GlossaryHeader from '../components/GlossaryHeader'
import { clip, evidenceColumn, referenceColumn } from '../components/cells'
import { useCSV } from '../lib/useCSV'
import { GWASRecord, QTLRecord } from '../lib/types'
import { CHROMOSOME_LENGTHS, TRAIT_CATEGORIES, TRAIT_GROUPS, normalizeTrait } from '../lib/map'

type Row = GWASRecord & { record_type: 'QTL' | 'GWAS' }

interface Filters {
  q: string
  type: string
  species: string
  trait: string
  parameter: string
  chromosome: string
  startMb: string
  endMb: string
  pveMin: string
  source: string
  databaseOnly: boolean
  hotspotOnly: boolean
  hasCandidateGene: boolean
}

const EMPTY: Filters = {
  q: '', type: '', species: '', trait: '', parameter: '', chromosome: '', startMb: '', endMb: '',
  pveMin: '', source: '', databaseOnly: false, hotspotOnly: false, hasCandidateGene: false,
}

function unique(rows: Row[], key: keyof Row): string[] {
  const set = new Set<string>()
  rows.forEach((r) => {
    const v = String(r[key] ?? '').trim()
    if (v) set.add(v)
  })
  return Array.from(set).sort()
}

const columns: ColumnDef<Row, any>[] = [
  { accessorKey: 'record_type', header: 'Type' },
  { accessorKey: 'id', header: 'ID' },
  { accessorKey: 'species', header: 'Species' },
  { accessorKey: 'trait', header: () => <GlossaryHeader label="Category" term="trait" /> },
  { accessorKey: 'parameter', header: () => <GlossaryHeader label="Trait" term="parameter" />, cell: clip(200) },
  { accessorKey: 'qtl_name', header: 'QTL / locus', cell: clip(200) },
  { accessorKey: 'chromosome', header: () => <GlossaryHeader label="Chr" term="chromosome" /> },
  { accessorKey: 'position_interval', header: () => <GlossaryHeader label="Position / interval" term="position_interval" /> },
  { accessorKey: 'position_unit', header: () => <GlossaryHeader label="Unit" term="position_unit" /> },
  { accessorKey: 'lod', header: () => <GlossaryHeader label="LOD" term="lod" /> },
  { accessorKey: 'neg_log10_p', header: () => <GlossaryHeader label="−log10(P)" term="neg_log10_p" /> },
  { accessorKey: 'pve', header: () => <GlossaryHeader label="PVE %" term="pve" /> },
  { accessorKey: 'associated_markers', header: () => <GlossaryHeader label="Markers" term="associated_markers" />, cell: clip(200) },
  { accessorKey: 'candidate_gene', header: () => <GlossaryHeader label="Cand. gene" term="candidate_gene" />, cell: clip(180) },
  { accessorKey: 'ref_genome', header: () => <GlossaryHeader label="Assembly" term="ref_genome" />, cell: clip(180) },
  { accessorKey: 'hotspot_id', header: () => <GlossaryHeader label="Hotspot" term="hotspot" /> },
  { accessorKey: 'source', header: 'Source' },
  evidenceColumn<Row>(),
  referenceColumn<Row>(),
]

const SEARCH_EXAMPLES: { label: string; hint: string; f: Partial<Filters> }[] = [
  { label: 'A07 fiber hotspot, 86–96 Mb', hint: 'Every QTL and GWAS locus in hotspot CHS007, with its gene heatmap', f: { chromosome: 'A07', startMb: '86', endMb: '96' } },
  { label: 'Fiber length on D11', hint: 'Fiber-length loci on chromosome D11', f: { parameter: 'fiber length', chromosome: 'D11' } },
  { label: 'Hotspot CHS004', hint: 'Records in the D11 fiber hotspot', f: { q: 'CHS004' } },
  { label: 'Loci with a candidate gene, PVE ≥ 10%', hint: 'Large-effect loci whose authors named a candidate gene', f: { hasCandidateGene: true, pveMin: '10' } },
]

export default function AdvancedSearch() {
  const qtl = useCSV<QTLRecord>('qtl.csv')
  const gwas = useCSV<GWASRecord>('gwas.csv')
  const [params, setParams] = useSearchParams()
  const [f, setF] = useState<Filters>(() => ({
    ...EMPTY,
    q: params.get('q') ?? '',
    trait: params.get('trait') ?? '',
    chromosome: params.get('chromosome') ?? '',
    type: params.get('type') ?? '',
  }))

  // Keep the shareable part of the filter state in the URL.
  useEffect(() => {
    const next = new URLSearchParams()
    ;(['q', 'trait', 'chromosome', 'type'] as const).forEach((k) => { if (f[k]) next.set(k, f[k]) })
    setParams(next, { replace: true })
  }, [f.q, f.trait, f.chromosome, f.type, setParams])

  const rows = useMemo<Row[]>(
    () => [
      ...qtl.data.map((r) => ({ ...r, record_type: 'QTL' as const })),
      ...gwas.data.map((r) => ({ ...r, record_type: 'GWAS' as const })),
    ],
    [qtl.data, gwas.data],
  )
  const species = useMemo(() => unique(rows, 'species'), [rows])
  const sources = useMemo(() => unique(rows, 'source'), [rows])
  const parameters = useMemo(() => {
    const cats = f.trait ? (TRAIT_GROUPS[f.trait] ?? [f.trait]) : null
    return unique(rows.filter((r) => (!cats || cats.includes(normalizeTrait(r)))), 'parameter')
  }, [rows, f.trait])

  const filtered = useMemo(() => {
    const q = f.q.trim().toLowerCase()
    const cats = f.trait ? (TRAIT_GROUPS[f.trait] ?? [f.trait]) : null
    const lo = f.startMb ? parseFloat(f.startMb) * 1e6 : null
    const hi = f.endMb ? parseFloat(f.endMb) * 1e6 : null
    const pveMin = f.pveMin ? parseFloat(f.pveMin) : null
    return rows.filter((r) => {
      if (f.type && r.record_type !== f.type) return false
      if (f.species && r.species !== f.species) return false
      if (cats && !cats.includes(normalizeTrait(r))) return false
      if (f.parameter && r.parameter !== f.parameter) return false
      if (f.chromosome && r.chromosome !== f.chromosome) return false
      if (f.source && r.source !== f.source) return false
      if (f.databaseOnly && r.evidence !== 'database') return false
      if (f.hotspotOnly && !r.hotspot_id) return false
      if (f.hasCandidateGene && !r.candidate_gene) return false
      if (pveMin !== null && !(parseFloat(String(r.pve)) >= pveMin)) return false
      if (lo !== null || hi !== null) {
        // physical window on the common axis; records without a projected position cannot match
        const bp = r.map_bp ? parseFloat(r.map_bp) : NaN
        if (!Number.isFinite(bp) || (lo !== null && bp < lo) || (hi !== null && bp > hi)) return false
      }
      if (q) {
        const hay = `${r.id} ${r.qtl_name} ${r.parameter} ${r.trait_original} ${r.associated_markers} ${r.candidate_gene} ${r.reference} ${r.population} ${r.cross ?? ''} ${r.hotspot_id}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, f])

  const regionSet = !!f.chromosome && parseFloat(f.startMb) >= 0 && parseFloat(f.endMb) > parseFloat(f.startMb) && parseFloat(f.endMb) - parseFloat(f.startMb) <= 30
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((p) => ({ ...p, [k]: v, ...(k === 'trait' ? { parameter: '' } : {}) }))

  return (
    <div>
      <PageHero
        eyebrow="Search"
        title="Advanced search"
        subtitle="Filter linkage QTL and GWAS loci together by species, trait, chromosome region, effect size, source and evidence level."
        variant="side"
      />
      <AsyncBoundary loading={qtl.loading || gwas.loading} error={qtl.error ?? gwas.error}>
        <div className="card mb-6">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold text-wheat-900"><Filter className="h-4 w-4" />Filters</div>
            <button className="btn text-xs" onClick={() => setF(EMPTY)}><RotateCcw className="h-3.5 w-3.5" />Reset</button>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <Field label="Keyword">
              <input className="input" value={f.q} onChange={(e) => set('q', e.target.value)} placeholder="QTL name, marker, gene, author…" />
            </Field>
            <Field label="Record type">
              <select className="input" value={f.type} onChange={(e) => set('type', e.target.value)}>
                <option value="">QTL and GWAS</option><option value="QTL">QTL (linkage)</option><option value="GWAS">GWAS loci</option>
              </select>
            </Field>
            <Field label="Species">
              <select className="input" value={f.species} onChange={(e) => set('species', e.target.value)}>
                <option value="">All species</option>
                {species.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Source">
              <select className="input" value={f.source} onChange={(e) => set('source', e.target.value)}>
                <option value="">All sources</option>
                {sources.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Trait category">
              <select className="input" value={f.trait} onChange={(e) => set('trait', e.target.value)}>
                <option value="">All categories</option>
                {Object.keys(TRAIT_GROUPS).map((g) => <option key={g} value={g}>{g} (group)</option>)}
                {TRAIT_CATEGORIES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Harmonised trait">
              <select className="input" value={f.parameter} onChange={(e) => set('parameter', e.target.value)}>
                <option value="">All traits</option>
                {parameters.map((p) => <option key={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Chromosome">
              <select className="input" value={f.chromosome} onChange={(e) => set('chromosome', e.target.value)}>
                <option value="">All chromosomes</option>
                {Object.keys(CHROMOSOME_LENGTHS).map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Region on common axis (Mb)">
              <div className="flex items-center gap-2">
                <input className="input" inputMode="decimal" value={f.startMb} onChange={(e) => set('startMb', e.target.value)} placeholder="from" aria-label="Region start in Mb" />
                <span className="text-wheat-500">–</span>
                <input className="input" inputMode="decimal" value={f.endMb} onChange={(e) => set('endMb', e.target.value)} placeholder="to" aria-label="Region end in Mb" />
              </div>
            </Field>
            <Field label="Minimum PVE (%)">
              <input className="input" inputMode="decimal" value={f.pveMin} onChange={(e) => set('pveMin', e.target.value)} placeholder="e.g. 10" />
            </Field>
            <div className="flex flex-col justify-end gap-1.5 text-sm lg:col-span-3">
              <Check label="Curated database records only (exclude auto-extracted)" checked={f.databaseOnly} onChange={(v) => set('databaseOnly', v)} />
              <Check label="Inside a QTL hotspot" checked={f.hotspotOnly} onChange={(v) => set('hotspotOnly', v)} />
              <Check label="Has a candidate gene" checked={f.hasCandidateGene} onChange={(v) => set('hasCandidateGene', v)} />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-wheat-600">Examples:</span>
            {SEARCH_EXAMPLES.map((x) => (
              <button key={x.label} type="button" title={x.hint} onClick={() => setF({ ...EMPTY, ...x.f })}
                className="rounded-full border border-wheat-300 px-2 py-0.5 text-wheat-800 hover:border-accent hover:text-accent">
                {x.label}
              </button>
            ))}
          </div>
          {regionSet && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded border border-wheat-200 bg-wheat-50/60 p-2 text-sm">
              <span className="text-wheat-700">Genes in {f.chromosome}:{f.startMb}–{f.endMb} Mb:</span>
              <Link className="underline" to={`/genes?r=${encodeURIComponent(`${f.chromosome}:${f.startMb}-${f.endMb}`)}`}>list and narrow by expression</Link>
              <HeatmapButton label="Expression heatmap" id={`adv-${f.chromosome}-${f.startMb}-${f.endMb}`} title={`${f.chromosome}:${f.startMb}–${f.endMb} Mb`}
                chr={f.chromosome} start={parseFloat(f.startMb) * 1e6} end={parseFloat(f.endMb) * 1e6} />
            </div>
          )}
          <p className="mt-3 text-xs text-wheat-500">
            The region filter uses positions projected onto the TM-1 UTX v2.1 axis and is approximate (a few Mb); records
            with only a genetic (cM) position never match it.
          </p>
        </div>
        <DataTable data={filtered} columns={columns} filename="cottonqtlome_search.csv" urlQuery={false} />
      </AsyncBoundary>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-wheat-700">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  )
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2">
      <input type="checkbox" className="h-4 w-4 accent-wheat-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}
