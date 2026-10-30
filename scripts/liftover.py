#!/usr/bin/env python3
"""Coordinate conversion between allotetraploid cotton genome assemblies.

Published QTL / GWAS positions sit on whichever assembly the authors used (BGI v1, NAU-NBI v1.1, CRI v1,
HAU v1.1, ZJU v2.1, UTX v2.1, G. barbadense HAU v2 / HGS v1.1 / ZJU H7124 ...). This builds anchor maps
between every available assembly and a hub (G. hirsutum TM-1 UTX v2.1, the display axis of the site) and
converts every physical record onto every assembly: source -> hub -> target.

Method
  * The hub's 26 chromosomes are cut into 5-kb windows every 50 kb (windows with > 10 % N skipped).
  * Windows are mapped to each other assembly with minimap2 (-x asm5 within G. hirsutum TM-1,
    -x asm10 for other accessions / G. barbadense), keeping primary hits with MAPQ >= 30 that cover
    >= 70 % of the window. The window midpoint is placed by linear interpolation inside the hit.
  * Anchors that disagree with their neighbours (a different target chromosome, or an offset more than
    1.5 Mb from the local median) are dropped: these are repeats or paralogous hits, not synteny.
  * A position is converted by linear interpolation between the two flanking anchors when both sit on the
    same target chromosome and keep their order; otherwise it is placed from the nearest anchor (flagged).
    Positions beyond the outermost anchors are extrapolated at slope 1 (flagged). The reverse direction
    (assembly -> hub) uses the same anchors sorted by target position.
  * Records whose source assembly is not available (or not stated) keep the previous approximation:
    relative position scaled to the hub chromosome length, flagged "approximate".

Writes
  data/liftover/<key>.anchors.tsv           hub_chr hub_pos tgt_chr tgt_pos strand
  data/liftover/chromosome_lengths.tsv      assembly chromosome sequence length_bp
  data/processed/assemblies.tsv             what is available and how many records each assembly sources
  analysis/tables/coordinates_lifted.tsv    every physical record on every assembly (+ method flags)

Usage: python3 scripts/liftover.py          (needs minimap2, samtools; genomes in data/genomes/)
"""
import bisect
import csv
import gzip
import os
import re
import subprocess
import sys
import zipfile
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harmonize import CHR_NUM_TO_SUB  # classical c1-c26 numbering: c14 = D02, c15 = D01, ...

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEN = f"{ROOT}/data/genomes"
LO = f"{ROOT}/data/liftover"
THREADS = "8"
HUB = "Gh_UTX_v2.1"
WIN, STEP = 5_000, 50_000
CHRS = [f"{g}{i:02d}" for g in "AD" for i in range(1, 14)]

