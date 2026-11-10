/**
 * Gene lookup on a static host. scripts/export_gene_index.py writes
 *   data/genes/alias/NN.json      normalised alias -> { g: [[chr, index]], r: [[record, type, trait, chr, study]] }
 *   data/genes/chr/<chr>.json     genes of one chromosome, sorted by start
 *   data/genes/intervals/<chr>.json  meta-QTL, hotspots, QTL and GWAS loci on UTX v2.1
 * A search fetches one or two alias shards (about 100 kB each); a gene or interval view fetches
 * one chromosome file. norm() and shardOf() must stay identical to the Python side.
 */

export const N_SHARDS = 64

export type Gene = {
  id: string
  chr: string
  start: number
  end: number
  strand: string
  locus_tag: string
  refseq: string
  ncbi_gene_id: string
  symbol: string
  arabidopsis: string
  description: string
}

export type Interval = {
  kind: 'M' | 'H' | 'Q' | 'G'
  id: string
  trait: string
  category: string
  start: number
  end: number
  support: string
  method: string
}

export type Mention = { record: string; type: string; trait: string; chr: string; study: string }
type Shard = Record<string, { g: [string, number][]; r: [string, string, string, string, string][] }>

export function norm(alias: string): string {
  let a = alias.trim().toLowerCase()
  a = a.replace(/(\.v\d+(\.\d+)*|_utx-tm1_v2\.1)$/, '')
  a = a.replace(/(?<=g\d{4})(\.\d+)+$|(?<=g\d{5})(\.\d+)+$|(?<=g\d{6})(\.\d+)+$|(?<=\d{5})\.\d+$/, '')
  a = a.replace(/(?<=\d)v\d$/, '')
  return a
}

export function shardOf(alias: string): number {
  let h = 0x811c9dc5
  for (const b of new TextEncoder().encode(alias)) {
    h ^= b
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h % N_SHARDS
}

const cache = new Map<string, Promise<unknown>>()
function getJSON<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    const p = fetch(`${import.meta.env.BASE_URL}data/genes/${path}`).then((r) => {
      if (!r.ok) throw new Error(`Could not load ${path} (${r.status})`)
      return r.json()
    })
    p.catch(() => cache.delete(path))
    cache.set(path, p)
  }
  return cache.get(path) as Promise<T>
}

type GeneRow = [string, number, number, string, string, string, string, string, string, string]
type IntervalRow = [Interval['kind'], string, string, string, number, number, string, string]

export async function genesOn(chr: string): Promise<Gene[]> {
  const rows = await getJSON<GeneRow[]>(`chr/${chr}.json`)
  return rows.map(([id, start, end, strand, locus_tag, refseq, ncbi_gene_id, symbol, arabidopsis, description]) => ({
    id, chr, start, end, strand, locus_tag, refseq, ncbi_gene_id, symbol, arabidopsis, description,
  }))
}

export async function intervalsOn(chr: string): Promise<Interval[]> {
  const rows = await getJSON<IntervalRow[]>(`intervals/${chr}.json`)
  return rows.map(([kind, id, trait, category, start, end, support, method]) => ({ kind, id, trait, category, start, end, support, method }))
}

/** Genes overlapping [start, end] (genes are sorted by start; binary search on the end bound). */
export function overlapping<T extends { start: number; end: number }>(items: T[], start: number, end: number, maxLen = 3e6): T[] {
  let lo = 0
  let hi = items.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (items[mid].start <= end) lo = mid + 1
    else hi = mid
  }
  const out: T[] = []
  for (let i = lo - 1; i >= 0; i--) {
    const it = items[i]
    if (it.end >= start) out.push(it)
    if (start - it.start > maxLen) break // no item is longer than maxLen
  }
  return out.reverse()
}

export type SearchResult = { query: string; genes: Gene[]; mentions: Mention[]; homologOf: Gene[] }

export async function searchGene(query: string): Promise<SearchResult> {
  const q = norm(query)
  const keys = [q, `sym:${q}`]
  const shards = await Promise.all(keys.map((k) => getJSON<Shard>(`alias/${String(shardOf(k)).padStart(2, '0')}.json`)))
  const direct = shards[0][q]
  const sym = shards[1][`sym:${q}`]
  const load = async (refs: [string, number][] = []) =>
    Promise.all(refs.map(async ([chr, i]) => (await genesOn(chr))[i]))
  const [genes, homologOf] = await Promise.all([load(direct?.g), load(sym?.g)])
  const mentions = (direct?.r ?? []).map(([record, type, trait, chr, study]) => ({ record, type, trait, chr, study }))
  return { query, genes, mentions, homologOf }
}

