import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Upload, FileDown, X, ClipboardPaste, AlertTriangle, CheckCircle2, Download, Play } from 'lucide-react'
import {
  ColumnMapping,
  DEMO_FILES,
  MapResult,
  ParsedTable,
  PositionUnit,
  getUserDataset,
  guessUnit,
  mapRows,
  parseText,
  readFile,
  setUserDataset,
} from '../lib/userData'
import { downloadCSV } from '../lib/csv'
import { AssemblyInfo } from '../lib/assemblies'

const ACCEPT = '.csv,.tsv,.txt,.tab,.assoc,.ps,.bed,.bedgraph,.gff,.gff3,.gtf,.vcf,.json,.xlsx,.xls,.xlsm,.ods,.gz'
const DEMO_BASE = `${import.meta.env.BASE_URL}data/demo/`

const FIELDS: { key: keyof ColumnMapping; label: string; required?: boolean; hint: string }[] = [
  { key: 'chromosome', label: 'Chromosome', required: true, hint: 'A01–D13, Chr01–Chr26, Ghir_A01, chrA01…' },
  { key: 'start', label: 'Position / start', required: true, hint: 'A single position, a start, or a "12.1-14.8" range' },
  { key: 'end', label: 'End', hint: 'Leave empty for single positions' },
  { key: 'name', label: 'Name / ID', hint: 'Shown on hover and as labels' },
  { key: 'trait', label: 'Trait', hint: 'Matched to a trait category for colour' },
  { key: 'value', label: 'Value', hint: 'LOD, P, −log10 P, PVE, score… sets mark length' },
]

interface Props {
  onChange: (result: MapResult | null) => void
  /** Assemblies a user's positions can be on, and the one chosen. */
  assemblies?: AssemblyInfo[]
  assembly?: string
  onAssembly?: (key: string) => void
}

