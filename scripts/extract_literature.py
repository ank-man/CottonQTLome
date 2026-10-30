#!/usr/bin/env python3
"""Turn harvested paper tables and supplementary files into harmonised QTL/GWAS records.

For every paper (PMC full text, PMC supplementary files, Springer ESM):
  1. normalise all tabular content (JATS tables, xlsx/xls sheets, csv/txt, docx/doc tables) to grids;
  2. classify each table (QTL, GWAS, meta-QTL, epistatic QTL, QTL cluster / pleiotropy, other);
  3. map header columns to canonical fields and emit one record per data row.

Extraction is automatic: every record keeps a pointer to its source table so it can be verified.

Usage: extract_literature.py PROJECT_DIR
"""
import csv
import glob
import json
import os
import math
import re
import subprocess
import sys
import tempfile
import zipfile
from concurrent.futures import ProcessPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harmonize as H  # noqa: E402

MAX_ROWS = 20000
MAX_FILE_BYTES = 40_000_000
csv.field_size_limit(10_000_000)

# Canonical field -> header regex (lower-cased header text). Order matters: first match wins.
MAX_BP = 2.5e8   # longest cotton chromosomes are ~150 Mb; anything above this is a parsing error

FIELDS = [
    # Columns that look positional or statistical but are not: counts, sizes, lengths, other studies' intervals.
    # Matched first and then dropped (e.g. "QTL region (Kb)" sizes were read as kb positions, "No. of significant
    # SNP" as a p-value, "Previously reported interval (Mb)" as the locus position).
    ("skip", r"^no\.?$|^no\.? of\b|\bnumber of\b|^count\b|previously|reported (in|interval|by|qtl)|clumping|\bmaf\b|"
             r"allele freq|\bsize\b|\bwidth\b|length ?\(|^length$|interval length|region length|region \(kb\)|distance (to|from|between)"),
    ("ci", r"confidence|\bci\b|support interval|lod[- ]?(drop|support)|\binterval \(c?m\)|range \(c?m\)|\b[12]-lod|"
           r"\b(start|stop|end|left|right|begin)\b[^|]{0,30}\bcm\b"),
    ("lod", r"\blod\b|\blrt?\b"),
    ("p", r"p[- ]?val|^p$|^p \(|log ?10|[−-] ?log|\bfdr\b|q[- ]?value|^prob|significan"),
    ("pve", r"\br ?2\b|r²|r\^2|\bpve\b|\bpv\b|phenotypic var|var(iance|iation)?\.? ?(expl|%)|expl(ained)?|contribution|\bvar ?%|h2"),
    ("additive", r"additive|\badd\b|^a$|^a \(|\baa\b|a ?× ?a|effect|substitution|\bdom\b|dominan"),
    ("gene", r"gene|annotation|homolog"),
    ("phys_start", r"\bstart\b|left (position|bp)|\bbegin"),
    ("phys_end", r"\bend\b|\bstop\b|right (position|bp)"),
    ("phys", r"\bbp\b|\bmb\b|\bkb\b|physical|genom(e|ic) ?(position|region|interval|location|coordinate)|snp position|position ?\(?bp"),
    ("marker", r"marker|\bsnp\b|\bsnps\b|flank|nearest|\binterval\b|\bbin\b|\bssr\b|\bindel\b|variant|\blocus id"),
    ("pos_cm", r"position|\bpos\b|peak|\bcm\b|\bsite\b|location \(cm"),
    ("chrom", r"^chr|chromos?o?m|\blg\b|linkage ?group|^c\.?$|^chr\.?/|scaffold"),
    ("env", r"environment|^env|\byear\b|\blocation\b|season|\bsite\b|treatment|condition|generation"),
    ("population", r"population|\bcross\b|parent|\bpanel\b|pedigree"),
    ("qtl_name", r"\bm?qtls?\b|meta[- ]?qtl|\blocus\b|\bloci\b|cluster|hotspot|^name$|consensus|\bmqtl"),
    ("trait", r"trait|phenotype|character|^index$|^item$"),
    ("ref", r"reference|^source$|author|citation|study|literature"),
]
FIELDS = [(f, re.compile(p)) for f, p in FIELDS]
NUM = re.compile(r"[-+−–]?\d+(?:[.,]\d+)?(?:\s*[eE×x]\s*(?:10\s*\^?\s*)?[-+−–]?\d+)?")


def clean(x):
    if x is None:
        return ""
    return re.sub(r"\s+", " ", str(x)).strip()


def to_float(x):
    """First number in a cell (handles 1.2E-08, 3.4×10−7, unicode minus, decimal comma)."""
    s = clean(x).replace("−", "-").replace("–", "-")
    m = re.search(r"([-+]?\d+(?:\.\d+)?)\s*[×x*]\s*10\s*\^?\s*([-+]?\d+)", s)
    if m:
        return float(m.group(1)) * 10 ** int(m.group(2))
    m = re.search(r"[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?", s.replace(",", "") if s.count(",") > 1 else s.replace(",", "."))
    try:
        return float(m.group(0)) if m else None
    except ValueError:
        return None


NUM_CELL = re.compile(r"[<>≤≥=~≈]?\s*[-+−–]?\d[\d.,]*\s*(?:[eE]\s*[-+−–]?\d+|[×x*]\s*10\s*\^?\s*[-+−–]?\d+)?\s*[*†‡a-zA-Z%]{0,3}")
RANGE_CELL = re.compile(r"[\d.,\s]+(?:[-–—~−]|\.\.|to)+[\d.,\s]+(?:[a-zA-Z]{0,3})")


def num(x):
    """Number from a cell that is essentially numeric (rejects names such as qFL-A13-1)."""
    s = clean(x)
    return to_float(s) if NUM_CELL.fullmatch(s) else None


def to_range(x):
    """'12.3-15.6' / '12.3–15.6' / '12.3 to 15.6' -> (12.3, 15.6)."""
    s = clean(x).replace("−", "-").replace("–", "-").replace("—", "-").replace("~", "-").replace(" to ", "-")
    nums = re.findall(r"(?<![\w.])\d+(?:\.\d+)?", s.replace(",", ""))
    if len(nums) >= 2:
        return float(nums[0]), float(nums[1])
    if len(nums) == 1:
        return float(nums[0]), float(nums[0])
    return None, None


