import PageHero from '../components/PageHero'
import AsyncBoundary from '../components/AsyncBoundary'
import { useJSON } from '../lib/useJSON'

type FileEntry = { group: string; title: string; path: string; description: string; rows: number; columns: number; bytes: number }
type Manifest = { files: FileEntry[]; release: string; release_files: { title: string; file: string }[] }

const size = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} kB`)

export default function DownloadsPage() {
  const { data, error } = useJSON<Manifest>('downloads.json')
  const groups = data ? [...new Set(data.files.map((f) => f.group))] : []
  const base = `${import.meta.env.BASE_URL}data/`
  return (
    <div>
      <PageHero
        eyebrow="Data"
        title="Downloads"
        subtitle="Every table in CottonQTLome as a CSV file (.csv.gz files open in Excel, R or Python after unzipping, or directly with read.csv / pandas). Each record names its source paper or database."
        variant="side"
      />
      <AsyncBoundary loading={!data && !error} error={error}>
        {data && (
          <div className="space-y-8">
            {groups.map((g) => (
              <section key={g}>
                <h2 className="mb-2 text-lg font-semibold text-wheat-900">{g}</h2>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-wheat-300 text-left text-wheat-600">
                        <th className="py-2 pr-4 font-medium">File</th>
                        <th className="py-2 pr-4 font-medium">Content</th>
                        <th className="py-2 pr-4 text-right font-medium">Rows</th>
                        <th className="py-2 text-right font-medium">Size</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.files.filter((f) => f.group === g).map((f) => (
                        <tr key={f.path} className="border-b border-wheat-200 align-top">
                          <td className="w-60 py-2 pr-4">
                            <a className="underline" href={`${base}${f.path}`} download={`cottonqtlome_${f.path.split('/').pop()}`}>{f.title}</a>
                          </td>
                          <td className="py-2 pr-4 text-wheat-700">{f.description}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">{f.rows.toLocaleString()}</td>
                          <td className="py-2 text-right tabular-nums text-wheat-600">{size(f.bytes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
            <section className="card text-sm leading-relaxed text-wheat-700">
              <h2 className="mb-2 text-lg font-semibold text-wheat-900">Complete database files</h2>
              <p className="mb-2">
                Too large for the website, these are attached to the{' '}
                <a className="underline" href={data.release}>latest GitHub release</a>:
              </p>
              <ul className="list-disc space-y-1 pl-5">
                {data.release_files.map((r) => (
                  <li key={r.file}><a className="underline" href={`${data.release}/download/${r.file}`}>{r.file}</a> — {r.title}</li>
                ))}
              </ul>
              <p className="mt-3">
                Column definitions are given on each data page and in the repository README. Please cite the original
                studies (every record carries its PMID or DOI) together with CottonQTLome.
              </p>
            </section>
          </div>
        )}
      </AsyncBoundary>
    </div>
  )
}
