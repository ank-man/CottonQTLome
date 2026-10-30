import { Link } from 'react-router-dom'
import PageHero from '../components/PageHero'
import { useJSON } from '../lib/useJSON'
import { Summary } from '../lib/types'

export default function DataIndex() {
  const { data } = useJSON<Summary>('summary.json')
  const c = data?.counts
  const n = (k: string) => (c ? `${c[k].toLocaleString()} ` : '')
  const items = [
    { to: '/data/qtl', title: 'QTL', desc: `${n('qtl')}linkage-mapping QTL records.` },
    { to: '/data/gwas', title: 'GWAS loci', desc: `${n('gwas_loci')}loci summarising ${c ? c.gwas_associations.toLocaleString() : ''} marker–trait associations.` },
    { to: '/data/metaqtl', title: 'Meta-QTL', desc: `${n('mqtl')}consensus loci computed across studies (${c ? c.mqtl_high.toLocaleString() : ''} with ≥ 5 studies), plus rows from published meta-analyses.` },
    { to: '/data/epistatic', title: 'Epistatic QTL', desc: `${n('epistatic')}QTL × QTL interaction pairs (${c ? c.epistatic_physical : ''} with physical positions for both loci).` },
    { to: '/data/multi-trait', title: 'Multi-trait QTL clusters', desc: `${n('clusters')}cluster / pleiotropic-region rows as reported by authors.` },
    { to: '/data/qualitative', title: 'Qualitative trait loci', desc: `${n('mtl')}Mendelian trait loci and gene symbols.` },
    { to: '/hotspots', title: 'QTL hotspots', desc: `${n('hotspots')}genomic regions supported by many independent studies.` },
    { to: '/linkage-maps', title: 'Linkage maps', desc: `${n('maps')}genetic maps with ${c ? c.map_loci.toLocaleString() : ''} loci to view and download.` },
    { to: '/markers', title: 'Trait-linked markers', desc: `${n('markers')}marker–trait links graded by evidence, with primers.` },
    { to: '/statistics', title: 'Statistics', desc: 'Counts by trait, chromosome, species and source, and how the sources compare.' },
    { to: '/map', title: 'Genome map', desc: 'Interactive ideogram and Circos views of loci and hotspots.' },
    { to: '/literature', title: 'Literature index', desc: `${n('papers_indexed')}cotton QTL/GWAS papers tagged by study type.` },
  ]
  return (
    <div>
      <PageHero
        eyebrow="Data tables"
        title="Browse the database"
        subtitle="Every table is sortable, searchable and exportable as CSV. Each record says where it came from and whether it was taken from a curated database or extracted automatically from a paper."
        variant="side"
      />
      <table className="w-full max-w-4xl text-[15px]">
        <tbody>
          {items.map(({ to, title, desc }) => (
            <tr key={to} className="border-b border-wheat-200 align-top">
              <td className="w-56 py-2.5 pr-6"><Link className="underline" to={to}>{title}</Link></td>
              <td className="py-2.5 text-wheat-700">{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