/** Outbound links per identifier type. Only patterns that resolve to a page about that identifier. */
export function geneLinks(g: Gene): { label: string; url: string }[] {
  const out = [
    { label: 'Phytozome', url: `https://phytozome-next.jgi.doe.gov/report/gene/Ghirsutum_v2_1/${g.id}` },
    { label: 'CottonGen', url: `https://www.cottongen.org/search/site/${encodeURIComponent(g.id)}` },
  ]
  if (g.ncbi_gene_id) out.push({ label: 'NCBI Gene', url: `https://www.ncbi.nlm.nih.gov/gene/${g.ncbi_gene_id}` })
  else if (g.locus_tag) out.push({ label: 'NCBI Gene', url: `https://www.ncbi.nlm.nih.gov/gene/?term=${encodeURIComponent(g.locus_tag)}` })
  return out
}

export function idLink(id: string): string {
  if (/^AT[1-5CM]G\d{5}/i.test(id)) return `https://www.arabidopsis.org/locus?name=${id.toUpperCase().replace(/\.\d+$/, '')}`
  if (/^LOC\d+$/.test(id)) return `https://www.ncbi.nlm.nih.gov/gene/?term=${id}`
  if (/^\d{6,}$/.test(id)) return `https://www.ncbi.nlm.nih.gov/gene/${id}`
  if (/^ERO13_/.test(id)) return `https://www.ncbi.nlm.nih.gov/gene/?term=${id}`
  if (/^[A-Z0-9]+_[A-Z]{3,5}$/.test(id)) return `https://www.uniprot.org/uniprotkb?query=${id}`
  if (/^Gohir\./.test(id)) return `https://phytozome-next.jgi.doe.gov/report/gene/Ghirsutum_v2_1/${id.replace(/\.\d+$/, '')}`
  return `https://www.cottongen.org/search/site/${encodeURIComponent(id)}`
}

export const CHRS = [...'AD'].flatMap((g) => Array.from({ length: 13 }, (_, i) => `${g}${String(i + 1).padStart(2, '0')}`))

/* ---- organ expression (scripts/export_expression.py) ---------------------------------------------------------- */

export type ExprMeta = {
  organs: string[]
  organ_class: string[]
  runs: string[]
  classes: string[]
  genes: number
  expressed_share: number
  fibre_preferential_share: number
  source: string
  doi: string
  method: string
}

/** TPM per organ (meta.organs order), tau (0-1, null when not expressed), peak class (null when not expressed). */
export type Expr = { tpm: number[]; tau: number | null; peak: string | null; fibrePref: boolean; max: number }

type ExprRow = number[]
export const exprMeta = () => getJSON<ExprMeta>('expr/meta.json')

export async function expressionOn(chr: string): Promise<Map<string, Expr>> {
  const [meta, rows] = await Promise.all([exprMeta(), getJSON<Record<string, ExprRow>>(`expr/${chr}.json`)])
  const k = meta.organs.length
  const out = new Map<string, Expr>()
  for (const [id, r] of Object.entries(rows)) {
    const tpm = r.slice(0, k)
    out.set(id, {
      tpm,
      tau: r[k] < 0 ? null : r[k] / 100,
      peak: r[k + 1] < 0 ? null : meta.classes[r[k + 1]],
      fibrePref: r[k + 2] === 1,
      max: Math.max(...tpm),
    })
  }
  return out
}

/** [genes, expressed, fibre-preferential, peak in fibre, peak in seed] per hotspot or meta-QTL id */
export const intervalExpression = () => getJSON<Record<string, [number, number, number, number, number]>>('expr/intervals.json')

/** TPM of one organ class: mean of its organs (as in the analysis, where classes average their libraries). */
export function classTPM(e: Expr, meta: ExprMeta, cls: string): number {
  const v = e.tpm.filter((_, i) => meta.organ_class[i] === cls)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0
}
