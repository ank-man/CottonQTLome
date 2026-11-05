#!/usr/bin/env python3
"""Cloned and functionally validated cotton genes behind traits, mined from titles and abstracts.

A paper qualifies when its title/abstract links a genetic mapping result (map-based / positional cloning,
fine mapping, QTL, GWAS, BSA, a mutant) to a named Gossypium gene, and says how the gene was confirmed
(VIGS, CRISPR, RNAi, over-expression, transgenic complementation, allele sequence). Each row is one
paper x gene with the evidence tier, validation methods, trait(s), chromosome and, when the gene ID is a
TM-1 UTX v2.1 / RefSeq ID, its position.

Outputs
  data/literature/cloned_genes_papers.tsv   every Europe PMC hit with the decision (cached search)
  data/processed/cloned_genes.tsv           the gene table
Usage: python3 scripts/cloned_genes.py . [--refresh]
"""
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter

import numpy as np
import pandas as pd

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else ".")
sys.path.insert(0, f"{ROOT}/scripts")
import harmonize as H  # noqa: E402

API = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
CACHE = f"{ROOT}/data/literature/cloned_genes_papers.tsv"
OUT = f"{ROOT}/data/processed/cloned_genes.tsv"
SP = 'TITLE_ABS:(cotton OR Gossypium)'
QUERIES = [
    f'{SP} AND TITLE_ABS:("map-based cloning" OR "positional cloning" OR "fine mapping" OR "fine-mapping" OR "fine mapped" OR "fine-mapped" OR "map-based isolation")',
    f'{SP} AND TITLE_ABS:(GWAS OR "genome-wide association" OR QTL OR "association mapping" OR "BSA-seq" OR "bulked segregant" OR "QTL-seq") '
    f'AND TITLE_ABS:(VIGS OR "gene silencing" OR CRISPR OR knockout OR "knock-out" OR transgenic OR overexpression OR "over-expression" OR overexpressing OR "functional validation" OR "functionally validated" OR complementation OR RNAi)',
    f'{SP} AND TITLE_ABS:(mutant OR mutation) AND TITLE_ABS:(cloning OR "candidate gene" OR "causal gene" OR "responsible gene" OR "causative")',
    f'{SP} AND TITLE:("candidate gene" OR "causal gene" OR "causative gene" OR "underlying" OR "controls" OR "regulates" OR "confers") '
    f'AND TITLE_ABS:(QTL OR GWAS OR "genome-wide association" OR "fine mapping" OR "BSA-seq" OR locus OR allele)',
]

# gene names: Gossypium symbols (GhMYB25, GbVIN1, GaGIR1, GhCASD1, Gh_A12G2345) and IDs of every annotation
SYMBOL = re.compile(r"\b((?:Gh|Gb|Ga|Gr|Gt|Gd|Gm)[A-Z][A-Za-z0-9]*\d[A-Za-z0-9]*(?:[-_.][A-Za-z0-9]+)?|"
                    r"(?:Gh|Gb|Ga)[A-Z]{2,}[a-z]?[A-Z0-9]*)\b")
GENEID = re.compile(r"\b(Gohir\.[AD]\d\dG\d{6}|GH_[AD]\d\dG\d{4}|Gh_[AD]\d\dG\d{4}|Ghir_[AD]\d\dG\d{6}|Gbar_[AD]\d\dG\d{6}|"
                    r"GB_[AD]\d\dG\d{4}|GOBAR_[AD]\d\dG\d+|GhM_[AD]\d\dG\d+|GbM_[AD]\d\dG\d+|Ga\d\dG\d{4,}|Gorai\.\d{3}G\d{6}|"
                    r"ERO13_[AD]\d\dG\d+|Garb_\d\dG\d+|Gh[AD]\d\dG\d{4,})\b")
