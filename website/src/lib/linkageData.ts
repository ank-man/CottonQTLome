import { ParsedTable, readFile as readTable, parseText as parseTable, normalizeUserChromosome, classifyTrait } from './userData'
import { TraitCategory, chromosomeSortKey } from './map'

// Linkage maps and cM-based QTL uploaded by a visitor. Everything is read in
// the browser. Accepted: any table the genome plotter reads (CSV, TSV, Excel,
// JSON ...), plus MapChart / JoinMap ".map" text ("group LG1" then
// "marker  cM" lines) and R/qtl "csv" cross files (marker names on row 1,
// chromosome on row 2, cM on row 3).

export type MapMapping = { marker: string; group: string; cm: string }
export type QtlMapping = { name: string; group: string; start: string; end: string; peak: string; trait: string; value: string }

export interface LinkageMarker { marker: string; group: string; cm: number }
export interface LinkageQtl {
  id: string
  name: string
  group: string
  start: number
  end: number
  peak: number | null
  traitText: string
  trait: TraitCategory
  value: number | null
  raw: Record<string, string>
}
export interface LinkageGroup {
  /** As written in the file. */
  name: string
  /** A01-D13 when the name is a recognisable chromosome. */
  chromosome: string | null
  min: number
  max: number
  markers: LinkageMarker[]
  qtl: LinkageQtl[]
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const num = (s: string | undefined) => {
  const v = (s ?? '').replace(/,/g, '.').trim()
  return v === '' ? NaN : Number(v)
}

function pick(columns: string[], candidates: string[], used: Set<string>): string {
  const ks = columns.filter((c) => !used.has(c)).map((c) => [c, key(c)] as const)
  for (const cand of candidates) {
    const hit = ks.find(([, k]) => k === cand)
    if (hit) { used.add(hit[0]); return hit[0] }
  }
  for (const cand of candidates.filter((c) => c.length >= 3)) {
    const hit = ks.find(([, k]) => k.includes(cand))
    if (hit) { used.add(hit[0]); return hit[0] }
  }
  return ''
}

const GROUP = ['linkagegroup', 'lg', 'group', 'chromosome', 'chrom', 'chr', 'linkage']
export function guessMapMapping(columns: string[]): MapMapping {
  const used = new Set<string>()
  const cm = pick(columns, ['positioncm', 'cm', 'poscm', 'position', 'pos', 'distance', 'geneticposition', 'mapposition'], used)
  const group = pick(columns, GROUP, used)
  const marker = pick(columns, ['marker', 'markername', 'locus', 'name', 'snp', 'id', 'loci'], used)
  return { marker, group, cm }
}

export function guessQtlMapping(columns: string[]): QtlMapping {
  const used = new Set<string>()
  const start = pick(columns, ['startcm', 'start', 'leftcm', 'left', 'cistart', 'lower', 'from', 'lci', 'leftci'], used)
  const end = pick(columns, ['endcm', 'end', 'rightcm', 'right', 'ciend', 'upper', 'to', 'uci', 'rightci'], used)
  const peak = pick(columns, ['peakcm', 'peak', 'positioncm', 'position', 'pos', 'cm', 'maxlod'], used)
  const group = pick(columns, GROUP, used)
  const value = pick(columns, ['lod', 'maxlod', 'pve', 'r2', 'logp', 'score'], used)
  const trait = pick(columns, ['trait', 'phenotype', 'traitname', 'category'], used)
  const name = pick(columns, ['qtl', 'qtlname', 'name', 'id', 'locus', 'label'], used)
  return { name, group, start, end, peak, trait, value }
}

/** Read a map or QTL file, adding the two linkage-map-only formats. */
export async function readLinkageFile(file: File, sheet?: string): Promise<ParsedTable> {
  const name = file.name.toLowerCase()
  if (/\.(map|mct|joinmap|loc)$/.test(name)) {
    const t = parseMapChart(await file.text(), file.name)
    if (t) return t
  }
  if (/\.(csv|csvr)$/.test(name)) {
    const text = await file.text()
    const t = parseRqtl(text, file.name)
    if (t) return t
  }
  return readTable(file, sheet)
}

export function parseLinkageText(text: string, fileName: string): ParsedTable {
  return parseMapChart(text, fileName) ?? parseRqtl(text, fileName) ?? parseTable(text, fileName, '')
}

function table(fileName: string, format: string, columns: string[], rows: Record<string, string>[], notes: string[]): ParsedTable {
  return {
    format: format as ParsedTable['format'],
    fileName,
    columns,
    rows,
    notes,
    mapping: { chromosome: '', start: '', end: '', name: '', trait: '', value: '' },
    unit: 'bp',
  }
}

/** MapChart / JoinMap: "group <name>" lines, then "<marker> <cM>" lines. */
function parseMapChart(text: string, fileName: string): ParsedTable | null {
  const lines = text.split(/\r?\n/)
  if (!lines.some((l) => /^\s*(group|lg|chrom)\s+\S+/i.test(l))) return null
  const rows: Record<string, string>[] = []
  let group = ''
  for (const raw of lines) {
    const l = raw.replace(/;.*$/, '').trim()
    if (!l || l.startsWith('#') || l.startsWith(';')) continue
    const g = l.match(/^(?:group|lg|chrom)\s+(.+)$/i)
    if (g) { group = g[1].trim(); continue }
    const f = l.split(/\s+/)
    if (f.length >= 2 && Number.isFinite(Number(f[1])) && group) rows.push({ marker: f[0], linkage_group: group, position_cM: f[1] })
  }
  if (!rows.length) return null
  return table(fileName, 'MapChart / JoinMap', ['marker', 'linkage_group', 'position_cM'], rows, ['Read as a MapChart / JoinMap map file.'])
}

/** R/qtl "csv" cross: row 1 marker names, row 2 chromosome, row 3 cM, the first column(s) phenotypes. */
function parseRqtl(text: string, fileName: string): ParsedTable | null {
  const lines = text.split(/\r?\n/).slice(0, 3).map((l) => l.split(','))
  if (lines.length < 3) return null
  const [names, chr, pos] = lines
  // phenotype columns have an empty chromosome and position cell
  const first = chr.findIndex((c) => c.trim() !== '')
  if (first < 1 || chr.slice(0, first).some((c) => c.trim()) || pos.slice(0, first).some((c) => c.trim())) return null
  const cells = pos.slice(first).filter((c) => c.trim())
  if (!cells.length || cells.some((c) => !Number.isFinite(Number(c)))) return null
  const rows = names.slice(first).map((m, i) => ({ marker: m.trim(), linkage_group: chr[first + i].trim(), position_cM: pos[first + i].trim() }))
    .filter((r) => r.marker && r.position_cM)
  return table(fileName, 'R/qtl cross', ['marker', 'linkage_group', 'position_cM'], rows, [`Read the map rows of an R/qtl cross file (${first} phenotype column${first > 1 ? 's' : ''} skipped).`])
}

export interface LinkageResult {
  groups: LinkageGroup[]
  nMarkers: number
  nQtl: number
  skipped: { reason: string; count: number }[]
  valueLabel: string
}

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

/** Combine an optional map and optional QTL table into linkage groups. */
export function buildLinkage(
  map: ParsedTable | null, mm: MapMapping | null,
  qt: ParsedTable | null, qm: QtlMapping | null,
): LinkageResult {
  const skipped = new Map<string, number>()
  const skip = (r: string) => skipped.set(r, (skipped.get(r) ?? 0) + 1)
  const groups = new Map<string, LinkageGroup>()
  const group = (name: string) => {
    let g = groups.get(name)
    if (!g) {
      g = { name, chromosome: normalizeUserChromosome(name), min: Infinity, max: -Infinity, markers: [], qtl: [] }
      groups.set(name, g)
    }
    return g
  }
  let nMarkers = 0
  if (map && mm && mm.group && mm.cm) {
    map.rows.forEach((r) => {
      const gname = (r[mm.group] ?? '').trim()
      const cm = num(r[mm.cm])
      if (!gname) return skip('Map row without a linkage group')
      if (!Number.isFinite(cm)) return skip('Map row without a cM position')
      const g = group(gname)
      g.markers.push({ marker: mm.marker ? r[mm.marker] ?? '' : '', group: gname, cm })
      g.min = Math.min(g.min, cm)
      g.max = Math.max(g.max, cm)
      nMarkers++
    })
  }
  let nQtl = 0
  if (qt && qm && qm.group && (qm.start || qm.peak)) {
    qt.rows.forEach((r, i) => {
      const gname = (r[qm.group] ?? '').trim()
      if (!gname) return skip('QTL row without a linkage group')
      // a "12.3-18.0" range in the start column is read as both ends
      const range = (r[qm.start] ?? '').match(/^\s*(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*$/)
      let start = range ? Number(range[1]) : num(r[qm.start])
      let end = range ? Number(range[2]) : num(r[qm.end])
      const peak = num(r[qm.peak])
      if (!Number.isFinite(start)) start = Number.isFinite(peak) ? peak : NaN
      if (!Number.isFinite(end)) end = Number.isFinite(peak) ? peak : start
      if (!Number.isFinite(start)) return skip('QTL row without a cM position')
      if (end < start) [start, end] = [end, start]
      const g = group(gname)
      const traitText = qm.trait ? r[qm.trait] ?? '' : ''
      const v = qm.value ? num(r[qm.value]) : NaN
      g.qtl.push({
        id: `Q${i}`,
        name: (qm.name && r[qm.name]) || `${gname}:${start.toFixed(1)}`,
        group: gname,
        start,
        end,
        peak: Number.isFinite(peak) ? peak : null,
        traitText,
        trait: classifyTrait(traitText),
        value: Number.isFinite(v) ? v : null,
        raw: r,
      })
      g.min = Math.min(g.min, start)
      g.max = Math.max(g.max, end)
      nQtl++
    })
  }
  const list = [...groups.values()].filter((g) => Number.isFinite(g.min))
  list.forEach((g) => g.markers.sort((a, b) => a.cm - b.cm))
  list.sort((a, b) => {
    if (a.chromosome && b.chromosome) return chromosomeSortKey(a.chromosome) - chromosomeSortKey(b.chromosome) || natural(a.name, b.name)
    if (a.chromosome) return -1
    if (b.chromosome) return 1
    return natural(a.name, b.name)
  })
  return {
    groups: list,
    nMarkers,
    nQtl,
    skipped: [...skipped.entries()].map(([reason, count]) => ({ reason, count })),
    valueLabel: qm?.value ?? '',
  }
}

// ---------------------------------------------------------------------------
// Comparison with the database's linkage maps
// ---------------------------------------------------------------------------

interface MarkerIndex { maps: string[]; chrs: string[]; m: Record<string, number[]> }
let indexPromise: Promise<MarkerIndex> | null = null
export function loadMarkerIndex(): Promise<MarkerIndex> {
  if (!indexPromise) {
    indexPromise = fetch(`${import.meta.env.BASE_URL}data/maps/marker_index.json`).then((r) => {
      if (!r.ok) throw new Error(`marker_index.json: ${r.status}`)
      return r.json()
    })
    indexPromise.catch(() => { indexPromise = null })
  }
  return indexPromise
}

export interface GroupMatch {
  group: string
  markers: number
  shared: number
  /** Chromosome most of the shared markers sit on in the database maps. */
  chromosome: string
  agreement: number
  /** Best-matching database map for this group, and the rank correlation of marker order with it. */
  bestMap: string
  bestShared: number
  rho: number | null
}
export interface MapMatch { mapId: string; shared: number; groups: number }

function spearman(x: number[], y: number[]): number | null {
  const n = x.length
  if (n < 5) return null
  const rank = (v: number[]) => {
    const o = v.map((val, i) => [val, i] as const).sort((a, b) => a[0] - b[0])
    const r = new Array(n)
    for (let i = 0; i < n;) {
      let j = i
      while (j + 1 < n && o[j + 1][0] === o[i][0]) j++
      for (let k = i; k <= j; k++) r[o[k][1]] = (i + j) / 2
      i = j + 1
    }
    return r as number[]
  }
  const rx = rank(x)
  const ry = rank(y)
  const mx = rx.reduce((s, v) => s + v, 0) / n
  const my = ry.reduce((s, v) => s + v, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (rx[i] - mx) * (ry[i] - my)
    sxx += (rx[i] - mx) ** 2
    syy += (ry[i] - my) ** 2
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null
}

export function compareWithDatabase(groups: LinkageGroup[], idx: MarkerIndex): { byGroup: GroupMatch[]; byMap: MapMatch[] } {
  const mapShared = new Map<number, { n: number; groups: Set<string> }>()
  const byGroup: GroupMatch[] = groups.map((g) => {
    const chrVotes = new Map<string, number>()
    const perMap = new Map<string, { you: number[]; db: number[] }>()   // key: map|chr
    let shared = 0
    g.markers.forEach((m) => {
      const hits = idx.m[m.marker.trim().toUpperCase()]
      if (!hits) return
      shared++
      // one vote per marker, for the chromosome most database maps put it on (SSRs often also map
      // to the homoeologous At/Dt chromosome in some maps; those placements should not split the vote)
      const perChr = new Map<string, number>()
      for (let i = 0; i < hits.length; i += 3) {
        const c = idx.chrs[hits[i + 1]]
        const norm = normalizeUserChromosome(c) ?? c
        perChr.set(norm, (perChr.get(norm) ?? 0) + 1)
      }
      let top = ''
      let topN = 0
      perChr.forEach((n, c) => { if (n > topN) { topN = n; top = c } })
      if (top) chrVotes.set(top, (chrVotes.get(top) ?? 0) + 1)
      for (let i = 0; i < hits.length; i += 3) {
        const mapI = hits[i]
        const chr = idx.chrs[hits[i + 1]]
        const cm = hits[i + 2] / 10
        const norm = normalizeUserChromosome(chr) ?? chr
        const k = `${mapI}|${norm}`
        const p = perMap.get(k) ?? { you: [], db: [] }
        p.you.push(m.cm)
        p.db.push(cm)
        perMap.set(k, p)
        const ms = mapShared.get(mapI) ?? { n: 0, groups: new Set<string>() }
        ms.n++
        ms.groups.add(g.name)
        mapShared.set(mapI, ms)
      }
    })
    let chromosome = ''
    let best = 0
    let total = 0
    chrVotes.forEach((v, c) => { total += v; if (v > best) { best = v; chromosome = c } })
    let bestKey = ''
    let bestN = 0
    perMap.forEach((p, k) => {
      if (k.endsWith(`|${chromosome}`) && p.you.length > bestN) { bestN = p.you.length; bestKey = k }
    })
    const bp = perMap.get(bestKey)
    return {
      group: g.name,
      markers: g.markers.length,
      shared,
      chromosome,
      agreement: total ? best / total : 0,
      bestMap: bestKey ? idx.maps[Number(bestKey.split('|')[0])] : '',
      bestShared: bestN,
      rho: bp ? spearman(bp.you, bp.db) : null,
    }
  })
  const byMap = [...mapShared.entries()]
    .map(([i, v]) => ({ mapId: idx.maps[i], shared: v.n, groups: v.groups.size }))
    .sort((a, b) => b.shared - a.shared)
  return { byGroup, byMap }
}
