import { Converter, convertInterval } from './assemblies'
import { EpistaticLink, MapItem } from './map'
import { UserItem } from './userData'

// Put items held on one assembly's coordinates onto another's. Items whose
// two ends land on different chromosomes (a rearrangement between the two
// assemblies) can't be drawn as one mark and are counted instead.

export interface Moved<T> { items: T[]; dropped: number; approximate: number }

const clamp = (x: number, len: number | undefined) => Math.max(0, Math.min(x, len ?? x))

export function convertMapItems(items: MapItem[], c: Converter, lengths: Record<string, number>): Moved<MapItem> {
  if (c.from === c.to) return { items, dropped: 0, approximate: 0 }
  const out: MapItem[] = []
  let dropped = 0
  let approximate = 0
  items.forEach((it) => {
    if (it.type === 'qtl') {
      const p = c.point(it.chromosome, it.point)
      if (!p || !(p.chromosome in lengths)) { dropped++; return }
      if (p.flag === 'nearest' || p.flag === 'extrapolated') approximate++
      out.push({ ...it, chromosome: p.chromosome, point: clamp(p.pos, lengths[p.chromosome]) })
    } else {
      const iv = convertInterval(c, it.chromosome, it.start, it.end)
      if (!iv || !(iv.chromosome in lengths)) { dropped++; return }
      if (!iv.exact) approximate++
      const len = lengths[iv.chromosome]
      const mid = c.point(it.chromosome, it.point)
      out.push({
        ...it,
        chromosome: iv.chromosome,
        start: clamp(iv.start, len),
        end: clamp(iv.end, len),
        point: clamp(mid && mid.chromosome === iv.chromosome ? mid.pos : (iv.start + iv.end) / 2, len),
      })
    }
  })
  return { items: out, dropped, approximate }
}

export function convertLinks(links: EpistaticLink[], c: Converter, lengths: Record<string, number>): EpistaticLink[] {
  if (c.from === c.to) return links
  const out: EpistaticLink[] = []
  links.forEach((l) => {
    const a = c.point(l.chromosome1, l.point1)
    const b = c.point(l.chromosome2, l.point2)
    if (!a || !b || !(a.chromosome in lengths) || !(b.chromosome in lengths)) return
    out.push({
      ...l,
      chromosome1: a.chromosome,
      point1: clamp(a.pos, lengths[a.chromosome]),
      chromosome2: b.chromosome,
      point2: clamp(b.pos, lengths[b.chromosome]),
    })
  })
  return out
}

export function convertUserItems(items: UserItem[], c: Converter, lengths: Record<string, number>): Moved<UserItem> {
  if (c.from === c.to) return { items, dropped: 0, approximate: 0 }
  const out: UserItem[] = []
  let dropped = 0
  let approximate = 0
  items.forEach((it) => {
    if (it.isInterval) {
      const iv = convertInterval(c, it.chromosome, it.start, it.end)
      if (!iv || !(iv.chromosome in lengths)) { dropped++; return }
      if (!iv.exact) approximate++
      const len = lengths[iv.chromosome]
      const s = clamp(iv.start, len)
      const e = clamp(iv.end, len)
      out.push({ ...it, chromosome: iv.chromosome, start: s, end: e, point: (s + e) / 2 })
    } else {
      const p = c.point(it.chromosome, it.point)
      if (!p || !(p.chromosome in lengths)) { dropped++; return }
      if (p.flag === 'nearest' || p.flag === 'extrapolated') approximate++
      const x = clamp(p.pos, lengths[p.chromosome])
      out.push({ ...it, chromosome: p.chromosome, start: x, end: x, point: x })
    }
  })
  return { items: out, dropped, approximate }
}
