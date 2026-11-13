import { Github, Mail } from 'lucide-react'
import PageHero from '../components/PageHero'

export default function Contact() {
  return (
    <div>
      <PageHero
        eyebrow="Get in touch"
        title="Contact"
        subtitle="Corrections, missing studies and data contributions are welcome."
        variant="side"
      />
      <div className="card max-w-2xl space-y-3 text-sm leading-relaxed text-wheat-700">
        <p>
          The quickest way to report a wrong record is to give its ID (for example <code>CQ0012345</code>) and what the
          source paper says. Missing studies are best reported with a DOI or PMID.
        </p>
        <p>
          CottonQTLome is developed and maintained by the <strong>Peng Chee Lab, Cotton Molecular Biology Laboratory,
          University of Georgia</strong>.
        </p>
        <div className="rounded-lg border border-wheat-200 bg-wheat-50 p-4">
          <div className="mb-1 font-semibold text-wheat-900">Webmaster</div>
          <div>Ankush Sharma</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <Mail className="h-4 w-4 text-wheat-600" />
            <a className="underline" href="mailto:Ankush.Sharma@uga.edu">Ankush.Sharma@uga.edu</a>
            <span className="text-wheat-500">or</span>
            <a className="underline" href="mailto:mr.ank2999@gmail.com">mr.ank2999@gmail.com</a>
          </div>
        </div>
        <p className="flex items-center gap-2">
          <Github className="h-4 w-4 text-wheat-600" />
          <a className="underline" href="https://github.com/ank-man" target="_blank" rel="noreferrer">github.com/ank-man</a>
          <span className="text-wheat-500">- open an issue on the project repository</span>
        </p>
      </div>
    </div>
  )
}
