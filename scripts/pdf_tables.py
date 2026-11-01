"""Read tables from journal PDFs (main text and supplements) with PyMuPDF.

Tables are located from their captions ("Table 2", "TABLE 2", "Supplementary Table S3"), searched in the caption's
column, and read either from ruling lines or, for tables without vertical rules, by rebuilding rows from word heights
and columns from vertical whitespace. Cell text is rebuilt from character positions so that raised decimal points and
missing word spaces come out right (2.87, not "287 ."). Returns [(name, caption, rows)] like the other readers.
"""
import re, signal
import pymupdf

pymupdf.TOOLS.mupdf_display_errors(False)
CAPRX = re.compile(r"^(supplementa\w*|additional)?(table)s?(\d+)[a-z]?([.:|]|$|[a-z])", re.I)

def page_chars(page):
    out = []
    for b in page.get_text("rawdict")["blocks"]:
        for l in b.get("lines", []):
            if abs(l["dir"][1]) > 0.5:       # rotated text is handled by the page-rotation pass
                continue
            for s in l["spans"]:
                for c in s["chars"]:
                    x0, y0, x1, y1 = c["bbox"]
                    out.append(((x0 + x1) / 2, (y0 + y1) / 2, x0, x1, s["size"], c["c"]))
    return out

def cell_text(chars, bbox):
    x0, y0, x1, y1 = bbox
    cs = [c for c in chars if x0 - 0.5 <= c[0] <= x1 + 0.5 and y0 - 0.5 <= c[1] <= y1 + 0.5]
    if not cs:
        return ""
    cs.sort(key=lambda c: c[1])
    lines, cur = [], [cs[0]]
    for c in cs[1:]:
        if abs(c[1] - cur[-1][1]) > 0.55 * max(c[4], cur[-1][4]):
            lines.append(cur); cur = [c]
        else:
            cur.append(c)
    lines.append(cur)
    merged = []
    for ln in lines:
        if merged and all(ch[5] in ".,·-−–" for ch in ln):
            merged[-1] += ln
        else:
            merged.append(ln)
    words = []
    for ln in merged:
        ln.sort(key=lambda c: c[2])
        s = ln[0][5]
        for a, b in zip(ln, ln[1:]):
            if b[2] - a[3] > 0.22 * b[4] and b[5] != " " and a[5] != " ":
                s += " "
            s += b[5]
        words.append(s)
    return re.sub(r"\s+", " ", " ".join(words)).strip()

def captions(page):
    """[(y_top, y_bottom, caption text)] for lines that start a table caption."""
    lines = []
    for b in page.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            t = "".join(s["text"] for s in l["spans"]).strip()
            if t:
                lines.append((l["bbox"][1], l["bbox"][3], t, l["bbox"][0], l["bbox"][2]))
    lines.sort()
    out = []
    for i, (y0, y1, t, x0, x1) in enumerate(lines):
        squeezed = re.sub(r"\s+", "", t)
        m = CAPRX.match(squeezed)
        if not m or re.match(r"(?i)^tables?\s*\d+\s*(and|shows?|lists?|in|were|was|is|are|summari)", t):
            continue
        cap, yb = t, y1
        if len(t) < 14 and i + 1 < len(lines):   # "TABLE 2" alone: title is on the next line
            cap, yb = t + " " + lines[i + 1][2], lines[i + 1][1]
        out.append((y0, yb, re.sub(r"T\s?A\s?B\s?L\s?E", "Table", cap), x0, x1))
    return out

