#!/usr/bin/env Rscript
# Physical meta-QTL (MQTL) for the cotton QTLome.
#
# For every harmonised trait x chromosome, including traits in the unclassified category:
#   1. take de-duplicated QTL and GWAS records placed on the common TM-1 UTX v2.1 axis;
#   2. collapse each study's records lying within MERGE_BP into one observation, so that a study
#      contributes one independent observation per locus (position = precision-weighted mean);
#   3. fit Gaussian mixtures with k = 1..K components in which every observation keeps its own
#      known variance (the meta-analysis model of Goffinet & Gerber 2000, as used by BioMercator),
#      by expectation-maximisation;
#   4. choose k by BIC and assign each observation to its most probable component, leaving
#      observations further than 3 SD from that component unassigned;
#   5. keep components supported by >= MIN_STUDIES independent studies as meta-QTL.
# Consensus position = precision-weighted mean; 95% CI = +-1.96 * sqrt(1 / sum(1/sd_i^2)).
#
# Usage: Rscript analysis/meta_qtl.R PROJECT_DIR

suppressPackageStartupMessages(library(data.table))

MERGE_BP    <- 2e6   # one observation per study within this distance
SD_FLOOR    <- 1e6   # positional SD never assumed better than this (cross-assembly projection)
SD_CAP      <- 5e6
MIN_STUDIES <- 2
MAX_K       <- 40
N_START     <- 6
UNRESOLVED_LABELS <- c("unspecified", "undefined trait", "all traits")
set.seed(20261011)

args <- commandArgs(trailingOnly = TRUE)
proj <- if (length(args)) args[1] else "."

ABBR <- c("fiber length" = "FL", "fiber strength" = "FS", "micronaire" = "MIC", "fiber elongation" = "FE",
          "fiber uniformity" = "FU", "short fiber content" = "SFC", "fiber maturity" = "FMT", "fiber fineness" = "FIN",
          "spinning consistency index" = "SCI", "fiber reflectance" = "RD", "fiber yellowness" = "YEL",
          "fiber whiteness and colorimetry" = "COL", "lint percentage" = "LP", "lint index" = "LI", "seed index" = "SI",
          "boll weight" = "BW", "boll number" = "BN", "seed cotton yield" = "SCY", "lint yield" = "LY",
          "lint weight per boll" = "LWB", "plant height and stature" = "PH", "branch traits" = "BR",
          "first fruiting branch position" = "FFB", "flowering time" = "FT", "growth period and maturity" = "GP",
          "verticillium wilt resistance" = "VW", "fusarium wilt resistance" = "FW",
          "seed oil and fatty acids" = "OIL", "seed protein and amino acids" = "PRO", "drought tolerance" = "DT",
          "salt tolerance" = "ST", "root system traits" = "ROOT", "trichome and pubescence" = "TRI",
          "leaf morphology" = "LEAF", "germination and seedling vigor" = "VIG", "plant biomass" = "BIO",
          "chlorophyll content" = "CHL", "fiber development" = "FDEV")
abbr <- function(trait) {
  if (trait %in% names(ABBR)) return(ABBR[[trait]])
  toupper(substr(paste(substr(regmatches(trait, gregexpr("[a-z]+", trait))[[1]], 1, 1), collapse = ""), 1, 5))
}

# ---- mixture with observation-specific known variances -----------------------------------------
resp <- function(x, sd, mu, w) {
  dens <- sweep(exp(-0.5 * (outer(x, mu, "-") / sd)^2) / (sd * sqrt(2 * pi)), 2, w, "*")
  tot <- pmax(rowSums(dens), 1e-300)
  list(ll = sum(log(tot)), r = dens / tot)
}
fit_mixture <- function(x, sd, k) {
  prec <- 1 / sd^2
  best <- list(ll = -Inf)
  for (s in seq_len(N_START)) {
    mu <- if (s == 1 || length(x) < k) quantile(x, (seq_len(k) - 0.5) / k, names = FALSE) else sort(sample(x, k))
    w <- rep(1 / k, k)
    prev <- -Inf
    for (it in 1:300) {
      e <- resp(x, sd, mu, w)
      nk <- colSums(e$r)
      num <- colSums(e$r * (x * prec))
      den <- colSums(e$r * prec)
      mu <- ifelse(nk > 1e-8, num / pmax(den, 1e-300), mu)
      w <- pmax(nk / max(sum(nk), 1e-300), 1e-12)
      if (e$ll - prev < 1e-7) break
      prev <- e$ll
    }
    e <- resp(x, sd, mu, w)
    if (e$ll > best$ll) best <- list(ll = e$ll, mu = mu, w = w, r = e$r)
  }
  best
}

