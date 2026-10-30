#!/usr/bin/env python3
"""
Validate the CottonQTLome data end to end.

    python3 scripts/validate_data.py            # from the project root

Checks
  A. master records (data/processed/records_deduplicated.tsv): identifiers, vocabularies, chromosome names,
     value ranges, positions against chromosome lengths, positions written into SNP names, citations
  B. coordinate conversion: lifted positions inside the target chromosomes, published positions kept,
     agreement with independent placements of the same marker on two assemblies, the site's anchor files
  C. website tables (website/public/data): unique ids, links between tables, counts in summary.json,
     meta-QTL and hotspot geometry, primer sequences, the all-assemblies download
Writes
  analysis/tables/validation_report.md     one line per check: PASS / WARN / FAIL, count, examples
  analysis/tables/validation_issues.tsv    every flagged record
Exit status 1 if any check FAILs.
"""
import csv
import gzip
import json
import math
import os
import re
import sys
from collections import Counter, defaultdict

import numpy as np
import pandas as pd

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import liftover as L  # noqa: E402

SITE = f"{ROOT}/website/public/data"
CHRS = [f"{g}{i:02d}" for g in "AD" for i in range(1, 14)]
RECORD_TYPES = {"QTL", "GWAS", "meta-QTL", "QTL cluster", "epistatic QTL", "MTL"}
SOURCES = {"CottonGen", "Literature", "GWAS Atlas", "CottonMD", "CottonGVD"}
CATEGORIES = {"fiber quality", "yield", "plant architecture", "phenology", "biotic stress", "abiotic stress",
              "seed quality", "morphology", "physiology", "growth and vigor", "fertility", "unclassified"}
IUPAC = re.compile(r"^[ACGTRYSWKMBDHVNIU]+$")

results, issues = [], []


def check(section, name, bad, total, *, level="FAIL", examples=None, note="", ids=None, why=""):
    """bad: number of failing items. level: what a non-zero count means (FAIL or WARN)."""
    status = "PASS" if bad == 0 else level
    results.append((section, name, status, bad, total, note, "; ".join(map(str, (examples or [])[:5]))))
    for i in (ids or [])[:20000]:
        issues.append((section, name, status, *i) if isinstance(i, tuple) else (section, name, status, i, "", why))
    return bad


def num(s):
    return pd.to_numeric(s, errors="coerce")


def study(d):
    return d["pmid"].where(d["pmid"] != "", d["source_dataset"])


def flagged(d, mask, why, col="record_id"):
    x = d[mask.fillna(False)]
    return [(r, s, why) for r, s in zip(x[col], study(x) if "pmid" in x else [""] * len(x))]