# ----------------------------------------------------------------------------- readers
def read_docx_tables(path):
    try:
        with zipfile.ZipFile(path) as z:
            xml = z.read("word/document.xml").decode("utf8", "ignore")
    except Exception:  # noqa: BLE001
        return []
    out = []
    for n, tbl in enumerate(re.findall(r"<w:tbl>.*?</w:tbl>", xml, re.S), 1):
        rows = []
        for tr in re.findall(r"<w:tr[ >].*?</w:tr>", tbl, re.S):
            cells = []
            for tc in re.findall(r"<w:tc>.*?</w:tc>", tr, re.S):
                txt = "".join(re.findall(r"<w:t(?: [^>]*)?>([^<]*)</w:t>", tc))
                span = re.search(r'<w:gridSpan w:val="(\d+)"', tc)
                cells += [clean(txt)] * (int(span.group(1)) if span else 1)
            rows.append(cells)
        if len(rows) >= 2:
            out.append((f"table{n}", "", rows))
    # captions: paragraphs that start with "Table" / "Supplementary Table"
    caps = re.findall(r"((?:Supplementa\w* |Additional file \d+:? ?)?Table ?S?\d+[a-z]?[.:]? [^<]{10,300})",
                      re.sub(r"<[^>]+>", "", re.sub(r"</w:p>", "\n", xml)))
    return [(name, caps[i] if i < len(caps) else "", rows) for i, (name, _, rows) in enumerate(out)]


def read_tabular(path):
    """Return [(sheet_or_table_name, caption, rows)] for one file."""
    ext = path.rsplit(".", 1)[-1].lower()
    out = []
    try:
        if os.path.getsize(path) > MAX_FILE_BYTES:
            return [("__skipped__", "file too large", [])]
        if ext in ("xlsx", "xlsm"):
            import openpyxl
            wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
            for ws in wb.worksheets:
                rows = []
                for r in ws.iter_rows(values_only=True):
                    rows.append([clean(c) for c in r])
                    if len(rows) > MAX_ROWS:
                        break
                out.append((ws.title, "", rows))
        elif ext == "xls":
            import xlrd
            wb = xlrd.open_workbook(path, on_demand=True)
            for sh in wb.sheets():
                rows = [[clean(c) for c in sh.row_values(i)] for i in range(min(sh.nrows, MAX_ROWS))]
                out.append((sh.name, "", rows))
        elif ext in ("csv", "tsv", "txt"):
            with open(path, encoding="utf8", errors="ignore") as fh:
                head = fh.read(4000)
                fh.seek(0)
                delim = "\t" if head.count("\t") >= head.count(",") else ","
                rows = [[clean(c) for c in r] for i, r in enumerate(csv.reader(fh, delimiter=delim)) if i < MAX_ROWS]
            out.append((os.path.basename(path), "", rows))
        elif ext == "docx":
            out = read_docx_tables(path)
        elif ext in ("doc", "rtf"):
            with tempfile.TemporaryDirectory() as td:
                tmp = os.path.join(td, "c.docx")
                subprocess.run(["textutil", "-convert", "docx", "-output", tmp, path],
                               capture_output=True, timeout=120, check=False)
                if os.path.exists(tmp):
                    out = read_docx_tables(tmp)
    except Exception as e:  # noqa: BLE001
        return [("__error__", str(e)[:200], [])]
    return out


# ----------------------------------------------------------------------------- classification
def header_of(rows):
    """Pick the header row (most field-name matches in the first 15 rows) and map columns."""
    best, best_i = 0, None
    for i, r in enumerate(rows[:15]):
        cells = [c for c in r if c]
        if len(cells) < 3:
            continue
        nonnum = [c for c in cells if not NUM.fullmatch(c)]
        if len(nonnum) < 0.7 * len(cells):
            continue
        score = sum(1 for c in set(nonnum) if any(rx.search(c.lower()) for _, rx in FIELDS))
        if score > best:
            best, best_i = score, i
    if best_i is None or best < 2:
        return None, {}, 0
    hdr = list(rows[best_i])
    above = rows[best_i - 1] if best_i > 0 else []
    if len({c for c in above if c}) <= 1:
        above = []  # a title/caption line, not a header level
    below = rows[best_i + 1] if best_i + 1 < len(rows) else []
    filled_below = [c for c in below if c]
    # a second header line directly below (sub-columns such as "Left / Right" or "E1 / E2")
    two_line = len(filled_below) >= 2 and not any(NUM.fullmatch(c) for c in filled_below) and (
        any(not h and j < len(below) and below[j] for j, h in enumerate(hdr))
        or len(set(hdr)) < len([c for c in hdr if c]))
    probe = below if two_line else (rows[best_i + 1] if best_i + 1 < len(rows) else [])
    for j in range(1, len(hdr)):  # merged header cells: inherit the label from the left
        if not hdr[j] and j < len(probe) and probe[j]:
            hdr[j] = hdr[j - 1]
    colmap = {}
    for j, h in enumerate(hdr):
        text = " ".join(x for x in [above[j] if j < len(above) and above[j] != h else "", h,
                                    below[j] if two_line and j < len(below) and below[j] != h else ""] if x).lower()
        for f, rx in FIELDS:
            if f == "skip":
                # a count in brackets ("Hotspots (Number of QTL)") does not make the column a count, and a
                # "distance interval (bp)" is a physical interval
                t = re.sub(r"\((?:number|no\.?) of[^)]*\)", "", text)
                if not rx.search(t) or ("distance" in t and re.search(r"interval|position|region|range", t)):
                    continue
            if rx.search(text):
                colmap.setdefault(f, []).append(j)
                break
    colmap.pop("skip", None)
    return best_i + (2 if two_line else 1), colmap, best


NOT_QTL = re.compile(
    r"primer|sequence \(5|go (term|enrich)|kegg|fpkm|\btpm\b|expression (level|profile|pattern)|express(ed|ion) (in|of)|anova|"
    r"descriptive|correlation|heritab|skewness|mean square|statistics of|linkage map|genetic map|bin map|map length|"
    r"markers? (used|information|mapped|distribution|density)|number of markers|polymorphi|germplasm|accessions?\b|"
    r"cultivars?\b|varieties|rna-?seq|qrt|transcript|lncrna|non-coding|\beqtl|\btwas\b|sweep|selecti(on|ve)|\bibd\b|"
    r"segregation distortion|collinear|synten|snp array|snp loci in|marker genes|centromere|differential|haplotype (block|freq)|"
    r"structural varia|\bsvs?\b|introgress|ortholog|homolog|gene famil|genotyp(e|ing) (data|of|result)|phenotyp(e|ic) (data|value|perform)|"
    r"candidate genes?|genes? (located|within|in the|annotat|list|information|identified)|annotation of|blast|domain")
EPI = re.compile(r"epista|digenic|qtl ?[×x] ?qtl|interact(ion|ing) (qtl|loci|between)|additive ?[×x] ?additive|a ?× ?a|qq interaction")


