// Single source of truth for genetics/statistics terminology used across the
// data tables (as column-header tooltips, via GlossaryHeader) and the FAQ
// page - so a term is defined once and reads identically everywhere it
// appears, rather than being paraphrased differently in each place.
export const GLOSSARY = {
  qtl: 'Quantitative Trait Locus (QTL): a chromosomal region associated with a measurable trait, identified by linkage between molecular markers and phenotype in a segregating population (interval mapping).',
  mta: 'GWAS locus: one or more SNPs significantly associated with a trait in a diversity panel. CottonQTLome groups co-localising associations for the same trait (same assembly, within 500 kb) into one locus and shows its most significant association.',
  metaqtl: 'Meta-QTL (MQTL): a consensus locus for one trait supported by QTL or GWAS loci from at least two independent studies. CottonQTLome computes them on the common physical axis with a Gaussian mixture model (each locus keeps its own positional variance; number of meta-QTL per chromosome chosen by BIC). Position is the precision-weighted mean and the interval its 95% confidence interval.',
  confidence: 'Confidence: high = supported by 5 or more independent studies, moderate = 3–4, low = 2.',
  epistatic: 'Epistatic QTL: a pair of loci whose combined effect on a trait deviates from the sum of their individual (additive) effects.',
  trait: 'Trait category: the broad class the trait belongs to (fiber quality, yield, biotic stress …), assigned by rule-based harmonisation of the name used in the source.',
  parameter: 'Harmonised trait: the standardised trait name (e.g. "fiber length", "lint percentage") that groups the many names and abbreviations used across studies.',
  trait_original: 'Original trait: the trait name or abbreviation exactly as given by the source database or paper table.',
  chromosome: 'Chromosome: one of the 26 allotetraploid cotton chromosomes, A01–A13 (At subgenome) and D01–D13 (Dt subgenome). Numeric names c1–c26 used in older papers are converted.',
  position_interval: 'Position / interval: the locus position as reported, either physical (bp, on the assembly named in the Assembly column) or genetic (cM, on that study’s linkage map). A single value is a point; a range is the flanking interval.',
  position_unit: 'Unit: bp = physical position on a genome assembly; cM = genetic position on a linkage map. The two are not interchangeable.',
  ref_genome: 'Assembly: the reference genome the physical coordinates refer to. "not stated" means the source table did not name it, so those positions are only comparable within that paper.',
  associated_markers: 'Markers: the lead SNP or the markers flanking / closest to the locus.',
  pve: 'PVE / R² (phenotypic variance explained): the percentage of phenotypic variation attributed to this locus - an effect size, not a significance measure.',
  lod: 'LOD score: strength of linkage evidence for a QTL at this position; most studies declare significance at about 2.5–3 or by permutation.',
  neg_log10_p: '−log10(P): significance of the lead association. For CottonGVD loci this is the best value within the 500-kb bin.',
  candidate_gene: 'Candidate gene: gene(s) proposed by the source as underlying the locus - not necessarily validated.',
  cross: 'Cross: parents of the mapping population.',
  population: 'Population / panel: the mapping population or GWAS panel.',
  evidence: 'Evidence: "database" = taken from a curated database (CottonGen, GWAS Atlas, CottonMD, CottonGVD); "auto-extracted" = parsed automatically from a table in the paper or its supplement and not manually reviewed.',
  hotspot: 'Hotspot: a 2-Mb window (or run of windows) on the common TM-1 UTX v2.1 axis in which QTL/GWAS loci from more independent studies co-occur than expected by chance (permutation test, FDR < 0.01).',
  n_studies: 'Studies: number of independent studies (publications or database panels) contributing at least one locus.',
} as const

export type GlossaryTerm = keyof typeof GLOSSARY