# key: (label, file in data/genomes, minimap2 preset for hub -> this, source)
ASSEMBLIES = {
    "Gh_UTX_v2.1": ("G. hirsutum TM-1 UTX v2.1 (Chen et al. 2020)", "GCF_007990345.1.zip", None, "NCBI GCF_007990345.1"),
    "Gh_UTX_v3.0": ("G. hirsutum TM-1 UTX v3.0 (HudsonAlpha)", "GCA_007990345.2.zip", "asm5", "NCBI GCA_007990345.2"),
    "Gh_T2T_ZJU": ("G. hirsutum TM-1 T2T (ZJU)", "GCA_046843835.1.zip", "asm5", "NCBI GCA_046843835.1"),
    "Gh_ZJU_v2.1": ("G. hirsutum TM-1 ZJU v2.1 (Hu et al. 2019)", "ZJU_TM-1_V2.1.fa.gz", "asm5", "cotton.zju.edu.cn TM-1_V2.1.fa.gz"),
    "Gh_HAU_v1.1": ("G. hirsutum TM-1 HAU v1.1 (Wang et al. 2019)", "HAU_TM-1_v1.1.fa.gz", "asm5", "CottonGen (manual download)"),
    "Gh_NAU_v1.1": ("G. hirsutum TM-1 NAU-NBI v1.1 (Zhang et al. 2015)", "coge_28813_NAU-NBI_v1.1.fa", "asm5", "CoGe genome 28813"),
    "Gh_CRI_v1": ("G. hirsutum TM-1 CRI v1 (Yang et al. 2019)", "GCA_006980745.1.zip", "asm5", "NCBI GCA_006980745.1"),
    "Gh_BGI_v1": ("G. hirsutum TM-1 BGI v1 (Li et al. 2015)", "GCF_000987745.1.zip", "asm5", "NCBI GCF_000987745.1"),
    "Gh_WHU_v1": ("G. hirsutum TM-1 WHU v1 (Huang et al. 2020)", "WHU_TM-1_v1.fa.gz", "asm5", "CottonMD/CottonGen (manual download)"),
    "Gb_HAU_v2": ("G. barbadense 3-79 HAU v2 (Wang et al. 2019)", "HAU_Gb3-79_v2.fa.gz", "asm10", "CottonGen (manual download)"),
    "Gb_HGS_v1.1": ("G. barbadense 3-79 HGS v1.1 (Chen et al. 2020)", "GCA_008761655.1.zip", "asm10", "NCBI GCA_008761655.1"),
    "Gb_ZJU_v1.1": ("G. barbadense Hai7124 ZJU v1.1 (Hu et al. 2019)", "ZJU_Hai7124_V1.1.fa.gz", "asm10", "cotton.zju.edu.cn Hai7124_V1.1.fa.gz"),
}

# ref_genome text in records_deduplicated.tsv -> assembly key (first match wins)
SOURCE_OF = [
    (r"UTX_v2\.1|UTX v2\.1", "Gh_UTX_v2.1"),
    (r"ZJU-improved_v2\.1|TM-1 ZJU v2\.1", "Gh_ZJU_v2.1"),
    (r"'TM-1' genome NAU-NBI|TM-1 NAU-NBI", "Gh_NAU_v1.1"),
    (r"'TM-1' genome HAU_v1|TM-1 HAU v1", "Gh_HAU_v1.1"),
    (r"'TM-1' genome CRI_v1|TM-1 CRI v1", "Gh_CRI_v1"),
    (r"CGP-BGI_v1|BGI v1", "Gh_BGI_v1"),
    (r"WHU v1", "Gh_WHU_v1"),
    (r"'3-79' genome HAU_v2", "Gb_HAU_v2"),
    (r"'3-79' genome HGS_v1\.1", "Gb_HGS_v1.1"),
    (r"'H7124' genome ZJU_v1\.1", "Gb_ZJU_v1.1"),
]


def sh(cmd):
    subprocess.run(cmd, shell=True, check=True)


# Assemblies whose downloadable sequence does not carry the coordinates authors published on it.
# Their records keep the relative-position approximation instead of being lifted through a mismatched file.
EXCLUDED = {
    "Gh_BGI_v1": "NCBI GCF_000987745.1 chromosomes do not match published BGI v1 coordinates "
                 "(numbering differs from A01-D13 and, on 9 of 26 chromosomes, published positions run past "
                 "the sequence length)",
}


def source_key(ref):
    return next((k for pat, k in SOURCE_OF if re.search(pat, ref or "")), None)


def chrom_label(header):
    """A01-D13 from a FASTA header, or None (scaffolds, organelles)."""
    h = header.replace("lcl|", "")
    if re.search(r"scaffold|contig|unplaced|unlocalized|chloroplast|mitochondri", h, re.I):
        return None
    m = re.search(r"chromosome[ :_]*([AD])[t]?[ _]?0?(\d{1,2})\b", h, re.I)
    if not m:
        m = re.search(r"(?:^|[_|\s])(?:Gh|Ghir|Gb|Gbar|AD1|AD2|NBI|HAU|ZJU|Chr)?_?([AD])t?[_]?0?(\d{1,2})(?:\s|$|,)", h.split()[0] + " ", re.I)
    if m and 1 <= int(m.group(2)) <= 13:
        return f"{m.group(1).upper()}{int(m.group(2)):02d}"
    m = re.search(r"chromosome[ :_]*(\d{1,2})\b", h, re.I) or re.match(r"(?:Chr)?0?(\d{1,2})\b", h.split()[0], re.I)
    if m and 1 <= int(m.group(1)) <= 26:                  # numbered c1-c26 (provisional; checked by alignment)
        return CHR_NUM_TO_SUB[int(m.group(1))]
    return None