def classify(caption, colmap, rows, start, paper):
    cap = (caption or "").lower()
    hdr_text = " ".join(" ".join(r) for r in rows[max(0, start - 2):start]).lower()
    ctx = cap + " " + hdr_text
    has = lambda *f: all(k in colmap for k in f)  # noqa: E731
    stat = has("lod") or has("p") or has("pve")
    pos = has("pos_cm") or has("phys") or has("phys_start") or has("ci")
    loc = has("chrom") or pos or has("marker")
    if not loc:
        return "other"
    # Gene lists, expression tables, map statistics etc. are not QTL result tables,
    # unless the caption itself announces QTL / association results with statistics.
    announces = re.search(r"\bm?qtls?\b (identified|detected|mapped|for|of|associated|information|summary|result)|"
                          r"(identified|detected|significant|stable|major|putative|summary of|list of|details of) (the )?"
                          r"(m?qtls?|snps?|loci|associations?|marker[- ]trait|mtas?|qtns?)\b|epista|meta[- ]?qtl", cap)
    if NOT_QTL.search(cap) and not (announces and stat):
        return "other"
    if has("gene") and not stat and not has("qtl_name"):
        return "other"
    if EPI.search(cap) or (EPI.search(hdr_text) and has("lod")):
        if len(colmap.get("chrom", [])) + len(colmap.get("marker", [])) + len(colmap.get("qtl_name", [])) + \
                len(colmap.get("pos_cm", [])) >= 2:
            return "epistatic QTL"
    if re.search(r"meta[- ]?qtl|\bmqtl|consensus qtl|meta[- ]analysis", ctx):
        return "meta-QTL"
    if re.search(r"qtl (cluster|hot ?spot)|pleiotrop|co-?locali[sz]|multi[- ]?trait|common qtl|cluster(s|ed)? of qtl|"
                 r"hot ?spots?|qtl[- ]rich", cap) and (has("qtl_name") or has("trait")):
        return "QTL cluster"
    gwas_words = re.search(r"gwas|genome[- ]wide association|association (analysis|mapping|signal|stud)|"
                           r"associated (with|snp|marker|loc)|significant(ly)? (snp|marker|association|loc)|"
                           r"marker[- ]trait|\bmtas?\b|lead snp|\bqtns?\b|peak snp", ctx)
    qtl_words = re.search(r"\bqtl|quantitative trait loc|interval mapping|\bcim\b|\bicim\b", ctx)
    if gwas_words and has("p") and not (has("lod") and qtl_words):
        return "GWAS"
    if qtl_words and (has("lod") or has("pve") or (has("qtl_name") and pos)):
        return "QTL"
    if has("lod") and (has("chrom") or pos):
        return "QTL"
    if has("p") and has("marker") and paper.get("is_gwas") == "1" and (has("trait") or has("pve")):
        return "GWAS"
    return "other"


# ----------------------------------------------------------------------------- record building
def trait_from_name(name):
    m = re.match(r"\s*(?:m?q|qtl)[-_. ]?([A-Za-z%]{1,12}?)(?=[-_. \d]|[A-D]\d|chr|Chr|$)", name)
    return m.group(1) if m else ""


def chrom_from_text(text):
    for tok in re.split(r"[-_./ ,;()]+", text)[1:]:
        c = H.std_chromosome(tok) or (H.std_chromosome("chr" + tok) if re.fullmatch(r"c?h?r?\d{1,2}", tok, re.I) else "")
        if c:
            return c
    return ""


def infer_species(text):
    t = text.lower()
    hb = re.search(r"hirsutum\s*[×x]\s*(g\.|gossypium)\s*barbadense|interspecific|barbadense\s*[×x]\s*(g\.|gossypium)\s*hirsutum", t)
    if hb:
        return "Gossypium hirsutum x barbadense", "AD"
    for pat, sp, grp in [(r"barbadense|sea[- ]island|pima|egyptian cotton|island cotton", "Gossypium barbadense", "AD"),
                         (r"arboreum|asiatic cotton|asian cotton|desi cotton", "Gossypium arboreum", "A"),
                         (r"herbaceum", "Gossypium herbaceum", "A"), (r"raimondii", "Gossypium raimondii", "D"),
                         (r"tomentosum", "Gossypium hirsutum x tomentosum", "AD"),
                         (r"mustelinum", "Gossypium hirsutum x mustelinum", "AD"),
                         (r"darwinii", "Gossypium hirsutum x darwinii", "AD")]:
        if re.search(pat, t) and not re.search(r"hirsutum|upland", t.split(".")[0]):
            return sp, grp
    return "Gossypium hirsutum", "AD"


REF_PATTERNS = [
    (r"\bhau[- _]?(v|version)? ?1|wang et al\.,? 2019|huazhong agricultural university.{0,40}genome", "G. hirsutum TM-1 HAU v1 (inferred)"),
    (r"\bzju[- _]?(improved|v ?2)|hu et al\.,? 2019|zju[- ]?v2\.1", "G. hirsutum TM-1 ZJU v2.1 (inferred)"),
    (r"nau[- ]?nbi|nbi[- ]?v1|zhang et al\.,? 2015|nau[- _]?v1", "G. hirsutum TM-1 NAU-NBI v1.1 (inferred)"),
    (r"utx[- _]?(jgi)?[- _]?v ?2|chen et al\.,? 2020", "G. hirsutum TM-1 UTX v2.1 (inferred)"),
    (r"cri[- _]?v ?1|yang et al\.,? 2019", "G. hirsutum TM-1 CRI v1 (inferred)"),
    (r"\bbgi[- _]?v ?1|li et al\.,? 2015", "G. hirsutum TM-1 BGI v1 (inferred)"),
    (r"whu[- _]?v ?1|huang et al\.,? 2020", "G. hirsutum TM-1 WHU v1 (inferred)"),
]


def infer_reference(fulltext):
    """Name the reference assembly only when the text points to exactly one."""
    t = fulltext.lower()
    hits = {name for pat, name in REF_PATTERNS if re.search(pat, t)}
    return hits.pop() if len(hits) == 1 else ""


