CottonQTLome map upload - demo files
All values in these files are synthetic (randomly generated) and exist only to
show the accepted formats. They are not research results.

demo_qtl_intervals.csv  QTL intervals, bp, trait + LOD + PVE
demo_gwas_summary.tsv   GWAS hits, numbered Chr01-Chr26 (classical order: 14 = D02, 15 = D01, ...), P-values
demo_loci.xlsx          Excel, two sheets, positions in Mb, Ghir_ prefixed names
demo_regions.bed        BED6, 0-based starts, chrA01 style names
demo_genes.gff3         GFF3 genes (+ mRNA rows, which the map skips)
demo_variants.vcf       Sites-only VCF
demo_loci.json          JSON object holding an array of records, Mb intervals
template_loci.csv       Blank template: name, chromosome, start, end, trait, value

Required: a chromosome column (A01-D13, Ghir_A01, chrA01, At01, or classical
numbers Chr01-Chr26 where 14 = D02, 15 = D01, 16 = D07, 17 = D03, 18 = D13,
19 = D05, 20 = D10, 21 = D11, 22 = D04, 23 = D09, 24 = D08, 25 = D06, 26 = D12)
and a position column (bp, kb or Mb; a single position or a start/end pair, or a
"12.1-14.8" range in one cell). Optional: end, name, trait, value (LOD, P, -log10P,
PVE, score). positions can be on any of the assemblies listed on the site.

Linkage-map plotter demo files
demo_linkage_map.csv    REAL map: markers and cM positions of CottonGen map CG009, Yumian-1 x T586 RIL
                        (Liu et al. 2015, Mol Genet Genomics). Linkage groups were renamed LG01-LG26 in a
                        shuffled order so the plotter's chromosome matching can be tried. True identity:
                        LG23 = A01, LG08 = A02, LG02 = A03, LG14 = A04, LG04 = A05, LG01 = A06, LG06 = A07, LG19 = A08, LG05 = A09, LG10 = A10, LG20 = A11, LG09 = A12, LG25 = A13, LG07 = D01, LG13 = D02, LG18 = D03, LG16 = D04, LG26 = D05, LG24 = D06, LG11 = D07, LG17 = D08, LG21 = D09, LG15 = D10, LG03 = D11, LG22 = D12, LG12 = D13
demo_linkage_qtl.csv    SYNTHETIC QTL support intervals (start/end/peak cM) on those linkage groups.