def chrom_fasta(key):
    """The 26 chromosomes of an assembly as FASTA named A01..D13 (+ .fai). Returns path or None."""
    out = f"{LO}/{key}.chrom.fa"
    if os.path.exists(out + ".fai"):
        return out
    src = f"{GEN}/{ASSEMBLIES[key][1]}"
    if not os.path.exists(src):
        return None
    print(f"  extracting chromosomes of {key} ...", flush=True)
    if src.endswith(".zip"):
        z = zipfile.ZipFile(src)
        fn = [n for n in z.namelist() if re.search(r"\.(fna|fa|fasta)$", n)][0]
        fh = (l.decode() for l in z.open(fn))
    elif src.endswith(".gz"):
        fh = gzip.open(src, "rt")
    else:
        fh = open(src)
    seen, keep, names = set(), False, []
    with open(out + ".tmp", "w") as o:
        for line in fh:
            if line.startswith(">"):
                lab = chrom_label(line[1:].strip())
                keep = lab is not None and lab not in seen
                if keep:
                    seen.add(lab)
                    names.append((lab, line[1:].split()[0]))
                    o.write(f">{lab}\n")
            elif keep:
                o.write(line)
    os.replace(out + ".tmp", out)
    with open(f"{LO}/{key}.names.tsv", "w") as f:
        f.writelines(f"{a}\t{b}\n" for a, b in names)
    if len(seen) != 26:
        print(f"  WARNING {key}: found {len(seen)} chromosomes {sorted(seen)}", flush=True)
    sh(f"samtools faidx {out}")
    return out


def lengths(fa):
    return {l.split("\t")[0]: int(l.split("\t")[1]) for l in open(fa + ".fai")}


def hub_windows(hub_fa):
    out = f"{LO}/hub_windows.fa"
    if os.path.exists(out):
        return out
    seqs, cur, buf = {}, None, []
    for line in open(hub_fa):
        if line.startswith(">"):
            if cur:
                seqs[cur] = "".join(buf)
            cur, buf = line[1:].strip(), []
        else:
            buf.append(line.strip())
    if cur:
        seqs[cur] = "".join(buf)
    n = 0
    with open(out, "w") as o:
        for c in CHRS:
            s = seqs.get(c, "")
            for start in range(0, len(s) - WIN, STEP):
                w = s[start:start + WIN]
                if w.upper().count("N") > WIN * 0.1:
                    continue
                o.write(f">{c}|{start + WIN // 2}\n{w}\n")
                n += 1
    print(f"  {n:,} hub windows", flush=True)
    return out


