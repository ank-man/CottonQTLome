import { ExternalLink } from 'lucide-react'
import PageHero from '../components/PageHero'

const LINKS: [string, string, string][] = [
  ['CottonGen', 'https://www.cottongen.org', 'Community database for cotton genomics, genetics and breeding: genomes, maps, markers, QTL, germplasm.'],
  ['CottonMD', 'https://yanglab.hzau.edu.cn/CottonMD', 'Multi-omics database: variation, expression, epigenomics, GWAS, eQTL, TWAS.'],
  ['CottonGVD', 'https://db.cngb.org/cottonGVD/', 'Genomic variation database for cultivated cottons with GWAS visualisation.'],
  ['CottonFGD', 'https://cottonfgd.net', 'Cotton functional genomics database: gene annotation and expression across assemblies.'],
  ['COTTONOMICS', 'http://cotton.zju.edu.cn', 'Zhejiang University cotton genome and resequencing resources.'],
  ['GWAS Atlas', 'https://ngdc.cncb.ac.cn/gwas/', 'Curated genome-wide variant–trait associations in plants and animals.'],
  ['Europe PMC', 'https://europepmc.org', 'Literature search, open-access full text and supplementary files.'],
  ['NCBI Genome: TM-1 UTX v2.1', 'https://www.ncbi.nlm.nih.gov/datasets/genome/GCF_007990345.1/', 'Reference assembly used as the common display axis.'],
  ['WheatQTLdb V3.0', 'https://github.com/ank-man/WheatQTLdbV3.0', 'The wheat QTL database whose interface this site is adapted from.'],
]

export default function UsefulLinks() {
  return (
    <div>
      <PageHero eyebrow="Resources" title="Related resources" subtitle="Cotton genomics databases and the sources this compilation draws on." variant="side" />
      <div className="grid gap-4 md:grid-cols-2">
        {LINKS.map(([name, url, desc]) => (
          <a key={url} href={url} target="_blank" rel="noreferrer" className="card block transition hover:border-wheat-400">
            <div className="flex items-center gap-2 font-semibold text-wheat-900">{name}<ExternalLink className="h-3.5 w-3.5 text-wheat-500" /></div>
            <p className="mt-1 text-sm text-wheat-700">{desc}</p>
          </a>
        ))}
      </div>
    </div>
  )
}
