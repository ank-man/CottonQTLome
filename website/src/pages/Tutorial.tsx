import { Link } from 'react-router-dom'
import { Download } from 'lucide-react'
import PageHero from '../components/PageHero'
import guide from '../lib/guide.json'

// The guide is generated: scripts/guide/build.sh takes the screenshots, draws
// the numbered arrows and writes src/lib/guide.json together with the Word
// version, so this page and the downloadable document always match.
interface GuideSection {
  id: string
  title: string
  intro: string
  image: string
  width: number
  height: number
  callouts: { n: number; label: string; text: string }[]
}

const sections = guide as GuideSection[]
const asset = (p: string) => `${import.meta.env.BASE_URL}${p}`

const TASKS: { title: string; to: string; cta: string }[] = [
  { title: 'Find loci for a trait', to: '/search?trait=Fiber%20quality', cta: 'Open search' },
  { title: 'Look at a genomic region', to: '/search?chromosome=D11', cta: 'Search D11' },
  { title: 'Prioritise stable regions', to: '/hotspots', cta: 'Open hotspots' },
  { title: 'See the genome-wide picture', to: '/map', cta: 'Open map' },
  { title: 'Go back to the source', to: '/literature', cta: 'Open literature' },
]

export default function Tutorial() {
  return (
    <div>
      <PageHero
        eyebrow="Documentation"
        title="User guide"
        subtitle="A tour of CottonQTLome, page by page. Each screenshot is numbered, and the list beside it explains every numbered item."
        variant="side"
      />

      <div className="card mb-6 flex flex-wrap items-center gap-4">
        <nav aria-label="Guide sections" className="min-w-0 flex-1">
          <ol className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {sections.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-wheat-700 hover:text-accent hover:underline">
                  <span className="tabular-nums text-wheat-400">{i + 1}.</span> {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <a href={asset('CottonQTLome_User_Guide.docx')} download className="btn-primary flex-shrink-0">
          <Download className="h-4 w-4" /> Download as Word
        </a>
      </div>

      <div className="mb-10 flex flex-wrap items-center gap-2 text-sm">
        <span className="mr-1 font-semibold text-wheat-900">Common tasks:</span>
        {TASKS.map((t) => (
          <Link key={t.title} to={t.to} className="btn" title={t.cta}>{t.title}</Link>
        ))}
      </div>

      <div className="space-y-12">
        {sections.map((s, i) => (
          <section key={s.id} id={s.id} className="scroll-mt-20">
            <h2 className="font-serif text-2xl text-wheat-900">
              <span className="text-wheat-400">{i + 1}.</span> {s.title}
            </h2>
            <p className="mt-2 max-w-3xl text-wheat-700">{s.intro}</p>
            <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
              <a href={asset(`images/guide/${s.image}`)} target="_blank" rel="noreferrer" title="Open the full-size screenshot">
                <img
                  src={asset(`images/guide/${s.image}`)}
                  alt={`${s.title}: screenshot with numbered arrows`}
                  width={s.width}
                  height={s.height}
                  loading="lazy"
                  className="h-auto w-full rounded-xl border border-wheat-200 shadow-sm"
                />
              </a>
              <ol className="space-y-3 text-sm">
                {s.callouts.map((c) => (
                  <li key={c.n} className="flex gap-3">
                    <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white">
                      {c.n}
                    </span>
                    <p className="leading-relaxed text-wheat-700">
                      <strong className="text-wheat-900">{c.label}.</strong> {c.text}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        ))}
      </div>

      <p className="mt-12 text-sm text-wheat-600">
        Questions, corrections or new data: see <Link to="/faq" className="underline">FAQ &amp; methods</Link> or
        the <Link to="/contact" className="underline">Contact</Link> page.
      </p>
    </div>
  )
}