def build_anchors(key, tgt_fa, preset, win_fa):
    out = f"{LO}/{key}.anchors.tsv"
    if os.path.exists(out):
        return out
    paf = f"{LO}/{key}.windows.paf"
    if not os.path.exists(paf):
        print(f"  mapping hub windows -> {key} ({preset}) ...", flush=True)
        sh(f"minimap2 -t {THREADS} -x {preset} --secondary=no {tgt_fa} {win_fa} > {paf}.tmp 2> {paf}.log && mv {paf}.tmp {paf}")
    raw = []
    for l in open(paf):
        f = l.split("\t")
        if "tp:A:P" not in l or int(f[11]) < 30:
            continue
        qlen, qs, qe = int(f[1]), int(f[2]), int(f[3])
        if qe - qs < 0.7 * qlen:
            continue
        hc, hp = f[0].split("|")
        hp = int(hp)
        mid = qlen // 2
        ts, te = int(f[7]), int(f[8])
        frac = min(1, max(0, (mid - qs) / max(1, qe - qs)))
        tp = ts + frac * (te - ts) if f[4] == "+" else te - frac * (te - ts)
        raw.append((hc, hp, f[5], int(tp), f[4]))
    raw.sort(key=lambda r: (CHRS.index(r[0]), r[1]))
    # Which hub chromosome does each target chromosome align to? Header names (especially numbered ones)
    # are only trusted when the sequence agrees.
    votes = defaultdict(Counter)
    for r in raw:
        votes[r[2]][r[0]] += 1
    ident = {t: v.most_common(1)[0][0] for t, v in votes.items()}
    wrong = {t: h for t, h in ident.items() if t != h}
    if wrong:
        print(f"  NOTE {key}: chromosome names differ from the alignment: {wrong}", flush=True)
    with open(f"{LO}/{key}.identity.tsv", "w") as o:
        o.write("name_in_file\taligns_to\tshare\n")
        for t, v in sorted(votes.items()):
            o.write(f"{t}\t{ident[t]}\t{v[ident[t]] / sum(v.values()):.3f}\n")
    if len(set(ident.values())) == len(ident):          # a clean one-to-one renaming
        raw = [(a, b, ident[c], d, e) for a, b, c, d, e in raw]
    kept = clean_anchors(raw)
    with open(out, "w") as o:
        o.write("hub_chr\thub_pos\ttgt_chr\ttgt_pos\tstrand\n")
        o.writelines("\t".join(map(str, r)) + "\n" for r in kept)
    print(f"  {key}: {len(kept):,} anchors kept of {len(raw):,} hits", flush=True)
    return out