def build_records(rows, start, colmap, cls, meta, table_id, caption):
    recs = []

    def cell(r, field, k=0):
        cols = colmap.get(field, [])
        return r[cols[k]] if k < len(cols) and cols[k] < len(r) else ""

    def cells(r, field):
        return [r[j] for j in colmap.get(field, []) if j < len(r) and r[j]]

    cap_trait = ""
    m = re.search(r"(?:for|of|associated with|controlling|underlying) ([a-z ,/-]{4,60}?)(?: traits?| in | across | detected| identified|\.|$)",
                  (caption or "").lower())
    if m:
        cap_trait = m.group(1).strip()
    sheet_trait = re.sub(r"^\d+[ ._-]*", "", table_id.rsplit("|", 1)[-1])
    if H.harmonise_trait(sheet_trait)[1] == "unclassified":
        sheet_trait = ""
    last = {"trait": "", "chrom": "", "env": ""}
    for i, r in enumerate(rows[start:start + MAX_ROWS]):
        if not any(r):
            continue
        filled = [c for c in r if c]
        if len(set(filled)) == 1 and len(r) > 2:  # section row spanning the table (often a trait or chromosome)
            sec = filled[0]
            if H.std_chromosome(sec):
                last["chrom"] = sec
            elif len(sec) < 60:
                last["trait"] = sec
            continue
        name = next((x for x in cells(r, "qtl_name") if not NUM_CELL.fullmatch(x)), "")
        if cell(r, "trait"):
            last["trait"] = cell(r, "trait")
        # trait candidates in order of specificity; take the first one the harmoniser recognises
        cands = [cell(r, "trait"), trait_from_name(name) if name else "", last["trait"], sheet_trait, cap_trait]
        cands = [c for c in cands if c]
        trait = next((c for c in cands if H.harmonise_trait(c)[1] != "unclassified"), cands[0] if cands else "")
        chrom_raw = cell(r, "chrom") or last["chrom"]
        markers = cells(r, "marker")
        chrom = H.std_chromosome(chrom_raw) or chrom_from_text("x-" + name) or \
            (chrom_from_text("x-" + markers[0]) if markers else "")
        lods = [v for v in (num(x) for x in cells(r, "lod")) if v is not None]
        pves = [v for v in (num(x) for x in cells(r, "pve")) if v is not None and 0 <= v <= 100]  # PVE is a percentage
        ps = [v for v in (num(x) for x in cells(r, "p")) if v is not None]
        rec = {
            "record_type": {"epistatic QTL": "epistatic QTL", "meta-QTL": "meta-QTL", "QTL cluster": "QTL cluster"}.get(cls, cls),
            "record_subtype": "", "source_db": "Literature", "source_dataset": meta["paper_id"],
            "source_record_id": f"{table_id}|row{start + i + 1}", "qtl_name": name, "trait_original": trait,
            "species": meta["species"], "genome_group": meta["genome_group"],
            "population": cell(r, "population"), "environment": cell(r, "env") or "",
            "chromosome": chrom, "linkage_group": chrom_raw, "lead_marker": markers[0] if markers else "",
            "flanking_markers": "; ".join(markers[1:3]), "candidate_genes": "; ".join(cells(r, "gene"))[:300],
            "lod": max(lods) if lods else None, "r2_pct": max(pves) if pves else None,
            "additive_effect": cell(r, "additive"), "pmid": meta["pmid"], "doi": meta["doi"], "year": meta["year"],
            "first_author": meta["first_author"], "citation": meta["citation"], "n_source_rows": 1,
            "stat_note": f"auto-extracted from {table_id}; verify against the paper",
        }
        # p-values: header says -log10 -> convert; otherwise take the smallest valid p
        if ps:
            hdr = " ".join(rows[start - 1][j].lower() for j in colmap.get("p", []) if j < len(rows[start - 1]))
            valid = [p for p in ps if 0 < p <= 1]
            if re.search(r"log", hdr):
                rec["neg_log10_p"] = max(ps)
            elif valid:
                rec["p_value"] = min(valid)
            elif all(1 < p < 400 for p in ps):  # column labelled "P" but holding -log10(P)
                rec["neg_log10_p"] = max(ps)
        # positions: the unit comes from the header of the column actually read, and every value is checked
        # against chromosome scale (a bp value under an "Mb" header is left as bp, not multiplied by 10^6)
        a = b = None
        hdr_row = rows[start - 1] if start > 0 else []
        def head(cols):
            return " ".join(hdr_row[j].lower() for j in cols if j < len(hdr_row))
        hdr = ""
        if "phys_start" in colmap or "phys_end" in colmap:
            a, b = num(cell(r, "phys_start")), num(cell(r, "phys_end"))
            a, b = (b, None) if a is None else (a, b)
            hdr = head(colmap.get("phys_start", [])[:1] + colmap.get("phys_end", [])[:1])
        if a is None and "phys" in colmap:
            for j in colmap["phys"]:
                c = r[j] if j < len(r) else ""
                if c and (NUM_CELL.fullmatch(c) or RANGE_CELL.fullmatch(c)):
                    a, b = to_range(c) if RANGE_CELL.fullmatch(c) else (num(c), None)
                    hdr = head([j])
                    # an interval header spanning two cells ("Physical interval (bp)" | "") holds start | end
                    nxt = r[j + 1] if j + 1 < len(r) else ""
                    same_label = j + 1 in colmap["phys"] or not (j + 1 < len(hdr_row) and hdr_row[j + 1])
                    if b is None and nxt and NUM_CELL.fullmatch(nxt) and same_label \
                            and j + 1 not in [k for f, cs in colmap.items() if f != "phys" for k in cs]:
                        b = num(nxt)
                    break
        if a is not None:
            b = a if b is None else b
            unit = 1e6 if re.search(r"\bmb\b", hdr) else (1e3 if re.search(r"\bkb\b", hdr) else None)

            def to_bp(v):
                if unit and v * unit <= MAX_BP:
                    return v * unit
                if 1e4 <= v <= MAX_BP:              # already in bp
                    return v
                if unit is None and v < 3000:        # unlabelled small numbers in a physical column: Mb
                    return v * 1e6
                return None
            a2, b2 = to_bp(a), to_bp(b)
            if a2 is not None and b2 is not None and a2 <= MAX_BP and b2 <= MAX_BP:
                rec["phys_start"], rec["phys_end"] = int(min(a2, b2)), int(max(a2, b2))
                rec["ref_genome"] = meta["ref_genome"]
        if "pos_cm" in colmap:
            vals = [num(x) if NUM_CELL.fullmatch(x) else (to_range(x)[0] if RANGE_CELL.fullmatch(x) else None)
                    for x in cells(r, "pos_cm")]
            vals = [v for v in vals if v is not None]
            if vals and max(vals) > 5000:                    # a "position" column holding bp, never cM
                if rec.get("phys_start") is None and max(vals) <= MAX_BP:
                    rec["phys_start"], rec["phys_end"] = int(min(vals)), int(max(vals))
                    rec["ref_genome"] = meta["ref_genome"]
            elif vals:
                rec["cm_peak"] = vals[0]
        if rec.get("phys_start") is None and markers:
            m = re.fullmatch(r"(?:G[hb]\w*?_)?([AD]t?_?(?:chr)?\d{1,2})[_:](\d{4,9})", markers[0], re.I)
            if m:  # e.g. Gbar_A02_98595082, D10_54999525
                rec["chromosome"] = rec["chromosome"] or H.std_chromosome(m.group(1))
                rec["phys_start"] = rec["phys_end"] = int(m.group(2))
                rec["ref_genome"] = meta["ref_genome"]
        if "ci" in colmap:
            lo, hi = to_range(" - ".join(cells(r, "ci")))
            if lo is not None and hi is not None and hi < 5000:
                rec["cm_start"], rec["cm_stop"] = min(lo, hi), max(lo, hi)
        if rec.get("phys_start") is None and rec.get("cm_peak") is not None:
            rec["map_name"] = meta["paper_id"] + " map"
        if cls == "epistatic QTL":
            second = [cell(r, f, 1) for f in ("qtl_name", "chrom", "marker", "pos_cm") if cell(r, f, 1)]
            rec["partner_locus"] = " | ".join(second)
        chrom = rec["chromosome"]
        has_loc = chrom or rec.get("cm_peak") is not None or rec.get("phys_start") is not None or markers
        has_id = bool(trait or name)
        has_stat = bool(lods or pves or ps)
        if has_loc and (has_id or has_stat) and (has_stat or name or cls in ("meta-QTL", "QTL cluster")):
            recs.append(rec)
    return recs


