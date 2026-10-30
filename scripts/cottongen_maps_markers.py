#!/usr/bin/env python3
"""Download CottonGen genetic maps and markers through Tripal MegaSearch.

  maps/cottongen_maps.tsv                 one row per map (type, population, parents, #LG, #loci, citation)
  maps/marker_positions/<map>.tsv         marker loci of each map (linkage group, cM position)
  markers/trait_markers_<category>.tsv    markers CottonGen links to a trait (type, primers, location, pubs)

Usage: cottongen_maps_markers.py RAW_COTTONGEN_DIR [maps] [positions] [trait_markers]
"""
import html
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cottongen_megasearch import BASE, build_id, default_fields, fetch  # noqa: E402


def open_form(datatype):
    page = fetch(f"{BASE}/tripal_megasearch?datatype={datatype}").decode("utf8", "ignore")
    fb = build_id(page[page.find('id="tripal-megasearch-form"'):])
    resp = json.loads(fetch(BASE + "/chado_search_ajax_callback", {
        "datatype": datatype, "form_build_id": fb, "form_id": "tripal_megasearch_form",
        "_triggering_element_name": "datatype"}, ajax=True))
    form = "".join(c["data"] for c in resp if c.get("command") == "insert")
    return fb, form


def export(datatype, out_file, filters=None, fields=None, tries=4):
    """Submit the form (retrying on gateway time-outs) and save the TSV."""
    for k in range(tries):
        try:
            return _export(datatype, out_file, filters, fields)
        except Exception as e:  # noqa: BLE001
            print("  retry", k, str(e)[:60], flush=True)
            time.sleep(20 * (k + 1))
    return None, "failed"


def _export(datatype, out_file, filters=None, fields=None):
    fb, form = open_form(datatype)
    base = []
    for k, v in default_fields(form):
        if k.startswith("attribute_check"):
            m = re.match(r"attribute_checkboxes\[(.+)\]", k)
            if fields is None or (m and m.group(1) in fields):
                base.append((k, v))
        elif k not in (filters or {}):
            base.append((k, v))
    base += list((filters or {}).items())
    base += [("datatype", datatype), ("form_build_id", fb), ("form_id", "tripal_megasearch_form"),
             ("_triggering_element_name", "button"), ("_triggering_element_value", "TSV")]
    resp = json.loads(fetch(BASE + "/system/ajax", base, ajax=True))
    text = " ".join(str(c.get("data", "")) for c in resp)
    m = re.search(r'window\.location\s*=\s*"([^"]+)"', text)
    count = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text))[:80]
    if not m:
        return None, count
    data = fetch(BASE + html.unescape(m.group(1)).replace("\\/", "/"))
    with open(out_file, "wb") as fh:
        fh.write(data)
    return len(data), count


def options(form, name):
    m = re.search(rf'<select[^>]*name="{re.escape(name)}"[^>]*>(.*?)</select>', form, re.S)
    return [html.unescape(v) for v in re.findall(r'<option value="([^"]*)"', m.group(1)) if v != "0"]


def main(out, steps):
    if "maps" in steps:
        print("maps", export("tripal_megasearch_featuremap", f"{out}/maps/cottongen_maps.tsv"), flush=True)
    if "positions" in steps:
        _, form = open_form("tripal_megasearch_marker")
        for name in options(form, "marker_map"):
            fn = f"{out}/maps/marker_positions/{re.sub(r'[^A-Za-z0-9._-]+', '_', name)}.tsv"
            if os.path.exists(fn):
                continue
            size, count = export("tripal_megasearch_marker", fn, {"marker_map": name},
                                 ["name", "marker_type", "mapped_organism", "map", "lg", "std_lg", "start", "stop"])
            print(name, size, count, flush=True)
            time.sleep(1.5)
    if "trait_markers" in steps:
        # one request per trait: whole trait categories time out on the server
        _, form = open_form("tripal_megasearch_marker")
        for trait in options(form, "marker_trait[]"):
            fn = f"{out}/markers/by_trait/{re.sub(r'[^A-Za-z0-9._-]+', '_', trait)}.tsv"
            if os.path.exists(fn):
                continue
            size, count = export("tripal_megasearch_marker", fn, {"marker_trait[]": trait},
                                 ["uniquename", "name", "organism", "marker_type", "map", "lg", "std_lg", "start", "stop",
                                  "genome", "std_chr", "location", "alias", "trait", "primers", "pubs"], tries=2)
            print(trait, size, count, flush=True)
            time.sleep(2)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:] or ["maps", "positions", "trait_markers"])