# ============================================================================ A. master records
def section_a():
    S = "A. records"
    d = pd.read_csv(f"{ROOT}/data/processed/records_deduplicated.tsv", sep="\t", dtype=str, keep_default_na=False,
                    low_memory=False)
    allr = pd.read_csv(f"{ROOT}/data/processed/records_all.tsv", sep="\t", dtype=str, keep_default_na=False,
                       low_memory=False, usecols=["record_id", "duplicate_of"])
    n = len(d)
    check(S, "record_id unique", int(d.record_id.duplicated().sum()), n)
    bad = allr[(allr.duplicate_of != "") & ~allr.duplicate_of.isin(allr.record_id)]
    check(S, "duplicate_of points to an existing record", len(bad), len(allr), examples=bad.record_id.tolist())
    for col, vocab in (("record_type", RECORD_TYPES), ("source_db", SOURCES), ("trait_category", CATEGORIES)):
        m = ~d[col].isin(vocab)
        check(S, f"{col} in controlled vocabulary", int(m.sum()), n, examples=d.loc[m, col].unique().tolist())
    check(S, "species stated", int((d.species == "").sum()), n)
    check(S, "trait resolved to a category", int((d.trait_category == "unclassified").sum()), n, level="WARN",
          note="kept but excluded from trait-specific analyses")

    # chromosome names
    ad = d.genome_group == "AD"
    m = ad & (d.chromosome != "") & ~d.chromosome.isin(CHRS)
    check(S, "tetraploid chromosome is A01-A13 / D01-D13", int(m.sum()), int((ad & (d.chromosome != "")).sum()),
          examples=d.loc[m, "chromosome"].unique().tolist(), ids=flagged(d, m, "bad chromosome"))
    dip = d.genome_group.isin(["A", "D"]) & (d.chromosome != "")
    m = dip & (d.chromosome.str[0] != d.genome_group)
    check(S, "diploid chromosome belongs to its genome", int(m.sum()), int(dip.sum()),
          examples=(d.loc[m, "genome_group"] + ":" + d.loc[m, "chromosome"]).unique().tolist(),
          ids=flagged(d, m, "chromosome of the other genome"))

    # numeric ranges
    ps, pe = num(d.phys_start), num(d.phys_end)
    has = ps.notna()
    check(S, "physical start <= end", int((ps > pe).sum()), int(has.sum()))
    check(S, "physical position >= 0 and <= 250 Mb", int(((ps < 0) | (pe > 2.5e8)).sum()), int(has.sum()),
          ids=flagged(d, (ps < 0) | (pe > 2.5e8), "position out of range"))
    lens = pd.read_csv(f"{ROOT}/data/liftover/chromosome_lengths.tsv", sep="\t")
    clen = {(a, c): n for a, c, n in zip(lens.assembly, lens.chromosome, lens.length_bp)}
    hub = {c: n for (a, c), n in clen.items() if a == L.HUB}
    src = d.ref_genome.map(L.source_key)
    known = has & ad & src.notna() & src.map(lambda k: (k, "A01") in clen if isinstance(k, str) else False)
    lim = pd.Series([clen.get((k, c)) for k, c in zip(src, d.chromosome)], index=d.index, dtype=float)
    m = known & (pe > lim * 1.02)
    check(S, "position inside the chromosome of its stated assembly", int(m.sum()), int(known.sum()), level="WARN",
          note="source error; placed approximately, not converted",
          examples=[f"{s} {c}:{int(p)} > {int(x)}" for s, c, p, x in zip(src[m], d.chromosome[m], pe[m], lim[m])],
          ids=flagged(d, m, "beyond the chromosome end of its assembly"))
    unk = has & ad & d.chromosome.isin(CHRS) & ~known
    hl = d.chromosome.map(hub).astype(float)
    m = unk & (pe > hl * 1.3)
    check(S, "position plausible where the assembly is unknown (<= 1.3 x UTX length)", int(m.sum()),
          int(unk.sum()), level="WARN", ids=flagged(d, m, "longer than any assembly of this chromosome"),
          examples=(study(d[m]).value_counts().head(5).index.tolist()))
    w = pe - ps
    m = has & (w > 30e6)
    check(S, "interval narrower than 30 Mb", int(m.sum()), int(has.sum()), level="WARN",
          note="wide clusters / low-density maps; drawn but weak for co-location",
          examples=study(d[m]).value_counts().head(5).index.tolist())

    cms = {c: num(d[c]) for c in ("cm_start", "cm_stop", "cm_peak")}
    hc = cms["cm_start"].notna() | cms["cm_peak"].notna()
    m = pd.concat([(v < 0) | (v > 400) for v in cms.values()], axis=1).any(axis=1)
    check(S, "cM within 0-400", int(m.sum()), int(hc.sum()), level="WARN",
          note="negative = support interval extended past the end of the group",
          examples=study(d[m]).value_counts().head(5).index.tolist(), ids=flagged(d, m, "cM outside 0-400"))
    m = (cms["cm_start"] > cms["cm_stop"])
    check(S, "cM start <= stop", int(m.sum()), int(hc.sum()))
    m = (cms["cm_peak"] < cms["cm_start"] - 1) | (cms["cm_peak"] > cms["cm_stop"] + 1)
    check(S, "cM peak inside its support interval", int(m.sum()), int((cms["cm_peak"].notna() & cms["cm_start"].notna()).sum()),
          level="WARN", examples=study(d[m]).value_counts().head(5).index.tolist(), ids=flagged(d, m, "peak outside interval"))

    p, nl, lod, r2 = num(d.p_value), num(d.neg_log10_p), num(d.lod), num(d.r2_pct)
    check(S, "P in (0, 1]", int(((p <= 0) | (p > 1)).sum()), int(p.notna().sum()))
    check(S, "-log10(P) >= 0", int((nl < 0).sum()), int(nl.notna().sum()))
    m = p.notna() & nl.notna() & ((nl + np.log10(p.clip(lower=1e-300))).abs() > 0.05)
    check(S, "-log10(P) agrees with P", int(m.sum()), int((p.notna() & nl.notna()).sum()), ids=flagged(d, m, "P and -log10P disagree"))
    check(S, "LOD >= 0", int((lod < 0).sum()), int(lod.notna().sum()))
    m = lod > 100
    check(S, "LOD <= 100", int(m.sum()), int(lod.notna().sum()), level="WARN",
          note="very strong loci; usually GWAS-derived QTL with matching -log10P", ids=flagged(d, m, "LOD > 100"))
    check(S, "PVE within 0-100 %", int(((r2 < 0) | (r2 > 100)).sum()), int(r2.notna().sum()))
    m = (d.record_type == "GWAS") & ((nl < -math.log10(0.05)) | (p > 0.05))
    check(S, "GWAS association has P <= 0.05", int(m.sum()), int((d.record_type == "GWAS").sum()),
          examples=study(d[m]).value_counts().head(5).index.tolist(), ids=flagged(d, m, "non-significant GWAS row"))

    yr = num(d.year)
    check(S, "year 1900-2026", int(((yr < 1900) | (yr > 2026)).sum()), int(yr.notna().sum()),
          examples=d.loc[(yr < 1900) | (yr > 2026), "year"].unique().tolist())
    m = (d.pmid != "") & ~d.pmid.str.fullmatch(r"\d{1,9}")
    check(S, "PMID is numeric", int(m.sum()), int((d.pmid != "").sum()), examples=d.loc[m, "pmid"].unique().tolist())
    dm = (d.doi != "") & ~d.doi.str.contains(r"10\.\d{4,9}/\S+", regex=True)
    check(S, "DOI well-formed", int(dm.sum()), int((d.doi != "").sum()), examples=d.loc[dm, "doi"].unique().tolist())

    # positions written into marker names (independent of the position columns)
    pat = re.compile(r"(?:^|[^A-Za-z0-9])(?:Gh_|Gb_|Chr|chr|Ghir\.NAUv1:)?([AD])t?0?(\d{1,2})[_:\-](\d{4,9})(?![\d.])")
    rows = []
    for rid, s, c, a, b, mk, nm, sd in zip(d.record_id, d.source_db, d.chromosome, ps, pe, d.lead_marker, d.qtl_name,
                                          study(d)):
        if a != a:
            continue
        m_ = pat.search(mk) or pat.search(nm)
        if not m_:
            continue
        mc, mp = f"{m_.group(1)}{int(m_.group(2)):02d}", int(m_.group(3))
        ok = (mc == c) and (a - 1000 <= mp <= b + 1000)
        rows.append((rid, s, sd, ok, f"{mk or nm} vs {c}:{int(a)}"))
    x = pd.DataFrame(rows, columns=["rid", "src", "study", "ok", "ex"])
    for s_, g in x.groupby("src"):
        bad = g[~g.ok]
        check(S, f"position agrees with the position in the SNP name ({s_})", len(bad), len(g),
              level="WARN" if len(bad) <= 0.02 * len(g) else "FAIL", examples=bad.ex.tolist(),
              ids=[(r, sd, "SNP name says another position") for r, sd in zip(bad.rid, bad.study)])

    # CottonGen NAU placements near the chromosome start disagree with UTX placements of the same marker
    nau = (src == "Gh_NAU_v1.1") & (d.source_db == "CottonGen") & (ps < 1e6)
    check(S, "CottonGen NAU-NBI positions < 1 Mb (often scaffold-relative)", int(nau.sum()),
          int(((src == "Gh_NAU_v1.1") & has).sum()), level="WARN",
          note="78% of testable cases disagree with CottonGen's UTX placement of the same marker",
          ids=flagged(d, nau, "suspect NAU position near chromosome start"))
    return d