def biomercator_records(rows, meta, table_id):
    """Blocks of '<chr> <trait> mQTLs' / 'AIC Value' / 'Mean position k (C.I.)': keep the lowest-AIC model."""
    title = rows[0][0] if rows and rows[0] else ""
    recs, chrom, trait, best = [], "", "", None
    for i, r in enumerate(rows):
        head = r[0] if r else ""
        m = re.match(r"(c\d+|chr ?\d+|[AD]\d+)\s+(.+?)\s+mQTLs?$", head, re.I)
        if m:
            chrom, trait, best = m.group(1), m.group(2), None
        elif head.lower().startswith("aic"):
            vals = [(to_float(c), j) for j, c in enumerate(r[1:], 1) if to_float(c) is not None]
            best = min(vals)[1] if vals else None
        elif head.lower().startswith("mean position") and best is not None and best < len(r) and r[best]:
            m2 = re.match(r"\s*([-\d.]+)\s*\(\s*([-\d.]+)\s*-\s*([-\d.]+)\s*\)", r[best])
            if not m2:
                continue
            k = (re.findall(r"\d+", head) or ["0"])[0]
            recs.append({
                "record_type": "meta-QTL", "record_subtype": "", "source_db": "Literature",
                "source_dataset": meta["paper_id"], "source_record_id": f"{table_id}|row{i + 1}",
                "qtl_name": f"{chrom}-mQTL-{trait}-{int(k) + 1}", "trait_original": trait,
                "species": "Gossypium hirsutum x barbadense" if re.search(r"Gb|interspecific", title) else "Gossypium hirsutum",
                "genome_group": "AD", "population": title[:120], "chromosome": H.std_chromosome(chrom),
                "linkage_group": chrom, "map_name": meta["paper_id"] + " consensus map (" + title[-40:] + ")",
                "cm_peak": float(m2.group(1)), "cm_start": float(m2.group(2)), "cm_stop": float(m2.group(3)),
                "pmid": meta["pmid"], "doi": meta["doi"], "year": meta["year"], "first_author": meta["first_author"],
                "citation": meta["citation"], "n_source_rows": 1,
                "stat_note": f"BioMercator meta-analysis, lowest-AIC model; parsed from {table_id}",
            })
    return recs


DNA = re.compile(r"[ACGTRYKMSWN]{15,60}", re.I)
VALID_CTX = re.compile(r"kasp|caps\b|dcaps|diagnostic|functional marker|marker[- ]assisted|\bmas\b|validat|fine[- ]mapp|"
                       r"breeder|selection marker|gene[- ]specific|introgress", re.I)


def primer_records(rows, meta, table_id, caption):
    """Marker / primer-sequence tables: >= 2 columns that hold oligonucleotide sequences."""
    if len(rows) < 4:
        return []
    width = max(len(r) for r in rows)
    body = rows[1:]
    seq_cols = []
    for j in range(width):
        cells = [r[j].replace(" ", "").replace("-", "") for r in body if j < len(r) and r[j]]
        if len(cells) >= 3 and sum(bool(DNA.fullmatch(c)) for c in cells) >= 0.6 * len(cells):
            seq_cols.append(j)
    if len(seq_cols) < 2:
        return []
    # header = last row before the first row that carries sequences
    first = next(i for i, r in enumerate(rows) if seq_cols[0] < len(r) and DNA.fullmatch(r[seq_cols[0]].replace(" ", "").replace("-", "")))
    hdr = [h.lower() for h in rows[first - 1]] if first > 0 else []
    name_col = next((j for j in range(width) if j not in seq_cols and any(
        j < len(r) and r[j] and not NUM_CELL.fullmatch(r[j]) for r in rows[first:first + 5])), None)
    if name_col is None:
        return []
    chr_col = next((j for j, h in enumerate(hdr) if re.search(r"^chr|chromos|\blg\b|linkage", h)), None)
    pos_col = next((j for j, h in enumerate(hdr) if re.search(r"position|\bpos\b|\bbp\b|\bmb\b|location|start", h) and j not in seq_cols), None)
    ctx = caption + " " + " ".join(hdr)
    mtype = next((t for t in ["KASP", "dCAPS", "CAPS", "InDel", "SSR", "SNP", "SCAR", "STS", "qRT-PCR", "RT-PCR", "VIGS"]
                  if re.search(rf"\b{t}", ctx, re.I)), "")
    if mtype in ("qRT-PCR", "RT-PCR", "VIGS") or re.search(r"qrt|rt-?pcr|expression|vigs|clon(e|ing)|vector|crispr|sgrna", ctx, re.I):
        return []   # expression / cloning primers are not genotyping markers
    trait, cat = H.harmonise_trait(re.sub(r"table s?\d+\.?|primers?|markers?|sequences?|used|list of|information", " ", caption.lower()))
    out, last = [], ""
    for i, r in enumerate(rows[first:], first):
        seqs = [r[j].replace(" ", "").replace("-", "").upper() for j in seq_cols if j < len(r) and DNA.fullmatch(r[j].replace(" ", "").replace("-", ""))]
        if not seqs:
            continue
        name = (r[name_col] if name_col < len(r) else "") or last   # KASP rows often leave the name blank
        last = name
        out.append({"paper_id": meta["paper_id"], "pmid": meta["pmid"], "doi": meta["doi"], "year": meta["year"],
                    "first_author": meta["first_author"], "table_id": f"{table_id}|row{i + 1}", "marker": name[:80],
                    "marker_type": mtype, "primers": "|".join(seqs[:4]),
                    "chromosome": H.std_chromosome(r[chr_col]) if chr_col is not None and chr_col < len(r) else "",
                    "position": r[pos_col] if pos_col is not None and pos_col < len(r) else "",
                    "trait_harmonized": trait if cat != "unclassified" else "", "trait_category": cat if cat != "unclassified" else "",
                    "validation_context": int(bool(VALID_CTX.search(ctx))), "caption": caption[:200]})
    return out


