#!/usr/bin/env python3
"""Drive CottonGen's Tripal MegaSearch (QTL/GWAS datatype) and download results.

Usage: cottongen_megasearch.py OUT_DIR [qtl_type ...]   (qtl_type: QTL, GWAS, MTL, or ALL)
"""
import html
import http.cookiejar
import json
import re
import sys
import time
import urllib.parse
import urllib.request

BASE = "https://www.cottongen.org"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
PAGE = BASE + "/tripal_megasearch?datatype=tripal_megasearch_qtl"

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def fetch(url, data=None, ajax=False, timeout=900):
    headers = {"User-Agent": UA, "Referer": PAGE}
    if ajax:
        headers["X-Requested-With"] = "XMLHttpRequest"
    body = urllib.parse.urlencode(data, doseq=True).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers=headers)
    with opener.open(req, timeout=timeout) as r:
        return r.read()


def build_id(fragment):
    return re.search(r'name="form_build_id" value="([^"]+)"', fragment).group(1)


def open_form():
    page = fetch(PAGE).decode("utf8", "ignore")
    i = page.find('id="tripal-megasearch-form"')
    fb = build_id(page[i:])
    resp = json.loads(fetch(BASE + "/chado_search_ajax_callback", {
        "datatype": "tripal_megasearch_qtl", "form_build_id": fb,
        "form_id": "tripal_megasearch_form", "_triggering_element_name": "datatype"}, ajax=True))
    form = ""
    for c in resp:
        if c.get("command") == "insert":
            form += c["data"]
        if c.get("command") == "updateBuildId":
            fb = c["new"]
    return fb, form


def default_fields(form):
    fields = []
    for m in re.finditer(r'<select[^>]*name="([^"]+)"[^>]*>(.*?)</select>', form, re.S):
        name, body = m.group(1), m.group(2)
        if name.endswith("[]"):
            continue  # multi-selects: nothing selected = no filter
        sel = re.search(r'<option value="([^"]*)"[^>]*selected', body)
        first = re.search(r'<option value="([^"]*)"', body)
        fields.append((name, html.unescape((sel or first).group(1))))
    for t in re.findall(r'<input[^>]*>', form):
        n = re.search(r'name="([^"]+)"', t)
        ty = re.search(r'type="([^"]+)"', t)
        v = re.search(r'value="([^"]*)"', t)
        if not n:
            continue
        if ty.group(1) == "text":
            fields.append((n.group(1), ""))
        elif ty.group(1) == "checkbox" and "checked" in t:
            fields.append((n.group(1), html.unescape(v.group(1))))
    return fields


def run(out_dir, qtl_type):
    fb, form = open_form()
    fields = [(k, v) for k, v in default_fields(form) if k != "qtl_type"]
    fields += [("qtl_type", "0" if qtl_type == "ALL" else qtl_type),
               ("datatype", "tripal_megasearch_qtl"), ("form_build_id", fb),
               ("form_id", "tripal_megasearch_form")]
    for label, trig in (("count", [("_triggering_element_name", "button"),
                                   ("_triggering_element_value", "Refresh Count")]),
                        ("tsv", [("_triggering_element_name", "button"),
                                 ("_triggering_element_value", "TSV")])):
        raw = fetch(BASE + "/system/ajax", fields + trig, ajax=True)
        with open(f"{out_dir}/_ajax_{qtl_type}_{label}.json", "wb") as fh:
            fh.write(raw)
        resp = json.loads(raw)
        text = " ".join(str(c.get("data", "")) for c in resp)
        plain = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text))
        print(qtl_type, label, "->", plain[:400])
        links = set(re.findall(r'href="([^"]+)"', text)) | set(
            re.findall(r'window\.location\s*=\s*"([^"]+)"', text))
        for c in resp:
            for key in ("url", "path"):
                if isinstance(c.get(key), str):
                    links.add(c[key])
        for link in links:
            link = html.unescape(link).replace("\\/", "/")
            if not re.search(r"\.(tsv|csv|zip|gz)", link):
                continue
            url = link if link.startswith("http") else BASE + link
            ext = re.search(r"\.(tsv|csv|zip|gz)", url).group(1)
            name = f"{out_dir}/cottongen_megasearch_{qtl_type}.{ext}"
            data = fetch(url)
            with open(name, "wb") as fh:
                fh.write(data)
            print("  saved", name, len(data), "bytes from", url)
        time.sleep(2)


if __name__ == "__main__":
    out = sys.argv[1]
    for t in sys.argv[2:] or ["ALL"]:
        run(out, t)
