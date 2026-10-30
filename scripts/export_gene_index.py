#!/usr/bin/env python3
"""Gene search files for the website (TM-1 UTX v2.1, the map axis).

    python3 scripts/export_gene_index.py        # after export_site_data.py

Inputs (data/genomes/annotation/)
  cottongen/Ghirsutum_527_v2.1.gene.gff3.gz     JGI gene models (Gohir.*), the reference gene set
  gca/.../GCA_007990345.1/genomic.gff           GenBank locus tags (ERO13_*), linked to Gohir IDs by Dbxref
  gcf/.../GCF_007990345.1/genomic.gff           NCBI RefSeq genes (LOC*, symbols, descriptions), linked by overlap
  cottongen/blastp_*_vs_arabidopsis.xlsx(.gz)   best Arabidopsis hit per gene
  cottongen/blastp_*_vs_swissprot.xlsx(.gz)     best Swiss-Prot hit (protein name)
  data/processed/records_deduplicated.tsv       candidate genes named by the papers (any naming scheme)

Outputs (website/public/data/genes/)
  chr/<A01..D13>.json   genes of one chromosome, sorted by start: loaded to list the genes inside an interval
  alias/<00..63>.json   normalised alias -> genes and records; a search fetches one shard (see shardOf below)
  index.json            counts, shard count, column order
The shard of an alias is FNV-1a (32 bit) of its normalised UTF-8 form modulo N_SHARDS; website/src/lib/genes.ts
implements the same function.
"""
import gzip
import json
import os
import re
import shutil
from collections import defaultdict

import numpy as np
import pandas as pd

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ANN = f"{ROOT}/data/genomes/annotation"
OUT = f"{ROOT}/website/public/data/genes"
N_SHARDS = 64
CHRS = [f"{g}{i:02d}" for g in "AD" for i in range(1, 14)]
MIN_OVERLAP = 0.5   # RefSeq gene <-> JGI gene: overlap / shorter gene length, same strand
GENE_TOKEN = re.compile(
    r"^(?:Gohir\.[AD]\d\dG\d+|GH_[AD]\d\dG\d+|Gh_[AD]\d\dG\d+|Ghir_[AD]\d\dG\d+|Gbar_[AD]\d\dG\d+|GB_[AD]\d\dG\d+|"
    r"Gb_[AD]\d\dG\d+|GOBAR_[AD]\d\dG\d+|Garb_\d\dG\d+|Ga\d\dG\d+|Gorai\.\d{3}G\d+|Gr\d\dG\d+|ERO13_[AD]\d\dG\d+v?\d?|"
    r"LOC\d{6,}|AT[1-5CM]G\d{5}|Gh[A-Z][A-Za-z0-9-]{1,15})(?:\.\d+)*$")


def norm(a):
    """Lower case, no transcript / version suffix (Gohir.A01G000101.1 -> gohir.a01g000101)."""
    a = a.strip().lower()
    a = re.sub(r"(\.v\d+(\.\d+)*|_utx-tm1_v2\.1)$", "", a)
    a = re.sub(r"(?<=g\d{4})(\.\d+)+$|(?<=g\d{5})(\.\d+)+$|(?<=g\d{6})(\.\d+)+$|(?<=\d{5})\.\d+$", "", a)
    a = re.sub(r"(?<=\d)v\d$", "", a)                     # ERO13_A01G000101v2
    return a


def shard_of(a):
    h = 0x811C9DC5
    for b in a.encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h % N_SHARDS


def attrs(s):
    return dict(kv.split("=", 1) for kv in s.strip().split(";") if "=" in kv)


def gff_genes(path, opener=open):
    with opener(path, "rt") as fh:
        for line in fh:
            if "\tgene\t" not in line or line.startswith("#"):
                continue
            f = line.rstrip("\n").split("\t")
            if f[2] == "gene":
                yield f[0], int(f[3]), int(f[4]), f[6], attrs(f[8])


