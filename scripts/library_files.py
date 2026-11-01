#!/usr/bin/env python3
"""Sort papers and supplements downloaded through a library into one folder per paper.

Files are matched to a DOI from their name (DOI-style names, Springer/BMC ESM, Elsevier mmc, Wiley sup files)
or, for PDFs, from the DOI printed on the first pages. Matched files are hard-linked (no extra disk space)
into LIT/library/<doi with / as _>/. Metadata for papers that are not yet in the literature index is
looked up on Crossref and written to LIT/library_index.tsv, in the same columns as literature_index.tsv.

Usage: library_files.py PROJECT_DIR DROP_DIR [CANDIDATE_TSV ...]
"""
import csv, json, os, re, sys, time, urllib.parse, urllib.request, zipfile

UA = {"User-Agent": "CottonQTLome/1.0 (mailto:cottonqtlome@example.org)"}
SKIP_EXT = {"jpg", "jpeg", "png", "tif", "tiff", "gif", "mp4", "avi", "mov", "nwk", "fasta", "fa", "json", "ppt", "pptx"}
WILEY = {"tpj": "10.1111/tpj.", "pbi": "10.1111/pbi.", "jipb": "10.1111/jipb.", "nph": "10.1111/nph.", "pce": "10.1111/pce.",
         "ppl": "10.1111/ppl.", "pbr": "10.1111/pbr.", "mpp": "10.1111/mpp.", "csc2": "10.1002/csc2.", "tpg2": "10.1002/tpg2.",
         "fsn3": "10.1002/fsn3.", "pld3": "10.1002/pld3.", "ece3": "10.1002/ece3.", "aps3": "10.1002/aps3.", "jsfa": "10.1002/jsfa.",
         "imb": "10.1111/imb.", "ps": "10.1002/ps.", "jgg": "10.1111/jgg.", "pbi": "10.1111/pbi."}
OUP = {"erab": "10.1093/jxb/", "erac": "10.1093/jxb/", "erad": "10.1093/jxb/", "erae": "10.1093/jxb/", "eraf": "10.1093/jxb/",
       "kiab": "10.1093/plphys/", "kiac": "10.1093/plphys/", "kiad": "10.1093/plphys/", "kiae": "10.1093/plphys/",
       "kiaf": "10.1093/plphys/", "kiag": "10.1093/plphys/", "koab": "10.1093/plcell/", "koac": "10.1093/plcell/",
       "toac": "10.1093/jee/", "toad": "10.1093/jee/", "jkab": "10.1093/g3journal/", "jkac": "10.1093/g3journal/",
       "pcp": "10.1093/pcp/", "dnares": "10.1093/dnares/"}


def get(url):
    for _ in range(3):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60))
        except Exception:  # noqa: BLE001
            time.sleep(2)
    return None


def crossref_meta(doi):
    js = get("https://api.crossref.org/works/" + urllib.parse.quote(doi))
    return js["message"] if js else None


def pii_doi(pii, cache):
    if pii not in cache:
        js = get("https://api.crossref.org/works?" + urllib.parse.urlencode({"filter": f"alternative-id:{pii}", "rows": 1}))
        items = (js or {}).get("message", {}).get("items", [])
        cache[pii] = items[0]["DOI"].lower() if items else ""
    return cache[pii]


def resolve(doi, cache):
    """Crossref-check a DOI; if it fails, try turning underscores in the suffix back into slashes."""
    key = "doi:" + doi
    if key in cache:
        return cache[key]
    pre, _, suf = doi.partition("/")
    tries = [doi] + [pre + "/" + suf.replace("_", "/", k) for k in range(1, suf.count("_") + 1)] + [pre + "/" + suf.replace("_", "/")]
    if "rs.3.rs-" in doi:
        tries.insert(0, re.sub(r"_(v\d+)$", r"/\1", doi))
    out = ""
    for t in dict.fromkeys(tries):
        if get("https://api.crossref.org/works/" + urllib.parse.quote(t)):
            out = t
            break
    cache[key] = out or doi
    return cache[key]


def pdf_doi(path):
    try:
        import pdfplumber
        with pdfplumber.open(path) as pdf:
            txt = " ".join((p.extract_text() or "") for p in pdf.pages[:2])
    except Exception:  # noqa: BLE001
        return ""
    m = re.search(r"\b(10\.\d{4,9}/[^\s\"<>]+)", txt.replace("doi.org/", " ").replace("DOI ", " "))
    return m.group(1).rstrip(".,;)").lower() if m else ""


