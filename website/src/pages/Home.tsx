import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import MiniIdeogram from '../components/MiniIdeogram'
import { useJSON } from '../lib/useJSON'
import { Summary } from '../lib/types'
import { TRAIT_CATEGORIES, TRAIT_COLORS } from '../lib/map'

export default function Home() {
  const { data } = useJSON<Summary>('summary.json')
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const c = data?.counts
  const i = data?.insights
  const n = (v?: number) => (v !== undefined ? v.toLocaleString() : '—')

  const contents: [string, number | undefined, string, string][] = [
    ['Linkage QTL', c?.qtl, '/data/qtl', 'interval mapping'],
    ['GWAS loci', c?.gwas_loci, '/data/gwas', `${n(c?.gwas_associations)} associations`],
    ['Meta-QTL', c?.mqtl, '/data/metaqtl', `${n(c?.mqtl_high)} with ≥ 5 studies`],
    ['Epistatic pairs', c?.epistatic, '/data/epistatic', 'two-locus interactions'],
    ['Hotspot regions', c?.hotspots, '/hotspots', 'study-supported'],
    ['Linkage maps', c?.maps, '/linkage-maps', `${n(c?.map_loci)} loci`],
    ['Trait markers', c?.markers, '/markers', `${n(c?.markers_with_primers)} with primers`],
    ['Indexed papers', c?.papers_indexed, '/literature', 'by study type'],
  ]
  const cats = TRAIT_CATEGORIES.filter((t) => !data || data.by_category[t].qtl + data.by_category[t].gwas_loci > 0)
  const maxCat = Math.max(1, ...cats.map((t) => (data ? data.by_category[t].qtl + data.by_category[t].gwas_loci : 1)))

  return (
    <div className="space-y-8">
      {/* hero in the manner of WheatQTLdb V3.0: centred title, embedded search, quick terms */}
      <section className="panel relative overflow-hidden px-5 py-12 sm:px-10 sm:py-16">
        <img src={`${import.meta.env.BASE_URL}images/cotton-field-floyd-county-ga.jpg`} alt="" className="absolute inset-0 h-full w-full object-cover" />
        {/* veil in the theme's surface colour keeps the text readable in every theme */}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgb(var(--n-50) / 0.90) 0%, rgb(var(--n-50) / 0.82) 60%, rgb(var(--n-50) / 0.70) 100%)' }} />
        <a
          href="https://commons.wikimedia.org/wiki/File:Cotton_field,_Floyd_County,_GA,_US.jpg"
          target="_blank" rel="noreferrer"
          className="absolute bottom-2 right-3 z-10 rounded bg-wheat-50/80 px-2 py-0.5 text-[11px] text-wheat-700 hover:underline"
        >
          Photo: cotton field, Floyd County, Georgia · Bubba73 · CC BY-SA 4.0
        </a>
        <div className="relative mx-auto flex max-w-4xl flex-col items-center text-center">
          <span className="badge animate-fade-up !rounded-full !px-3 !py-1">
            <span className="mr-1.5 inline-flex h-2 w-2 rounded-full bg-accent" />
            {data ? `Release ${data.built}` : 'Release'} · the QTLome of <em className="ml-1">Gossypium</em>
          </span>
          <h1 className="mt-5 font-serif text-4xl leading-tight text-wheat-900 animate-fade-up sm:text-6xl">
            Cotton<span className="text-accent">QTLome</span>
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-wheat-800 animate-fade-up" style={{ animationDelay: '.06s' }}>
            An open atlas of published <strong>QTL</strong>, <strong>GWAS loci</strong>, <strong>meta-QTL</strong> and{' '}
            <strong>epistatic QTL</strong> in cotton, integrated from CottonGen, GWAS Atlas, CottonMD, CottonGVD and{' '}
            {n(c?.papers_indexed)} papers.
          </p>
          <form
            onSubmit={(e) => { e.preventDefault(); navigate(q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : '/search') }}
            className="mt-8 flex w-full max-w-2xl items-center gap-2 border border-wheat-200 bg-wheat-50 p-2 shadow-lg animate-fade-up"
            style={{ borderRadius: 'calc(var(--radius) + 4px)', animationDelay: '.12s' }}
          >
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search QTL, trait, marker, gene, reference…"
              className="flex-1 bg-transparent px-3 py-2 text-base text-wheat-900 outline-none placeholder:text-wheat-500"
              aria-label="Search CottonQTLome"
            />
            <button type="submit" className="btn-primary">Search</button>
          </form>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs text-wheat-700 animate-fade-up" style={{ animationDelay: '.18s' }}>
            <span>Try:</span>
            {['fiber strength', 'verticillium', 'lint percentage', 'drought', 'NAU1085'].map((t) => (
              <button key={t} onClick={() => navigate(`/search?q=${encodeURIComponent(t)}`)}
                className="rounded-full border border-wheat-300 bg-wheat-50 px-3 py-1 transition hover:border-accent hover:text-accent">
                {t}
              </button>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-2 animate-fade-up" style={{ animationDelay: '.24s' }}>
            <Link to="/data" className="btn-primary">Browse data</Link>
            <Link to="/map" className="btn">Genome map</Link>
            <Link to="/hotspots" className="btn">Hotspots</Link>
            <Link to="/linkage-maps" className="btn">Linkage maps</Link>
          </div>
          {data && <p className="mt-5 text-sm font-medium text-wheat-800">{n(c?.loci)} loci · {c!.studies_with_data} studies · {c!.traits} named traits</p>}
          <p className="mt-3 rounded-full border border-wheat-200 bg-wheat-50/90 px-4 py-1.5 text-sm font-medium text-wheat-900">
            Developed by the Peng Chee Lab · Cotton Molecular Biology Laboratory · University of Georgia
          </p>
        </div>
      </section>

      {/* contents: one ruled strip across the page */}
      <section className="panel grid grid-cols-2 overflow-hidden sm:grid-cols-4 2xl:grid-cols-8">
        {contents.map(([label, value, to, note]) => (
          <Link key={label} to={to} className="group -mb-px -mr-px border-b border-r border-wheat-200 p-4 transition hover:bg-accent-soft sm:p-5">
            <div className="font-serif text-3xl text-wheat-900 2xl:text-4xl">{n(value)}</div>
            <div className="mt-1 font-medium text-accent group-hover:underline">{label}</div>
            <div className="text-sm text-wheat-500">{note}</div>
          </Link>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="panel p-6">
          <h2 className="font-serif text-2xl text-wheat-900">Trait categories</h2>
          <p className="mt-1 text-sm text-wheat-600">Linkage QTL and GWAS loci per category; select one to search it.</p>
          <div className="mt-4 space-y-2.5">
            {cats.map((t) => {
              const q = data?.by_category[t].qtl ?? 0
              const g = data?.by_category[t].gwas_loci ?? 0
              return (
                <Link key={t} to={`/search?trait=${encodeURIComponent(t)}`} className="group grid grid-cols-[9.5rem_1fr_auto] items-center gap-3 text-[15px]">
                  <span className="text-wheat-900 group-hover:underline">{t}</span>
                  <span className="h-3 bg-wheat-100">
                    <span className="block h-3" style={{ width: `${Math.max(1, ((q + g) / maxCat) * 100)}%`, background: TRAIT_COLORS[t] }} />
                  </span>
                  <span className="w-28 text-right tabular-nums text-wheat-600">{(q + g).toLocaleString()}</span>
                </Link>
              )
            })}
          </div>
        </div>

        <div className="panel p-6">
          <h2 className="font-serif text-2xl text-wheat-900">Findings from the compiled record</h2>
          {i && (
            <ol className="mt-4 space-y-4">
              {[
                [`${(i.subgenome.frac_Dt * 100).toFixed(0)}%`, `of study-level loci lie on the Dt subgenome, which is only ${(i.subgenome.frac_Dt_length * 100).toFixed(0)}% of the genome by length. The parity holds in every trait category.`],
                [`${i.hotspots.n_hotspots}`, `hotspot regions cover ${(i.hotspots.genome_fraction * 100).toFixed(1)}% of the genome and hold ${(i.hotspots.fraction_loci_in_hotspots * 100).toFixed(0)}% of placed loci; most lie near chromosome ends.`],
                [`${n(c?.mqtl_high)}`, `meta-QTL rest on five or more independent studies, out of ${n(c?.mqtl)} computed across ${c?.mqtl_traits} traits.`],
                [`${i.effects.median_pve.toFixed(1)}%`, `is the median phenotypic variance explained by a linkage QTL; only ${(i.effects.frac_ge10 * 100).toFixed(0)}% explain 10% or more.`],
              ].map(([big, text]) => (
                <li key={text} className="grid grid-cols-[6.5rem_1fr] items-baseline gap-4 border-b border-wheat-200 pb-4 last:border-0 last:pb-0">
                  <span className="text-right font-serif text-3xl text-accent">{big}</span>
                  <span className="leading-relaxed text-wheat-800">{text}</span>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-4 text-sm"><Link className="underline" to="/insights">All findings, with tests and figures</Link></p>
        </div>
      </section>

      <section className="panel p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-serif text-2xl text-wheat-900">Where the loci are</h2>
          <Link className="text-sm underline" to="/hotspots">Explore hotspots interactively</Link>
        </div>
        <p className="mt-1 text-sm text-wheat-600">Independent studies reporting a locus in each 2-Mb window across the 26 chromosomes; the dashed line is the hotspot threshold.</p>
        <img
          src={`${import.meta.env.BASE_URL}figures/fig3_genomewide_hotspots.png`}
          alt="Number of independent studies per 2-Mb window across the 26 cotton chromosomes, with the hotspot threshold"
          loading="lazy"
          className="mt-4 w-full"
        />
      </section>

      <section className="border-t border-wheat-300 pt-4 text-sm leading-relaxed text-wheat-700">
        <strong className="text-wheat-900">Reliability.</strong> Records marked <span className="badge">database</span> were curated or computed by the
        source databases. Records marked <span className="badge">auto-extracted</span> were parsed automatically from tables in papers
        and have not been reviewed by a person; use them to find the paper, then confirm the values there.{' '}
        <Link className="underline" to="/faq">Methods and limits</Link>.
      </section>
    </div>
  )
}