def best_hits(name):
    p = f"{ANN}/cottongen/blastp_G.hirsutum_UTX_v2.1_vs_{name}.xlsx"
    if not os.path.exists(p):
        return {}
    x = pd.read_excel(p, header=2, dtype=str)
    x["gene"] = x["Query"].str.replace(r"\.\d+_UTX-TM1_v2\.1$", "", regex=True)
    x["Score"] = pd.to_numeric(x["Score"], errors="coerce")
    x = x.sort_values("Score", ascending=False).drop_duplicates("gene")
    return {g: (m, d) for g, m, d in zip(x["gene"], x["Match"].fillna(""), x["Description"].fillna(""))}


def export_intervals():
    """intervals/<chr>.json rows: [kind, id, trait, category, start, end, support, method] on UTX v2.1.
    kind: M meta-QTL (95% CI), H hotspot, Q linkage QTL, G GWAS locus. support: studies (M, H, G) or LOD (Q)."""
    site = f"{ROOT}/website/public/data"
    rd = lambda f: pd.read_csv(f"{site}/{f}", dtype=str, keep_default_na=False)  # noqa: E731
    lt = pd.read_csv(f"{ROOT}/analysis/tables/coordinates_lifted.tsv", sep="\t", dtype=str, keep_default_na=False,
                     usecols=["record_id", "Gh_UTX_v2.1_chr", "Gh_UTX_v2.1_start", "Gh_UTX_v2.1_end"])
    lt = lt[lt["Gh_UTX_v2.1_chr"] != ""].set_index("record_id")
    rows = []
    mq = rd("mqtl.csv")
    for r in mq.itertuples():
        rows.append([r.chromosome, "M", r.mqtl_id, r.trait, r.category, int(float(r.ci_start_mb) * 1e6),
                     int(float(r.ci_end_mb) * 1e6), r.n_studies, r.confidence])
    for r in rd("hotspots.csv").itertuples():
        rows.append([r.chromosome, "H", r.hotspot_id, r.top_traits[:80], r.dominant_category, int(r.start), int(r.end),
                     r.n_studies, ""])
    for f, kind, rid in (("qtl.csv", "Q", "id"), ("gwas.csv", "G", "lead_record")):
        d = rd(f)
        d = d[(d.map_bp != "") & (d.map_chr != "")]
        for r in d.itertuples():
            key = getattr(r, rid)
            if key in lt.index and lt.at[key, "Gh_UTX_v2.1_start"] and lt.at[key, "Gh_UTX_v2.1_chr"] == r.map_chr:
                s, e = int(float(lt.at[key, "Gh_UTX_v2.1_start"])), int(float(lt.at[key, "Gh_UTX_v2.1_end"] or lt.at[key, "Gh_UTX_v2.1_start"]))
            else:
                s = e = int(r.map_bp)
            sup = r.lod if kind == "Q" else r.n_studies
            rows.append([r.map_chr, kind, r.id, r.parameter, r.trait, min(s, e), max(s, e), sup, r.map_method])
    iv = pd.DataFrame(rows, columns=["chr", "kind", "id", "trait", "category", "start", "end", "support", "method"])
    iv = iv[iv.chr.isin(CHRS)].sort_values(["chr", "start"])
    os.makedirs(f"{OUT}/intervals", exist_ok=True)
    for c, x in iv.groupby("chr"):
        json.dump(x.drop(columns="chr").values.tolist(), open(f"{OUT}/intervals/{c}.json", "w"),
                  separators=(",", ":"), default=int)
    return len(iv)