# ---- data --------------------------------------------------------------------------------------
use <- c("record_id", "record_type", "source_db", "source_dataset", "qtl_name", "trait_harmonized", "trait_category",
         "species", "chromosome", "phys_start", "phys_end", "lod", "r2_pct", "neg_log10_p", "candidate_genes",
         "pmid", "first_author", "year")
d <- fread(file.path(proj, "data/processed/records_deduplicated.tsv"), select = use, sep = "\t", quote = "",
           na.strings = "", colClasses = list(character = c("pmid", "year", "source_dataset")))
ax <- fread(file.path(proj, "analysis/tables/records_common_axis.tsv"), select = c("record_id", "pos"))
cl <- fread(file.path(proj, "data/liftover/chromosome_lengths.tsv"))[assembly == "Gh_UTX_v2.1"]
chr_len_mb <- as.list(setNames(cl$length_bp / 1e6, cl$chromosome))   # the map axis (UTX v2.1)
d <- merge(d, ax, by = "record_id")[record_type %in% c("QTL", "GWAS") &
                                     !is.na(trait_harmonized) & nzchar(trait_harmonized) &
                                     !trait_harmonized %in% UNRESOLVED_LABELS]
d[, study := fifelse(is.na(pmid), source_dataset, pmid)]
d[, mx := max(r2_pct, na.rm = TRUE), by = source_dataset]
d[, pve := fifelse(is.finite(mx) & mx <= 1, r2_pct * 100, r2_pct)]
d[!is.na(pve) & (pve < 0 | pve > 100), pve := NA_real_]
# positional SD: half the reported interval read as a 95% CI, bounded
d[, sd := pmin(pmax((phys_end - phys_start) / (2 * 1.96), SD_FLOOR), SD_CAP)]
d[is.na(sd), sd := SD_FLOOR]

setorder(d, trait_harmonized, chromosome, study, pos)
d[, obs := cumsum(c(TRUE, diff(pos) > MERGE_BP)), by = .(trait_harmonized, chromosome, study)]
d[, obs := .GRP, by = .(trait_harmonized, chromosome, study, obs)]
obs <- d[, .(trait = trait_harmonized[1], category = trait_category[1], chromosome = chromosome[1], study = study[1],
             x = sum(pos / sd^2) / sum(1 / sd^2), sd = min(sd)), by = obs]
cat(nrow(d), "records ->", nrow(obs), "study-level observations\n")

# Keep established codes and disambiguate any new abbreviation collisions.
trait_names <- sort(unique(obs$trait))
trait_codes <- setNames(make.unique(vapply(trait_names, abbr, ""), sep = ""), trait_names)