CLASSIC = re.compile(r"\b(Li1|Li2|Li\(?[12]\)?|N1|n2|GoPGF|Gl2|Gl3|L-D1|L\(?D\)?1|okra|Rf1|Rf2|v1|cl1|fzl|Lc1|Le[12])\b")
NOT_GENE = re.compile(r"^(Gh|Gb|Ga)(SNP|SSR|QTL|GWAS|BSA|LG|NAU|CRI|HAU|ZJU|UTX|TM1|GBS|RNA|DNA|MAGIC|RIL|CSSL|BC|F2)", re.I)
VALID = {
    "VIGS": r"\bVIGS\b|virus[- ]induced gene silencing",
    "CRISPR/Cas9": r"CRISPR|Cas9|Cas12|gene[- ]edit|genome[- ]edit|base[- ]edit",
    "RNAi": r"\bRNAi\b|RNA interference|antisense|amiRNA",
    "over-expression": r"over-?express|ectopic(ally)? express",
    "transgenic complementation": r"complementation|complemented|transgenic",
    "knockout/mutant allele": r"knock-?out|knock-?down|loss-of-function|null (allele|mutant)|T-DNA",
    "allele sequence/marker": r"(InDel|SNP|deletion|insertion|frameshift|premature stop|splice|promoter) (variation|variant|mutation|in the)|functional marker|causal (variant|mutation|SNP)",
}
MAPPING = [("map-based cloning", r"map-based (cloning|isolation)|positional(ly)? clon"),
           ("fine mapping", r"fine[- ]?mapp"),
           ("GWAS", r"\bGWAS\b|genome[- ]wide association|association (mapping|analysis|study)"),
           ("QTL / BSA", r"\bQTLs?\b|quantitative trait|bulked segregant|BSA[- ]?seq|QTL-seq|MutMap"),
           ("mutant mapping", r"mutants?\b.{0,120}\b(mapp|linkage|segregat|F2|BC1|locus|loci|delimit)|"
                              r"(mapp|linkage|segregat|F2|delimit).{0,120}\bmutant")]
TRAIT_HINTS = [  # title/abstract phrase -> harmonised trait (checked in order; first hits kept)
    (r"fiber length|fibre length|fiber elongat|fibre elongat|cell elongation", "fiber length"),
    (r"fiber strength|fibre strength", "fiber strength"),
    (r"fiber initiation|fibre initiation|fuzz|lintless|fuzzless|naked seed|\blint\b(?! percentage)", "seed fuzz"),
    (r"lint percentage|lint yield|ginning", "lint percentage"),
    (r"micronaire|fiber fineness|fibre fineness|secondary (cell )?wall", "micronaire"),
    (r"fiber colou?r|colored fiber|brown fiber|green fiber", "fiber color"),
    (r"boll weight|boll size", "boll weight"),
    (r"seed oil|oil content|fatty acid", "seed oil and fatty acids"),
    (r"seed protein", "seed protein and amino acids"),
    (r"seed (size|weight)|seed index", "seed size and shape"),
    (r"plant height|dwarf|internode", "plant height and stature"),
    (r"plant architecture|fruit(ing)? branch|branch(ing)? angle|cluster|nulliplex|determinate", "branch traits"),
    (r"flowering|maturity|earliness|photoperiod", "flowering time"),
    (r"leaf shape|okra|leaf lob|super-okra|leaf morpholog", "leaf morphology"),
    (r"virescen|chlorophyll|albino|yellow(ing)? leaf|leaf colou?r|chlorosis", "chlorophyll content"),
    (r"gland|gossypol", "gossypol and glands"),
    (r"pubescen|trichome|hairiness", "trichome and pubescence"),
    (r"male steril|fertility restor|restorer|cytoplasmic male|\bCMS\b", "fertility and sterility"),
    (r"verticillium", "verticillium wilt resistance"),
    (r"fusarium", "fusarium wilt resistance"),
    (r"nematode", "root-knot nematode resistance"),
    (r"leaf curl|CLCuD|leaf crumple|virus resist", "cotton leaf curl / virus resistance"),
    (r"aphid|aphis|whitefly|insect|bollworm|spider mite", "insect resistance"),
    (r"drought|water deficit", "drought tolerance"),
    (r"salt|salinity", "salt tolerance"),
    (r"cold|chilling|freez", "cold tolerance"),
    (r"heat (stress|toleran)|high temperature", "heat tolerance"),
    (r"root", "root system traits"),
    (r"flower|petal|anther|pollen|stigma|corolla", "flower morphology"),
    (r"nitrogen|phosphorus|potassium|nutrient", "nutrient use"),
]


def fetch(q):
    recs, cursor = [], "*"
    while True:
        url = f"{API}?query={urllib.parse.quote(q)}&format=json&resultType=core&pageSize=1000&cursorMark={urllib.parse.quote(cursor)}"
        for k in range(5):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "CottonQTLome/1.0"}), timeout=180) as r:
                    js = json.load(r); break
            except Exception:  # noqa: BLE001
                time.sleep(3 * (k + 1))
        else:
            raise SystemExit("Europe PMC not reachable")
        res = js.get("resultList", {}).get("result", [])
        recs += res
        nxt = js.get("nextCursorMark")
        if not res or not nxt or nxt == cursor:
            return recs
        cursor = nxt