def map_records(rows, start, colmap, meta, table_id, caption):
    """Linkage-map tables: one marker per row with linkage group and cM position, no QTL statistics."""
    if not ({"marker", "pos_cm"} <= set(colmap)) or {"lod", "pve", "p"} & set(colmap) or len(rows) - start < 80:
        return []
    mc, pc = colmap["marker"][0], colmap["pos_cm"][0]
    # a column headed cM / distance beats a generic "position" column, which often holds bp
    head_cells = [str(c).lower() for c in rows[start - 1]]
    cm_cols = [j for j, h in enumerate(head_cells) if re.search(r"\bcm\b|\(cm\)|distance|genetic pos", h) and j != mc]
    if cm_cols:
        pc = cm_cols[0]
    cc = colmap["chrom"][0] if "chrom" in colmap else None
    hdr = " ".join(rows[start - 1]).lower()
    if not re.search(r"\bcm\b|genetic|linkage|map", hdr + " " + caption.lower()):
        return []
    out, lg, names = [], "", set()
    for r in rows[start:start + 60000]:
        if len([c for c in r if c]) == 1 and len(r) > 2:   # a section row naming the linkage group
            lg = next(c for c in r if c)
            continue
        if mc >= len(r) or pc >= len(r) or not r[mc]:
            continue
        pos = num(r[pc])
        if pos is None or pos > 5000:
            continue
        group = (r[cc] if cc is not None and cc < len(r) and r[cc] else lg)
        if not group or re.search(r"scaffold|contig|^nan$", group, re.I):   # unanchored sequence, not a linkage group
            continue
        out.append({"paper_id": meta["paper_id"], "pmid": meta["pmid"], "doi": meta["doi"], "table_id": table_id,
                    "marker": r[mc][:80], "linkage_group": group[:40], "chromosome": H.std_chromosome(group),
                    "position_cm": pos})
        names.add(r[mc])
    # a genuine map lists mostly distinct markers spread over several groups
    if len(out) < 80 or len(names) < 0.7 * len(out) or len({o["linkage_group"] for o in out}) < 2:
        return []
    return out


def epistatic_records(rows, start, meta, table_id, caption):
    """Two-locus tables: split the header into a locus-1 and a locus-2 block around the two chromosome columns."""
    hdr = [h.lower() for h in rows[start - 1]]
    if start >= 2 and len({c for c in rows[start - 2] if c}) > 1:
        hdr = [(a + " " + b).strip().lower() for a, b in zip(rows[start - 2] + [""] * len(hdr), rows[start - 1])]
    chr_cols = [j for j, h in enumerate(hdr) if re.search(r"^ch[ij]\b|^chr|chromos|chrosome", h)]
    if len(chr_cols) < 2:
        return None
    c1, c2 = chr_cols[0], chr_cols[1]
    strip = lambda h: re.sub(r"[\d()ij_. -]+", "", h)  # noqa: E731
    b = 1 if c1 >= 1 and strip(hdr[c1 - 1]) and strip(hdr[c1 - 1]) == strip(hdr[c2 - 1]) and \
        not re.search(r"trait|env|famil|gen", hdr[c1 - 1]) else 0
    blocks = [list(range(c1 - b, c2 - b)), list(range(c2 - b, min(len(hdr), c2 - b + (c2 - c1))))]
    stat_cols = {f: next((j for j, h in enumerate(hdr) if j >= blocks[1][-1] + 1 and re.search(rx, h)), None)
                 for f, rx in [("lod", r"\blod"), ("p", r"p[- ]?val|log"), ("pve", r"pve|h2|v\(aa\)|r2"), ("aa", r"^aa\b|a ?[×x] ?a|add by add|beta|effect")]}
    trait_col = next((j for j, h in enumerate(hdr[:c1]) if re.search(r"trait", h)), None)
    env_col = next((j for j, h in enumerate(hdr[:c1]) if re.search(r"env|gen", h)), None)
    recs, last_trait = [], ""
    sheet_trait = re.sub(r"^\d+[ ._-]*", "", table_id.rsplit("|", 1)[-1])
    m = re.search(r"(?:for|of|underlying) (?:the )?([a-z ,/-]{4,60}?)(?: traits?| in | detected| identified| of |\.|$)", caption.lower())
    cap_trait = m.group(1) if m else ""

    def locus(r, cols, chr_col):
        chrom = r[chr_col] if chr_col < len(r) else ""
        pos, marks = None, []
        for j in cols:
            if j == chr_col or j >= len(r) or not r[j]:
                continue
            if re.search(r"pos|genomic|\bbp\b|\bcm\b|site", hdr[j]) and num(r[j]) is not None:
                pos = num(r[j])
            elif not NUM_CELL.fullmatch(r[j]):
                marks.append(r[j])
        return chrom, pos, "; ".join(marks)[:120]

    for i, r in enumerate(rows[start:], start):
        if not any(r):
            continue
        if len({c for c in r if c}) == 1:
            continue
        if trait_col is not None and trait_col < len(r) and r[trait_col]:
            last_trait = r[trait_col]
        ch1, p1, m1 = locus(r, blocks[0], c1)
        ch2, p2, m2 = locus(r, blocks[1], c2)
        if not (H.std_chromosome(ch1) or m1) or not (H.std_chromosome(ch2) or m2):
            continue
        cands = [c for c in [last_trait, sheet_trait, cap_trait] if c]
        trait = next((c for c in cands if H.harmonise_trait(c)[1] != "unclassified"), cands[0] if cands else "")
        g = lambda k: (r[stat_cols[k]] if stat_cols[k] is not None and stat_cols[k] < len(r) else "")  # noqa: E731
        rec = {"record_type": "epistatic QTL", "record_subtype": "", "source_db": "Literature", "source_dataset": meta["paper_id"],
               "source_record_id": f"{table_id}|row{i + 1}", "qtl_name": "", "trait_original": trait,
               "species": meta["species"], "genome_group": meta["genome_group"],
               "environment": r[env_col] if env_col is not None and env_col < len(r) else "",
               "chromosome": H.std_chromosome(ch1), "linkage_group": ch1, "lead_marker": m1,
               "partner_chromosome": H.std_chromosome(ch2), "partner_marker": m2,
               "partner_locus": " ".join(x for x in [ch2, "" if p2 is None else f"@{p2:g}", m2] if x),
               "lod": num(g("lod")), "r2_pct": num(g("pve")), "additive_effect": g("aa"),
               "pmid": meta["pmid"], "doi": meta["doi"], "year": meta["year"], "first_author": meta["first_author"],
               "citation": meta["citation"], "n_source_rows": 1,
               "stat_note": f"auto-extracted two-locus table {table_id}; additive_effect holds the interaction (AA) effect"}
        pv = num(g("p"))
        if pv is not None:
            if stat_cols["p"] is not None and "log" in hdr[stat_cols["p"]]:
                rec["neg_log10_p"] = pv
            elif 0 < pv <= 1:
                rec["p_value"] = pv
        for pos, key_bp, key_cm in [(p1, "phys_start", "cm_peak"), (p2, "partner_pos_bp", "partner_cm")]:
            if pos is None:
                continue
            if pos > 5000:
                rec[key_bp] = int(pos)
            else:
                rec[key_cm] = pos
        if rec.get("phys_start") is not None:
            rec["phys_end"] = rec["phys_start"]
            rec["ref_genome"] = meta["ref_genome"]
        recs.append(rec)
    return recs