/** Upload, paste or load-a-demo panel that turns a user file into map items. */
export default function UserDataPanel({ onChange, assemblies = [], assembly, onAssembly }: Props) {
  const asmLengths = assemblies.find((a) => a.key === assembly)?.lengths
  const saved = getUserDataset()
  const [table, setTable] = useState<ParsedTable | null>(saved?.table ?? null)
  const [mapping, setMapping] = useState<ColumnMapping | null>(saved?.mapping ?? null)
  const [unit, setUnit] = useState<PositionUnit>(saved?.unit ?? 'bp')
  const [minValue, setMinValue] = useState<string>(saved?.minValue != null ? String(saved.minValue) : '')
  const [source, setSource] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasted, setPasted] = useState('')
  const [open, setOpen] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = (t: ParsedTable, file: File | null) => {
    setTable(t)
    setMapping(t.mapping)
    setUnit(t.unit)
    setMinValue('')
    setSource(file)
    setError(null)
  }

  const handleFile = async (file: File, sheet?: string) => {
    setBusy(true)
    try {
      load(await readFile(file, sheet), file)
    } catch (e) {
      setError(`Could not read ${file.name}: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const loadDemo = async (name: string) => {
    setBusy(true)
    try {
      const res = await fetch(DEMO_BASE + name)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      await handleFile(new File([blob], name))
    } catch (e) {
      setError(`Could not load the demo file: ${e instanceof Error ? e.message : String(e)}`)
      setBusy(false)
    }
  }

  const loadPasted = () => {
    try {
      load(parseText(pasted, 'Pasted data', ''), null)
      setPasteOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const clear = () => {
    setTable(null)
    setMapping(null)
    setSource(null)
    setError(null)
  }

  // /map?demo=demo_gwas_summary.tsv opens the map with that demo file plotted.
  useEffect(() => {
    const demo = new URLSearchParams(window.location.search).get('demo')
    if (demo && !table && DEMO_FILES.some((d) => d.file === demo)) loadDemo(demo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const threshold = minValue.trim() === '' ? null : Number(minValue)
  const result = useMemo(() => {
    if (!table || !mapping || !mapping.chromosome || !mapping.start) return null
    return mapRows(table, mapping, unit, threshold != null && Number.isFinite(threshold) ? threshold : null, asmLengths)
  }, [table, mapping, unit, threshold, asmLengths])

  useEffect(() => {
    onChange(result)
    setUserDataset(table && mapping ? { table, mapping, unit, minValue: threshold } : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result])

  const setField = (k: keyof ColumnMapping, v: string) => {
    if (!mapping || !table) return
    const next = { ...mapping, [k]: v }
    setMapping(next)
    if (k === 'start') setUnit(guessUnit(table.rows, next))
  }

  const cmWarning = mapping?.start && /c\.?m\b|centimorgan|_cm$|\(cm\)/i.test(mapping.start)

  const exportMapped = () => {
    if (!result) return
    downloadCSV(
      `${(table?.fileName || 'my_data').replace(/\.[^.]+$/, '')}_mapped.csv`,
      result.items.map((i) => ({
        name: i.name,
        chromosome: i.chromosome,
        start_bp: Math.round(i.start),
        end_bp: Math.round(i.end),
        trait: i.traitText,
        trait_category: i.trait,
        [result.valueLabel || 'value']: i.value ?? '',
      })),
    )
  }

  const totalSkipped = result?.skipped.reduce((s, x) => s + x.count, 0) ?? 0
  const belowThreshold = result?.skipped.find((s) => s.reason === 'Below the value threshold')?.count ?? 0

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button className="flex items-center gap-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Upload className="h-5 w-5 text-wheat-600 dark:text-wheat-400" />
          <h3 className="text-lg font-semibold text-wheat-900 dark:text-wheat-50">Plot your own data</h3>
          {result && (
            <span className="rounded-full bg-wheat-100 dark:bg-ink-800 px-2 py-0.5 text-xs font-medium text-wheat-700 dark:text-wheat-300">
              {result.items.length.toLocaleString()} loci from {table?.fileName}
            </span>
          )}
          <span className="text-xs text-wheat-500 dark:text-wheat-400">{open ? 'Hide' : 'Show'}</span>
        </button>
        {table && (
          <div className="flex items-center gap-2">
            {result && result.items.length > 0 && (
              <button className="btn text-xs" onClick={exportMapped} title="Download the rows as they were placed on the map">
                <Download className="h-3.5 w-3.5" /> Mapped rows (CSV)
              </button>
            )}
            <button className="btn text-xs" onClick={clear}>
              <X className="h-3.5 w-3.5" /> Remove
            </button>
          </div>
        )}
      </div>

      {open && (
        <div className="mt-4 space-y-4">
          {!table && (
            <>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragging(false)
                  const f = e.dataTransfer.files[0]
                  if (f) handleFile(f)
                }}
                onClick={() => inputRef.current?.click()}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
                role="button"
                tabIndex={0}
                className={`flex cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed px-4 py-8 text-center transition ${
                  dragging
                    ? 'border-wheat-600 bg-wheat-100 dark:bg-ink-800'
                    : 'border-wheat-300 dark:border-ink-700 hover:border-wheat-500 hover:bg-wheat-50 dark:hover:bg-ink-900/40'
                }`}
              >
                <Upload className="h-8 w-8 text-wheat-500 dark:text-wheat-400" />
                <p className="mt-2 font-medium text-wheat-800 dark:text-wheat-100">
                  {busy ? 'Reading…' : 'Drop a file here, or click to choose one'}
                </p>
                <p className="mt-1 text-xs text-wheat-600 dark:text-wheat-400">
                  CSV · TSV / TXT · Excel (.xlsx, .xls, .ods) · BED · GFF3 / GTF · VCF · JSON · PLINK / GEMMA output · any of these gzipped (.gz)
                </p>
                <p className="mt-1 text-xs text-wheat-500 dark:text-wheat-400">
                  The file is read in your browser and never leaves your computer.
                </p>
                <input
                  ref={inputRef}
                  type="file"
                  accept={ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleFile(f)
                    e.target.value = ''
                  }}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button className="btn text-xs" onClick={() => setPasteOpen(!pasteOpen)}>
                  <ClipboardPaste className="h-3.5 w-3.5" /> Paste from a spreadsheet
                </button>
                <span className="text-xs text-wheat-500 dark:text-wheat-400">
                  Copy cells (with the header row) from Excel or Google Sheets and paste them.
                </span>
              </div>
              {pasteOpen && (
                <div className="space-y-2">
                  <textarea
                    className="input h-32 w-full font-mono text-xs"
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    placeholder={'name\tchromosome\tstart\tend\ttrait\nqFL-A07.1\tA07\t15200000\t17850000\tfiber length'}
                  />
                  <button className="btn text-xs" onClick={loadPasted} disabled={!pasted.trim()}>
                    Plot pasted data
                  </button>
                </div>
              )}

              <div>
                <p className="mb-2 text-sm font-medium text-wheat-700 dark:text-wheat-300">
                  Try a demo file <span className="font-normal text-wheat-500 dark:text-wheat-400">(synthetic data, one per format)</span>
                </p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {DEMO_FILES.map((d) => (
                    <div key={d.file} className="flex items-start justify-between gap-2 rounded border border-wheat-200 dark:border-ink-700 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-wheat-800 dark:text-wheat-100">
                          {d.label} <span className="text-[10px] font-semibold text-wheat-500 dark:text-wheat-400">{d.format}</span>
                        </p>
                        <p className="text-xs text-wheat-600 dark:text-wheat-400">{d.description}</p>
                      </div>
                      <div className="flex shrink-0 flex-col gap-1">
                        {d.file.startsWith('demo_') && (
                          <button className="btn px-2 py-0.5 text-[11px]" onClick={() => loadDemo(d.file)} disabled={busy} title="Plot this file now">
                            <Play className="h-3 w-3" /> Plot
                          </button>
                        )}
                        <a className="btn px-2 py-0.5 text-[11px]" href={DEMO_BASE + d.file} download title="Download this file">
                          <FileDown className="h-3 w-3" /> Get
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-wheat-500 dark:text-wheat-400">
                  Positions can be on any listed assembly: you choose it after loading, and they are converted to the one the map
                  is drawn on. Genetic-map (cM) positions belong in the <Link className="underline" to="/plot/linkage-map">linkage-map plotter</Link>.{' '}
                  <a className="underline" href={DEMO_BASE + 'README.txt'} download>Format notes</a>
                </p>
              </div>
            </>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {table && mapping && (
            <>
              <div className="text-xs text-wheat-600 dark:text-wheat-400">
                <span className="font-medium text-wheat-800 dark:text-wheat-100">{table.fileName}</span> · {table.format} ·{' '}
                {table.rows.length.toLocaleString()} rows · {table.columns.length} columns
                {table.notes.length > 0 && <> · {table.notes.join(' ')}</>}
              </div>

              {table.sheets && table.sheets.length > 1 && source && (
                <label className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-wheat-700 dark:text-wheat-300">Sheet</span>
                  <select className="input w-auto text-sm" value={table.sheet} onChange={(e) => handleFile(source, e.target.value)}>
                    {table.sheets.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </label>
              )}

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                {FIELDS.map((f) => (
                  <label key={f.key} className="block">
                    <span className="text-xs font-medium text-wheat-700 dark:text-wheat-300">
                      {f.label}{f.required && <span className="text-red-600"> *</span>}
                    </span>
                    <select
                      className={`input mt-1 w-full text-sm ${f.required && !mapping[f.key] ? 'border-red-400' : ''}`}
                      value={mapping[f.key]}
                      onChange={(e) => setField(f.key, e.target.value)}
                      title={f.hint}
                    >
                      <option value="">{f.required ? '— choose a column —' : '— none —'}</option>
                      {table.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                ))}
              </div>

              <div className="flex flex-wrap items-end gap-4">
                {assemblies.length > 0 && onAssembly && (
                  <label className="block">
                    <span className="text-xs font-medium text-wheat-700 dark:text-wheat-300">
                      My positions are on<span className="text-red-600"> *</span>
                    </span>
                    <select
                      className="input mt-1 w-auto max-w-xs text-sm"
                      value={assembly}
                      onChange={(e) => onAssembly(e.target.value)}
                      title="The genome assembly your coordinates were called on; they are converted to the assembly the map is drawn on"
                    >
                      {['Gossypium hirsutum', 'Gossypium barbadense'].map((sp) => (
                        <optgroup key={sp} label={sp}>
                          {assemblies.filter((a) => a.species === sp).map((a) => (
                            <option key={a.key} value={a.key}>{a.label}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <span className="mt-1 block max-w-xs text-[11px] text-wheat-500">
                      Not listed (e.g. BGI v1, HAU v1.1/v2, WHU v1)? Pick TM-1 UTX v2.1: positions are then drawn as given, without conversion.
                    </span>
                  </label>
                )}
                <label className="block">
                  <span className="text-xs font-medium text-wheat-700 dark:text-wheat-300">Position unit</span>
                  <select className="input mt-1 w-auto text-sm" value={unit} onChange={(e) => setUnit(e.target.value as PositionUnit)}>
                    <option value="bp">bp</option>
                    <option value="kb">kb</option>
                    <option value="Mb">Mb</option>
                  </select>
                </label>
                {mapping.value && (
                  <label className="block">
                    <span className="text-xs font-medium text-wheat-700 dark:text-wheat-300">
                      Keep rows with {result?.valueLabel || 'value'} ≥
                    </span>
                    <input
                      type="number"
                      step="any"
                      className="input mt-1 w-28 text-sm"
                      value={minValue}
                      onChange={(e) => setMinValue(e.target.value)}
                      placeholder={result?.valueIsP ? 'e.g. 5' : 'no filter'}
                    />
                  </label>
                )}
                {result?.valueIsP && (
                  <p className="text-xs text-wheat-600 dark:text-wheat-400">
                    “{mapping.value}” holds P-values, so marks are scaled by −log10(P).
                  </p>
                )}
              </div>

              {cmWarning && (
                <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  The position column looks like a genetic-map position (cM). The map is physical, so cM values would be drawn in the wrong place.
                </p>
              )}

              {result && (
                <div className="space-y-1 text-xs">
                  <p className={`flex items-center gap-1.5 ${result.items.length ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
                    {result.items.length ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                    {result.items.length.toLocaleString()} of {table.rows.length.toLocaleString()} rows placed
                    {result.items.filter((i) => i.isInterval).length > 0 &&
                      ` (${result.items.filter((i) => i.isInterval).length.toLocaleString()} intervals)`}
                    {belowThreshold > 0 && ` · ${belowThreshold.toLocaleString()} below the threshold`}
                    {result.truncated && ` · capped at ${result.items.length.toLocaleString()} for drawing; raise the threshold to see the strongest`}
                  </p>
                  {totalSkipped - belowThreshold > 0 &&
                    result.skipped
                      .filter((s) => s.reason !== 'Below the value threshold')
                      .map((s) => (
                        <p key={s.reason} className="text-amber-700 dark:text-amber-400">
                          {s.count.toLocaleString()} skipped: {s.reason}
                          {s.examples.length > 0 && <> (e.g. {s.examples.map((x) => `“${x}”`).join(', ')})</>}
                        </p>
                      ))}
                </div>
              )}

              {result && result.items.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-wheat-600 dark:text-wheat-400">
                      <tr>
                        <th className="py-1 pr-3 font-medium">Name</th>
                        <th className="py-1 pr-3 font-medium">Chromosome</th>
                        <th className="py-1 pr-3 font-medium">Start (Mb)</th>
                        <th className="py-1 pr-3 font-medium">End (Mb)</th>
                        <th className="py-1 pr-3 font-medium">Trait → category</th>
                        {result.valueLabel && <th className="py-1 pr-3 font-medium">{result.valueLabel}</th>}
                      </tr>
                    </thead>
                    <tbody className="text-wheat-800 dark:text-wheat-200">
                      {result.items.slice(0, 5).map((i) => (
                        <tr key={i.id} className="border-t border-wheat-100 dark:border-ink-800">
                          <td className="py-1 pr-3">{i.name}</td>
                          <td className="py-1 pr-3">{i.chromosome}</td>
                          <td className="py-1 pr-3">{(i.start / 1e6).toFixed(3)}</td>
                          <td className="py-1 pr-3">{(i.end / 1e6).toFixed(3)}</td>
                          <td className="py-1 pr-3">{i.traitText ? `${i.traitText} → ${i.trait}` : '—'}</td>
                          {result.valueLabel && <td className="py-1 pr-3">{i.value == null ? '—' : i.value.toFixed(2)}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {result.items.length > 5 && (
                    <p className="mt-1 text-[11px] text-wheat-500 dark:text-wheat-400">First 5 of {result.items.length.toLocaleString()} shown.</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
