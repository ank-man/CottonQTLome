#!/usr/bin/env python3
"""Export assembly anchors and per-assembly coordinates for the website (run after liftover.py and
export_site_data.py).

  website/public/data/assemblies/index.json       available assemblies, chromosome lengths, record counts
  website/public/data/assemblies/<key>.json       hub -> assembly anchors (delta / run-length encoded)
  website/public/data/downloads/qtl_gwas_all_assemblies.csv.gz
                                                  every QTL and GWAS locus of the site on every assembly
Usage: python3 scripts/export_assemblies.py
"""
import csv
import gzip
import json
import os
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LO = f"{ROOT}/data/liftover"
OUT = f"{ROOT}/website/public/data/assemblies"
DL = f"{ROOT}/website/public/data/downloads"
HUB = "Gh_UTX_v2.1"
CHRS = [f"{g}{i:02d}" for g in "AD" for i in range(1, 14)]


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(DL, exist_ok=True)
    asm = list(csv.DictReader(open(f"{ROOT}/data/processed/assemblies.tsv"), delimiter="\t"))
    lens = defaultdict(dict)
    for r in csv.DictReader(open(f"{LO}/chromosome_lengths.tsv"), delimiter="\t"):
        if r["chromosome"] in CHRS:
            lens[r["assembly"]][r["chromosome"]] = int(r["length_bp"])

    index = []
    for a in asm:
        key = a["assembly"]
        if a["available"] != "yes" or len(lens[key]) != 26:
            continue
        species = "Gossypium barbadense" if key.startswith("Gb_") else "Gossypium hirsutum"
        entry = {"key": key, "label": a["label"], "species": species, "source": a["source"],
                 "lengths": {c: lens[key][c] for c in CHRS}, "n_records": int(a["records_published_on_it"]),
                 "anchors": 0 if key == HUB else int(a["anchors"])}
        if key != HUB:
            by = defaultdict(list)
            for r in csv.DictReader(open(f"{LO}/{key}.anchors.tsv"), delimiter="\t"):
                by[r["hub_chr"]].append((int(r["hub_pos"]), r["tgt_chr"], int(r["tgt_pos"]), r["strand"]))
            enc = {}
            for hc in CHRS:
                rows = sorted(by.get(hc, []))
                h, t, c, s = [], [], [], []
                ph = pt = 0
                for hp, tc, tp, st in rows:
                    h.append(hp - ph)
                    t.append(tp - pt)
                    ph, pt = hp, tp
                    if c and c[-1][0] == tc:
                        c[-1][1] += 1
                    else:
                        c.append([tc, 1])
                    s.append(st)
                enc[hc] = {"h": h, "t": t, "c": c, "s": "".join(s)}
            with open(f"{OUT}/{key}.json", "w") as fh:
                json.dump({"key": key, "anchors": enc}, fh, separators=(",", ":"))
        index.append(entry)
    index.sort(key=lambda e: (e["key"] != HUB, e["species"] != "Gossypium hirsutum", e["label"]))
    with open(f"{OUT}/index.json", "w") as fh:
        json.dump(index, fh, indent=1)

    # ---- per-assembly coordinates of the site's QTL and GWAS loci
    keys = [e["key"] for e in index]
    lifted = {}
    with open(f"{ROOT}/analysis/tables/coordinates_lifted.tsv") as fh:
        for r in csv.DictReader(fh, delimiter="\t"):
            lifted[r["record_id"]] = r
    site = f"{ROOT}/website/public/data"
    cols = ["id", "type", "name", "trait_category", "trait", "published_chromosome", "published_position",
            "published_assembly", "placement"] + [f"{k}_{x}" for k in keys for x in ("chr", "start", "end")]
    n = defaultdict(int)
    with gzip.open(f"{DL}/qtl_gwas_all_assemblies.csv.gz", "wt", newline="") as fh:
        w = csv.DictWriter(fh, cols, extrasaction="ignore")
        w.writeheader()
        for fn, typ in (("qtl.csv", "QTL"), ("gwas.csv", "GWAS")):
            for r in csv.DictReader(open(f"{site}/{fn}")):
                lt = lifted.get(r.get("lead_record") or r["id"])
                if not lt:
                    continue
                row = {"id": r["id"], "type": typ, "name": r["qtl_name"], "trait_category": r["trait"],
                       "trait": r["parameter"], "published_chromosome": r["chromosome"],
                       "published_position": r["position_interval"], "published_assembly": r["ref_genome"],
                       "placement": lt["hub_method"]}
                row.update({k: lt.get(k, "") for k in cols[9:]})
                w.writerow(row)
                n[typ] += 1
    print(f"{len(index)} assemblies; coordinates for {dict(n)}")
    print(f"anchor files: {sum(os.path.getsize(f'{OUT}/{e}') for e in os.listdir(OUT)) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
