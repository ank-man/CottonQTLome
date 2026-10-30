import Papa from 'papaparse'
import {
  TRAIT_CATEGORIES,
  TraitCategory,
  chromosomeLength,
  parsePositionInterval,
} from './map'

// Everything here runs in the browser: uploaded files are read locally and
// never sent anywhere.

export const MAX_ROWS = 250_000
export const MAX_ITEMS = 50_000

export type SourceFormat = 'Delimited text' | 'Excel' | 'BED' | 'GFF3 / GTF' | 'VCF' | 'JSON'

export interface ParsedTable {
  format: SourceFormat
  fileName: string
  columns: string[]
  rows: Record<string, string>[]
  /** Sheet names when the source is a workbook. */
  sheets?: string[]
  sheet?: string
  notes: string[]
  /** Column mapping the format implies (BED/GFF/VCF); for plain tables this is guessed. */
  mapping: ColumnMapping
  unit: PositionUnit
}

export type PositionUnit = 'bp' | 'kb' | 'Mb'

export interface ColumnMapping {
  chromosome: string
  start: string
  end: string
  name: string
  trait: string
  value: string
}

export const EMPTY_MAPPING: ColumnMapping = { chromosome: '', start: '', end: '', name: '', trait: '', value: '' }

export interface UserItem {
  id: string
  chromosome: string
  start: number
  end: number
  point: number
  isInterval: boolean
  name: string
  /** Trait text as written in the file. */
  traitText: string
  /** Trait category it was matched to (keyword match, or exact category name). */
  trait: TraitCategory
  value: number | null
  raw: Record<string, string>
}

export interface MapResult {
  items: UserItem[]
  skipped: { reason: string; count: number; examples: string[] }[]
  valueLabel: string
  /** Value column held P-values, plotted as -log10(P). */
  valueIsP: boolean
  truncated: boolean
}

// ---------------------------------------------------------------------------
// File reading
// ---------------------------------------------------------------------------

const ext = (name: string) => {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/)
  return m ? m[1] : ''
}

async function gunzip(file: Blob): Promise<string> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot decompress .gz files. Decompress the file first, then upload it.')
  }
  const stream = file.stream().pipeThrough(new DecompressionStream('gzip'))
  return await new Response(stream).text()
}

export async function readFile(file: File, sheet?: string): Promise<ParsedTable> {
  let name = file.name
  let e = ext(name)
  if (e === 'xlsx' || e === 'xls' || e === 'xlsm' || e === 'ods') {
    return parseWorkbook(await file.arrayBuffer(), name, sheet)
  }
  let text: string
  if (e === 'gz') {
    text = await gunzip(file)
    name = name.replace(/\.gz$/i, '')
    e = ext(name)
  } else {
    text = await file.text()
  }
  return parseText(text, name, e)
}

/** Parse text whose format is given by extension, or sniffed when the extension says nothing. */
export function parseText(text: string, fileName: string, extension = ext(fileName)): ParsedTable {
  const e = extension || sniff(text)
  if (e === 'bed' || e === 'bedgraph') return parseBED(text, fileName)
  if (e === 'gff' || e === 'gff3' || e === 'gtf') return parseGFF(text, fileName, e === 'gtf')
  if (e === 'vcf') return parseVCF(text, fileName)
  if (e === 'json') return parseJSON(text, fileName)
  return parseDelimited(text, fileName)
}

