import { Link } from 'react-router-dom'
import PageHero from '../components/PageHero'
import { useJSON } from '../lib/useJSON'
import { Summary } from '../lib/types'

const SOURCES = [
  { name: 'CottonGen', url: 'https://www.cottongen.org', what: 'Curated QTL, GWAS and qualitative trait loci with map and genome positions, populations and citations (full QTL/GWAS export).' },
  { name: 'GWAS Atlas', url: 'https://ngdc.cncb.ac.cn/gwas/', what: 'Manually curated SNP–trait associations for upland cotton.' },
  { name: 'CottonMD', url: 'https://yanglab.hzau.edu.cn/CottonMD', what: 'GWAS results for 45 traits; genome-wide significant loci were derived from SNPs with P < 1e-5.' },
  { name: 'CottonGVD', url: 'https://db.cngb.org/cottonGVD/', what: 'GWAS summaries for five panels; loci are 500-kb bins with −log10(P) ≥ 6 (lead SNPs are not exported by the resource).' },
  { name: 'Literature', url: 'https://europepmc.org', what: 'Tables and supplementary files of open-access papers (Europe PMC / PMC), plus openly served supplements of Springer papers, parsed automatically.' },
]

export default function About() {
  const { data } = useJSON<Summary>('summary.json')
  return (
    <div>
      <PageHero
        eyebrow="About"
        title="About CottonQTLome"
        subtitle="A harmonised compilation of published QTL, GWAS loci, meta-QTL and epistatic QTL for Gossypium species, with redundancy made explicit and genome-wide hotspot analysis."
        variant="side"
      />
      <div className="space-y-6">
        <div className="card text-sm leading-relaxed text-wheat-700">
          <h3 className="mb-2 text-lg font-semibold text-wheat-900">What it is</h3>
          <p>
            Cotton QTL information is scattered across several databases that each cover part of the literature, and across
            the tables and supplements of well over a thousand papers. CottonQTLome pulls these together into one schema:
            one trait vocabulary, one chromosome nomenclature (A01–A13, D01–D13), explicit position units and reference
            assemblies, and a link back to the source of every record.
          </p>
          <p className="mt-2">
            CottonQTLome is developed by the <strong>Peng Chee Lab, Cotton Molecular Biology Laboratory, University of Georgia</strong>.
          </p>
          <p className="mt-2">
            The web interface is adapted from <a className="underline" href="https://github.com/ank-man/WheatQTLdbV3.0" target="_blank" rel="noreferrer">WheatQTLdb V3.0</a>.
            Unlike WheatQTLdb, which is manually curated, the literature-derived part of this database is extracted
            automatically; each record carries an evidence flag for that reason.
          </p>
        </div>

        <div className="card">
          <h3 className="mb-3 text-lg font-semibold text-wheat-900">Data sources</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-wheat-200 text-sm">
              <thead className="bg-wheat-100 text-left">
                <tr><th className="px-3 py-2">Source</th><th className="px-3 py-2">Records</th><th className="px-3 py-2">Content</th></tr>
              </thead>
              <tbody className="divide-y divide-wheat-100">
                {SOURCES.map((s) => (
                  <tr key={s.name}>
                    <td className="whitespace-nowrap px-3 py-2 font-medium"><a className="underline" href={s.url} target="_blank" rel="noreferrer">{s.name}</a></td>
                    <td className="px-3 py-2 tabular-nums">{data ? (data.by_source[s.name] ?? 0).toLocaleString() : ''}</td>
                    <td className="px-3 py-2 text-wheat-700">{s.what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-wheat-500">Record counts are after de-duplication and include all record types.</p>
        </div>

        <div className="card text-sm leading-relaxed text-wheat-700">
          <h3 className="mb-2 text-lg font-semibold text-wheat-900">What was added on top of the sources</h3>
          <ul className="list-disc space-y-1.5 pl-5">
            <li><strong>Trait harmonisation</strong> - {data?.counts.trait_names ? `${data.counts.trait_names.toLocaleString()} distinct` : 'The'} original trait names and abbreviations are mapped by rule to {data?.counts.traits ?? ''} harmonised traits{data?.counts.categories ? ` in ${data.counts.categories} categories` : ''}. Names that cannot be resolved (for example a table of several traits without a trait column) are kept in the downloadable database but left out of the tables and analyses.</li>
            <li><strong>Redundancy handling</strong> - exact repeats are flagged and removed from the tables; records for the same trait that co-localise (same assembly within 500 kb, or same linkage map within 5 cM) share a locus ID.</li>
            <li><strong>GWAS loci</strong> - SNP-level associations are collapsed to one row per locus with the number of associations and studies behind it.</li>
            <li><strong>Evidence flag</strong> - every record is marked as coming from a curated database or as auto-extracted from a paper.</li>
            <li><strong>Coordinate conversion</strong> - Positions published on NAU-NBI v1.1, CRI v1, ZJU v2.1, UTX v2.1/v3.0, the TM-1 T2T and the G. barbadense HGS v1.1 and ZJU Hai7124 assemblies are converted onto TM-1 UTX v2.1 by sequence alignment (5-kb windows every 50 kb mapped with minimap2, interpolated between collinear anchors). Records whose assembly is not stated, or whose genome is not openly downloadable (G. barbadense 3-79 HAU v2, TM-1 HAU v1.1, WHU v1), or whose public sequence does not carry the published coordinates (BGI v1: the NCBI chromosomes are numbered differently and are shorter than many published positions), are still placed by relative position along the chromosome, which is approximate (a few Mb). The map can be drawn on any converted assembly.</li>
            <li><strong>Meta-QTL</strong> - consensus loci per trait computed across all studies on the physical axis (mixture model, BIC), each with a confidence interval, its supporting studies and a confidence tier.</li>
            <li><strong>Hotspots and insights</strong> - a permutation-based scan for regions supported by many independent studies, with subgenome, chromosome and effect-size analyses (<Link className="underline" to="/hotspots">Hotspots</Link>, <Link className="underline" to="/insights">Insights</Link>).</li>
            <li><strong>Literature index</strong> - cotton QTL/GWAS papers tagged by study type, including those whose data could not be retrieved.</li>
          </ul>
        </div>

        <div className="card text-sm leading-relaxed text-wheat-700">
          <h3 className="mb-2 text-lg font-semibold text-wheat-900">Known gaps</h3>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>{data?.counts.papers_not_in_pmc ? `${data.counts.papers_not_in_pmc.toLocaleString()} of the ${data.counts.papers_indexed.toLocaleString()}` : 'Many'} indexed papers have no full text in PubMed Central; for these only the metadata (and, for some Springer papers, the openly served supplements) could be used.</li>
            <li>Supplementary tables published as PDF are not parsed.</li>
            <li>The original CottonQTLdb (Said et al. 2015) is offline and its QTL table was never archived; its content is represented only through the underlying papers and meta-QTL supplements.</li>
            <li>Locus IDs (co-localising records) are assigned on each record’s own assembly, so records from different assemblies share a locus ID only through the meta-QTL and hotspots, which use the converted positions.</li>
            <li>eQTL and TWAS results are not included.</li>
          </ul>
          <p className="mt-3">
            The full database (all records including SNP-level GWAS associations, duplicates with their flags, an SQLite file)
            and every script used to build it are in the project repository; see <Link className="underline" to="/credits">Credits</Link>.
          </p>
        </div>
      </div>
    </div>
  )
}
