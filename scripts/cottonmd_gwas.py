#!/usr/bin/env python3
"""Download CottonMD GWAS results (all traits): 500-kb lead-SNP bins and suggestive SNPs (p<1e-5).

Usage: cottonmd_gwas.py OUT_DIR
"""
import csv
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

BASE = "https://yanglab.hzau.edu.cn"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
CHRS = [f"{g}{i:02d}" for g in "AD" for i in range(1, 14)]


def fetch(url, data=None, tries=4):
    body = urllib.parse.urlencode(data).encode() if data else None
    for k in range(tries):
        try:
            req = urllib.request.Request(url, data=body, headers={
                "User-Agent": UA, "X-Requested-With": "XMLHttpRequest",
                "Referer": BASE + "/CottonMD/GWAS.1"})
            with urllib.request.urlopen(req, timeout=180) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            print("  retry", k, e, flush=True)
            time.sleep(5 * (k + 1))
    return None


def main(out):
    page = fetch(BASE + "/CottonMD/GWAS.1").decode("utf8", "ignore")
    with open(f"{out}/GWAS_page.html", "w") as fh:
        fh.write(page)
    i = page.find('<select id="trait"')
    block = page[i:page.find("</select>", i)]
    traits = []
    for grp, body in re.findall(r'<optgroup[^>]*label="([^"]*)"[^>]*>(.*?)</optgroup>', block, re.S):
        for val, name in re.findall(r'<option[^>]*value="([^"]*)"[^>]*>([^<]*)', body):
            traits.append((html.unescape(grp), html.unescape(val), html.unescape(name).strip()))
    thr = dict(re.findall(r'"([^"]+)":\s*1\s*/\s*(\d+)', page))
    with open(f"{out}/cottonmd_gwas_traits.tsv", "w", newline="") as fh:
        w = csv.writer(fh, delimiter="\t")
        w.writerow(["panel_study", "table_id", "trait", "n_snps_for_threshold"])
        for g, v, n in traits:
            w.writerow([g, v, n, thr.get(v, "")])
    print(len(traits), "traits", flush=True)
    for g, v, n in traits:
        safe = re.sub(r"[^A-Za-z0-9_.-]", "_", v)
        f1 = f"{out}/gwas_manhattan_bins/{safe}.tsv"
        if not os.path.exists(f1):
            raw = fetch(BASE + "/cott/Multiomics/navigational_manhattan.1", {"table": v})
            try:
                rows = json.loads(raw)
                with open(f1, "w", newline="") as fh:
                    csv.writer(fh, delimiter="\t").writerows(rows)
            except Exception as e:  # noqa: BLE001
                print("  manhattan failed", v, e, flush=True)
        f2 = f"{out}/gwas_significant_snps/{safe}.tsv"
        if os.path.exists(f2):
            continue
        # The scatter endpoint returns HTTP 500 when a chromosome has no SNP with p < 1e-5,
        # so only query chromosomes whose best 500-kb bin passes that cutoff.
        best = {}
        with open(f1) as fh:
            for r in csv.DictReader(fh, delimiter="\t"):
                best[r["chr"]] = min(best.get(r["chr"], 1.0), float(r["pvalue"]))
        allrows, ok = [], True
        for c in sorted(best):
            if best[c] >= 1e-5:
                continue
            raw = fetch(BASE + "/cott/Multiomics/dtailed_scatter.1",
                        {"chr": c, "start": 0, "end": 400000000, "table": v})
            try:
                rows = json.loads(raw)
                allrows += [[c] + r for r in rows[1:]]
            except Exception as e:  # noqa: BLE001
                ok = False
                print("  scatter failed", v, c, e, str(raw)[:80], flush=True)
            time.sleep(0.4)
        if ok:
            with open(f2, "w", newline="") as fh:
                w = csv.writer(fh, delimiter="\t")
                w.writerow(["chr", "pos", "ref", "alt", "p_value"])
                w.writerows(allrows)
        print(v, n, len(allrows), "SNPs", "OK" if ok else "INCOMPLETE", flush=True)


if __name__ == "__main__":
    main(sys.argv[1])