def search():
    rows = {}
    for q in QUERIES:
        for r in fetch(q):
            key = r.get("doi", "").lower() or r.get("pmid") or r.get("id")
            if r.get("pubType", "").lower().find("review") >= 0 and "review" in (r.get("title") or "").lower():
                continue
            rows[key] = {"pmid": r.get("pmid", ""), "pmcid": r.get("pmcid", ""), "doi": r.get("doi", ""),
                         "year": r.get("pubYear", ""), "journal": r.get("journalTitle", "") or (r.get("journalInfo", {}) or {}).get("journal", {}).get("title", ""),
                         "first_author": (r.get("authorString", "") or "").split(",")[0].strip(),
                         "title": re.sub(r"<[^>]+>", "", r.get("title", "") or ""),
                         "abstract": re.sub(r"<[^>]+>", "", r.get("abstractText", "") or "")}
        print(f"query {QUERIES.index(q) + 1}: {len(rows)} papers", flush=True)
    return pd.DataFrame(rows.values())


def chrom_of(gene, text):
    m = re.search(r"[_.]?([AD])(\d\d)G", gene) or re.search(r"Gh([AD])(\d\d)G", gene)
    if m:
        return f"{m.group(1)}{m.group(2)}"
    if re.match(r"(Ga|Garb_)(\d\d)G", gene):
        return f"A{re.match(r'(?:Ga|Garb_)(\d\d)', gene).group(1)}"
    return ""


def text_chrom(text):
    c = Counter(f"{a.upper()}{int(n):02d}" for a, n in
                re.findall(r"(?:chromosome|chr\.?|Chr)\s*([AD])[t]?\s*0?(\d{1,2})\b", text, flags=re.I) if 1 <= int(n) <= 13)
    c.update(f"{a.upper()}{int(n):02d}" for a, n in re.findall(r"\b([AD])t?(0\d|1[0-3])\b(?= chromosome|\s*\()", text))
    return c.most_common(1)[0][0] if c else ""


def clean(x):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", html.unescape(html.unescape(x or "")))).strip()


def tidy(g):
    """GhSAD1HapB -> GhSAD1, GhDSA05-silenced -> GhDSA05, GhTT19LR -> GhTT19 (allele / construct suffixes)."""
    g = re.sub(r"(?:[-_](?:silenced|OE|RNAi|KO|cas9|mutant|allele)|Hap[A-Z0-9]?|LR)$", "", g, flags=re.I)
    return re.sub(r"(?<=[A-Z0-9])s$", "", g)          # GhAPs, GoFLA19s