def main():
    # ---- reference gene set
    rows = []
    for c, s, e, st, a in gff_genes(f"{ANN}/cottongen/Ghirsutum_527_v2.1.gene.gff3.gz", gzip.open):
        if c in CHRS:
            rows.append((a.get("Name") or a["ID"].replace(".v2.1", ""), c, s, e, st))
    g = pd.DataFrame(rows, columns=["id", "chr", "start", "end", "strand"])
    print("JGI genes", len(g), flush=True)

    # ---- GenBank locus tags
    tag = {}
    for c, s, e, st, a in gff_genes(f"{ANN}/gca/ncbi_dataset/data/GCA_007990345.1/genomic.gff"):
        m = re.search(r"Phytozome:(Gohir\.[^,;]+)", a.get("Dbxref", ""))
        if m:
            tag[m.group(1)] = a.get("locus_tag", a.get("Name", ""))
    g["locus_tag"] = g["id"].map(tag).fillna("")

    # ---- RefSeq genes, matched by overlap
    rep = [json.loads(l) for l in open(f"{ANN}/gcf/ncbi_dataset/data/GCF_007990345.1/sequence_report.jsonl")]
    nc = {r["refseqAccession"]: r["chrName"] for r in rep if r.get("role") == "assembled-molecule"}
    rs = []
    for c, s, e, st, a in gff_genes(f"{ANN}/gcf/ncbi_dataset/data/GCF_007990345.1/genomic.gff"):
        if c in nc and a.get("gene_biotype") == "protein_coding":
            rs.append((nc[c], s, e, st, a.get("Name", ""), a.get("description", "").replace("%2C", ",").replace("%3B", ";"),
                       re.search(r"GeneID:(\d+)", a.get("Dbxref", "")).group(1) if "GeneID:" in a.get("Dbxref", "") else ""))
    r = pd.DataFrame(rs, columns=["chr", "start", "end", "strand", "name", "description", "geneid"])
    print("RefSeq protein-coding genes", len(r), flush=True)
    best = {}
    for c, rg in r.groupby("chr"):
        gg = g[g.chr == c].sort_values("start")
        gs, ge = gg.start.values, gg.end.values
        order = np.argsort(gs)
        cummax_end = np.maximum.accumulate(ge[order])
        for row in rg.itertuples():
            hi = np.searchsorted(gs[order], row.end, side="right")
            lo = np.searchsorted(cummax_end, row.start, side="left")
            for k in order[lo:hi]:
                ov = min(ge[k], row.end) - max(gs[k], row.start) + 1
                if ov <= 0 or gg.strand.values[k] != row.strand:
                    continue
                frac = ov / min(ge[k] - gs[k] + 1, row.end - row.start + 1)
                gid = gg.id.values[k]
                if frac >= MIN_OVERLAP and frac > best.get(gid, (0,))[0]:
                    best[gid] = (frac, row.name, row.description, row.geneid)
    g["refseq"] = g["id"].map(lambda x: best.get(x, (0, ""))[1])
    g["description"] = g["id"].map(lambda x: best.get(x, (0, "", ""))[2])
    g["ncbi_gene_id"] = g["id"].map(lambda x: best.get(x, (0, "", "", ""))[3])
    print("JGI genes with a RefSeq match", int((g.refseq != "").sum()), flush=True)

    # ---- homologs
    at, sp = best_hits("arabidopsis"), best_hits("swissprot")
    g["arabidopsis"] = g["id"].map(lambda x: re.sub(r"\.\d+$", "", at.get(x, ("", ""))[0]))
    sp_name = {k: re.sub(r"\s+OS=.*$", "", d) for k, (m, d) in sp.items()}
    sp_sym = {k: (re.search(r"GN=(\S+)", d).group(1) if "GN=" in d else "") for k, (m, d) in sp.items()}
    g["swissprot"] = g["id"].map(lambda x: sp.get(x, ("", ""))[0])
    g["swissprot_name"] = g["id"].map(sp_name).fillna("")
    g["symbol"] = g["id"].map(sp_sym).fillna("")
    g.loc[g.description == "", "description"] = g.loc[g.description == "", "swissprot_name"]

    # ---- per-chromosome gene files
    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(f"{OUT}/chr")
    os.makedirs(f"{OUT}/alias")
    cols = ["id", "start", "end", "strand", "locus_tag", "refseq", "ncbi_gene_id", "symbol", "arabidopsis", "description"]
    g = g.sort_values(["chr", "start"])
    for c, gg in g.groupby("chr"):
        json.dump(gg[cols].values.tolist(), open(f"{OUT}/chr/{c}.json", "w"), separators=(",", ":"), default=int)

    # ---- alias shards: genes
    shards = [defaultdict(lambda: {"g": [], "r": []}) for _ in range(N_SHARDS)]
    loc = {gid: (c, i) for c, gg in g.groupby("chr") for i, gid in enumerate(gg["id"])}

    def add(alias, key, val):
        a = norm(alias)
        if len(a) < 3:
            return
        bucket = shards[shard_of(a)][a][key]
        if val not in bucket:
            bucket.append(val)

    for x in g.itertuples():
        ref = [x.chr, loc[x.id][1]]
        for a in (x.id, x.locus_tag, x.refseq, x.ncbi_gene_id, x.arabidopsis, x.swissprot):
            if a:
                add(a, "g", ref)
        if x.symbol and len(x.symbol) >= 3:
            add(f"sym:{x.symbol}", "g", ref)      # homolog symbols are many-to-many; searched with a prefix

    # ---- alias shards: candidate genes named in records (old annotations, other species)
    d = pd.read_csv(f"{ROOT}/data/processed/records_deduplicated.tsv", sep="\t", dtype=str, keep_default_na=False,
                    usecols=["record_id", "locus_cluster_id", "record_type", "trait_harmonized", "chromosome", "candidate_genes", "first_author",
                             "year", "pmid", "trait_category"])
    d = d[(d.candidate_genes != "") & (d.trait_category != "unclassified")]
    n_rec = 0
    # GWAS rows are shown on the site as loci (one row per locus cluster), so link those by locus ID
    d["site_id"] = d.locus_cluster_id.where(d.record_type == "GWAS", d.record_id)
    for rid, rt, tr, c, cg, au, yr in zip(d.site_id, d.record_type, d.trait_harmonized, d.chromosome, d.candidate_genes,
                                          d.first_author, d.year):
        for tok in re.split(r"[;,\s/|]+", cg):
            tok = tok.strip("()[]\"'")
            if GENE_TOKEN.match(tok):
                add(tok, "r", [rid, rt, tr, c, f"{au} {yr}".strip()])
                n_rec += 1
    for i, sh in enumerate(shards):
        json.dump(sh, open(f"{OUT}/alias/{i:02d}.json", "w"), separators=(",", ":"))

    # ---- intervals on UTX v2.1 per chromosome, so a gene page needs one small file instead of the full tables
    n_iv = export_intervals()
    json.dump({"assembly": "Gh_UTX_v2.1", "n_genes": len(g), "n_shards": N_SHARDS, "columns": cols,
               "with_refseq": int((g.refseq != "").sum()), "with_arabidopsis": int((g.arabidopsis != "").sum()),
               "candidate_gene_mentions": n_rec, "intervals": n_iv,
               "interval_columns": ["kind", "id", "trait", "category", "start", "end", "support", "method"],
               "sources": "JGI Gossypium hirsutum UTX v2.1 (Gohir), GenBank GCA_007990345.1 (ERO13), "
                          "RefSeq GCF_007990345.1 (LOC, matched by overlap), BLASTP best hits to Arabidopsis and Swiss-Prot"},
              open(f"{OUT}/index.json", "w"), indent=1)
    sizes = [os.path.getsize(f"{OUT}/alias/{i:02d}.json") for i in range(N_SHARDS)]
    print(f"genes {len(g)}; alias shards {min(sizes) / 1e3:.0f}-{max(sizes) / 1e3:.0f} kB; candidate mentions {n_rec}")


if __name__ == "__main__":
    main()
