#!/usr/bin/env Rscript
# Classic meta-QTL on the consensus genetic map (cM), for every individual harmonised trait.
#
# Input: analysis/tables/qtl_consensus_projection.tsv (scripts/consensus_map.py): linkage QTL projected onto the
#        consensus map built from CottonGen and paper maps around the AD genome-wide reference map (2009).
# For every harmonised trait x chromosome, including traits outside the named categories:
#   1. one observation per study and locus: a study's QTL within MERGE_CM are merged (precision-weighted mean),
#      so repeated environments of one QTL do not count as independent evidence;
#   2. positional SD = support interval / (2 x 1.96), bounded to [SD_FLOOR, SD_CAP];
#   3. Gaussian mixtures with known observation variances (Goffinet & Gerber 2000, as in BioMercator),
#      k = 1..K by EM; k chosen by BIC (AIC reported alongside);
#   4. observations further than 3 SD from their component stay unassigned; components with >= MIN_STUDIES
#      studies are meta-QTL. Consensus position = precision-weighted mean; 95% CI = +-1.96 sqrt(1/sum(1/sd^2)).
# Each meta-QTL also gets the consensus markers flanking its CI and, where member QTL have physical positions,
# its physical span on TM-1 UTX v2.1 and the physical meta-QTL of the same trait it overlaps.
#
# Usage: Rscript analysis/meta_qtl_cm.R PROJECT_DIR

suppressPackageStartupMessages(library(data.table))

MERGE_CM    <- 5
SD_FLOOR    <- 0.5
SD_CAP      <- 15
MIN_STUDIES <- 2
MAX_K       <- 30
N_START     <- 6
UNRESOLVED_LABELS <- c("unspecified", "undefined trait", "all traits", "multiple traits (not specified)")
set.seed(20261101)

