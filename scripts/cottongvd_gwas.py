#!/usr/bin/env python3
"""Download CottonGVD GWAS summaries: trait lists per population and the best -log10(P)
per 500-kb bin for every trait (one request per trait; the SNP-level search API only
serves 10 rows per page over 5.6 M rows, so it is not bulk-harvested).

Usage: cottongvd_gwas.py OUT_DIR
"""
import csv
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

API = "https://db.cngb.org/cottonGVD/api/v1"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
POPULATIONS = ["cottonA2.215", "cottonAD1.419", "cottonAD1.1245", "cottonAD1.383", "cottonAD2.365"]


def get_json(url, tries=3):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read())
        except Exception as e:  # noqa: BLE001
            print("  retry", k, url[-70:], e, flush=True)
            time.sleep(4 * (k + 1))
    return None


def main(out):
    sp = get_json(f"{API}/species/")
    with open(f"{out}/cottongvd_species.json", "w") as fh:
        json.dump(sp, fh, indent=1)
    with open(f"{out}/cottongvd_gwas_traits.tsv", "w", newline="") as tf:
        tw = csv.writer(tf, delimiter="\t")
        tw.writerow(["population", "trait", "trait_group"])
        for pop in POPULATIONS:
            traits = [x["trait"] for x in (get_json(f"{API}/gwas/traits/{pop}") or {}).get("data", [])]
            cat = (get_json(f"{API}/gwasviz/retrive_trait_category/species/{pop}/public") or {}).get("data", [])
            group = {c["value"]: g["title"] for g in cat for c in g.get("children", [])}
            names = sorted(set(traits) | set(group))
            print(pop, len(names), "traits", flush=True)
            for t in names:
                tw.writerow([pop, t, group.get(t, "")])
            tf.flush()
            os.makedirs(f"{out}/gwas_500kb_bins/{pop}", exist_ok=True)
            def one(t, pop=pop):
                fn = f"{out}/gwas_500kb_bins/{pop}/{re.sub(r'[^A-Za-z0-9_.-]', '_', t)}.tsv"
                if os.path.exists(fn):
                    return
                d = get_json(f"{API}/gwasviz/retrive_echart/species/{pop}/trait/{urllib.parse.quote(t)}")
                rows = (d or {}).get("data") or []
                if not rows:
                    print("  no data", pop, t, flush=True)
                    return
                with open(fn + ".part", "w", newline="") as fh:
                    w = csv.writer(fh, delimiter="\t")
                    w.writerow(["bin", "best_neg_log10_p", "chr", "trait"])
                    w.writerows(rows)
                os.replace(fn + ".part", fn)

            with ThreadPoolExecutor(3) as ex:
                list(ex.map(one, names))
            print("  done", pop, len(os.listdir(f"{out}/gwas_500kb_bins/{pop}")), "files", flush=True)


if __name__ == "__main__":
    main(sys.argv[1])