def match(name, known, cache, path):
    """Return (doi, how) for one file name."""
    base = os.path.basename(name)
    stem = base.rsplit(".", 1)[0]
    low = stem.lower()
    # DOI written into the file name with / -> _
    if low.startswith("10."):
        cand = low.replace("_", "/", 1)
        best = max((d for d in known if cand.startswith(d) or cand.startswith(d.replace("/", "_"))), key=len, default="")
        if best:
            return best, "file name"
        m = re.match(r"(10\.\d{4,9}/[^_]+(?:_[a-z]+\d+)?)", cand)
        doi = re.sub(r"(_supp.*|_v\d+.*|\.supp.*)$", "", cand)
        if "rs.3.rs" in doi:   # Research Square preprint: keep 10.21203/rs.3.rs-NNNN/vN
            mm = re.match(r"(10\.21203/rs\.3\.rs-\d+)_?(v\d+)", cand)
            doi = f"{mm.group(1)}/{mm.group(2)}" if mm else doi
        return (doi if m else ""), "file name"
    # Springer / BMC electronic supplementary material: <journal>_<year>_<article>_MOESMn_ESM
    m = re.match(r"(\d+)_(\d{4})_(\d+)_moesm", low)
    if m:
        j, y, a = int(m.group(1)), int(m.group(2)), int(m.group(3))
        rx = re.compile(rf"/s0*{j}-0*{y % 100:02d}-0*{a}-")
        rx2 = re.compile(rf"/s0*{j}-0*{y % 1000:03d}-0*{a}-")
        hits = [d for d in known if rx.search(d) or rx2.search(d)]
        if hits:
            return hits[0], "Springer ESM"
        return "", f"Springer ESM {j}/{y}/{a} (paper not on any list)"
    # Elsevier: 1-s2.0-<PII>-mmcN
    m = re.search(r"1-s2\.0-(s[0-9x]{16})", low)
    if m:
        d = pii_doi(m.group(1).upper(), cache)
        return d, "Elsevier PII" if d else "Elsevier PII not found"
    # Wiley: <journal code><article>-sup-... or -sm-...
    for code in sorted(WILEY, key=len, reverse=True):
        m = re.match(rf"{code}(\d{{4,6}})-(sup|sm)-", low)
        if m:
            return WILEY[code] + m.group(1), "Wiley sup"
    # older ACSESS (Crop Science, Plant Genome): csc2cropsci2008030129 -> 10.2135/cropsci2008.03.0129
    m = re.match(r"csc2cropsci(\d{4})(\d{2})(\d{4})-sup", low)
    if m:
        return f"10.2135/cropsci{m.group(1)}.{m.group(2)}.{m.group(3)}", "ACSESS sup"
    m = re.match(r"tpg2plantgenome(\d{4})(\d{2})(\d{4})-sup", low)
    if m:
        return f"10.3835/plantgenome{m.group(1)}.{m.group(2)}.{m.group(3)}", "ACSESS sup"
    # Nature portfolio ESM: 41588_2017_BFng3807_MOESM.. ; 41437_2008_BF6801063 (Heredity, sj.hdy)
    m = re.match(r"(\d+)_\d{4}_bf([a-z]*)(\d+)_moesm", low)
    if m:
        j, code, num = m.groups()
        if j == "41437":
            return f"10.1038/sj.hdy.{num}", "Nature ESM"
        return (f"10.1038/{code}.{num}" if code in ("ng", "nplants", "ncomms") else f"10.1038/{code}{num}"), "Nature ESM"
    # PLoS: journal.pone.0034874.s001
    m = re.match(r"(journal\.p[a-z]+\.\d{7})\.s\d+", low)
    if m:
        return "10.1371/" + m.group(1), "PLoS sup"
    # Oxford Academic: erab555_suppl..., kiag031_supplementary...
    m = re.match(r"([a-z]+)(\d{3})_supp", low)
    if m and m.group(1) in OUP:
        return OUP[m.group(1)] + m.group(1) + m.group(2), "OUP sup"
    if base.lower().endswith(".pdf"):
        d = pdf_doi(path)
        if d:
            return d, "DOI inside PDF"
    return "", "unmatched"