def classify(r):
    t, a = clean(r.title), clean(r.abstract)
    txt = f"{t} {a}"
    if not re.search(r"cotton|gossypium", txt, re.I):
        return None
    if re.search(r"(genome|gene)[- ]wide (analysis|identification|characteri[sz]ation|survey)|gene family|family genes|family members", t, re.I) \
            and not re.search(r"\bQTL|GWAS|association|mapping|mutant", t, re.I):
        return None   # gene-family surveys
    methods = [k for k, p in VALID.items() if re.search(p, txt, re.I)]
    mapping = [k for k, p in MAPPING if re.search(p, txt, re.I)]
    # genes: named in the title, or named at least twice in the abstract, or in a sentence with a validation method
    title_g = [g for g in SYMBOL.findall(t) + GENEID.findall(t) if not NOT_GENE.match(g)]
    sents = re.split(r"(?<=[.;])\s+", a)
    vsent = [s for s in sents if any(re.search(p, s, re.I) for p in VALID.values()) or
             re.search(r"candidate gene|causal gene|responsible for|encod|cloned|identified as", s, re.I)]
    cnt = Counter(g for g in SYMBOL.findall(a) + GENEID.findall(a) if not NOT_GENE.match(g))
    in_v = {g for s in vsent for g in SYMBOL.findall(s) + GENEID.findall(s)}
    # the title names the studied gene(s); otherwise the genes the abstract validates or calls candidates
    genes = list(dict.fromkeys(map(tidy, title_g))) or \
        list(dict.fromkeys(tidy(g) for g, n in cnt.most_common() if g in in_v or n >= 3))[:4]
    classic = list(dict.fromkeys(m for m in CLASSIC.findall(t) if m not in ("v1", "okra") or "mutant" in txt.lower()))
    genes = [g for g in genes if len(g) >= 3 and not re.fullmatch(r"Gh[A-Z]{2,3}", g)][:6]   # "G" left by tidy("Gs") etc.
    if not genes and not classic:
        return None
    if not mapping:
        return None
    if "map-based cloning" in mapping:
        tier = "map-based cloning"
    elif methods and set(methods) - {"allele sequence/marker"}:
        tier = "mapped and functionally validated"
    elif methods:
        tier = "mapped; causal variant described"
    elif re.search(r"fine[- ]?mapp|map-based|candidate gene|causal gene|clon", t, re.I):
        tier = "mapped candidate (not validated)"
    else:
        return None
    traits = []
    for p, tr in TRAIT_HINTS:
        if re.search(p, t, re.I) and tr not in traits:
            traits.append(tr)
    if not traits:
        for p, tr in TRAIT_HINTS:
            if re.search(p, a, re.I) and tr not in traits:
                traits.append(tr)
            if len(traits) == 2:
                break
    species = ("G. barbadense" if re.search(r"barbadense|sea[- ]island|pima", txt, re.I) and not re.search(r"hirsutum|upland", txt, re.I)
               else "G. arboreum" if re.search(r"arboreum", txt, re.I) and not re.search(r"hirsutum|upland", txt, re.I)
               else "G. hirsutum" if re.search(r"hirsutum|upland", txt, re.I) else "Gossypium")
    return {"genes": genes + [f"{c} (locus)" for c in classic], "tier": tier, "methods": "; ".join(methods),
            "mapping": "; ".join(mapping), "traits": "; ".join(traits[:3]), "species": species, "chrom_text": text_chrom(txt)}


def gene_positions():
    """Gohir / ERO13 / LOC / RefSeq symbol -> (chromosome, start, end, Gohir id) from the website gene index."""
    gd = f"{ROOT}/website/public/data/genes"
    if not os.path.isdir(f"{gd}/chr"):
        return {}, None
    sys.path.insert(0, f"{ROOT}/scripts")
    from export_gene_index import norm, shard_of  # noqa: E402
    chrs = {}
    for fn in os.listdir(f"{gd}/chr"):
        js = json.load(open(f"{gd}/chr/{fn}"))
        chrs[fn[:-5]] = js.get("genes", js) if isinstance(js, dict) else js
    shards = {}

    def look(name):
        k = norm(name)
        for key in (k, f"sym:{k}"):
            s = shard_of(key)
            if s not in shards:
                shards[s] = json.load(open(f"{gd}/alias/{s:02d}.json"))
            hit = shards[s].get(key)
            if hit and hit.get("g") and len(hit["g"]) == 1:
                c, i = hit["g"][0]
                g = chrs[c][i]
                return c, g
        return None
    return look, chrs


def link_records(out):
    """Records that name the gene as a candidate; their UTX v2.1 position (median) places the gene when its ID cannot."""
    d = pd.read_csv(f"{ROOT}/data/processed/records_deduplicated.tsv", sep="\t", dtype=str,
                    usecols=["record_id", "candidate_genes", "chromosome", "trait_harmonized"], low_memory=False)
    d = d[d.candidate_genes.notna()]
    ax = pd.read_csv(f"{ROOT}/analysis/tables/records_common_axis.tsv", sep="\t", usecols=["record_id", "pos"])
    d = d.merge(ax, on="record_id", how="left")
    tok = d.assign(g=d.candidate_genes.str.lower().str.split(r"[;,/ ]+")).explode("g")
    tok["g"] = tok.g.str.replace(r"(\.\d+)+$", "", regex=True)
    by = {k: v for k, v in tok.groupby("g")}
    n, ids, pos, tr = [], [], [], []
    for g, c in zip(out.gene.str.lower(), out.chromosome):
        h = by.get(g)
        if h is None:
            n.append(0); ids.append(""); pos.append(np.nan); tr.append(""); continue
        n.append(len(h)); ids.append("; ".join(h.record_id.head(20)))
        hh = h[(h.chromosome == c) | (c == "")] if c else h
        pos.append(hh.pos.median() / 1e6 if hh.pos.notna().any() else np.nan)
        tr.append("; ".join(sorted(set(h.trait_harmonized.dropna()))))
    out["n_records_naming_gene"], out["record_ids"], out["record_traits"] = n, ids, tr
    out["utx_v2_1_mb_from_records"] = pos
    return out