function sniff(text: string): string {
  const head = text.slice(0, 4000)
  if (/^##fileformat=VCF/m.test(head)) return 'vcf'
  if (/^##gff-version/m.test(head)) return 'gff3'
  const t = head.trimStart()
  if (t.startsWith('[') || t.startsWith('{')) return 'json'
  return 'txt'
}

function finish(
  format: SourceFormat,
  fileName: string,
  columns: string[],
  rows: Record<string, string>[],
  notes: string[],
  mapping?: Partial<ColumnMapping>,
): ParsedTable {
  if (rows.length > MAX_ROWS) {
    notes.push(`Only the first ${MAX_ROWS.toLocaleString()} of ${rows.length.toLocaleString()} rows were read. Filter large files (for example GWAS summary statistics to P < 1e-3) before uploading.`)
    rows = rows.slice(0, MAX_ROWS)
  }
  const guessed = { ...guessMapping(columns), ...mapping }
  return { format, fileName, columns, rows, notes, mapping: guessed, unit: guessUnit(rows, guessed) }
}

function parseDelimited(text: string, fileName: string): ParsedTable {
  const notes: string[] = []
  // Drop comment/meta lines that some tools put above the header, but keep
  // a "#CHROM"-style header line.
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  let start = 0
  while (start < lines.length && (lines[start].trim() === '' || (/^#/.test(lines[start]) && !/^#\s*(chr|chrom)/i.test(lines[start])))) start++
  const body = lines.slice(start).join('\n')
  const first = lines[start] ?? ''

  // Whitespace-aligned output (PLINK .assoc, GEMMA, many R write.table dumps):
  // no tab, comma or semicolon, but several space-separated fields.
  const spaceAligned = !/[\t,;|]/.test(first) && first.trim().split(/\s+/).length > 1
  let data: string[][]
  if (spaceAligned) {
    data = body.split('\n').filter((l) => l.trim()).map((l) => l.trim().split(/\s+/))
    notes.push('Columns are separated by spaces.')
  } else {
    const parsed = Papa.parse<string[]>(body, { skipEmptyLines: 'greedy', delimiter: '' })
    data = parsed.data
    const d = parsed.meta.delimiter
    notes.push(`Columns are separated by ${d === '\t' ? 'tabs' : d === ',' ? 'commas' : `"${d}"`}.`)
    if (parsed.errors.length) {
      notes.push(`${parsed.errors.length.toLocaleString()} row(s) had a formatting problem (first: row ${(parsed.errors[0].row ?? 0) + 1}, ${parsed.errors[0].message}).`)
    }
  }
  if (data.length === 0) throw new Error('The file is empty.')

  let header = data[0].map((h) => String(h ?? '').replace(/^#\s*/, '').trim())
  let rowsRaw = data.slice(1)
  // A file with no header row: the first row is data if its second field is a number.
  if (header.length >= 2 && /^\d+(\.\d+)?$/.test(header[1])) {
    rowsRaw = data
    header = header.map((_, i) => ['chromosome', 'start', 'end', 'name', 'trait', 'value'][i] ?? `column_${i + 1}`)
    notes.push('No header row found, so columns were read as chromosome, start, end, name, trait, value.')
  }
  const columns = dedupe(header)
  const rows = rowsRaw.map((r) => rowObject(columns, r))
  return finish('Delimited text', fileName, columns, rows, notes)
}

function parseBED(text: string, fileName: string): ParsedTable {
  const cols = ['chrom', 'chromStart', 'chromEnd', 'name', 'score', 'strand']
  const rows: Record<string, string>[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || /^(#|track|browser)/.test(line)) continue
    const f = line.split(/\t|\s+/)
    const start = parseInt(f[1], 10)
    // BED starts are 0-based; the map is 1-based.
    rows.push(rowObject(cols, [f[0], Number.isFinite(start) ? String(start + 1) : f[1], f[2], f[3], f[4], f[5]]))
  }
  return finish('BED', fileName, cols, rows, ['BED starts are 0-based and were shifted by +1.'], {
    chromosome: 'chrom', start: 'chromStart', end: 'chromEnd', name: rows.some((r) => r.name) ? 'name' : '',
    trait: '', value: rows.some((r) => r.score && r.score !== '.') ? 'score' : '',
  })
}

function parseGFF(text: string, fileName: string, gtf: boolean): ParsedTable {
  const cols = ['seqid', 'source', 'type', 'start', 'end', 'score', 'strand', 'name']
  let rows: Record<string, string>[] = []
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('##FASTA')) break
    if (!line.trim() || line.startsWith('#')) continue
    const f = line.split('\t')
    if (f.length < 8) continue
    const attrs = f[8] ?? ''
    const get = (k: string) => {
      const m = gtf ? attrs.match(new RegExp(`${k} "([^"]+)"`)) : attrs.match(new RegExp(`(?:^|;)\\s*${k}=([^;]+)`))
      return m ? decodeURIComponent(m[1]) : ''
    }
    const name = gtf ? get('gene_name') || get('gene_id') : get('Name') || get('ID') || get('gene')
    rows.push(rowObject(cols, [f[0], f[1], f[2], f[3], f[4], f[5], f[6], name]))
  }
  const notes: string[] = []
  // A full annotation has genes, mRNAs, exons, CDS... Draw genes only.
  const types = new Set(rows.map((r) => r.type))
  if (types.size > 1 && types.has('gene')) {
    const n = rows.length
    rows = rows.filter((r) => r.type === 'gene')
    notes.push(`Kept the ${rows.length.toLocaleString()} "gene" features out of ${n.toLocaleString()} (types: ${[...types].slice(0, 6).join(', ')}${types.size > 6 ? '…' : ''}).`)
  }
  return finish('GFF3 / GTF', fileName, cols, rows, notes, {
    chromosome: 'seqid', start: 'start', end: 'end', name: 'name', trait: '',
    value: rows.some((r) => r.score && r.score !== '.') ? 'score' : '',
  })
}

function parseVCF(text: string, fileName: string): ParsedTable {
  const cols = ['CHROM', 'POS', 'ID', 'REF', 'ALT', 'QUAL', 'FILTER', 'INFO']
  const rows: Record<string, string>[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue
    const f = line.split('\t')
    rows.push(rowObject(cols, f.slice(0, 8)))
    if (rows.length > MAX_ROWS) break
  }
  return finish('VCF', fileName, cols, rows, ['Read the eight fixed VCF columns; genotypes are ignored.'], {
    chromosome: 'CHROM', start: 'POS', end: '', name: 'ID', trait: '',
    value: rows.some((r) => r.QUAL && r.QUAL !== '.') ? 'QUAL' : '',
  })
}

function parseJSON(text: string, fileName: string): ParsedTable {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    throw new Error(`Not valid JSON: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (data && !Array.isArray(data) && typeof data === 'object') {
    const arr = Object.values(data as Record<string, unknown>).find(Array.isArray)
    if (arr) data = arr
  }
  if (!Array.isArray(data) || !data.length || typeof data[0] !== 'object') {
    throw new Error('JSON must be an array of objects, e.g. [{"chromosome":"A07","start":1200000,...}], or an object holding one such array.')
  }
  const columns = dedupe([...new Set(data.flatMap((d) => Object.keys(d as object)))])
  const rows = (data as Record<string, unknown>[]).map((d) =>
    Object.fromEntries(columns.map((c) => [c, d[c] == null ? '' : String(d[c])])),
  )
  return finish('JSON', fileName, columns, rows, [])
}

async function parseWorkbook(buf: ArrayBuffer, fileName: string, sheet?: string): Promise<ParsedTable> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(buf, { type: 'array' })
  const sheets = wb.SheetNames
  const pick =
    sheet && sheets.includes(sheet)
      ? sheet
      : sheets.find((s) => (XLSX.utils.sheet_to_json(wb.Sheets[s], { header: 1 }) as unknown[]).length > 1) ?? sheets[0]
  const csv = XLSX.utils.sheet_to_csv(wb.Sheets[pick], { blankrows: false })
  const t = parseDelimited(csv, fileName)
  t.notes = t.notes.filter((n) => !n.startsWith('Columns are separated'))
  if (sheets.length > 1) t.notes.unshift(`Read sheet "${pick}" (${sheets.length} sheets in the workbook).`)
  return { ...t, format: 'Excel', sheets, sheet: pick }
}

function dedupe(names: string[]): string[] {
  const seen = new Map<string, number>()
  return names.map((n, i) => {
    const base = n || `column_${i + 1}`
    const k = seen.get(base) ?? 0
    seen.set(base, k + 1)
    return k ? `${base}_${k + 1}` : base
  })
}

function rowObject(columns: string[], values: unknown[]): Record<string, string> {
  const o: Record<string, string> = {}
  columns.forEach((c, i) => { o[c] = values[i] == null ? '' : String(values[i]).trim() })
  return o
}

// ---------------------------------------------------------------------------
// Column guessing
// ---------------------------------------------------------------------------

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

const CANDIDATES: Record<keyof ColumnMapping, string[]> = {
  chromosome: ['chromosome', 'chrom', 'chr', 'seqid', 'seqname', 'seqnames', 'contig', 'chrname', 'ch', 'chromosomeid'],
  start: ['start', 'chromstart', 'startbp', 'bpstart', 'pos', 'position', 'bp', 'ps', 'physicalposition', 'positionbp', 'begin', 'cistart', 'leftbp', 'startmb', 'positionmb', 'from', 'peak', 'peakbp', 'mapbp'],
  end: ['end', 'chromend', 'endbp', 'bpend', 'stop', 'ciend', 'rightbp', 'endmb', 'to'],
  name: ['name', 'qtlname', 'qtl', 'id', 'locus', 'locusid', 'marker', 'markername', 'snp', 'snpid', 'rs', 'rsid', 'variant', 'variantid', 'gene', 'geneid', 'feature', 'label'],
  trait: ['trait', 'traitname', 'phenotype', 'pheno', 'category', 'traitcategory', 'parameter'],
  value: ['neglog10p', 'log10p', 'logp', 'mlog10p', 'lod', 'p', 'pvalue', 'pval', 'pwald', 'plrt', 'pscore', 'pve', 'r2', 'score', 'effect', 'beta', 'value'],
}

export function guessMapping(columns: string[]): ColumnMapping {
  const used = new Set<string>()
  const pick = (field: keyof ColumnMapping) => {
    const keys = columns.map((c) => [c, key(c)] as const).filter(([c]) => !used.has(c))
    for (const cand of CANDIDATES[field]) {
      const hit = keys.find(([, k]) => k === cand)
      if (hit) { used.add(hit[0]); return hit[0] }
    }
    // Partial match, but only on longer candidates so "p" doesn't grab "position".
    for (const cand of CANDIDATES[field].filter((c) => c.length >= 4)) {
      const hit = keys.find(([, k]) => k.includes(cand))
      if (hit) { used.add(hit[0]); return hit[0] }
    }
    return ''
  }
  const chromosome = pick('chromosome')
  const start = pick('start')
  const end = pick('end')
  const value = pick('value')
  const trait = pick('trait')
  const name = pick('name')
  return { chromosome, start, end, name, trait, value }
}

function num(s: string | undefined): number {
  if (s == null) return NaN
  const v = s.replace(/,/g, '').replace(/−/g, '-').trim()
  return v === '' ? NaN : Number(v)
}

/** bp unless every position is small enough that it can only be Mb (cotton chromosomes are < 130 Mb). */
export function guessUnit(rows: Record<string, string>[], m: ColumnMapping): PositionUnit {
  if (!m.start) return 'bp'
  const col = m.start.toLowerCase()
  if (/mb$|_mb|\(mb\)/.test(col)) return 'Mb'
  if (/kb$|_kb|\(kb\)/.test(col)) return 'kb'
  let max = 0
  for (const r of rows.slice(0, 5000)) {
    const p = parsePositionInterval(r[m.start])
    const v = p.end ?? p.point ?? NaN
    if (Number.isFinite(v) && v > max) max = v
  }
  return max > 0 && max <= 140 ? 'Mb' : 'bp'
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Chromosome names in cotton files come in many spellings: A07, Ghir_A07,
 * Gh_A07, chrA07, At07, A7, and the classical numbered c1-c26 / Chr01-Chr26.
 * Numbers follow the classical cytogenetic order used across this database
 * (scripts/harmonize.py): 1-13 = A01-A13, but the Dt chromosomes are numbered
 * by homoeology, so 14 = D02, 15 = D01, 16 = D07 ... Returns A01-D13, or null.
 */
const CHR_NUM_TO_SUB: Record<number, string> = {
  14: 'D02', 15: 'D01', 16: 'D07', 17: 'D03', 18: 'D13', 19: 'D05', 20: 'D10',
  21: 'D11', 22: 'D04', 23: 'D09', 24: 'D08', 25: 'D06', 26: 'D12',
}

export function normalizeUserChromosome(input: string): string | null {
  let s = (input || '').toUpperCase().replace(/\s+/g, '')
  if (!s) return null
  s = s.replace(/^(GOSSYPIUM_?HIRSUTUM_?|GHIR_?|GH_?|GBAR_?|GB_?|TM1_?|HAU_?)/, '')
  s = s.replace(/^(CHROMOSOME|CHROM|CHR|CH)[_-]?/, '')
  let m = s.match(/^([AD])T?[_-]?0?(\d{1,2})$/)
  if (m) {
    const n = parseInt(m[2], 10)
    return n >= 1 && n <= 13 ? `${m[1]}${String(n).padStart(2, '0')}` : null
  }
  m = s.match(/^0?(\d{1,2})$/)
  if (m) {
    const n = parseInt(m[1], 10)
    if (n >= 1 && n <= 13) return `A${String(n).padStart(2, '0')}`
    if (n >= 14 && n <= 26) return CHR_NUM_TO_SUB[n]
  }
  return null
}

// Keyword rules, checked in order, so "fiber maturity" lands in Fiber quality
// before "maturity" can claim it for Phenology.
const TRAIT_RULES: [TraitCategory, RegExp][] = [
  ['Fiber quality', /fib(er|re)|micronaire|\bmic\b|elongation|uniformity|uhml|\b(fl|fs|fm|fe|fu|ui|sfc)\b|staple|fineness/i],
  ['Abiotic stress', /drought|salt|salin|heat|cold|chill|temperature|water|osmotic|alkali|nacl|flood/i],
  ['Biotic stress', /verticillium|fusarium|wilt|disease|resist|nematode|aphid|whitefly|insect|pest|virus|clcuv|blight|bollworm|jassid|mite/i],
  ['Fertility', /fertil|steril|pollen|restor|\bcms\b|anther/i],
  ['Yield', /yield|lint|boll|seed ?cotton|\b(lp|bw|bn|scy|ly|li|gt|go)\b|seed index|\bsi\b|lint index|ginning/i],
  ['Seed quality', /\boil\b|protein|gossypol|fatty|seed (quality|weight|size|oil)|kernel/i],
  ['Phenology', /flower|maturity|earl(y|iness)|days to|budding|squaring|heading|\bft\b/i],
  ['Plant architecture', /height|branch|node|internode|angle|architecture|canopy|\bph\b|\bfbn\b|\bfbl\b|plant type|compact/i],
  ['Growth and vigor', /biomass|vigou?r|germinat|seedling|emergence|root|growth|fresh weight|dry weight/i],
  ['Physiology', /chlorophyll|photosynth|stomat|spad|nitrogen|transpiration|leaf area|ndvi|physiolog|enzyme|hormone/i],
  ['Morphology', /leaf|petal|colou?r|glabr|trichome|hair|pubesc|okra|shape|morpholog|nectar|bract|gland/i],
  ['Abiotic stress', /stress|toleran/i],
]

export function classifyTrait(text: string): TraitCategory {
  const t = (text || '').trim()
  if (!t) return 'Unclassified'
  const exact = TRAIT_CATEGORIES.find((c) => c.toLowerCase() === t.toLowerCase())
  if (exact) return exact
  for (const [cat, re] of TRAIT_RULES) if (re.test(t)) return cat
  return 'Unclassified'
}

const UNIT_FACTOR: Record<PositionUnit, number> = { bp: 1, kb: 1e3, Mb: 1e6 }

/** Turn parsed rows into map items, collecting every reason a row was left out. */
export function mapRows(
  table: ParsedTable,
  m: ColumnMapping,
  unit: PositionUnit,
  minValue: number | null,
  /** Chromosome lengths of the assembly the positions are on (defaults to the current map axis). */
  lengths?: Record<string, number>,
): MapResult {
  const skipped = new Map<string, { count: number; examples: string[] }>()
  const skip = (reason: string, example: string) => {
    const s = skipped.get(reason) ?? { count: 0, examples: [] }
    s.count++
    if (s.examples.length < 3 && example && !s.examples.includes(example)) s.examples.push(example)
    skipped.set(reason, s)
  }

  // A value column holding only numbers in [0, 1] whose name says P is a
  // P-value: plot -log10(P) so stronger hits get longer marks.
  let valueIsP = false
  if (m.value) {
    const k = key(m.value)
    const looksP = /^p$|pval|pwald|plrt|pscore|^p[a-z]*value/.test(k) && !/log/.test(k)
    if (looksP) {
      valueIsP = table.rows.slice(0, 2000).every((r) => {
        const v = num(r[m.value])
        return !Number.isFinite(v) || (v >= 0 && v <= 1)
      })
    }
  }
  const valueLabel = m.value ? (valueIsP ? `−log10(${m.value})` : m.value) : ''

  const f = UNIT_FACTOR[unit]
  const items: UserItem[] = []
  let truncated = false
  table.rows.forEach((r, i) => {
    const chrRaw = r[m.chromosome] ?? ''
    const chr = normalizeUserChromosome(chrRaw)
    if (!chr) return skip('Chromosome not recognised as A01–D13', chrRaw || '(empty)')

    const p = parsePositionInterval(r[m.start] ?? '')
    let start = p.start ?? p.point
    let end = m.end ? num(r[m.end]) : NaN
    if (!Number.isFinite(end)) end = p.end ?? start ?? NaN
    if (start == null || !Number.isFinite(start)) return skip('No readable position', r[m.start] || '(empty)')
    start *= f
    end *= f
    if (end < start) [start, end] = [end, start]
    const len = lengths?.[chr] ?? chromosomeLength(chr)
    if (start > len * 1.02) return skip(`Position beyond the end of the chromosome (check the unit; now ${unit})`, `${chr}:${r[m.start]}`)
    start = Math.max(0, Math.min(start, len))
    end = Math.max(0, Math.min(end, len))

    let value: number | null = null
    if (m.value) {
      const v = num(r[m.value])
      if (Number.isFinite(v)) value = valueIsP ? (v > 0 ? -Math.log10(v) : 300) : v
    }
    if (minValue != null && (value == null || value < minValue)) return skip('Below the value threshold', '')

    if (items.length >= MAX_ITEMS) { truncated = true; return }
    const traitText = m.trait ? r[m.trait] ?? '' : ''
    const isInterval = end - start > 1
    items.push({
      id: `U${i}`,
      chromosome: chr,
      start,
      end,
      point: isInterval ? (start + end) / 2 : start,
      isInterval,
      name: (m.name && r[m.name]) || `${chr}:${Math.round(start).toLocaleString()}`,
      traitText,
      trait: classifyTrait(traitText),
      value,
      raw: r,
    })
  })

  return {
    items,
    skipped: [...skipped.entries()].map(([reason, s]) => ({ reason, ...s })).sort((a, b) => b.count - a.count),
    valueLabel,
    valueIsP,
    truncated,
  }
}

// ---------------------------------------------------------------------------
// Overlap with the database
// ---------------------------------------------------------------------------

export interface Region { id: string; chromosome: string; start: number; end: number; label: string; category: string }

export interface OverlapRow {
  item: UserItem
  regions: Region[]
  hotspots: Region[]
  nearbyLoci: number
}

/** For each user locus: meta-QTL and hotspots it overlaps (± flank) and database loci within the flank. */
export function overlapWithDatabase(
  items: UserItem[],
  mqtl: Region[],
  hotspots: Region[],
  lociByChr: Map<string, number[]>,
  flankBp: number,
  sameCategory = false,
): OverlapRow[] {
  const byChr = (rs: Region[]) => {
    const g = new Map<string, Region[]>()
    rs.forEach((r) => {
      const a = g.get(r.chromosome)
      if (a) a.push(r)
      else g.set(r.chromosome, [r])
    })
    return g
  }
  const mq = byChr(mqtl)
  const hs = byChr(hotspots)
  // Trait matching is skipped for rows without a trait: there is nothing to match on.
  const hits = (g: Map<string, Region[]>, it: UserItem) =>
    (g.get(it.chromosome) ?? []).filter(
      (r) =>
        r.start <= it.end + flankBp &&
        r.end >= it.start - flankBp &&
        (!sameCategory || !it.traitText || r.category.toLowerCase() === it.trait.toLowerCase()),
    )
  return items.map((it) => {
    const pos = lociByChr.get(it.chromosome) ?? []
    const lo = lowerBound(pos, it.start - flankBp)
    const hi = lowerBound(pos, it.end + flankBp + 1)
    return { item: it, regions: hits(mq, it), hotspots: hits(hs, it), nearbyLoci: hi - lo }
  })
}

function lowerBound(a: number[], x: number) {
  let lo = 0
  let hi = a.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (a[mid] < x) lo = mid + 1
    else hi = mid
  }
  return lo
}

// ---------------------------------------------------------------------------
// Session store: keeps the uploaded set while the visitor moves between pages.
// ---------------------------------------------------------------------------

export interface UserDataset {
  table: ParsedTable
  mapping: ColumnMapping
  unit: PositionUnit
  minValue: number | null
}

let current: UserDataset | null = null
export const getUserDataset = () => current
export const setUserDataset = (d: UserDataset | null) => { current = d }

// Demo files shipped in public/data/demo/. All are synthetic.
export const DEMO_FILES: { file: string; label: string; format: string; description: string }[] = [
  { file: 'demo_qtl_intervals.csv', label: 'QTL intervals', format: 'CSV', description: 'Linkage QTL with start/end (bp), trait and LOD' },
  { file: 'demo_gwas_summary.tsv', label: 'GWAS hits', format: 'TSV', description: 'Lead SNPs, numbered Chr01–Chr26 (classical order), BP and P' },
  { file: 'demo_loci.xlsx', label: 'Excel workbook', format: 'XLSX', description: 'Two sheets: QTL (positions in Mb) and candidate genes' },
  { file: 'demo_regions.bed', label: 'BED regions', format: 'BED', description: 'Fine-mapped regions, 0-based starts' },
  { file: 'demo_genes.gff3', label: 'Candidate genes', format: 'GFF3', description: 'Gene features with ID/Name attributes' },
  { file: 'demo_variants.vcf', label: 'Variants', format: 'VCF', description: 'Sites-only VCF with QUAL' },
  { file: 'demo_loci.json', label: 'JSON records', format: 'JSON', description: 'Array of {chromosome, position, trait, ...}' },
  { file: 'template_loci.csv', label: 'Blank template', format: 'CSV', description: 'Header row and two example rows to fill in' },
]

// ---------------------------------------------------------------------------
// Drawing helpers shared by the ideogram and circos views
// ---------------------------------------------------------------------------

export type UserColorMode = 'trait' | 'single'

/** Filled with `currentColor` in single mode, so it follows the plot's light/dark toggle. */
export const USER_SINGLE_CLASS = 'text-[#1f2937] dark:text-[#f8fafc]'

/** Trait highlight and search apply to uploaded loci too, except that rows with no trait are never hidden by a trait filter. */
export function filterUserItems(items: UserItem[], selectedTraits: string[], search: string): UserItem[] {
  const q = search.trim().toLowerCase()
  return items.filter((i) => {
    if (selectedTraits.length && i.traitText && !selectedTraits.includes(i.trait)) return false
    if (q && !`${i.name} ${i.traitText} ${i.trait}`.toLowerCase().includes(q)) return false
    return true
  })
}

/** 0-1 scale for mark length; every mark is full length when there is no value column. */
export function valueScaler(items: UserItem[]): (i: UserItem) => number {
  let max = 0
  items.forEach((i) => { if (i.value != null && i.value > max) max = i.value })
  if (max <= 0) return () => 1
  return (i) => (i.value == null || i.value <= 0 ? 0.15 : Math.max(0.15, i.value / max))
}