def main(proj, drop, cand_files):
    lit = f"{proj}/data/literature"
    lib = f"{lit}/library"
    os.makedirs(lib, exist_ok=True)
    known = set()
    with open(f"{lit}/literature_index.tsv") as fh:
        index = {r["doi"].lower(): r for r in csv.DictReader(fh, delimiter="\t") if r["doi"]}
    known |= set(index)
    for f in cand_files:
        with open(f) as fh:
            known |= {r["doi"].lower() for r in csv.DictReader(fh, delimiter="\t") if r.get("doi")}
    cache_f = f"{lit}/library_pii_cache.json"
    cache = json.load(open(cache_f)) if os.path.exists(cache_f) else {}
    status = []
    fd_f = f"{lit}/library_folders.json"
    folder_doi = json.load(open(fd_f)) if os.path.exists(fd_f) else {}
    files = sorted(os.path.join(dp, f) for dp, _, fs in os.walk(drop) for f in fs)
    for path in files:
        ext = path.rsplit(".", 1)[-1].lower() if "." in path else ""
        if ext in ("html", "tsv") and os.path.dirname(path) == drop.rstrip("/"):
            continue
        if ext in SKIP_EXT:
            status.append(dict(file=os.path.relpath(path, drop), doi="", how=f"skipped ({ext}: figure or non-table)"))
            continue
        doi, how = match(path, known, cache, path)
        if doi and doi not in known:
            doi = resolve(doi, cache)
        if doi:
            folder_doi[doi.replace("/", "_")] = doi
            d = f"{lib}/{doi.replace('/', '_')}"
            os.makedirs(d, exist_ok=True)
            tgt = f"{d}/{os.path.basename(path)}"
            if not os.path.exists(tgt):
                try:
                    os.link(path, tgt)
                except OSError:
                    import shutil
                    shutil.copy2(path, tgt)
        status.append(dict(file=os.path.relpath(path, drop), doi=doi, how=how))
    json.dump(cache, open(cache_f, "w"))
    json.dump(folder_doi, open(fd_f, "w"), indent=0)
    # drop folders made under an unresolved spelling of a DOI
    import shutil
    for folder in os.listdir(lib):
        if folder not in folder_doi:
            shutil.rmtree(f"{lib}/{folder}")
    with open(f"{lit}/library_status.tsv", "w", newline="") as fh:
        w = csv.DictWriter(fh, ["file", "doi", "how"], delimiter="\t")
        w.writeheader()
        w.writerows(status)
    # metadata for papers not in the literature index
    cols = list(next(csv.reader(open(f"{lit}/literature_index.tsv"), delimiter="\t")))
    old = {}
    if os.path.exists(f"{lit}/library_index.tsv"):
        with open(f"{lit}/library_index.tsv") as fh:
            old = {r["doi"]: r for r in csv.DictReader(fh, delimiter="\t")}
    rows = []
    for folder in sorted(os.listdir(lib)):
        doi = folder_doi[folder]
        if doi in index:
            continue
        if doi in old and old[doi]["title"]:
            rows.append(old[doi])
            continue
        m = crossref_meta(doi) or {}
        title = re.sub(r"<[^>]+>", "", (m.get("title") or [""])[0])
        abstract = re.sub(r"<[^>]+>", " ", m.get("abstract", ""))
        t = (title + " " + abstract).lower()
        r = {c: "" for c in cols}
        r.update(epmc_id=f"LIB:{doi}", source="LIB", doi=doi, title=title, abstract=abstract[:3000],
                 year=str(((m.get("issued") or {}).get("date-parts") or [[""]])[0][0]),
                 journal=(m.get("container-title") or [""])[0],
                 authors=", ".join(f"{a.get('family', '')} {a.get('given', '')[:1]}".strip() for a in m.get("author", [])[:30]),
                 pub_types="Research article", is_open_access="N", in_pmc="N", has_suppl="Y", cited_by="0",
                 is_qtl_linkage="1" if re.search(r"\bqtls?\b|quantitative trait loc|linkage map|genetic map", t) else "0",
                 is_gwas="1" if re.search(r"genome.wide association|\bgwas\b|association mapping", t) else "0",
                 is_meta_qtl="1" if "meta-qtl" in t or "meta-analysis" in t else "0",
                 is_epistasis="1" if "epista" in t else "0", is_fine_mapping="1" if re.search(r"fine.?mapp", t) else "0",
                 is_bsa="1" if re.search(r"bulked|\bbsa\b|qtl-seq", t) else "0", is_review="1" if "review" in t[:200] else "0")
        for c in ("is_multi_trait", "is_qtl_x_env", "is_eqtl_omics"):
            r[c] = "0"
        rows.append(r)
        time.sleep(0.1)
    with open(f"{lit}/library_index.tsv", "w", newline="") as fh:
        w = csv.DictWriter(fh, cols, delimiter="\t")
        w.writeheader()
        w.writerows(rows)
    hows = {}
    for s in status:
        hows[s["how"].split(" (")[0]] = hows.get(s["how"].split(" (")[0], 0) + 1
    print(len(status), "files;", hows)
    print(len(os.listdir(lib)), "paper folders;", len(rows), "papers new to the index")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3:])