# ---- model fitting -----------------------------------------------------------------------------
hs <- fread(file.path(proj, "analysis/tables/hotspots.tsv"))
gene_rx <- "^G[hboa][A-Za-z0-9]*[_.]?[AD][0-9]{2}G[0-9]+"
mq <- list(); members <- list(); models <- list()
sets <- unique(obs[, .(trait, chromosome)])
for (i in seq_len(nrow(sets))) {
  o <- obs[trait == sets$trait[i] & chromosome == sets$chromosome[i]]
  if (uniqueN(o$study) < MIN_STUDIES || nrow(o) < 2) next
  x <- o$x / 1e6; sdv <- o$sd / 1e6                       # Mb
  kmax <- max(1, min(MAX_K, nrow(o) - 1))
  best <- NULL
  for (k in seq_len(kmax)) {
    f <- fit_mixture(x, sdv, k)
    f$bic <- (2 * k - 1) * log(nrow(o)) - 2 * f$ll
    f$k <- k
    if (k == 1) bic1 <- f$bic
    if (is.null(best) || f$bic < best$bic) best <- f
  }
  models[[length(models) + 1]] <- data.table(trait = sets$trait[i], chromosome = sets$chromosome[i],
                                             n_observations = nrow(o), n_studies = uniqueN(o$study),
                                             k_selected = best$k, bic = best$bic, bic_k1 = bic1)
  o[, comp := max.col(best$r, ties.method = "first")]
  o[, prob := best$r[cbind(seq_len(.N), comp)]]
  o[, mu := best$mu[comp] * 1e6]
  o <- o[abs(x - mu) <= 3 * sd]                            # unexplained observations stay unassigned
  for (cp in unique(o$comp)) {
    m <- o[comp == cp]
    if (uniqueN(m$study) < MIN_STUDIES) next
    prec <- 1 / (m$sd / 1e6)^2
    pos <- sum(m$x / 1e6 * prec) / sum(prec)
    half <- 1.96 * sqrt(1 / sum(prec))
    recs <- d[obs %in% m$obs]
    genes <- trimws(unlist(strsplit(recs$candidate_genes[!is.na(recs$candidate_genes)], "[;,]")))
    genes <- genes[grepl(gene_rx, genes)]
    genes <- if (length(genes)) names(sort(table(genes), decreasing = TRUE))[seq_len(min(5, uniqueN(genes)))] else character()
    nm <- unique(recs[record_type == "QTL" & !is.na(qtl_name) & grepl("^q[A-Za-z]", qtl_name), qtl_name])
    refs <- unique(trimws(paste(sub("\\s+et al\\.?$", "", recs$first_author[!is.na(recs$first_author)]),
                                fifelse(is.na(recs$year[!is.na(recs$first_author)]), "", recs$year[!is.na(recs$first_author)]))))
    has_q <- any(recs$record_type == "QTL"); has_g <- any(recs$record_type == "GWAS")
    mx_or_na <- function(v) if (all(is.na(v))) NA_real_ else max(v, na.rm = TRUE)
    id <- length(mq) + 1
    mq[[id]] <- data.table(
      trait = sets$trait[i], category = m$category[1], chromosome = sets$chromosome[i],
      position_mb = pos, ci_start_mb = max(0, pos - half), ci_end_mb = min(chr_len_mb[[sets$chromosome[i]]], pos + half),
      ci_width_mb = min(chr_len_mb[[sets$chromosome[i]]], pos + half) - max(0, pos - half),   # CI cut at the chromosome ends
      span_start_mb = min(m$x) / 1e6, span_end_mb = max(m$x) / 1e6,
      n_studies = uniqueN(m$study), n_observations = nrow(m), n_initial_records = nrow(recs),
      n_linkage_qtl = sum(recs$record_type == "QTL"), n_gwas_associations = sum(recs$record_type == "GWAS"),
      evidence_class = if (has_q && has_g) "QTL + GWAS" else if (has_q) "QTL only" else "GWAS only",
      mean_pve = mean(recs[record_type == "QTL", pve], na.rm = TRUE), max_lod = mx_or_na(recs$lod),
      max_neg_log10_p = mx_or_na(recs$neg_log10_p), mean_membership = mean(m$prob), k_models_on_chromosome = best$k,
      species = substr(paste(sort(unique(recs$species[!is.na(recs$species)])), collapse = "; "), 1, 160),
      sources = paste(sort(unique(recs$source_db)), collapse = "; "),
      example_qtl = paste(head(nm, 6), collapse = "; "), recurrent_candidate_genes = paste(genes, collapse = "; "),
      references = paste(head(refs[nzchar(refs)], 8), collapse = "; "),
      pmids = substr(paste(sort(unique(recs$pmid[!is.na(recs$pmid)])), collapse = "; "), 1, 400), .set = id)
    members[[id]] <- data.table(.set = id, record_id = recs$record_id)
  }
}
mq <- rbindlist(mq); members <- rbindlist(members); models <- rbindlist(models)
mq[is.nan(mean_pve), mean_pve := NA_real_]
setorder(mq, chromosome, trait, position_mb)
mq[, n := seq_len(.N), by = .(trait, chromosome)]
mq[, mqtl_id := paste0("MQTL-", trait_codes[trait], "-", chromosome, "-", n)]
mq[, hotspot_id := ""]
for (h in seq_len(nrow(hs))) mq[chromosome == hs$chromosome[h] & position_mb >= hs$start[h] / 1e6 & position_mb <= hs$end[h] / 1e6,
                                 hotspot_id := hs$hotspot_id[h]]
