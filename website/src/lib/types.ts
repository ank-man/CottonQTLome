/** One linkage-mapping QTL record (public/data/qtl.csv). */
export interface QTLRecord {
  id: string
  species: string
  /** Trait category (one of TRAIT_CATEGORIES). */
  trait: string
  /** Harmonised trait name. */
  parameter?: string
  trait_original?: string
  qtl_name: string
  chromosome: string
  position_interval?: string
  /** 'bp' or 'cM' */
  position_unit?: string
  /** Position on the TM-1 UTX v2.1 axis, used by the map. */
  map_bp?: string
  /** Chromosome on the UTX v2.1 axis (differs from `chromosome` where the source assembly was misassembled). */
  map_chr?: string
  /** 'aligned' (converted through genome anchors or published on UTX v2.1) or 'approximate' (relative position). */
  map_method?: string
  ref_genome?: string
  associated_markers?: string
  lod?: string
  pve?: number | string
  neg_log10_p?: string
  candidate_gene?: string
  cross?: string
  population?: string
  environment?: string
  reference?: string
  doi?: string
  source?: string
  /** 'database' (curated by the source database) or 'auto-extracted' (parsed from a paper table). */
  evidence?: string
  locus_id?: string
  hotspot_id?: string
  subtype?: string
}

/** One GWAS locus (public/data/gwas.csv): the lead association of a cluster of co-localising SNPs. */
export interface GWASRecord extends QTLRecord {
  lead_record?: string
  n_associations?: string
  n_studies?: string
}

export interface MetaQTLRecord {
  id: string
  species: string
  trait: string
  parameter?: string
  trait_original?: string
  mqtl_name: string
  chromosome: string
  position_interval?: string
  position_unit?: string
  associated_markers?: string
  lod?: string
  pve?: number | string
  candidate_gene?: string
  population?: string
  reference?: string
  doi?: string
  source?: string
  evidence?: string
}

/** One meta-QTL computed by CottonQTLome on the common physical axis (public/data/mqtl.csv). */
export interface MQTLRecord {
  mqtl_id: string
  trait: string
  category: string
  chromosome: string
  position_mb: string
  ci_start_mb: string
  ci_end_mb: string
  ci_width_mb: string
  span_start_mb: string
  span_end_mb: string
  n_studies: string
  n_observations: string
  n_initial_records: string
  n_linkage_qtl: string
  n_gwas_associations: string
  evidence_class: string
  mean_pve: string
  max_lod: string
  max_neg_log10_p: string
  mean_membership: string
  species: string
  sources: string
  example_qtl: string
  recurrent_candidate_genes: string
  references: string
  pmids: string
  hotspot_id: string
  confidence: string
}

export interface ClusterRecord extends QTLRecord {}

export interface EpistaticRecord {
  id: string
  species: string
  trait: string
  parameter?: string
  trait_original?: string
  locus1: string
  chromosome: string
  pos1_bp?: string
  markers1?: string
  chromosome2?: string
  pos2_bp?: string
  markers2?: string
  locus2: string
  lod?: string
  neg_log10_p?: string
  pve?: number | string
  effect?: string
  /** 'physical' (both loci have bp positions), 'chromosome only', or 'unplaced' */
  placement?: string
  population?: string
  reference?: string
  doi?: string
  evidence?: string
}

/** One linkage map (public/data/maps.csv); its loci are in public/data/maps/<map_id>.csv. */
export interface LinkageMapRecord {
  map_id: string
  name: string
  source: string
  map_type: string
  species: string
  population: string
  parents: string
  n_linkage_groups: string
  n_loci: string
  length_cm: string
  marker_types: string
  n_qtl: string
  reference: string
  doi: string
}

export interface MapLocus {
  marker: string
  marker_type: string
  linkage_group: string
  chromosome: string
  position_cm: string
  primers?: string
}

/** One trait-linked marker (public/data/markers.csv). */
export interface MarkerRecord {
  marker: string
  trait: string
  category: string
  marker_type: string
  chromosome: string
  n_studies: string
  primers: string
  evidence: string
  context: string
  species: string
  reference: string
  doi: string
}

export interface MTLRecord {
  id: string
  species: string
  trait: string
  parameter?: string
  trait_original?: string
  qtl_name: string
  reference?: string
  doi?: string
  citation?: string
}

export interface HotspotRecord {
  hotspot_id: string
  chromosome: string
  start: string
  end: string
  size_mb: string
  n_studies: string
  peak_window_studies: string
  min_q: string
  n_loci: string
  n_records: string
  n_qtl_records: string
  n_gwas_records: string
  n_traits: string
  n_trait_categories: string
  top_traits: string
  trait_categories: string
  dominant_category: string
  species: string
  sources: string
  example_qtl: string
  recurrent_candidate_genes: string
  pmids: string
}

export interface WindowRecord {
  chromosome: string
  start: string
  end: string
  n_studies: string
  n_loci: string
  n_traits: string
  q: string
  significant: string
}

export interface LiteratureRecord {
  pmid: string
  pmcid: string
  year: string
  title: string
  authors: string
  journal: string
  study_type: string
  open_access: string
  records_extracted: string
  doi: string
}

export interface Summary {
  built: string
  counts: Record<string, number>
  comparison?: {
    sources: { source: string; QTL: number; GWAS: number; 'meta-QTL': number; 'epistatic QTL': number; 'QTL cluster': number; MTL: number; studies: number; traits: number; species: number; unique_studies: number }[]
    integrated: { label: string; cottongen: number; integrated: number }[]
    studies_total: number
    studies_literature_only: number
    records_literature_only: number
  }
  by_source: Record<string, number>
  by_species: Record<string, number>
  by_category: Record<string, { qtl: number; gwas_loci: number }>
  top_traits: Record<string, number>
  per_chromosome: { chromosome: string; length_mb: number; loci: number; qtl_loci: number; gwas_loci: number; studies: number; traits: number; loci_per_mb: number }[]
  papers_per_year: { year: number; 'Linkage QTL': number; GWAS: number; 'Meta-QTL / epistasis': number }[]
  subgenome_bias: { trait_category: string; At: number; Dt: number; frac_Dt: number; p_vs_equal: number; p_vs_length: number; q_vs_equal: number; q_vs_length: number }[]
  effect_sizes: { trait_category: string; n: number; median: number; frac_major: number; frac_large: number }[]
  top_hotspots?: { id: string; chr: string; start_mb: number; end_mb: number; studies: number }[]
  top_mqtl?: { id: string; trait: string; chr: string; pos_mb: number; studies: number }[]
  insights: {
    n_records: number
    n_loci: number
    n_studies: number
    subgenome: { frac_Dt_length: number; At: number; Dt: number; frac_Dt: number; p_vs_equal: number; p_vs_length: number }
    hotspots: { window_mb: number; n_windows: number; records_placed: number; studies_placed: number; threshold_studies: number; fdr: number; n_sig_windows: number; n_hotspots: number; genome_fraction: number; fraction_loci_in_hotspots: number; hotspots_At: number; hotspots_Dt: number; null_mean: number; null_p99: number }
    distal: { spearman_rho: number; p: number; mean_studies_distal20: number; mean_studies_central: number }
    homoeolog: { median_rho_homoeologous: number; median_rho_other: number; mannwhitney_p: number }
    effects: { n: number; median_pve: number; frac_ge10: number; frac_ge20: number }
    literature: { last_year: number; gwas_last: number; linkage_last: number; gwas_2015: number; linkage_2015: number }
    trait_chr: { chi2: number; dof: number; p: number }
  }
}
