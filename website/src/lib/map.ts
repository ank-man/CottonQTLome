import { QTLRecord, MetaQTLRecord, EpistaticRecord, HotspotRecord, MQTLRecord } from './types'

// Trait categories assigned upstream by scripts/harmonize.py and shipped in
// the `trait` column of every data file, so the site never re-derives them.
export const TRAIT_CATEGORIES = [
  'Fiber quality',
  'Yield',
  'Plant architecture',
  'Phenology',
  'Biotic stress',
  'Abiotic stress',
  'Seed quality',
  'Morphology',
  'Physiology',
  'Growth and vigor',
  'Fertility',
  'Unclassified',
] as const

export type TraitCategory = (typeof TRAIT_CATEGORIES)[number]

// Umbrella groupings recognised by the Search page's trait filter.
export const TRAIT_GROUPS: Record<string, TraitCategory[]> = {
  'Stress tolerance': ['Biotic stress', 'Abiotic stress'],
  'Fiber and yield': ['Fiber quality', 'Yield'],
}

// Eight categorical hues (a validated colour-blind-safe order) carry the
// eight categories users filter on most; the four small residual categories
// take neutral tones. Every use is paired with a text label, so identity
// never depends on colour alone.
export const TRAIT_COLORS: Record<TraitCategory, string> = {
  'Fiber quality': '#2a78d6',
  Yield: '#eb6834',
  'Plant architecture': '#1baf7a',
  Phenology: '#eda100',
  'Biotic stress': '#e87ba4',
  'Abiotic stress': '#008300',
  'Seed quality': '#6250d6',
  Morphology: '#e34948',
  Physiology: '#57575f',
  'Growth and vigor': '#8a8a93',
  Fertility: '#b3b3ba',
  Unclassified: '#6b7280',
}

// Centromere positions are not drawn: no assembly-wide, experimentally
// defined centromere coordinates are bundled with this database, and an
// approximate "pinch" would imply precision the data does not have.
export function centromerePosition(_chromosome: string): number | null {
  return null
}

// Gossypium hirsutum TM-1 UTX v2.1 chromosome lengths in bp
// (NCBI GCF_007990345.1, Chen et al. 2020 Nat Genet). This assembly is the
// common display axis: physical positions reported on other assemblies are
// projected onto it by relative position (see analysis/hotspot_analysis.py).
export const CHROMOSOME_LENGTHS: Record<string, number> = {
  A01: 119761559,
  A02: 108141443,
  A03: 113693209,
  A04: 89180822,
  A05: 111098753,
  A06: 128195338,
  A07: 98902531,
  A08: 127495948,
  A09: 85335976,
  A10: 118182687,
  A11: 124181751,
  A12: 109474314,
  A13: 111646624,
  D01: 65205008,
  D02: 72186496,
  D03: 54956272,
  D04: 58229188,
  D05: 66484719,
  D06: 66684206,
  D07: 59440927,
  D08: 69427147,
  D09: 54445796,
  D10: 68089194,
  D11: 72823778,
  D12: 63255146,
  D13: 65099798,
}

// The display axis can be switched to another assembly (Map page). Lengths are
// swapped in place so every component reading CHROMOSOME_LENGTHS follows;
// components drawing them are remounted with the assembly as their key.
const HUB_LENGTHS = { ...CHROMOSOME_LENGTHS }
export function setChromosomeLengths(lengths?: Record<string, number>) {
  Object.keys(CHROMOSOME_LENGTHS).forEach((k) => delete CHROMOSOME_LENGTHS[k])
  Object.assign(CHROMOSOME_LENGTHS, lengths ?? HUB_LENGTHS)
}

export function chromosomeLength(chromosome: string): number {
  return CHROMOSOME_LENGTHS[chromosome] ?? 100000000
}

// Allotetraploid cotton carries two subgenomes: At (from an A-genome diploid
// like G. arboreum) and Dt (from a D-genome diploid like G. raimondii).
// `currentColor` + a Tailwind text-* class keeps this responsive to the
// plot's light/dark toggle without JS.
// Neutral tones on purpose: the trait categories own the saturated hues, so a
// blue or orange chromosome would read as "fiber quality" or "yield".
export const GENOME_COLOR_CLASS: Record<string, string> = {
  A: 'text-[#64748b] dark:text-[#94a3b8]',
  D: 'text-[#b08968] dark:text-[#8a6a4f]',
}

export const SUBGENOMES = ['A', 'D'] as const
export type Subgenome = (typeof SUBGENOMES)[number]