args <- commandArgs(trailingOnly = TRUE)
proj <- if (length(args)) args[1] else "."
tab <- file.path(proj, "analysis/tables")

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
    w <- rep(1 / k, k); prev <- -Inf
    for (it in 1:300) {
      e <- resp(x, sd, mu, w)
      nk <- colSums(e$r)
      mu <- ifelse(nk > 1e-8, colSums(e$r * (x * prec)) / pmax(colSums(e$r * prec), 1e-300), mu)
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
pj <- fread(file.path(tab, "qtl_consensus_projection.tsv"), colClasses = list(character = c("study", "record_id")))
pj <- pj[!is.na(trait) & nzchar(trait) & !trait %in% UNRESOLVED_LABELS & is.finite(cons_peak)]
cmap <- fread(file.path(proj, "data/processed/consensus_map.tsv"))
chr_len <- cmap[, .(len = max(cM)), by = chromosome]
pj <- merge(pj, chr_len, by = "chromosome")
pj[, peak := pmin(pmax(cons_peak, 0), len)]
pj[, sd := pmin(pmax((cons_stop - cons_start) / (2 * 1.96), SD_FLOOR), SD_CAP)]
pj[!is.finite(sd), sd := SD_CAP]

setorder(pj, trait, chromosome, study, peak)
pj[, obs := cumsum(c(TRUE, diff(peak) > MERGE_CM)), by = .(trait, chromosome, study)]
pj[, obs := .GRP, by = .(trait, chromosome, study, obs)]
obs <- pj[, .(trait = trait[1], category = category[1], chromosome = chromosome[1], study = study[1],
              x = sum(peak / sd^2) / sum(1 / sd^2), sd = min(sd), n_rec = .N), by = obs]
cat(nrow(pj), "projected QTL ->", nrow(obs), "study-level observations\n")

ax <- fread(file.path(tab, "records_common_axis.tsv"), select = c("record_id", "pos"))
pmq <- fread(file.path(tab, "meta_qtl.tsv"), select = c("mqtl_id", "trait", "chromosome", "ci_start_mb", "ci_end_mb"))
codes <- unique(fread(file.path(tab, "meta_qtl.tsv"), select = c("mqtl_id", "trait"))[, .(trait, code = sub("^MQTL-([^-]+)-.*", "\\1", mqtl_id))])
code_of <- setNames(codes$code, codes$trait)   # reuse the physical meta-QTL trait codes
abbr <- function(tr) {
  if (tr %in% names(code_of)) return(code_of[[tr]])
  toupper(substr(paste(substr(regmatches(tr, gregexpr("[a-z0-9]+", tr))[[1]], 1, 1), collapse = ""), 1, 5))
}
trait_names <- sort(unique(obs$trait))
trait_codes <- setNames(make.unique(vapply(trait_names, abbr, ""), sep = ""), trait_names)

flank <- function(chr, lo, hi) {
  m <- cmap[chromosome == chr]
  left <- m[cM <= lo][order(-cM)][1]; right <- m[cM >= hi][order(cM)][1]
  inside <- m[cM >= lo & cM <= hi]
  c(left = if (nrow(left) && !is.na(left$marker)) left$marker else "", right = if (nrow(right) && !is.na(right$marker)) right$marker else "",
    n_inside = nrow(inside))
}

# ---- fitting -----------------------------------------------------------------------------------
mq <- list(); members <- list(); models <- list()
sets <- unique(obs[, .(trait, chromosome)])
for (i in seq_len(nrow(sets))) {
  o <- obs[trait == sets$trait[i] & chromosome == sets$chromosome[i]]
  if (uniqueN(o$study) < MIN_STUDIES || nrow(o) < 2) next
  kmax <- max(1, min(MAX_K, nrow(o) - 1)); best <- NULL
  for (k in seq_len(kmax)) {
    f <- fit_mixture(o$x, o$sd, k)
    f$bic <- (2 * k - 1) * log(nrow(o)) - 2 * f$ll
    f$aic <- 2 * (2 * k - 1) - 2 * f$ll
    f$k <- k
    if (k == 1) bic1 <- f$bic
    if (is.null(best) || f$bic < best$bic) best <- f
    if (k == 1 || f$aic < aic_best) { aic_best <- f$aic; k_aic <- k }
  }
  models[[length(models) + 1]] <- data.table(trait = sets$trait[i], chromosome = sets$chromosome[i], n_observations = nrow(o),
                                             n_studies = uniqueN(o$study), k_bic = best$k, k_aic = k_aic, bic = best$bic, bic_k1 = bic1)
  o[, comp := max.col(best$r, ties.method = "first")]
  o[, prob := best$r[cbind(seq_len(.N), comp)]]
  o[, mu := best$mu[comp]]
  o <- o[abs(x - mu) <= 3 * sd]
  L <- chr_len[chromosome == sets$chromosome[i], len]
  for (cp in unique(o$comp)) {
    m <- o[comp == cp]
    if (uniqueN(m$study) < MIN_STUDIES) next
    prec <- 1 / m$sd^2
    pos <- sum(m$x * prec) / sum(prec); half <- 1.96 * sqrt(1 / sum(prec))
    lo <- max(0, pos - half); hi <- min(L, pos + half)
    recs <- pj[obs %in% m$obs]
    ph <- ax[record_id %in% recs$record_id, pos] / 1e6
    fl <- flank(sets$chromosome[i], lo, hi)
    id <- length(mq) + 1
    mq[[id]] <- data.table(
      trait = sets$trait[i], category = m$category[1], chromosome = sets$chromosome[i],
      position_cm = pos, ci_start_cm = lo, ci_end_cm = hi, ci_width_cm = hi - lo,
      span_start_cm = min(m$x), span_end_cm = max(m$x),
      n_studies = uniqueN(m$study), n_observations = nrow(m), n_initial_qtl = nrow(recs),
      n_projected_by_map = sum(recs$method == "map projection"), n_placed_by_markers = sum(recs$method == "marker placement"),
      n_ci_imputed = sum(recs$ci_imputed), mean_membership = mean(m$prob), k_models_on_chromosome = best$k,
      left_marker = fl[["left"]], right_marker = fl[["right"]], n_consensus_markers_in_ci = as.integer(fl[["n_inside"]]),
      n_members_with_physical = length(ph),
      physical_median_mb = if (length(ph)) median(ph) else NA_real_,
      physical_q1_mb = if (length(ph)) quantile(ph, 0.25, names = FALSE) else NA_real_,
      physical_q3_mb = if (length(ph)) quantile(ph, 0.75, names = FALSE) else NA_real_,
      studies = substr(paste(sort(unique(m$study)), collapse = "; "), 1, 400), .set = id)
    members[[id]] <- data.table(.set = id, record_id = recs$record_id)
  }
}
mq <- rbindlist(mq); members <- rbindlist(members); models <- rbindlist(models)
setorder(mq, chromosome, trait, position_cm)
mq[, n := seq_len(.N), by = .(trait, chromosome)]
mq[, mqtl_id := paste0("cMQTL-", trait_codes[trait], "-", chromosome, "-", n)]
mq[, confidence := fifelse(n_studies >= 5, "high", fifelse(n_studies >= 3, "moderate", "low"))]
# physical meta-QTL of the same trait overlapping the members' interquartile physical range
mq[, physical_mqtl := ""]
for (j in which(!is.na(mq$physical_q1_mb))) {
  h <- pmq[trait == mq$trait[j] & chromosome == mq$chromosome[j] &
           ci_start_mb <= mq$physical_q3_mb[j] + 1 & ci_end_mb >= mq$physical_q1_mb[j] - 1, mqtl_id]
  set(mq, j, "physical_mqtl", paste(head(h, 6), collapse = "; "))
}
members <- merge(members, mq[, .(.set, mqtl_id)], by = ".set")[, .(mqtl_id, record_id)]
mq[, c(".set", "n") := NULL]
setcolorder(mq, "mqtl_id")
fwrite(mq, file.path(tab, "meta_qtl_cm.tsv"), sep = "\t", na = "")
fwrite(members, file.path(tab, "meta_qtl_cm_members.tsv"), sep = "\t")
fwrite(models, file.path(tab, "meta_qtl_cm_models.tsv"), sep = "\t")

# ---- every trait of the database, with what happened to it -------------------------------------
traits <- fread(file.path(proj, "data/processed/trait_summary.tsv"), select = c("trait_category", "trait_harmonized", "n_records", "n_qtl"))
cov <- traits[, .(trait = trait_harmonized, category = trait_category, n_database_records = n_records, n_database_qtl = n_qtl)]
parts <- list(pj[, .(n_projected_qtl = .N, n_projected_studies = uniqueN(study)), by = trait],
              obs[, .(n_observations = .N), by = trait],
              models[, .(n_chromosomes_modelled = .N), by = trait],
              mq[, .(n_cm_meta_qtl = .N, n_high = sum(confidence == "high"), max_studies = max(n_studies)), by = trait])
for (p in parts) cov <- merge(cov, p, by = "trait", all.x = TRUE)
for (col in setdiff(names(cov), c("trait", "category"))) set(cov, which(is.na(cov[[col]])), col, 0L)
cov[, status := fifelse(trait %in% UNRESOLVED_LABELS, "unresolved trait name",
                fifelse(n_database_qtl == 0, "no linkage QTL (GWAS or other records only)",
                fifelse(n_projected_qtl == 0, "linkage QTL not on a map sharing markers with the consensus",
                fifelse(n_chromosomes_modelled == 0, "no chromosome with two independent studies",
                fifelse(n_cm_meta_qtl == 0, "modelled; no supported component", "meta-QTL found")))))]
setorder(cov, category, trait)
fwrite(cov, file.path(tab, "meta_qtl_cm_trait_coverage.tsv"), sep = "\t")

cat("trait x chromosome sets modelled:", nrow(models), "| cM meta-QTL:", nrow(mq), "| traits:", uniqueN(mq$trait),
    "| QTL absorbed:", nrow(members), "\n")
print(table(mq$confidence))
cat("median CI (cM):", round(median(mq$ci_width_cm), 2), "| with physical match:", sum(mq$physical_mqtl != ""),
    "of", sum(!is.na(mq$physical_q1_mb)), "with physical members\n")
print(cov[, .N, by = status])
print(head(mq[order(-n_studies), .(mqtl_id, trait, position_cm = round(position_cm, 1), ci = paste0(round(ci_start_cm, 1), "-", round(ci_end_cm, 1)),
                                    n_studies, n_initial_qtl, left_marker, right_marker, physical_mqtl)], 12))