# ============================================================================ B. coordinate conversion
def section_b(d):
    S = "B. conversion"
    lt = pd.read_csv(f"{ROOT}/analysis/tables/coordinates_lifted.tsv", sep="\t", dtype=str, keep_default_na=False,
                     low_memory=False)
    lens = pd.read_csv(f"{ROOT}/data/liftover/chromosome_lengths.tsv", sep="\t")
    clen = {(a, c): n for a, c, n in zip(lens.assembly, lens.chromosome, lens.length_bp)}
    keys = [c[:-4] for c in lt.columns if c.endswith("_chr")]
    need = d[(d.genome_group == "AD") & num(d.phys_start).notna() & d.chromosome.isin(CHRS)]
    miss = ~need.record_id.isin(lt.record_id)
    check(S, "every placed tetraploid record is in the conversion table", int(miss.sum()), len(need),
          examples=need.record_id[miss].tolist())
    check(S, "conversion table has no unknown records", int((~lt.record_id.isin(d.record_id)).sum()), len(lt))
    for k in keys:
        c, s, e = lt[f"{k}_chr"], num(lt[f"{k}_start"]), num(lt[f"{k}_end"])
        has = c != ""
        lim = pd.Series([clen.get((k, x), np.nan) for x in c], index=lt.index)
        bad = has & ((s < 0) | (e > lim * 1.001) | (s > e) | ~c.isin(CHRS))
        check(S, f"{k}: converted positions inside the chromosomes", int(bad.sum()), int(has.sum()),
              examples=(lt.record_id[bad] + " " + c[bad] + ":" + lt[f"{k}_end"][bad]).tolist())
        same = (lt.source_assembly == k) & ~lt.hub_method.str.contains("beyond the chromosome end")
        if same.any():
            bad = same & ((num(lt.start) != s) | (num(lt.end) != e))
            check(S, f"{k}: published positions kept unchanged", int(bad.sum()), int(same.sum()))
    m = lt.hub_method.str.startswith("approximate")
    check(S, "records placed by relative position only", int(m.sum()), len(lt), level="WARN",
          note="assembly not stated or no usable public genome; error up to a few Mb",
          examples=lt.hub_method[m].value_counts().head(4).index.tolist())

    # independent test: one marker placed by CottonGen (or a paper) on two aligned assemblies
    have = {k for k in keys if k == L.HUB or os.path.exists(f"{ROOT}/data/liftover/{k}.anchors.tsv")}
    x = d[(d.lead_marker != "") & num(d.phys_start).notna() & (d.genome_group == "AD")].copy()
    x["src"] = x.ref_genome.map(L.source_key)
    x = x[x.src.isin(have)]
    x["pos"] = num(x.phys_start)
    x = x[num(x.phys_end).fillna(x.pos) - x.pos <= 5000]
    g = x.groupby(["lead_marker", "src"]).agg(chr=("chromosome", "first"), pos=("pos", "median")).reset_index()
    multi = g.groupby("lead_marker").src.nunique()
    g = g[g.lead_marker.isin(multi[multi > 1].index)]
    maps = {}

    def amap(k, rev):
        if (k, rev) not in maps:
            maps[(k, rev)] = L.AnchorMap(f"{ROOT}/data/liftover/{k}.anchors.tsv", reverse=rev)
        return maps[(k, rev)]

    errs, homoeo, near0 = [], 0, 0
    for mk, grp in g.groupby("lead_marker"):
        rs = list(grp.itertuples())
        for i in range(len(rs)):
            for j in range(i + 1, len(rs)):
                a, b = rs[i], rs[j]
                if min(a.pos, b.pos) < 1e6:
                    near0 += 1
                    continue
                hub = (a.chr, int(a.pos)) if a.src == L.HUB else amap(a.src, True).point(a.chr, int(a.pos))
                if not hub:
                    continue
                t = (hub[0], hub[1]) if b.src == L.HUB else amap(b.src, False).point(hub[0], hub[1])
                if not t:
                    continue
                if t[0] != b.chr:
                    homoeo += t[0][1:] == b.chr[1:]
                    errs.append((mk, a.src, b.src, None))
                else:
                    errs.append((mk, a.src, b.src, abs(t[1] - b.pos)))
    e = pd.DataFrame(errs, columns=["marker", "a", "b", "err"])
    same = e[e.err.notna()]
    ok = same.err <= 50_000
    q = same.err.quantile([0.5, 0.9]).tolist()
    ok250 = same.err <= 250_000
    check(S, "same marker placed on two assemblies: converted position within 250 kb of the other placement",
          int((~ok250).sum()), len(same), level="WARN" if ok250.mean() >= 0.9 else "FAIL",
          note=f"independent of the alignment; median {q[0]:.0f} bp, 90th percentile {q[1] / 1e3:.0f} kb, "
               f"{ok.mean():.0%} within 50 kb; {near0} pairs with a position < 1 Mb left out (see the NAU check)",
          examples=(same[~ok250].marker + " " + (same[~ok250].err / 1e6).round(1).astype(str) + " Mb").head(8).tolist())
    same.to_csv(f"{ROOT}/analysis/tables/validation_marker_pairs.tsv", sep="\t", index=False)
    other = e[e.err.isna()]
    check(S, "same marker placed on two assemblies: same chromosome", len(other), len(e), level="WARN",
          note=f"{homoeo} of {len(other)} are the homoeologous chromosome: multi-copy SSRs placed at different copies",
          examples=other.marker.head(5).tolist())

    # site anchor files decode to the pipeline's anchors
    idx = json.load(open(f"{SITE}/assemblies/index.json"))
    for a in idx:
        k = a["key"]
        if len(a["lengths"]) != 26:
            check(S, f"{k}: 26 chromosome lengths in index.json", 1, 1)
        if k == L.HUB:
            continue
        j = json.load(open(f"{SITE}/assemblies/{k}.json"))["anchors"]
        tsv = defaultdict(list)
        for r in csv.DictReader(open(f"{ROOT}/data/liftover/{k}.anchors.tsv"), delimiter="\t"):
            tsv[r["hub_chr"]].append((int(r["hub_pos"]), r["tgt_chr"], int(r["tgt_pos"]), r["strand"]))
        bad = 0
        for hc, enc in j.items():
            h, t = np.cumsum(enc["h"]).tolist(), np.cumsum(enc["t"]).tolist()
            cs = [c for c, n in enc["c"] for _ in range(n)]
            dec = list(zip(h, cs, t, enc["s"]))
            bad += dec != sorted(tsv.get(hc, []))
        check(S, f"{k}: site anchor file decodes to the pipeline anchors", bad, len(j))
        n = sum(len(v) for v in tsv.values())
        check(S, f"{k}: anchor count in index.json", int(n != a["anchors"]), 1, examples=[f"{n} vs {a['anchors']}"])