export function genomeOf(chromosome: string): string {
  return chromosome.slice(0, 1)
}

export function normalizeChromosome(chromosome: string): string | null {
  const raw = (chromosome || '').toUpperCase().trim()
  return /^[AD](0[1-9]|1[0-3])$/.test(raw) ? raw : null
}

export function normalizeSpecies(s: string): string {
  return s.trim()
}

export function chromosomeSortKey(chromosome: string): number {
  const m = chromosome.match(/^([AD])(\d\d)$/)
  if (!m) return 999
  return (m[1] === 'A' ? 0 : 100) + parseInt(m[2], 10)
}

export interface ParsedPosition {
  point: number | null
  start: number | null
  end: number | null
}

export function parsePositionInterval(value: string): ParsedPosition {
  const v = (value || '').replace(/−/g, '-').replace(/,/g, '').trim()
  if (!v || v === '-' || v === 'NA' || v === 'N/A') {
    return { point: null, start: null, end: null }
  }

  // 46.8(43.5-50.1): the "(" must be present, otherwise a bare range would
  // also match by backtracking and corrupt its start.
  const paren = v.match(/^(-?\d+(?:\.\d+)?)\s*\(\s*(-?\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*\)$/)
  if (paren) {
    const start = parseFloat(paren[2])
    const end = parseFloat(paren[3])
    return { point: parseFloat(paren[1]), start: Math.min(start, end), end: Math.max(start, end) }
  }

  const range = v.match(/^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$/)
  if (range) {
    const start = parseFloat(range[1])
    const end = parseFloat(range[2])
    return { point: (start + end) / 2, start: Math.min(start, end), end: Math.max(start, end) }
  }

  const single = v.match(/^(\d+(?:\.\d+)?)$/)
  if (single) {
    const point = parseFloat(single[1])
    return { point, start: point, end: point }
  }

  return { point: null, start: null, end: null }
}

export function normalizeTrait(record: { trait?: string }): TraitCategory {
  const t = (record.trait || '').trim() as TraitCategory
  // every exported record carries a named category; the fallback only guards against a malformed row
  return (TRAIT_CATEGORIES as readonly string[]).includes(t) ? t : 'Physiology'
}

// No category needs a further split in the cotton data (the harmonised trait
// in `parameter` already is the finer level).
export const TRAIT_SUBCATEGORIES: Partial<Record<TraitCategory, string[]>> = {}

export function normalizeSubTrait(_record: { trait?: string }): string | null {
  return null
}

/** Distinct locus key - several records of one locus cluster count once. */
export function locusKey(r: QTLRecord): string {
  return r.locus_id || r.id
}

export interface QTLItem {
  id: string
  type: 'qtl'
  chromosome: string
  point: number
  trait: TraitCategory
  name: string
  raw: QTLRecord
}

// The interval track of the map: meta-QTL computed by CottonQTLome on the
// common physical axis (bar = 95% confidence interval) or, alternatively, the
// study-supported hotspot regions. Published cotton meta-QTL sit on consensus
// genetic maps (cM) and cannot be drawn here.
export interface MetaQTLItem {
  id: string
  type: 'metaqtl'
  chromosome: string
  point: number
  start: number
  end: number
  trait: TraitCategory
  name: string
  raw: MetaQTLRecord
}

export type MapItem = QTLItem | MetaQTLItem

export function isPhysicalPosition(pos: ParsedPosition): boolean {
  return [pos.point, pos.start, pos.end].some((v) => v !== null && v >= 1000)
}

/** Records are placed with `map_bp`, the position projected onto the common
 *  TM-1 UTX v2.1 axis; records without one (cM-only, diploid species,
 *  unplaced) are not drawn. */
export function prepareItems(loci: QTLRecord[], hotspots: HotspotRecord[], mqtl: MQTLRecord[] = []): MapItem[] {
  const items: MapItem[] = []

  loci.forEach((r) => {
    const chr = normalizeChromosome(r.map_chr || r.chromosome)
    const bp = r.map_bp ? parseFloat(r.map_bp) : NaN
    if (!chr || !Number.isFinite(bp)) return
    items.push({
      id: r.id,
      type: 'qtl',
      chromosome: chr,
      point: Math.min(bp, chromosomeLength(chr)),
      trait: normalizeTrait(r),
      name: r.qtl_name || r.associated_markers || r.id,
      raw: r,
    })
  })

  hotspots.forEach((h) => {
    const chr = normalizeChromosome(h.chromosome)
    if (!chr) return
    const start = parseFloat(h.start)
    const end = parseFloat(h.end)
    items.push({
      id: h.hotspot_id,
      type: 'metaqtl',
      chromosome: chr,
      point: (start + end) / 2,
      start,
      end,
      trait: normalizeTrait({ trait: capitalise(h.dominant_category) }),
      name: h.hotspot_id,
      raw: {
        id: h.hotspot_id,
        species: h.species,
        trait: capitalise(h.dominant_category),
        parameter: h.top_traits,
        mqtl_name: h.hotspot_id,
        chromosome: chr,
        position_interval: `${h.start}-${h.end}`,
        pve: '',
        candidate_gene: h.recurrent_candidate_genes,
      },
    })
  })

  mqtl.forEach((m) => {
    const chr = normalizeChromosome(m.chromosome)
    if (!chr) return
    const len = chromosomeLength(chr)
    const start = Math.min(parseFloat(m.ci_start_mb) * 1e6, len)
    const end = Math.min(parseFloat(m.ci_end_mb) * 1e6, len)
    items.push({
      id: m.mqtl_id,
      type: 'metaqtl',
      chromosome: chr,
      point: Math.min(parseFloat(m.position_mb) * 1e6, len),
      start,
      end,
      trait: normalizeTrait({ trait: m.category }),
      name: m.mqtl_id,
      raw: {
        id: m.mqtl_id,
        species: m.species,
        trait: m.category,
        parameter: `${m.trait} · ${m.n_studies} studies`,
        mqtl_name: m.mqtl_id,
        chromosome: chr,
        position_interval: `${m.ci_start_mb}-${m.ci_end_mb} Mb`,
        pve: m.mean_pve,
        candidate_gene: m.recurrent_candidate_genes,
      },
    })
  })

  return items
}

export function capitalise(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

export interface EpistaticLink {
  id: string
  chromosome1: string
  point1: number
  chromosome2: string
  point2: number
  trait: TraitCategory
  name: string
  raw: EpistaticRecord
}

/** Epistatic pairs as chords. A pair with bp positions for both loci is drawn
 *  at those positions. With `includeChromosomeLevel`, pairs known only to the
 *  chromosome are drawn between chromosome midpoints (flagged `approximate`). */
export function prepareEpistaticLinks(epistatic: EpistaticRecord[], includeChromosomeLevel = false): EpistaticLink[] {
  const links: EpistaticLink[] = []
  epistatic.forEach((r) => {
    const chr1 = normalizeChromosome(r.chromosome)
    const chr2 = normalizeChromosome(r.chromosome2 || '')
    if (!chr1 || !chr2) return
    const p1 = r.pos1_bp ? parseFloat(r.pos1_bp) : NaN
    const p2 = r.pos2_bp ? parseFloat(r.pos2_bp) : NaN
    const physical = Number.isFinite(p1) && Number.isFinite(p2)
    if (!physical && !includeChromosomeLevel) return
    links.push({
      id: r.id,
      chromosome1: chr1,
      point1: physical ? Math.min(p1, chromosomeLength(chr1)) : chromosomeLength(chr1) / 2,
      chromosome2: chr2,
      point2: physical ? Math.min(p2, chromosomeLength(chr2)) : chromosomeLength(chr2) / 2,
      trait: normalizeTrait(r),
      name: `${r.parameter || r.trait}: ${chr1} × ${chr2}${physical ? '' : ' (chromosome level)'}`,
      raw: r,
    })
  })
  return links
}

export function chromosomeRanges(items: MapItem[]): Map<string, { min: number; max: number }> {
  const ranges = new Map<string, { min: number; max: number }>()
  items.forEach((item) => {
    const lo = item.type === 'metaqtl' ? item.start : item.point
    const hi = item.type === 'metaqtl' ? item.end : item.point
    const r = ranges.get(item.chromosome)
    if (!r) ranges.set(item.chromosome, { min: lo, max: hi })
    else {
      r.min = Math.min(r.min, lo)
      r.max = Math.max(r.max, hi)
    }
  })
  return ranges
}

export function sortedChromosomes(items: MapItem[]): string[] {
  return Array.from(chromosomeRanges(items).keys()).sort((a, b) => chromosomeSortKey(a) - chromosomeSortKey(b))
}

/** Reference link for a record: `doi` already holds a full URL (DOI or PubMed). */
export function referenceUrl(r: { doi?: string }): string | null {
  if (!r.doi) return null
  return r.doi.startsWith('http') ? r.doi : `https://doi.org/${r.doi}`
}
