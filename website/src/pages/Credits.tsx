import PageHero from '../components/PageHero'

const CITE = [
  ['CottonGen', 'Yu J, Jung S, Cheng CH, et al. (2021) CottonGen: the community database for cotton genomics, genetics, and breeding research. Plants 10:2805.'],
  ['GWAS Atlas', 'Tian D, Wang P, Tang B, et al. (2020) GWAS Atlas: a curated resource of genome-wide variant-trait associations in plants and animals. Nucleic Acids Res 48:D927–D932.'],
  ['CottonMD', 'Yang Z, Wang J, Huang Y, et al. (2023) CottonMD: a multi-omics database for cotton biological study. Nucleic Acids Res 51:D1446–D1456.'],
  ['CottonGVD', 'Peng Z, Li H, Sun G, et al. (2021) CottonGVD: a comprehensive genomic variation database for cultivated cottons. Front Plant Sci 12:803736.'],
  ['Europe PMC', 'Literature metadata, full-text tables and supplementary files were retrieved through Europe PMC and the PMC Open Access subset.'],
  ['Reference axis', 'Chen ZJ, Sreedasyam A, Ando A, et al. (2020) Genomic diversifications of five Gossypium allopolyploid species and their impact on cotton improvement. Nat Genet 52:525–533 (TM-1 UTX v2.1).'],
]

export default function Credits() {
  return (
    <div>
      <PageHero eyebrow="Project" title="Credits & how to cite" subtitle="CottonQTLome is a compilation: please cite the original studies and source databases for any record you use." variant="side" />
      <div className="space-y-6">
        <div className="card text-sm leading-relaxed text-wheat-700">
          <h3 className="mb-2 text-lg font-semibold text-wheat-900">Citing data</h3>
          <p>
            Each record links to the publication it comes from - cite that publication. If you use records taken from a
            source database, cite the database as well (please check each citation against the database’s own
            “how to cite” page before publishing):
          </p>
          <ul className="mt-3 space-y-2">
            {CITE.map(([name, text]) => (
              <li key={name}><span className="font-semibold text-wheat-900">{name}.</span> {text}</li>
            ))}
          </ul>
        </div>
        <div className="card text-sm leading-relaxed text-wheat-700">
          <h3 className="mb-2 text-lg font-semibold text-wheat-900">Developed by</h3>
          <p>Peng Chee Lab, Cotton Molecular Biology Laboratory, University of Georgia.</p>
        </div>
        <div className="card text-sm leading-relaxed text-wheat-700">
          <h3 className="mb-2 text-lg font-semibold text-wheat-900">Photography</h3>
          <p>
            Home-page background: <a className="underline" href="https://commons.wikimedia.org/wiki/File:Cotton_field,_Floyd_County,_GA,_US.jpg" target="_blank" rel="noreferrer">“Cotton field, Floyd County, GA, US”</a>{' '}
            by Bubba73 (Wikimedia Commons), licensed under{' '}
            <a className="underline" href="https://creativecommons.org/licenses/by-sa/4.0" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>.
            The image was resized and is shown under a translucent overlay.
          </p>
        </div>
        <div className="card text-sm leading-relaxed text-wheat-700">
          <h3 className="mb-2 text-lg font-semibold text-wheat-900">Software</h3>
          <p>
            The web interface is adapted from WheatQTLdb V3.0 (React, Vite, Tailwind CSS, TanStack Table, Recharts).
            Collection, harmonisation and analysis scripts are written in Python (pandas, SciPy, Matplotlib).
          </p>
        </div>
      </div>
    </div>
  )
}
