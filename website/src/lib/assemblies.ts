import { useEffect, useState } from 'react'

// Genome assemblies the map can be drawn on, and conversion between them.
//
// Every assembly is tied to a hub (TM-1 UTX v2.1) by anchors: 5-kb hub
// windows every 50 kb mapped onto it with minimap2 (scripts/liftover.py).
// A position is converted source -> hub -> target by linear interpolation
// between flanking anchors, exactly as the pipeline does for the database, so
// a locus uploaded here lands where the same locus in the database would.

export const HUB = 'Gh_UTX_v2.1'

export interface AssemblyInfo {
  key: string
  label: string
  species: string
  source: string
  /** Chromosome lengths in bp, A01-D13. */
  lengths: Record<string, number>
  /** Database records published on this assembly. */
  n_records: number
  anchors: number
}

/** Anchor file as exported by scripts/export_assemblies.py, per hub chromosome. */
interface AnchorFile {
  key: string
  // hub positions and target positions are delta-encoded; target chromosome
  // is run-length encoded as [name, count] pairs; strand as a '+'/'-' string.
  anchors: Record<string, { h: number[]; t: number[]; c: [string, number][]; s: string }>
}

interface Anchor { from: number; chr: string; to: number; strand: 1 | -1 }

export type Converted = { chromosome: string; pos: number; flag: 'interpolated' | 'nearest' | 'extrapolated' | 'same' }

class AnchorMap {
  private by = new Map<string, Anchor[]>()
  private keys = new Map<string, number[]>()

  constructor(rows: { a: string; x: number; b: string; y: number; s: 1 | -1 }[]) {
    rows.forEach((r) => {
      const list = this.by.get(r.a) ?? []
      list.push({ from: r.x, chr: r.b, to: r.y, strand: r.s })
      this.by.set(r.a, list)
    })
    this.by.forEach((list, c) => {
      list.sort((p, q) => p.from - q.from)
      this.keys.set(c, list.map((p) => p.from))
    })
  }

  point(chr: string, x: number): Converted | null {
    const a = this.by.get(chr)
    if (!a || !a.length) return null
    const k = this.keys.get(chr)!
    let lo = 0
    let hi = k.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (k[mid] <= x) lo = mid + 1
      else hi = mid
    }
    const i = lo
    if (i > 0 && i < a.length) {
      const p = a[i - 1]
      const q = a[i]
      if (p.chr === q.chr && q.from > p.from) {
        const gapS = q.from - p.from
        if (Math.abs(q.to - p.to) <= 3 * gapS + 200_000) {
          return { chromosome: p.chr, pos: Math.round(p.to + ((x - p.from) * (q.to - p.to)) / gapS), flag: 'interpolated' }
        }
      }
      const n = x - p.from <= q.from - x ? p : q
      return { chromosome: n.chr, pos: Math.round(n.to + (x - n.from) * n.strand), flag: 'nearest' }
    }
    const n = i === 0 ? a[0] : a[a.length - 1]
    return { chromosome: n.chr, pos: Math.round(n.to + (x - n.from) * n.strand), flag: 'extrapolated' }
  }
}

const base = () => `${import.meta.env.BASE_URL}data/assemblies/`

let indexPromise: Promise<AssemblyInfo[]> | null = null
export function loadAssemblyIndex(): Promise<AssemblyInfo[]> {
  if (!indexPromise) {
    indexPromise = fetch(base() + 'index.json').then((r) => {
      if (!r.ok) throw new Error(`assemblies/index.json: ${r.status}`)
      return r.json()
    })
    indexPromise.catch(() => { indexPromise = null })
  }
  return indexPromise
}

const maps = new Map<string, Promise<{ fwd: AnchorMap; rev: AnchorMap }>>()
function loadMaps(key: string) {
  let p = maps.get(key)
  if (!p) {
    p = fetch(`${base()}${key}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`assemblies/${key}.json: ${r.status}`)
        return r.json() as Promise<AnchorFile>
      })
      .then((f) => {
        const rows: { a: string; x: number; b: string; y: number; s: 1 | -1 }[] = []
        Object.entries(f.anchors).forEach(([hc, v]) => {
          let h = 0
          let t = 0
          let ci = 0
          let left = v.c[0]?.[1] ?? 0
          v.h.forEach((dh, i) => {
            h += dh
            t += v.t[i]
            while (left === 0 && ci < v.c.length - 1) { ci++; left = v.c[ci][1] }
            left--
            rows.push({ a: hc, x: h, b: v.c[ci][0], y: t, s: v.s[i] === '-' ? -1 : 1 })
          })
        })
        return {
          fwd: new AnchorMap(rows),
          rev: new AnchorMap(rows.map((r) => ({ a: r.b, x: r.y, b: r.a, y: r.x, s: r.s }))),
        }
      })
    p.catch(() => maps.delete(key))
    maps.set(key, p)
  }
  return p
}

export interface Converter {
  from: string
  to: string
  /** Convert one position; null when it cannot be placed. */
  point: (chr: string, x: number) => Converted | null
}

const identity = (from: string, to: string): Converter => ({
  from,
  to,
  point: (chromosome, pos) => ({ chromosome, pos, flag: 'same' }),
})

/** Converter between any two assemblies, through the hub. */
export async function makeConverter(from: string, to: string): Promise<Converter> {
  if (from === to) return identity(from, to)
  const a = from === HUB ? null : (await loadMaps(from)).rev
  const b = to === HUB ? null : (await loadMaps(to)).fwd
  return {
    from,
    to,
    point: (chr, x) => {
      const h = a ? a.point(chr, x) : { chromosome: chr, pos: x, flag: 'same' as const }
      if (!h) return null
      const t = b ? b.point(h.chromosome, h.pos) : h
      if (!t) return null
      const worst = [h.flag, t.flag].find((f) => f === 'extrapolated') ?? [h.flag, t.flag].find((f) => f === 'nearest') ?? (a || b ? 'interpolated' : 'same')
      return { chromosome: t.chromosome, pos: t.pos, flag: worst }
    },
  }
}

/** React hook: a converter between two assemblies, or null while it loads. */
export function useConverter(from: string, to: string) {
  const [conv, setConv] = useState<Converter | null>(from === to ? identity(from, to) : null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setError(null)
    if (from === to) { setConv(identity(from, to)); return }
    setConv(null)
    makeConverter(from, to)
      .then((c) => { if (live) setConv(c) })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
  }, [from, to])
  return { converter: conv, error }
}

export function useAssemblyIndex() {
  const [list, setList] = useState<AssemblyInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    loadAssemblyIndex().then(setList).catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])
  return { assemblies: list, error }
}

/** Convert an interval; null when its two ends land on different chromosomes. */
export function convertInterval(c: Converter, chr: string, start: number, end: number) {
  const a = c.point(chr, start)
  const b = c.point(chr, end)
  if (!a || !b || a.chromosome !== b.chromosome) return null
  return { chromosome: a.chromosome, start: Math.min(a.pos, b.pos), end: Math.max(a.pos, b.pos), exact: a.flag !== 'nearest' && a.flag !== 'extrapolated' && b.flag !== 'nearest' && b.flag !== 'extrapolated' }
}