def text_table(page, clip):
    """Rebuild a table without ruling lines: rows from word heights, columns from vertical gaps in the body rows."""
    ws = [w for w in page.get_text("words", clip=clip) if w[4].strip()]
    if len(ws) < 9:
        return []
    ws.sort(key=lambda w: ((w[1] + w[3]) / 2, w[0]))
    rows, cur = [], [ws[0]]
    for w in ws[1:]:
        h = max(w[3] - w[1], 4)
        if abs((w[1] + w[3]) / 2 - (cur[-1][1] + cur[-1][3]) / 2) > 0.5 * h:
            rows.append(cur); cur = [w]
        else:
            cur.append(w)
    rows.append(cur)
    # stop at the first large vertical gap (end of table, start of footnotes or text)
    ys = [sum((w[1] + w[3]) / 2 for w in r) / len(r) for r in rows]
    gaps = sorted(b - a for a, b in zip(ys, ys[1:]))
    if gaps:
        med = gaps[len(gaps) // 2]
        for i in range(1, len(ys)):
            if i >= 3 and ys[i] - ys[i - 1] > 2.6 * med:
                rows = rows[:i]
                break
    # cut at the first footnote line
    for i, r in enumerate(rows):
        first = " ".join(w[4] for w in sorted(r, key=lambda w: w[0]))
        if i >= 2 and re.match(r"(?i)^(notes?|abbreviations?|source|significan\w*|values|data are|[*†‡§¶])\b|^[*†‡§¶]", first):
            rows = rows[:i]
            break
    # drop trailing prose/footnote rows (one long run of words spanning the width)
    while rows and len(rows[-1]) > 8 and max(w[2] for w in rows[-1]) - min(w[0] for w in rows[-1]) > 0.8 * clip.width and \
            all(b[0] - a[2] < 6 for a, b in zip(sorted(rows[-1]), sorted(rows[-1])[1:])):
        rows.pop()
    if len(rows) < 3:
        return []
    body = rows[min(2, len(rows) - 3):]
    x0 = int(min(w[0] for r in rows for w in r)); x1 = int(max(w[2] for r in rows for w in r)) + 1
    cover = [0] * (x1 - x0 + 2)
    for r in body:
        for w in r:
            for x in range(int(w[0]) - x0, int(w[2]) - x0 + 1):
                cover[x] += 1
    need = max(1, int(0.08 * len(body)))   # a gap may be crossed by a few wrapped or spanning cells
    cuts, run = [], None
    for x, c in enumerate(cover):
        if c < need:
            run = x if run is None else run
        else:
            if run is not None and x - run >= 4:
                cuts.append(x0 + (run + x) / 2)
            run = None
    if len(cuts) < 2:
        return []
    out = []
    for r in rows:
        cells = [[] for _ in range(len(cuts) + 1)]
        for w in sorted(r, key=lambda w: w[0]):
            k = sum(((w[0] + w[2]) / 2) > c for c in cuts)
            cells[k].append(w[4])
        out.append([" ".join(c) for c in cells])
    return out


def good(rows):
    cells = [c for r in rows for c in r if c]
    if len(rows) < 3 or not cells:
        return False
    return len(cells) / sum(len(r) for r in rows) > 0.35 and max(len(r) for r in rows) >= 3

def extract(page, t, chars):
    rows = [[cell_text(chars, c) if c else "" for c in r.cells] for r in t.rows]
    return [r for r in rows if any(r)]

HDR_FOOT = re.compile(r"^(LOD|LR|LRT|R2(?: ?\(%\))?|R²(?: ?\(%\))?|PVE(?: ?\(%\))?|Add|Dom|Var(?: ?\(%\))?|QTL|Marker|Position(?: ?\(cM\))?|"
                      r"Chr|Chromosome|Interval|Effect|Trait|Env\.?|SNP|P|MAF)([a-h]|\*+|†|‡)$", re.I)


def clean_header(rows):
    """Footnote letters glued to header cells in PDFs ("LODa", "R2 (%)b") hide the column name."""
    for r in rows[:3]:
        for i, c in enumerate(r):
            m = HDR_FOOT.match(c.strip())
            if m:
                r[i] = m.group(1)
    return rows


class _Timeout(Exception):
    pass


def pdf_tables(path, max_pages=80, seconds=180):
    """All captioned tables in a PDF; gives up on a file after `seconds`."""
    def _alarm(*_):
        raise _Timeout()
    old = signal.signal(signal.SIGALRM, _alarm)
    signal.alarm(seconds)
    try:
        return [(n, c, clean_header(r)) for n, c, r in _pdf_tables(path, max_pages)]
    except _Timeout:
        return [("__error__", "PDF timed out", [])]
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, old)


