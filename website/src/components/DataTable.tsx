import { CSSProperties, ReactNode, useEffect, useMemo, useState } from 'react'
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from '@tanstack/react-table'
import { useSearchParams } from 'react-router-dom'
import { ArrowUpDown, ChevronLeft, ChevronRight, Download, HelpCircle, Search } from 'lucide-react'
import { downloadCSV } from '../lib/csv'
import { RowGroup, asCategory, tint, traitGroup } from '../lib/rowColors'
import { TRAIT_COLORS } from '../lib/map'

interface Props<T extends object> {
  data: T[]
  columns: ColumnDef<T, any>[]
  filename?: string
  searchableKeys?: (keyof T)[]
  pageSize?: number
  /** Colour group of each row (default: trait category); null turns colouring off. */
  rowGroup?: ((row: T) => RowGroup | null) | null
  /** Legend title for the colour groups. */
  groupLabel?: string
  /** Seed the table search from ?q= (off where the page uses q for its own filter). */
  urlQuery?: boolean
}

// Score columns drawn with an in-cell bar, and the value that fills the bar.
const BAR_SCALE: Record<string, number> = {
  lod: 20, max_lod: 20, neg_log10_p: 20, max_neg_log10_p: 20, pve: 50, mean_pve: 50,
}
const CATEGORY_COLUMNS = new Set(['trait', 'category', 'dominant_category'])
const CHROMOSOME_COLUMNS = new Set(['chromosome', 'chromosome2', 'map_chr'])

export function CategoryChip({ category }: { category: string }) {
  const c = asCategory(category)
  if (!c) return <>{category}</>
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium"
      style={{ borderColor: tint(TRAIT_COLORS[c], 45), background: tint(TRAIT_COLORS[c], 12) }}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TRAIT_COLORS[c] }} />
      {c}
    </span>
  )
}

/** Built-in cues by column: category chips, A/D subgenome marks, score bars, record-type badges. */
function decorate(columnId: string, value: unknown, rendered: ReactNode): ReactNode {
  const v = value == null ? '' : String(value)
  if (!v) return rendered
  if (CATEGORY_COLUMNS.has(columnId) && asCategory(v)) return <CategoryChip category={v} />
  if (CHROMOSOME_COLUMNS.has(columnId) && /^[AD]\d{2}$/.test(v)) {
    const a = v[0] === 'A'
    return (
      <span title={a ? 'At subgenome' : 'Dt subgenome'}
        className={`inline-block rounded px-1.5 font-mono text-xs ${a ? 'bg-wheat-800 text-wheat-50' : 'border border-wheat-500 text-wheat-800'}`}>
        {v}
      </span>
    )
  }
  if (columnId in BAR_SCALE) {
    const n = parseFloat(v)
    if (!Number.isFinite(n)) return rendered
    const w = Math.max(2, Math.min(100, (n / BAR_SCALE[columnId]) * 100))
    return (
      <span className="relative inline-block min-w-[56px] rounded-sm px-1 tabular-nums">
        <span className="absolute inset-y-0 left-0 rounded-sm bg-accent/20" style={{ width: `${w}%` }} />
        <span className="relative">{rendered}</span>
      </span>
    )
  }
  if (columnId === 'record_type') {
    const gwas = v === 'GWAS'
    return <span className={`badge ${gwas ? 'border-wheat-500 bg-wheat-100' : 'border-accent/40 text-accent'}`}>{v}</span>
  }
  return rendered
}

const COLOR_PREF = 'cqtl.rowColors'
function readPref(): boolean {
  try { return localStorage.getItem(COLOR_PREF) !== 'off' } catch { return true }
}