# ============================================================================ C. website tables
def section_c():
    S = "C. site"
    rd = lambda f: pd.read_csv(f"{SITE}/{f}", dtype=str, keep_default_na=False, low_memory=False)  # noqa: E731
    qtl, gwas, mq, hs, maps, mk = rd("qtl.csv"), rd("gwas.csv"), rd("mqtl.csv"), rd("hotspots.csv"), rd("maps.csv"), rd("markers.csv")
    summ = json.load(open(f"{SITE}/summary.json"))["counts"]
    for name, df, col in (("qtl", qtl, "id"), ("gwas", gwas, "locus_id"), ("mqtl", mq, "mqtl_id"),
                          ("hotspots", hs, "hotspot_id"), ("maps", maps, "map_id"), ("metaqtl", rd("metaqtl.csv"), "id"),
                          ("clusters", rd("clusters.csv"), "id"), ("epistatic", rd("epistatic.csv"), "id"),
                          ("mtl", rd("mtl.csv"), "id")):
        dup = df[col].duplicated()
        check(S, f"{name}.csv: {col} unique", int(dup.sum()), len(df), examples=df[col][dup].tolist())
        check(S, f"{name}.csv: {col} present", int((df[col] == "").sum()), len(df))
    for key, n in (("qtl", len(qtl)), ("gwas_loci", len(gwas)), ("mqtl", len(mq)), ("hotspots", len(hs)),
                   ("maps", len(maps)), ("metaqtl", len(rd("metaqtl.csv"))), ("clusters", len(rd("clusters.csv"))),
                   ("epistatic", len(rd("epistatic.csv"))), ("mtl", len(rd("mtl.csv"))), ("markers", len(mk))):
        check(S, f"summary.json '{key}' equals the table", int(summ.get(key) != n), 1,
              examples=[f"summary {summ.get(key)} vs table {n}"])

    hsid = set(hs.hotspot_id)
    for name, df in (("qtl", qtl), ("gwas", gwas), ("mqtl", mq), ("clusters", rd("clusters.csv"))):
        ids = df.hotspot_id[df.hotspot_id != ""].str.split(r";\s*").explode()
        bad = ids[~ids.isin(hsid)]
        check(S, f"{name}.csv: hotspot_id refers to an existing hotspot", len(bad), len(ids), examples=bad.unique().tolist())

    hub = {r["chromosome"]: int(r["length_bp"])
           for r in csv.DictReader(open(f"{ROOT}/data/liftover/chromosome_lengths.tsv"), delimiter="\t")
           if r["assembly"] == L.HUB}
    for name, df in (("qtl", qtl), ("gwas", gwas)):
        has = df.map_bp != ""
        bp = num(df.map_bp)
        lim = df.map_chr.map(hub).astype(float)
        bad = has & ((bp < 0) | (bp > lim * 1.001) | ~df.map_chr.isin(CHRS))
        check(S, f"{name}.csv: map position inside the UTX v2.1 chromosome", int(bad.sum()), int(has.sum()),
              examples=(df.map_chr[bad] + ":" + df.map_bp[bad]).head(5).tolist())
        bad = has & ~df.map_method.isin(["aligned", "approximate"])
        check(S, f"{name}.csv: map_method is aligned/approximate", int(bad.sum()), int(has.sum()))
        a = (df.map_method == "aligned").sum()
        results.append((S, f"{name}.csv: share drawn from aligned positions", "INFO", int(a), int(has.sum()), "", ""))

    for c in ("position_mb", "ci_start_mb", "ci_end_mb", "ci_width_mb", "n_studies"):
        mq[c] = num(mq[c])
    bad = (mq.ci_start_mb > mq.position_mb + 0.01) | (mq.position_mb > mq.ci_end_mb + 0.01)
    check(S, "meta-QTL position inside its 95% CI", int(bad.sum()), len(mq), examples=mq.mqtl_id[bad].tolist())
    bad = ((mq.ci_end_mb - mq.ci_start_mb) - mq.ci_width_mb).abs() > 0.02
    check(S, "meta-QTL CI width = end - start", int(bad.sum()), len(mq), examples=mq.mqtl_id[bad].tolist())
    check(S, "meta-QTL supported by >= 2 studies", int((mq.n_studies < 2).sum()), len(mq))
    bad = ~mq.chromosome.isin(CHRS) | (mq.ci_end_mb * 1e6 > mq.chromosome.map(hub) * 1.001)
    check(S, "meta-QTL inside its chromosome", int(bad.sum()), len(mq), examples=mq.mqtl_id[bad].tolist())

    hs_s, hs_e = num(hs.start), num(hs.end)
    bad = (hs_s >= hs_e) | (hs_e > hs.chromosome.map(hub) * 1.001) | ~hs.chromosome.isin(CHRS)
    check(S, "hotspots: start < end, inside the chromosome", int(bad.sum()), len(hs), examples=hs.hotspot_id[bad].tolist())
    ins = json.load(open(f"{ROOT}/analysis/insights.json"))["hotspots"]
    bad = num(hs.n_studies) < ins["threshold_studies"]
    check(S, f"hotspots reach the study threshold ({ins['threshold_studies']})", int(bad.sum()), len(hs),
          level="WARN", note="peak window passes; merged neighbours may not", examples=hs.hotspot_id[bad].tolist())

    files = {f[:-4] for f in os.listdir(f"{SITE}/maps") if f.endswith(".csv")}
    check(S, "every map in maps.csv has a marker file", len(set(maps.map_id) - files), len(maps),
          examples=sorted(set(maps.map_id) - files))
    check(S, "every marker file is listed in maps.csv", len(files - set(maps.map_id)), len(files),
          examples=sorted(files - set(maps.map_id)))
    bad = []
    for mid, n in zip(maps.map_id, maps.n_loci):
        if mid in files and n:
            rows = sum(1 for _ in open(f"{SITE}/maps/{mid}.csv")) - 1
            if rows != int(float(n)):
                bad.append(f"{mid}: {rows} rows vs n_loci {n}")
    check(S, "map marker files match n_loci", len(bad), len(maps), level="WARN", examples=bad)
    bad = []
    for mid in sorted(files):
        m = pd.read_csv(f"{SITE}/maps/{mid}.csv", dtype=str, keep_default_na=False)
        cm = num(m.position_cm)
        if (cm < -5).any() or (cm > 500).any() or (m.marker == "").any():
            bad.append(mid)
    check(S, "map marker files: names present, cM within -5..500", len(bad), len(files), level="WARN", examples=bad)

    prim = pd.read_csv(f"{SITE}/marker_primers.csv", dtype=str, keep_default_na=False, usecols=["marker", "primers"])
    seqs = prim.primers.str.split(r"[|;,/]+").explode().str.replace(r"^[^:]*:", "", regex=True).str.replace(" ", "").str.upper().str.strip()
    seqs = seqs[seqs != ""]
    bad = seqs[~seqs.str.fullmatch(IUPAC.pattern)]
    check(S, "primer sequences use nucleotide letters only", len(bad), len(seqs), level="WARN",
          examples=bad.unique()[:5].tolist())
    short = seqs[seqs.str.len() < 8]
    check(S, "primer sequences >= 8 nt (RAPD primers are 10-mers)", len(short), len(seqs), level="WARN", examples=short.unique()[:5].tolist())
    check(S, "primer rows have a marker name", int((prim.marker == "").sum()), len(prim))

    lit = rd("literature.csv")
    d = lit.pmid[lit.pmid != ""].duplicated()
    check(S, "literature.csv: PMID unique", int(d.sum()), int((lit.pmid != "").sum()))
    for name, df in (("qtl", qtl), ("gwas", gwas), ("mqtl", mq), ("literature", lit)):
        col = "doi" if "doi" in df else None
        if col:
            v = df[col][df[col] != ""]
            bad = v[~v.str.match(r"https://(doi\.org/10\.\d{4,9}/\S+|pubmed\.ncbi\.nlm\.nih\.gov/\d+/?)$")]
            check(S, f"{name}.csv: DOI / PubMed links well-formed", len(bad), len(v), examples=bad.unique()[:5].tolist())

    # all-assemblies download
    with gzip.open(f"{SITE}/downloads/qtl_gwas_all_assemblies.csv.gz", "rt") as fh:
        dl = pd.read_csv(fh, dtype=str, keep_default_na=False)
    drawn = set(qtl.id[qtl.map_bp != ""]) | set(gwas.id[gwas.map_bp != ""])
    miss = drawn - set(dl.id)
    check(S, "download lists every QTL/GWAS locus drawn on the map", len(miss), len(drawn), examples=sorted(miss))
    results.append((S, "download: converted loci not drawn on the map (interval > 20 Mb or ends in the first 100 kb)",
                    "INFO", len(set(dl.id) - drawn), len(dl), "", ""))
    check(S, "download ids unique", int(dl.id.duplicated().sum()), len(dl))

    # demo files exist and are non-empty
    demo = os.listdir(f"{SITE}/demo")
    bad = [f for f in demo if os.path.getsize(f"{SITE}/demo/{f}") == 0]
    check(S, "demo files non-empty", len(bad), len(demo), examples=bad)