# ----------------------------------------------------------------------------- per paper
def paper_tables(paper_dir, kind):
    """Yield (table_id, source_file, label, caption, rows) for one paper directory."""
    pid = os.path.basename(paper_dir)
    if kind == "pmc":
        tj = f"{paper_dir}/tables/tables.json"
        if os.path.exists(tj):
            for t in json.load(open(tj)):
                with open(f"{paper_dir}/tables/{t['file']}", newline="") as fh:
                    rows = [[clean(c) for c in r] for r in csv.reader(fh, delimiter="\t")]
                yield f"{pid}|{t['label'] or t['file']}", f"tables/{t['file']}", t["label"], t["caption"], rows
        files = sorted(glob.glob(f"{paper_dir}/supplementary/**/*", recursive=True))
    else:
        files = sorted(glob.glob(f"{paper_dir}/*"))
    for f in files:
        if os.path.isdir(f):
            continue
        ext = f.rsplit(".", 1)[-1].lower()
        rel = os.path.relpath(f, paper_dir)
        if ext == "zip":
            try:
                with zipfile.ZipFile(f) as z, tempfile.TemporaryDirectory() as td:
                    for m in z.infolist():
                        if m.is_dir() or m.file_size > MAX_FILE_BYTES or \
                                not re.search(r"\.(xlsx?|csv|tsv|txt|docx)$", m.filename, re.I):
                            continue
                        tmp = os.path.join(td, "f." + m.filename.rsplit(".", 1)[-1])
                        with z.open(m) as src, open(tmp, "wb") as dst:
                            dst.write(src.read())
                        for name, cap, rows in read_tabular(tmp):
                            yield f"{pid}|{rel}:{m.filename}|{name}", f"{rel}:{m.filename}", name, cap, rows
            except Exception:  # noqa: BLE001
                yield f"{pid}|{rel}|__error__", rel, "__error__", "unreadable zip", []
            continue
        if ext not in ("xlsx", "xlsm", "xls", "csv", "tsv", "txt", "docx", "doc", "rtf"):
            yield f"{pid}|{rel}|__unparsed__", rel, "__unparsed__", f"{ext} not parsed", []
            continue
        for name, cap, rows in read_tabular(f):
            yield f"{pid}|{rel}|{name}", rel, name, cap, rows


def drop_non_significant(recs, table_id):
    """GWAS rows with P > 0.05 are not associations. A table where most rows are like that is a full marker scan
    (e.g. every SNP tested, PMC6091029 Table S4); from it keep only P < 0.001, the conventional suggestive level
    (this reproduces the 15 SNPs that paper reports from its permutation threshold)."""
    def nlp(rec):
        if rec.get("neg_log10_p") is not None:
            return rec["neg_log10_p"]
        p = rec.get("p_value")
        return -math.log10(p) if p else None
    gw = [r for r in recs if r["record_type"] == "GWAS" and nlp(r) is not None]
    if not gw:
        return recs
    full_scan = len(gw) >= 100 and sum(nlp(r) < -math.log10(0.05) for r in gw) > 0.5 * len(gw)
    cut = 3.0 if full_scan else -math.log10(0.05)
    out = []
    for r in recs:
        v = nlp(r) if r["record_type"] == "GWAS" else None
        if v is not None and v < cut:
            continue
        if full_scan and r["record_type"] == "GWAS":
            r["stat_note"] += "; table lists every marker tested, kept P < 0.001"
        out.append(r)
    return out