export default function DataTable<T extends object>({
  data,
  columns,
  filename = 'data.csv',
  searchableKeys,
  pageSize = 25,
  rowGroup = traitGroup,
  groupLabel = 'Trait category',
  urlQuery = true,
}: Props<T>) {
  // ?q= in the URL pre-fills the search box, so other pages can link to a row
  const [params] = useSearchParams()
  const [globalFilter, setGlobalFilter] = useState(urlQuery ? params.get('q') ?? '' : '')
  useEffect(() => { const q = params.get('q'); if (urlQuery && q !== null) setGlobalFilter(q) }, [params, urlQuery])
  const [sorting, setSorting] = useState<SortingState>([])
  const [colorRows, setColorRows] = useState(readPref)
  const [only, setOnly] = useState<Set<string>>(new Set())

  useEffect(() => {
    try { localStorage.setItem(COLOR_PREF, colorRows ? 'on' : 'off') } catch { /* storage unavailable */ }
  }, [colorRows])

  const searched = useMemo(() => {
    if (!globalFilter) return data
    const q = globalFilter.toLowerCase()
    const keys = searchableKeys ?? (Object.keys(data[0] ?? {}) as (keyof T)[])
    return data.filter((row) =>
      keys.some((k) => String((row as any)[k] ?? '').toLowerCase().includes(q)),
    )
  }, [data, globalFilter, searchableKeys])

  // Groups present in the searched rows, largest first, for the legend.
  const groups = useMemo(() => {
    if (!rowGroup) return []
    const m = new Map<string, { color: string; n: number }>()
    searched.forEach((r) => {
      const g = rowGroup(r)
      if (!g) return
      const e = m.get(g.key)
      if (e) e.n++
      else m.set(g.key, { color: g.color, n: 1 })
    })
    return Array.from(m, ([key, e]) => ({ key, ...e })).sort((a, b) => b.n - a.n)
  }, [searched, rowGroup])

  const filtered = useMemo(() => {
    if (!only.size || !rowGroup) return searched
    return searched.filter((r) => only.has(rowGroup(r)?.key ?? ''))
  }, [searched, only, rowGroup])

  const toggleGroup = (k: string) =>
    setOnly((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-wheat-500" />
          <input
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder="Search across all fields…"
            className="input pl-8"
          />
        </div>
        <span className="badge">{filtered.length.toLocaleString()} rows</span>
        <span className="hidden text-xs text-wheat-500 sm:inline">Hover a column's <HelpCircle className="inline h-3 w-3 align-text-bottom" /> for its definition</span>
        <button
          className="btn"
          onClick={() => downloadCSV(filename, filtered)}
          disabled={!filtered.length}
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      {groups.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-semibold text-wheat-700">{groupLabel}:</span>
          {groups.map((g) => {
            const on = only.has(g.key)
            const dim = only.size > 0 && !on
            return (
              <button
                key={g.key}
                type="button"
                onClick={() => toggleGroup(g.key)}
                aria-pressed={on}
                title={on ? `Show all rows` : `Show only ${g.key}`}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 transition ${dim ? 'opacity-40' : ''} ${on ? 'font-semibold' : ''}`}
                style={{ borderColor: tint(g.color, on ? 90 : 40), background: tint(g.color, on ? 22 : 8) }}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: g.color }} />
                {g.key}
                <span className="text-wheat-500">{g.n.toLocaleString()}</span>
              </button>
            )
          })}
          {only.size > 0 && (
            <button type="button" className="underline text-wheat-600" onClick={() => setOnly(new Set())}>show all</button>
          )}
          <label className="ml-auto inline-flex cursor-pointer items-center gap-1 text-wheat-600">
            <input type="checkbox" checked={colorRows} onChange={(e) => setColorRows(e.target.checked)} />
            Colour rows
          </label>
        </div>
      )}

      <div className="max-h-[72vh] overflow-auto rounded border border-wheat-200 bg-wheat-50">
        <table className="min-w-full divide-y divide-wheat-200 text-sm">
          <thead className="sticky top-0 z-[5] border-b border-wheat-300 bg-wheat-100">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    className="cursor-pointer whitespace-nowrap px-3 py-2 text-left text-[13px] font-semibold text-wheat-800"
                    onClick={h.column.getToggleSortingHandler()}
                  >
                    <span className="inline-flex items-center gap-1">
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {h.column.getCanSort() && <ArrowUpDown className="h-3 w-3 opacity-50" />}
                      {h.column.getIsSorted() === 'asc' && ' ▲'}
                      {h.column.getIsSorted() === 'desc' && ' ▼'}
                    </span>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-wheat-100 bg-wheat-50">
            {table.getRowModel().rows.map((row, i) => {
              const g = colorRows && rowGroup ? rowGroup(row.original) : null
              return (
                <tr
                  key={row.id}
                  className={g ? 'bg-[var(--row-tint)] hover:bg-[var(--row-hover)]' : `${i % 2 ? 'bg-wheat-100/40' : ''} hover:bg-wheat-100`}
                  style={g ? ({ '--row-tint': tint(g.color, 7), '--row-hover': tint(g.color, 16) } as CSSProperties) : undefined}
                >
                  {row.getVisibleCells().map((cell, j) => (
                    <td
                      key={cell.id}
                      className="whitespace-nowrap px-3 py-1.5 align-top text-wheat-800"
                      style={g && j === 0 ? { boxShadow: `inset 4px 0 0 ${g.color}` } : undefined}
                    >
                      {decorate(cell.column.id, cell.getValue(), flexRender(cell.column.columnDef.cell, cell.getContext()))}
                    </td>
                  ))}
                </tr>
              )
            })}
            {!table.getRowModel().rows.length && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-wheat-600">
                  No matching records.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div>
          Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1}
        </div>
        <div className="flex items-center gap-2">
          <select
            className="input w-auto"
            value={table.getState().pagination.pageSize}
            onChange={(e) => table.setPageSize(Number(e.target.value))}
          >
            {[10, 25, 50, 100, 250].map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button className="btn" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