def main():
    d = section_a()
    section_b(d)
    section_c()
    os.makedirs(f"{ROOT}/analysis/tables", exist_ok=True)
    with open(f"{ROOT}/analysis/tables/validation_issues.tsv", "w", newline="") as fh:
        w = csv.writer(fh, delimiter="\t")
        w.writerow(["section", "check", "status", "record", "study", "reason"])
        w.writerows(issues)
    cnt = Counter(r[2] for r in results)
    lines = ["# Data validation report", "",
             f"{cnt['PASS']} passed · {cnt['WARN']} warnings · {cnt['FAIL']} failed "
             f"(generated by `scripts/validate_data.py`; flagged records in `validation_issues.tsv`)", "",
             "| Section | Check | Status | Flagged | Of | Note | Examples |", "|---|---|---|---|---|---|---|"]
    for r in results:
        lines.append("| " + " | ".join(str(x).replace("|", "/") for x in r) + " |")
    open(f"{ROOT}/analysis/tables/validation_report.md", "w").write("\n".join(lines) + "\n")
    w = max(len(r[1]) for r in results)
    for r in results:
        if r[2] != "PASS":
            print(f"{r[2]:4}  {r[1]:<{w}}  {r[3]:>7,} / {r[4]:<9,} {r[5][:70]}  {r[6][:110]}")
    print(f"\n{cnt['PASS']} passed, {cnt['WARN']} warnings, {cnt['FAIL']} failed")
    sys.exit(1 if cnt["FAIL"] else 0)


if __name__ == "__main__":
    main()
