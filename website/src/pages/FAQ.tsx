import PageHero from '../components/PageHero'
import { GLOSSARY } from '../lib/glossary'

const QA: [string, string][] = [
  ['Is this database manually curated?',
    'Partly. Records from CottonGen and GWAS Atlas were curated by those resources; CottonMD and CottonGVD loci were derived from their GWAS results. Records from the literature were extracted automatically from tables and supplementary files and have not been reviewed by a person. The Evidence column tells the two apart.'],
  ['How reliable are auto-extracted records?',
    'Column meanings are inferred from table headers, so a minority of rows have a wrong or missing field (for example a QTL name in the wrong column, or a trait left as an environment code). Use them to locate the study and table, then confirm values in the paper. Filtering to “database” evidence gives the conservative subset.'],
  ['Why do I see cM positions for some records and bp for others?',
    'Linkage QTL are reported on each study’s genetic map (cM); GWAS loci and newer QTL studies report physical positions (bp) on a genome assembly. The Unit and Assembly columns say which. cM positions from different maps are not comparable with each other.'],
  ['Which genome assembly do physical positions refer to?',
    'The one named in the Assembly column. “not stated” means the source table did not name it. For the map, the region search, the hotspots and the meta-QTL, positions published on NAU-NBI v1.1, CRI v1, ZJU v2.1, UTX v2.1/v3.0, the TM-1 T2T and the G. barbadense HGS v1.1 and ZJU Hai7124 assemblies are converted onto TM-1 UTX v2.1 by sequence alignment (5-kb windows every 50 kb mapped with minimap2, interpolated between collinear anchors). Records whose assembly is not stated, or whose genome is not openly downloadable (G. barbadense 3-79 HAU v2, TM-1 HAU v1.1, WHU v1), or whose public sequence does not carry the published coordinates (BGI v1: the NCBI chromosomes are numbered differently and are shorter than many published positions), are still placed by relative position along the chromosome, which is approximate (a few Mb). GWAS Atlas associations are placed from the location the authors reported on NAU-NBI v1, not from GWAS Atlas’s own re-mapping to BGI v1, which puts most of them on a different chromosome. The map can be redrawn on any of the converted assemblies, and every locus on every assembly can be downloaded from the map page.'],
  ['Can I plot my own data?',
    'Yes, in two tools under “Plot your data”. The genome plotter takes physical positions (CSV, TSV, Excel, BED, GFF3/GTF, VCF, JSON, PLINK/GEMMA output, gzipped or not), asks which assembly they are on, draws them on the assembly you choose beside the database, and lists the meta-QTL and hotspots each locus falls in. The linkage-map plotter takes a genetic map (marker, group, cM; also MapChart/JoinMap .map and R/qtl cross files) and QTL support intervals in cM, draws them LinkageMapView-style, and assigns each linkage group to a chromosome from the markers it shares with the 154 database maps. Files are read in your browser and never uploaded.'],
  ['How accurate is the conversion between assemblies?',
    'The UTX v2.1 genome is cut into 5 kb windows every 50 kb. Between G. hirsutum TM-1 assemblies, 92-95% of windows align uniquely and in order, so anchors sit about every 50 kb. Checked against markers that CottonGen placed independently on two TM-1 assemblies, a converted position lands a median 216 bp from the other placement and within 75 kb for 90% of markers; larger errors occur where the alignment has gaps. Between G. hirsutum and G. barbadense about 80% of windows are kept. Positions on G. barbadense are placed through the homologous sequence, so the error is larger in repeats and rearranged regions. A locus in a region that is rearranged between two assemblies is placed from the nearest anchor and flagged; an interval whose ends fall on different chromosomes is not converted.'],
  ['How are duplicates handled?',
    'A record is removed as a duplicate when another record has the same type, study, trait, environment or QTL name, chromosome, position and statistics. Co-localising records for the same trait are kept but share a locus ID. GWAS associations are shown as loci; the SNP-level table is in the downloadable database.'],
  ['What is a hotspot here?',
    GLOSSARY.hotspot + ' The null model is uniform across the genome, so hotspots partly reflect gene-rich, recombining chromosome ends.'],
  ['Why are fiber-quality and yield traits so dominant?',
    'They are the most studied traits in cotton. Counts reflect research effort, not the true number of loci per trait.'],
  ['Why does the Dt subgenome look enriched?',
    'Dt chromosomes are about half the physical size of At chromosomes but carry a similar number of reported loci, so loci per megabase is about twice as high on Dt. Counts per chromosome are similar between subgenomes.'],
  ['Where do the meta-QTL come from?',
    'Published cotton meta-analyses report their meta-QTL on consensus genetic maps in cM, which cannot be compared across studies or placed on the genome. CottonQTLome therefore computes its own: for each trait and chromosome, all QTL and GWAS loci with a physical position are placed on the TM-1 UTX v2.1 axis (converted by sequence alignment where the source assembly is available), each study contributes one observation per locus, and a Gaussian mixture model with observation-specific variances (the model used by BioMercator) is fitted, with the number of components chosen by BIC. Components supported by at least two independent studies are kept. Rows taken from published meta-analyses are listed in a separate tab.'],
  ['How reliable is a computed meta-QTL?',
    'It depends on its support. High-confidence meta-QTL rest on five or more independent studies; two-study ones are leads. The confidence interval reflects only the scatter of member loci; where member positions were placed by relative position (assembly not stated or not available), allow a few Mb more. About two thirds of member records were extracted automatically from papers.'],
  ['Why is a paper I know missing or without records?',
    'It may not be indexed under the search terms used, be behind a paywall, publish its QTL only in a PDF supplement or figure, or use a table layout the extractor did not recognise. The Literature page lists every indexed paper and how many records it contributed.'],
  ['Can I download everything?',
    'Every table on the site exports to CSV, including filtered search results. The complete database, including SNP-level associations, flagged duplicates and an SQLite file, is produced by the scripts in the project repository.'],
]

export default function FAQ() {
  return (
    <div>
      <PageHero eyebrow="Documentation" title="FAQ & methodology" subtitle="How records were collected, harmonised and analysed, and how far to trust them." variant="side" />
      <div className="space-y-3">
        {QA.map(([q, a]) => (
          <details key={q} className="card group">
            <summary className="cursor-pointer list-none font-semibold text-wheat-900">{q}</summary>
            <p className="mt-2 text-sm leading-relaxed text-wheat-700">{a}</p>
          </details>
        ))}
      </div>
      <h2 className="mb-3 mt-10 text-xl font-bold text-wheat-900">Glossary</h2>
      <div className="card">
        <dl className="space-y-3 text-sm">
          {Object.entries(GLOSSARY).map(([k, v]) => {
            const [term, ...rest] = v.split(': ')
            return (
              <div key={k}>
                <dt className="font-semibold text-wheat-900">{term}</dt>
                <dd className="text-wheat-700">{rest.join(': ')}</dd>
              </div>
            )
          })}
        </dl>
      </div>
    </div>
  )
}
