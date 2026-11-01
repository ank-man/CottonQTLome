import { Link } from 'react-router-dom'
import PageHero from '../components/PageHero'
import AsyncBoundary from '../components/AsyncBoundary'
import Figure from '../components/Figure'
import { useJSON } from '../lib/useJSON'
import { Summary } from '../lib/types'

const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`
const sci = (x: number) => (x < 1e-300 ? '< 1e-300' : x < 0.001 ? x.toExponential(1) : x.toFixed(3))

export default function InsightsPage() {
  const { data, loading, error } = useJSON<Summary>('summary.json')
  const i = data?.insights
  return (
    <div>
      <PageHero
        eyebrow="Analysis"
        title="Insights from the compiled data"
        subtitle="What the combined QTL and GWAS record says about where trait loci sit in the cotton genome - with the tests behind each statement and the limits of the data."
        variant="side"
      />
      <AsyncBoundary loading={loading} error={error}>
        {i && data && (
          <div className="space-y-6">
            <div className="card">
              <h3 className="text-lg font-semibold text-wheat-900">Key findings</h3>
              <p className="mt-1 text-sm text-wheat-600">
                Based on {i.n_records.toLocaleString()} de-duplicated QTL and GWAS records ({i.n_loci.toLocaleString()} loci,{' '}
                {i.n_studies} studies) from allotetraploid cotton with an assigned chromosome.
              </p>
              <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-relaxed text-wheat-800">
                <li>
                  <strong>The Dt subgenome is as rich in trait loci as At despite being about half its size.</strong>{' '}
                  Dt makes up {pct(i.subgenome.frac_Dt_length, 1)} of the assembled chromosomes but carries {pct(i.subgenome.frac_Dt, 1)} of
                  study-level loci ({i.subgenome.Dt.toLocaleString()} of {(i.subgenome.At + i.subgenome.Dt).toLocaleString()}). That is far more
                  than its length predicts (binomial P = {sci(i.subgenome.p_vs_length)}) and not different from an even
                  13:13 chromosome split (P = {i.subgenome.p_vs_equal.toFixed(2)}). The pattern holds in every trait category.
                </li>
                <li>
                  <strong>{i.hotspots.n_hotspots} hotspot regions cover {pct(i.hotspots.genome_fraction, 1)} of the genome and hold{' '}
                  {pct(i.hotspots.fraction_loci_in_hotspots, 1)} of placed loci.</strong>{' '}
                  A hotspot window has loci from at least {i.hotspots.threshold_studies} independent studies, against about{' '}
                  {i.hotspots.null_mean.toFixed(0)} expected by chance. {i.hotspots.hotspots_Dt} hotspots are on Dt and {i.hotspots.hotspots_At} on At.
                  {data.top_hotspots?.length ? <>The best supported are {list(data.top_hotspots.map((h) => `${h.chr} ${h.start_mb}–${h.end_mb} Mb (${h.studies} studies)`))}.{' '}</> : null}
                  <Link className="underline" to="/hotspots">Browse them</Link>.
                </li>
                <li>
                  <strong>{data.counts.mqtl.toLocaleString()} meta-QTL summarise the placed loci; {data.counts.mqtl_high.toLocaleString()} rest on five or more studies.</strong>{' '}
                  {data.counts.mqtl_qtl_gwas.toLocaleString()} are supported by both linkage QTL and GWAS associations, and{' '}
                  {data.counts.mqtl_in_hotspots.toLocaleString()} lie inside hotspot regions.{' '}
                  {data.top_mqtl?.length ? <>The best supported are {list(data.top_mqtl.map((m) => `${m.trait} on ${m.chr} near ${m.pos_mb} Mb (${m.studies} studies)`))}.{' '}</> : null}
                  <Link className="underline" to="/data/metaqtl">Browse meta-QTL</Link>.
                </li>
                <li>
                  <strong>Loci pile up toward chromosome ends.</strong>{' '}
                  Windows within 20% of a chromosome end average {i.distal.mean_studies_distal20.toFixed(1)} studies, against{' '}
                  {i.distal.mean_studies_central.toFixed(1)} in the interior (Spearman ρ = {i.distal.spearman_rho.toFixed(2)} between
                  distance to the nearest end and study support). This matches where genes and recombination concentrate in cotton,
                  so it is expected partly for structural reasons.
                </li>
                <li>
                  <strong>Most linkage QTL have small effects.</strong>{' '}
                  Across {i.effects.n.toLocaleString()} QTL with a reported PVE, the median is {i.effects.median_pve.toFixed(1)}%;
                  only {pct(i.effects.frac_ge10)} explain 10% or more and {pct(i.effects.frac_ge20, 1)} explain 20% or more.
                </li>
                <li>
                  <strong>No chromosome specialises in a trait category.</strong>{' '}
                  A category × chromosome test finds no departure from independence (χ² = {i.trait_chr.chi2.toFixed(0)},{' '}
                  {i.trait_chr.dof} d.f., P = {i.trait_chr.p.toFixed(2)}): fiber, yield, architecture and stress loci are spread over
                  all 26 chromosomes in similar proportions. Hotspots are correspondingly multi-trait.
                </li>
                <li>
                  <strong>Homoeologous chromosomes do not show clearly matching hotspot profiles.</strong>{' '}
                  Density profiles of A/D homoeologs correlate at a median ρ of {i.homoeolog.median_rho_homoeologous.toFixed(2)},
                  only slightly above non-homoeologous pairs ({i.homoeolog.median_rho_other.toFixed(2)}; one-sided P ={' '}
                  {i.homoeolog.mannwhitney_p.toFixed(2)}). Most of the shared signal is the general distal enrichment.
                </li>
                <li>
                  <strong>GWAS has nearly caught up with linkage mapping.</strong>{' '}
                  In {i.literature.last_year}, {i.literature.gwas_last} GWAS papers were indexed against {i.literature.linkage_last} linkage-QTL
                  papers; in 2015 it was {i.literature.gwas_2015} against {i.literature.linkage_2015}.
                </li>
              </ol>
            </div>

            <Figure name="fig3_genomewide_hotspots" title="Genome-wide study support and hotspot threshold">
              Number of independent studies with at least one QTL or GWAS locus in each 2-Mb window, across the 26 chromosomes
              (alternating shades separate chromosomes). The dashed line is the permutation threshold at FDR 0.01; the eight
              hotspots with the highest single-window support are labelled.
            </Figure>
            <div className="grid gap-6 lg:grid-cols-2">
              <Figure name="fig1_loci_density_per_chromosome" title="Dt chromosomes carry more loci per megabase">
                Loci per Mb for each chromosome (lengths from TM-1 UTX v2.1). Every Dt chromosome exceeds the At average;
                D11 and D03 are densest.
              </Figure>
              <Figure name="fig5_subgenome_share_by_trait" title="Dt share of loci by trait category">
                Share of study-level loci (one vote per study × trait × chromosome) on Dt. The solid line marks an equal split,
                the dashed line Dt’s share of genome length.
              </Figure>
            </div>
            <Figure name="fig2_trait_by_chromosome_enrichment" title="Trait categories across chromosomes">
              Adjusted residuals of a trait-category × chromosome table of study-level loci. Blue = fewer than expected,
              red = more; cells would be dotted if significant after FDR correction.
            </Figure>
            <div className="grid gap-6 lg:grid-cols-2">
              <Figure name="fig7_qtl_effect_sizes" title="Effect sizes of linkage QTL">
                Distribution of phenotypic variance explained (PVE). Datasets that report PVE as a fraction were converted to percent.
              </Figure>
              <Figure name="fig6_papers_per_year" title="Cotton QTL and GWAS papers per year">
                Papers indexed from Europe PMC by study type (a paper can count in more than one line).
              </Figure>
            </div>

            <div className="card text-sm leading-relaxed text-wheat-700">
              <h3 className="mb-2 text-lg font-semibold text-wheat-900">Read these with care</h3>
              <ul className="list-disc space-y-1.5 pl-5">
                <li>About two thirds of the records were extracted automatically from paper tables and have not been manually checked; some chromosome or position assignments will be wrong.</li>
                <li>Counts follow research effort. Fiber quality and yield dominate, and <em>G. hirsutum</em> and <em>G. barbadense</em> supply nearly all records.</li>
                <li>Physical positions come from several genome assemblies. They are converted onto TM-1 UTX v2.1 by sequence alignment where the source genome is available; records on G. barbadense HAU v2, TM-1 HAU v1.1, WHU v1, BGI v1 or an unstated assembly are placed by relative position, accurate to a few Mb.</li>
                <li>Linkage QTL reported only in cM are included in chromosome-level counts but not in the hotspot analysis.</li>
                <li>Study-level counting reduces, but does not remove, the influence of a few very large GWAS panels.</li>
              </ul>
              <p className="mt-3">
                The analysis script (<code>analysis/hotspot_analysis.py</code>) and its tables are part of the project repository.
              </p>
            </div>
          </div>
        )}
      </AsyncBoundary>
    </div>
  )
}
