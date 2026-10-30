import { TRAIT_CATEGORIES, TRAIT_COLORS, TraitCategory } from './map'

/** A row's colour group: a key shown in the legend and the colour drawn for it. */
export interface RowGroup {
  key: string
  color: string
}

const CATEGORY_BY_LOWER = new Map(TRAIT_CATEGORIES.map((c) => [c.toLowerCase(), c as TraitCategory]))

/** Trait category of a value, matched case-insensitively ("fiber quality" -> "Fiber quality"). */
export function asCategory(v: unknown): TraitCategory | null {
  if (typeof v !== 'string') return null
  return CATEGORY_BY_LOWER.get(v.trim().toLowerCase()) ?? null
}

// Columns that hold the trait category, in the order they are tried. Some tables keep the
// category in `category` and a free-text trait in `trait`, so `category` comes first.
const CATEGORY_KEYS = ['category', 'dominant_category', 'trait']

export function categoryOf(row: object): TraitCategory | null {
  for (const k of CATEGORY_KEYS) {
    const c = asCategory((row as Record<string, unknown>)[k])
    if (c) return c
  }
  return null
}

/** Default grouping: by trait category when the row has one. */
export function traitGroup(row: object): RowGroup | null {
  const c = categoryOf(row)
  return c ? { key: c, color: TRAIT_COLORS[c] } : null
}

// Study-design colours for tables without a trait (literature, linkage maps). Distinct from
// one another; each is always shown next to its label in the legend.
export const STUDY_COLORS: Record<string, string> = {
  'Linkage QTL': '#2a78d6',
  GWAS: '#eb6834',
  'Fine mapping': '#1baf7a',
  'Meta-QTL': '#6250d6',
  Epistasis: '#e87ba4',
  'Multi-trait': '#eda100',
  BSA: '#e34948',
  'QTL×E': '#008300',
  'eQTL/omics': '#57575f',
  Review: '#8a8a93',
  CottonGen: '#2a78d6',
  'Literature supplement': '#eb6834',
}

export function groupBy<T>(key: (row: T) => string | undefined): (row: T) => RowGroup | null {
  return (row) => {
    const k = key(row)
    return k ? { key: k, color: STUDY_COLORS[k] ?? '#8a8a93' } : null
  }
}

/** Faint tint of a colour that works on light and dark surfaces. */
export function tint(color: string, pct = 8): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`
}