def process(args):
    paper_dir, kind, meta = args
    catalog, records, primers, maps = [], [], [], []
    try:
        if kind == "pmc" and os.path.exists(f"{paper_dir}/fulltext.xml"):
            with open(f"{paper_dir}/fulltext.xml", encoding="utf8", errors="ignore") as fh:
                meta["ref_genome"] = infer_reference(re.sub(r"<[^>]+>", " ", fh.read()))
        for table_id, src, label, caption, rows in paper_tables(paper_dir, kind):
            rows = [r for r in rows if any(r)]
            entry = {"paper_id": meta["paper_id"], "pmid": meta["pmid"], "table_id": table_id, "source_file": src,
                     "label": label, "caption": (caption or "")[:400], "n_rows": len(rows), "class": "", "n_records": 0,
                     "mapped_fields": ""}
            if label in ("__unparsed__", "__error__", "__skipped__") or len(rows) < 2:
                entry["class"] = {"__unparsed__": "not parsed", "__error__": "read error",
                                  "__skipped__": "skipped (size)"}.get(label, "empty")
                catalog.append(entry)
                continue
            if any(r and r[0].lower().startswith("aic value") for r in rows[:40]):
                recs = biomercator_records(rows, meta, table_id)
                entry.update({"class": "meta-QTL", "n_records": len(recs), "mapped_fields": "biomercator model table",
                              "caption": (rows[0][0] if rows[0] else "")[:400]})
                records += recs
                catalog.append(entry)
                continue
            # first sheet line often holds the supplementary-table title
            cap = caption or (rows[0][0] if rows and len([c for c in rows[0] if c]) == 1 and len(rows[0][0]) > 15 else "")
            if not caption and not cap:
                cap = label
            pr = primer_records(rows, meta, table_id, cap + " " + label)
            if pr:
                primers += pr
                entry.update({"class": "marker primers", "caption": cap[:400], "n_records": len(pr)})
                catalog.append(entry)
                continue
            start, colmap, _ = header_of(rows)
            cls = classify(cap + " " + label, colmap, rows, start, meta) if start else "other"
            if cls == "other" and start:
                mp = map_records(rows, start, colmap, meta, table_id, cap + " " + label)
                if mp:
                    maps += mp
                    entry.update({"class": "linkage map", "caption": cap[:400], "n_records": len(mp),
                                  "mapped_fields": ",".join(sorted(colmap))})
                    catalog.append(entry)
                    continue
            if cls == "epistatic QTL":
                ep = epistatic_records(rows, start, meta, table_id, cap)
                if ep is None:
                    cls = "QTL"      # one locus per row: main-effect QTL from an epistasis model
                else:
                    records += ep
                    entry.update({"class": cls, "caption": cap[:400], "n_records": len(ep), "mapped_fields": "two-locus"})
                    catalog.append(entry)
                    continue
            if cls in ("QTL", "QTL cluster") and "gene" in colmap and "p" not in colmap and len(rows) - start > 50:
                # one row per gene (dense, mostly unique gene IDs) = candidate-gene list, not QTL results
                genes = [r[colmap["gene"][0]] for r in rows[start:] if colmap["gene"][0] < len(r) and r[colmap["gene"][0]]]
                if len(genes) > 0.8 * (len(rows) - start) and len(set(genes)) > 0.8 * len(genes):
                    cls = "other"
            if re.search(r"\d+ ?genes|genes? in \d", (cap + " " + label).lower()):
                cls = "other"
            entry.update({"class": cls, "caption": cap[:400], "mapped_fields": ",".join(sorted(colmap))})
            if cls != "other":
                recs = build_records(rows, start, colmap, cls, meta, table_id, cap)
                recs = drop_non_significant(recs, table_id)
                entry["n_records"] = len(recs)
                records += recs
            catalog.append(entry)
    except Exception as e:  # noqa: BLE001
        catalog.append({"paper_id": meta["paper_id"], "pmid": meta["pmid"], "table_id": meta["paper_id"] + "|__failed__",
                        "source_file": "", "label": "", "caption": str(e)[:300], "n_rows": 0, "class": "paper failed",
                        "n_records": 0, "mapped_fields": ""})
    return catalog, records, primers, maps


def main(proj):
    lit = f"{proj}/data/literature"
    out = f"{lit}/extracted"
    os.makedirs(out, exist_ok=True)
    with open(f"{lit}/literature_index.tsv") as fh:
        index = list(csv.DictReader(fh, delimiter="\t"))
    jobs = []
    for r in index:
        sp, grp = infer_species(r["title"] + ". " + r["abstract"])
        meta = {"paper_id": r["pmcid"] or ("doi:" + r["doi"]), "pmid": r["pmid"], "doi": r["doi"], "year": r["year"],
                "first_author": r["authors"].split(",")[0].split(" ")[0] if r["authors"] else "",
                "citation": f"{r['authors'][:120]}. {r['title']} {r['journal']}. {r['year']}",
                "species": sp, "genome_group": grp, "ref_genome": "",
                "is_gwas": r["is_gwas"], "is_qtl_linkage": r["is_qtl_linkage"]}
        if r["pmcid"] and os.path.isdir(f"{lit}/papers/{r['pmcid']}"):
            jobs.append((f"{lit}/papers/{r['pmcid']}", "pmc", meta))
        esm = f"{lit}/springer_esm/{r['doi'].lower().replace('/', '_')}"
        if r["doi"] and os.path.isdir(esm):
            jobs.append((esm, "esm", dict(meta)))
    print(len(jobs), "paper folders", flush=True)
    cat_cols = ["paper_id", "pmid", "table_id", "source_file", "label", "caption", "n_rows", "class", "n_records", "mapped_fields"]
    rec_cols = ["record_type", "record_subtype", "source_db", "source_dataset", "source_record_id", "qtl_name",
                "trait_original", "trait_harmonized", "trait_category", "species", "genome_group", "population",
                "environment", "chromosome", "ref_genome", "phys_start", "phys_end", "map_name", "linkage_group",
                "cm_start", "cm_stop", "cm_peak", "lead_marker", "flanking_markers", "candidate_genes", "p_value",
                "neg_log10_p", "lod", "r2_pct", "additive_effect", "stat_note", "partner_locus", "partner_chromosome", "partner_pos_bp",
                "partner_cm", "partner_marker", "pmid", "doi", "year",
                "first_author", "citation", "n_source_rows"]
    n_rec = n_pr = n_map = 0
    pr_cols = ["paper_id", "pmid", "doi", "year", "first_author", "table_id", "marker", "marker_type", "primers",
               "chromosome", "position", "trait_harmonized", "trait_category", "validation_context", "caption"]
    map_cols = ["paper_id", "pmid", "doi", "table_id", "marker", "linkage_group", "chromosome", "position_cm"]
    with open(f"{out}/literature_table_catalog.tsv", "w", newline="") as cf, \
            open(f"{out}/literature_records.tsv", "w", newline="") as rf, \
            open(f"{out}/literature_primers.tsv", "w", newline="") as pf, \
            open(f"{out}/literature_maps.tsv", "w", newline="") as mf, ProcessPoolExecutor(6) as ex:
        cw = csv.DictWriter(cf, cat_cols, delimiter="\t")
        rw = csv.DictWriter(rf, rec_cols, delimiter="\t", extrasaction="ignore")
        pw = csv.DictWriter(pf, pr_cols, delimiter="\t")
        mw = csv.DictWriter(mf, map_cols, delimiter="\t")
        for w in (cw, rw, pw, mw):
            w.writeheader()
        for i, (catalog, records, primers, maps) in enumerate(ex.map(process, jobs, chunksize=4)):
            pw.writerows(primers)
            mw.writerows(maps)
            n_pr += len(primers)
            n_map += len(maps)
            cw.writerows(catalog)
            for rec in records:
                rec["trait_harmonized"], rec["trait_category"] = H.harmonise_trait(rec["trait_original"])
                rw.writerow(rec)
            n_rec += len(records)
            if i % 100 == 0:
                print(i, n_rec, flush=True)
    print("records", n_rec, "| primer rows", n_pr, "| map loci", n_map, flush=True)


if __name__ == "__main__":
    main(sys.argv[1])