def clean_anchors(raw, k=10, max_dev=1_500_000):
    """Keep anchors whose target chromosome and offset agree with most of their +-k neighbours."""
    by = defaultdict(list)
    for r in raw:
        by[r[0]].append(r)
    kept = []
    for hc, rs in by.items():
        for i, r in enumerate(rs):
            nb = rs[max(0, i - k):i] + rs[i + 1:i + 1 + k]
            same = [x for x in nb if x[2] == r[2]]
            if len(same) < max(3, len(nb) // 2):
                continue
            off = sorted(x[3] - x[1] if x[4] == "+" else x[3] + x[1] for x in same if x[4] == r[4])
            if len(off) < 3:
                continue
            med = off[len(off) // 2]
            mine = r[3] - r[1] if r[4] == "+" else r[3] + r[1]
            if abs(mine - med) <= max_dev:
                kept.append(r)
    kept.sort(key=lambda r: (CHRS.index(r[0]), r[1]))
    return kept


class AnchorMap:
    """Piecewise-linear conversion along anchors, in either direction."""

    def __init__(self, path, reverse=False):
        rows = []
        for r in csv.DictReader(open(path), delimiter="\t"):
            a = (r["hub_chr"], int(r["hub_pos"]), r["tgt_chr"], int(r["tgt_pos"]), r["strand"])
            rows.append((a[2], a[3], a[0], a[1], a[4]) if reverse else a)
        self.by = defaultdict(list)
        for r in rows:
            self.by[r[0]].append(r)
        for c in self.by:
            self.by[c].sort(key=lambda r: r[1])
        self.pos = {c: [r[1] for r in v] for c, v in self.by.items()}

    def point(self, chrom, x):
        """(chrom, pos, flag) or None."""
        a = self.by.get(chrom)
        if not a:
            return None
        i = bisect.bisect_right(self.pos[chrom], x)
        if 0 < i < len(a):
            p, q = a[i - 1], a[i]
            if p[2] == q[2] and q[1] > p[1]:
                gap_s, gap_t = q[1] - p[1], abs(q[3] - p[3])
                if gap_t <= 3 * gap_s + 200_000:
                    return (p[2], round(p[3] + (x - p[1]) * (q[3] - p[3]) / gap_s), "interpolated")
            n = p if x - p[1] <= q[1] - x else q
            return (n[2], round(n[3] + (x - n[1]) * (1 if n[4] == "+" else -1)), "nearest anchor (rearranged region)")
        n = a[0] if i == 0 else a[-1]
        return (n[2], round(n[3] + (x - n[1]) * (1 if n[4] == "+" else -1)), "extrapolated beyond outermost anchor")


def main():
    os.makedirs(LO, exist_ok=True)
    have = {}
    for key, (_, fn, preset, _) in ASSEMBLIES.items():
        if key in EXCLUDED:
            print(f"  {key}: excluded - {EXCLUDED[key]}")
            continue
        fa = chrom_fasta(key)
        if fa:
            have[key] = fa
        else:
            print(f"  {key}: genome not available ({fn})")
    if HUB not in have:
        sys.exit("hub assembly missing")
    win = hub_windows(have[HUB])
    fwd, rev = {}, {}
    for key, fa in have.items():
        if key == HUB:
            continue
        path = build_anchors(key, fa, ASSEMBLIES[key][2], win)
        fwd[key], rev[key] = AnchorMap(path), AnchorMap(path, reverse=True)

    def identity(key):
        p = f"{LO}/{key}.identity.tsv"
        if not os.path.exists(p):
            return {}
        rows = list(csv.DictReader(open(p), delimiter="\t"))
        m = {r["name_in_file"]: r["aligns_to"] for r in rows}
        return m if len(set(m.values())) == len(m) else {}

    with open(f"{LO}/chromosome_lengths.tsv", "w") as o:
        o.write("assembly\tchromosome\tname_in_file\tlength_bp\n")
        for key, fa in have.items():
            ren = identity(key)
            for c, n in lengths(fa).items():
                o.write(f"{key}\t{ren.get(c, c)}\t{c}\t{n}\n")
    hub_len = lengths(have[HUB])
    # a record's chromosome is named as its source assembly names it; translate through the identity table
    rename = {k: identity(k) for k in have}
    tgt_len = {k: {rename.get(k, {}).get(c, c): n for c, n in lengths(fa).items()} for k, fa in have.items()}

    # ---- records
    import pandas as pd
    d = pd.read_csv(f"{ROOT}/data/processed/records_deduplicated.tsv", sep="\t", dtype=str, low_memory=False)
    for c in ("phys_start", "phys_end"):
        d[c] = pd.to_numeric(d[c], errors="coerce")
    d = d[d["phys_start"].notna() & d["chromosome"].isin(CHRS) & (d["genome_group"] == "AD")].copy()
    d["phys_end"] = d["phys_end"].fillna(d["phys_start"])
    d["src"] = d["ref_genome"].map(source_key)

    # relative-position fallback: same rule the hotspot analysis used, per (assembly text, chromosome)
    grp = d.groupby(["ref_genome", "chromosome"])["phys_end"]
    gmax, gn = grp.transform("max"), grp.transform("size")
    utx = d["chromosome"].map(hub_len)
    scaled = (gn >= 30) & (gmax / utx).between(0.6, 1.25)
    d["scale"] = (utx / gmax).where(scaled, 1.0)

    keys = list(have)
    out_rows, stats = [], Counter()
    for r in d.itertuples(index=False):
        src, chrom = (r.src if isinstance(r.src, str) else None), r.chromosome
        s, e = int(min(r.phys_start, r.phys_end)), int(max(r.phys_start, r.phys_end))
        row = {"record_id": r.record_id, "ref_genome": r.ref_genome, "source_assembly": src or "",
               "chromosome": chrom, "start": s, "end": e}
        # 1. onto the hub (a published position past the end of its own chromosome is a source error: not converted)
        src_len = tgt_len.get(src, {}).get(rename.get(src, {}).get(chrom, chrom)) if src in have else None
        beyond = src_len is not None and e > src_len
        if beyond:
            hub = None
        elif src == HUB:
            hub = (chrom, s, chrom, e, "same assembly")
        elif src in rev:
            sc = rename.get(src, {}).get(chrom, chrom)
            a, b = rev[src].point(sc, s), rev[src].point(sc, e)
            if a and b and a[0] == b[0]:
                lo, hi = sorted((a[1], b[1]))
                flag = "lifted" + ("" if a[2] == b[2] == "interpolated" else f" ({a[2] if a[2] != 'interpolated' else b[2]})")
                hub = (a[0], lo, a[0], hi, flag)
            else:
                hub = None
        else:
            hub = None
        if hub is None:
            k = float(r.scale)
            why = ("assembly sequence does not match published coordinates" if src in EXCLUDED
                   else "assembly not available" if src else "assembly not stated")
            if src in rev:
                why = "liftover failed (ends on different chromosomes)"
            if beyond:
                why = "position beyond the chromosome end of its assembly"
            hub = (chrom, round(s * k), chrom, round(e * k),
                   f"approximate: {'relative position' if k != 1 else 'as reported'} ({why})")
        stats[hub[4].split(" (")[0] if not hub[4].startswith("approximate") else hub[4]] += 1
        hc, hs, _, he, hflag = hub
        hs, he = max(0, min(hs, hub_len[hc])), max(0, min(he, hub_len[hc]))
        row.update(hub_method=hflag)
        # 2. hub -> every assembly (the source assembly keeps its published coordinates)
        for key in keys:
            if key == src and not beyond:
                row.update({f"{key}_chr": rename.get(src, {}).get(chrom, chrom), f"{key}_start": s, f"{key}_end": e})
            elif key == HUB:
                row.update({f"{key}_chr": hc, f"{key}_start": hs, f"{key}_end": he})
            else:
                a, b = fwd[key].point(hc, hs), fwd[key].point(hc, he)
                if a and b and a[0] == b[0]:
                    ln = tgt_len[key].get(a[0], 10**10)   # extrapolation past the last anchor stops at the chromosome end
                    lo, hi = sorted((min(max(0, a[1]), ln), min(max(0, b[1]), ln)))
                    row.update({f"{key}_chr": a[0], f"{key}_start": lo, f"{key}_end": hi})
                else:
                    row.update({f"{key}_chr": "", f"{key}_start": "", f"{key}_end": ""})
        out_rows.append(row)

    os.makedirs(f"{ROOT}/analysis/tables", exist_ok=True)
    cols = ["record_id", "ref_genome", "source_assembly", "chromosome", "start", "end", "hub_method"] + \
           [f"{k}_{x}" for k in keys for x in ("chr", "start", "end")]
    with open(f"{ROOT}/analysis/tables/coordinates_lifted.tsv", "w", newline="") as fh:
        w = csv.DictWriter(fh, cols, delimiter="\t")
        w.writeheader()
        w.writerows(out_rows)

    n_src = Counter(r["source_assembly"] for r in out_rows)
    with open(f"{ROOT}/data/processed/assemblies.tsv", "w") as o:
        o.write("assembly\tlabel\tsource\tavailable\tanchors\trecords_published_on_it\tnote\n")
        for key, (lab, fn, _, srcdesc) in ASSEMBLIES.items():
            na = sum(len(v) for v in fwd[key].by.values()) if key in fwd else (0 if key != HUB else "hub")
            o.write(f"{key}\t{lab}\t{srcdesc}\t{'yes' if key in have else 'no'}\t{na}\t{n_src.get(key, 0)}\t{EXCLUDED.get(key, '')}\n")
    print(f"{len(out_rows):,} physical records")
    for k, v in stats.most_common():
        print(f"  {v:>7,}  {k}")


if __name__ == "__main__":
    main()