def main():
    if "--refresh" in sys.argv or not os.path.exists(CACHE):
        papers = search()
        papers.to_csv(CACHE, sep="\t", index=False)
    papers = pd.read_csv(CACHE, sep="\t", dtype=str).fillna("")
    # plus every paper already indexed for the QTL/GWAS mining (they carry abstracts)
    li = pd.concat([pd.read_csv(f"{ROOT}/data/literature/{n}", sep="\t", dtype=str) for n in ("literature_index.tsv", "library_index.tsv")
                    if os.path.exists(f"{ROOT}/data/literature/{n}")]).fillna("")
    li["first_author"] = li.authors.str.split(",").str[0].str.strip()
    papers = pd.concat([papers, li[["pmid", "pmcid", "doi", "year", "journal", "first_author", "title", "abstract"]]], ignore_index=True)
    papers["k"] = papers.doi.str.lower().where(papers.doi != "", papers.pmid)
    papers = papers.drop_duplicates("k").drop(columns="k")
    look, _ = gene_positions()
    rows, decided = [], []
    for r in papers.itertuples():
        c = classify(r)
        decided.append("kept" if c else "no named gene / no mapping evidence")
        if not c:
            continue
        for g in c["genes"]:
            gid = g.replace(" (locus)", "")
            chrom, start, end, ref_id = chrom_of(gid, ""), "", "", ""
            hit = look(gid) if look and not g.endswith("(locus)") else None
            if hit:
                hc, hg = hit
                chrom = chrom or hc
                if chrom == hc:
                    start, end = hg[1], hg[2]
                    ref_id = hg[0]
            rows.append({"gene": gid, "gene_type": "classical locus" if g.endswith("(locus)") else ("gene ID" if GENEID.fullmatch(gid) else "gene symbol"),
                         "trait_harmonized": c["traits"].split("; ")[0] if c["traits"] else "",
                         "traits_mentioned": c["traits"],
                         "evidence_tier": c["tier"], "mapping_evidence": c["mapping"], "validation_methods": c["methods"],
                         "species": c["species"], "chromosome": chrom or c["chrom_text"],
                         "chromosome_source": "gene ID" if chrom_of(gid, "") else ("gene index" if chrom else ("abstract" if c["chrom_text"] else "")),
                         "utx_v2_1_gene": ref_id, "utx_v2_1_start": start, "utx_v2_1_end": end,
                         "pmid": r.pmid, "pmcid": r.pmcid, "doi": r.doi, "year": r.year, "first_author": r.first_author,
                         "journal": r.journal, "title": clean(r.title)})
    papers["decision"] = decided
    papers.drop(columns=["abstract"]).to_csv(CACHE.replace(".tsv", "_decisions.tsv"), sep="\t", index=False)
    out = pd.DataFrame(rows)
    out = link_records(out)
    cats = pd.read_csv(f"{ROOT}/data/processed/trait_summary.tsv", sep="\t").set_index("trait_harmonized").trait_category.to_dict()
    tr_cat = {t: cats.get(t) or (H.harmonise_trait(t)[1] if t else "unclassified") for t in out.trait_harmonized.unique()}
    out["trait_category"] = out.trait_harmonized.map(tr_cat)
    out = out.drop_duplicates(["gene", "doi", "pmid"]).sort_values(["evidence_tier", "gene", "year"])
    out.insert(0, "cloned_gene_id", [f"CG{i:05d}" for i in range(1, len(out) + 1)])
    out.to_csv(OUT, sep="\t", index=False)
    import sqlite3
    db = f"{ROOT}/data/processed/cotton_qtl.sqlite"
    if os.path.exists(db):
        with sqlite3.connect(db) as con:
            out.to_sql("cloned_genes", con, index=False, if_exists="replace")
    print(f"papers searched {len(papers)}; kept {decided.count('kept')}; gene rows {len(out)}; unique genes {out.gene.str.lower().nunique()}")
    print(out.evidence_tier.value_counts().to_string())
    print("placed on UTX v2.1 by gene ID:", (out.utx_v2_1_start.astype(str) != "").sum(), "; via records:", out.utx_v2_1_mb_from_records.notna().sum(),
          "; named by records:", (out.n_records_naming_gene > 0).sum(), "; with chromosome:", (out.chromosome != "").sum())


if __name__ == "__main__":
    main()