def _pdf_tables(path, max_pages):
    out, doc = [], pymupdf.open(path)
    for pno, page in enumerate(doc, 1):
        if pno > max_pages:
            break
        caps = captions(page)
        chars = None
        if caps:
            H = page.rect.height
            W, mid = page.rect.width, page.rect.width / 2
            def col(c):   # 0 = left column, 1 = right column, 2 = full width
                return 0 if c[4] < mid + 15 else 1 if c[3] > mid - 15 else 2
            for k, (y0, y1, cap, cx0, cx1) in enumerate(caps):
                ck = col(caps[k])
                # a caption in one column whose text block is wide (table spans page) behaves as full width
                lower = [c[0] for c in caps if c[0] > y0 + 1 and (col(c) == ck or col(c) == 2 or ck == 2)]
                bottom = min(lower) - 2 if lower else H - 30
                xa, xb = (page.rect.x0 + 20, mid + 5) if ck == 0 else (mid - 5, page.rect.x1 - 20) if ck == 1 else (page.rect.x0 + 20, page.rect.x1 - 20)
                clip = pymupdf.Rect(xa, y1 + 1, xb, bottom)
                # a column caption may still head a full-width table: widen unless the other column holds prose
                if ck != 2:
                    oc = pymupdf.Rect(mid + 5, y1 + 1, page.rect.x1 - 20, min(bottom, y1 + 120)) if ck == 0 else \
                        pymupdf.Rect(page.rect.x0 + 20, y1 + 1, mid - 5, min(bottom, y1 + 120))
                    ow = page.get_text("words", clip=oc)
                    if ow:
                        lines_ = {}
                        for w in ow:
                            lines_.setdefault(round((w[1] + w[3]) / 4), []).append(w)
                        widths = [max(w[2] for w in v) - min(w[0] for w in v) for v in lines_.values()]
                        prose = sum(wd > 0.75 * oc.width for wd in widths) > 0.5 * len(widths)
                        if not prose:
                            clip = pymupdf.Rect(page.rect.x0 + 20, y1 + 1, page.rect.x1 - 20, bottom)
                if clip.height < 20:
                    continue
                best = None
                try:
                    found = page.find_tables(clip=clip, strategy="lines").tables
                except Exception:
                    found = []
                if found and chars is None:
                    chars = page_chars(page)
                for t in found:
                    rows = extract(page, t, chars)
                    if good(rows) and (best is None or len(rows) * len(rows[0]) > len(best) * len(best[0])):
                        best = rows
                if not best or len(best) < 4:
                    tt = text_table(page, clip)
                    if good(tt) and (best is None or len(tt) > len(best)):
                        best = tt
                if best and not any(o[2] == best for o in out[-4:]):
                    out.append((f"p{pno}t{k + 1}", cap[:300], best))
        else:   # page without a caption: ruled table continuing from the previous page
            found = page.find_tables().tables
            for t in found:
                if chars is None:
                    chars = page_chars(page)
                rows = extract(page, t, chars)
                if good(rows) and out and len(rows[0]) == len(out[-1][2][0]):
                    out[-1][2].extend(rows)
    return out


def pdf_tables_isolated(path, seconds=240):
    """Run pdf_tables in a child process: a PDF that crashes MuPDF costs only that file."""
    import json, subprocess, sys
    code = ("import json, sys; sys.path.insert(0, %r); import pdf_tables as P; "
            "print(json.dumps(P.pdf_tables(sys.argv[1])))") % __import__("os").path.dirname(__import__("os").path.abspath(__file__))
    try:
        res = subprocess.run([sys.executable, "-c", code, path], capture_output=True, text=True, timeout=seconds)
    except subprocess.TimeoutExpired:
        return [("__error__", "PDF timed out", [])]
    if res.returncode != 0 or not res.stdout.strip():
        return [("__error__", f"PDF reader failed (exit {res.returncode})", [])]
    try:
        return [tuple(x) for x in json.loads(res.stdout.strip().splitlines()[-1])]
    except Exception:  # noqa: BLE001
        return [("__error__", "PDF reader output unreadable", [])]


if __name__ == "__main__":
    import json, sys
    print(json.dumps(pdf_tables(sys.argv[1])))