mq[, confidence := fifelse(n_studies >= 5, "high", fifelse(n_studies >= 3, "moderate", "low"))]
members <- merge(members, mq[, .(.set, mqtl_id)], by = ".set")[, .(mqtl_id, record_id)]
mq[, c(".set", "n") := NULL]
setcolorder(mq, "mqtl_id")

out <- file.path(proj, "analysis/tables")
fwrite(mq, file.path(out, "meta_qtl.tsv"), sep = "\t", na = "")
fwrite(members, file.path(out, "meta_qtl_members.tsv"), sep = "\t")
fwrite(models, file.path(out, "meta_qtl_models.tsv"), sep = "\t")

# Account for every database trait, including those without sufficient mapped evidence.
traits <- fread(file.path(proj, "data/processed/trait_summary.tsv"),
                select = c("trait_category", "trait_harmonized", "n_records", "n_qtl", "n_gwas"))
coverage <- traits[, .(trait = trait_harmonized, category = trait_category,
                       n_database_records = n_records, n_database_qtl = n_qtl,
                       n_database_gwas = n_gwas)]
placed <- d[, .(n_placed_records = .N, n_placed_studies = uniqueN(study)), by = trait_harmonized]
setnames(placed, "trait_harmonized", "trait")
observed <- obs[, .(n_observations = .N, n_chromosomes = uniqueN(chromosome)), by = trait]
fitted <- models[, .(n_chromosomes_modelled = .N), by = trait]
found <- mq[, .(n_meta_qtl = .N, n_studies_max = max(n_studies)), by = trait]
for (part in list(placed, observed, fitted, found)) coverage <- merge(coverage, part, by = "trait", all.x = TRUE)
num_cols <- setdiff(names(coverage), c("trait", "category"))
for (col in num_cols) set(coverage, which(is.na(coverage[[col]])), col, 0L)
coverage[, status := fifelse(trait %in% UNRESOLVED_LABELS, "unresolved trait name",
                     fifelse(n_placed_records == 0, "no common-axis QTL/GWAS coordinates",
                     fifelse(n_chromosomes_modelled == 0, "no chromosome with two independent studies",
                     fifelse(n_meta_qtl == 0, "modelled; no supported component", "meta-QTL found"))))]
setorder(coverage, category, trait)
fwrite(coverage, file.path(out, "meta_qtl_trait_coverage.tsv"), sep = "\t")

cat("trait x chromosome sets analysed:", nrow(models), "\n")
cat("MQTL:", nrow(mq), "| traits:", uniqueN(mq$trait), "| records absorbed:", nrow(members), "\n")
cat("Database traits:", nrow(coverage), "| modelled traits:", uniqueN(models$trait), "\n")
print(table(mq$confidence)); print(table(mq$evidence_class))
cat("median CI width (Mb):", round(median(mq$ci_width_mb), 2), "| max span (Mb):", round(max(mq$span_end_mb - mq$span_start_mb), 2),
    "| in hotspots:", sum(mq$hotspot_id != ""), "\n")
print(head(mq[order(-n_studies), .(mqtl_id, trait, position_mb = round(position_mb, 2), ci_start_mb = round(ci_start_mb, 2),
                                    ci_end_mb = round(ci_end_mb, 2), n_studies, n_linkage_qtl, n_gwas_associations, hotspot_id)], 10))
