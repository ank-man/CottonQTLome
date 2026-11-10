#!/usr/bin/env python3
"""Expression of the genes inside CottonQTLome hotspots and meta-QTL.

Atlas: TM-1 RNA-seq of 11 organs (PRJNA248163; Zhang et al. 2015), one library per organ, quantified with kallisto
against one transcript per UTX v2.1 gene (PolyploidQTLome step 13). Tissue classes: root, stem, leaf, flower
(petal, stamen, pistil), seed (ovule 10 dpa, seed), fibre (10 and 20 dpa); cotyledon counted as leaf.
Per gene: expressed (max TPM >= 1), tau (Yanai et al. 2005), peak class, and fibre-preferential
(peak in fibre and fibre TPM >= 2x every other class).

Tests
  1  hotspot genes vs genes in randomly placed intervals: every hotspot is shifted circularly along its own
     chromosome (one random offset per chromosome, applied to all hotspots on it), 2,000 times
  2  meta-QTL of a trait category vs the same null, for the a-priori tissue: fiber quality -> fibre,
     seed quality -> seed; the confidence intervals of a category are merged first so no gene counts twice
  3  fiber-quality vs other meta-QTL: category labels permuted among meta-QTL, 2,000 times (positions fixed,
     so gene density and marker coverage cancel)
Output: analysis/tables/expression_overlay_tests.tsv, expression_fibre_candidates.tsv, figures/expression_overlay.*
"""
import json, os
import numpy as np, pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
PQ = "/Users/ankushsharma/Documents/projects/PolyploidQTLome"
T = os.path.join(HERE, "tables")
rng = np.random.default_rng(20261106)
NREP = 2000

E = pd.read_csv(f"{PQ}/results/gene_expression.tsv.gz", sep="\t")
E = E[E.species == "cotton"].drop(columns="species")
G = pd.read_csv(f"{PQ}/data/processed/genes.tsv.gz", sep="\t")
G = G[G.species == "cotton"].merge(E, on="gene_id")
G["mid"] = (G.start + G.end) // 2
CL = ["root", "stem", "leaf", "flower", "seed", "fibre"]
tpm = G[[f"tpm_{c}" for c in CL]].values
other = np.delete(tpm, CL.index("fibre"), axis=1).max(1)
G["fibre_pref"] = G.expressed & (G.peak_class == "fibre") & (G.tpm_fibre >= 2 * other)
G["peak_fibre"] = np.where(G.expressed, G.peak_class == "fibre", np.nan)
G["peak_seed"] = np.where(G.expressed, G.peak_class == "seed", np.nan)
CHLEN = G.groupby("chromosome").end.max()
by_chr = {c: d.sort_values("mid") for c, d in G.groupby("chromosome")}


def genes_in(iv):
    """Boolean mask over G: genes whose midpoint lies in any interval of iv (chromosome, start, end)."""
    m = np.zeros(len(G), bool)
    for c, d in iv.groupby("chromosome"):
        if c not in by_chr:
            continue
        g = by_chr[c]
        for s, e in zip(d.start.values, d.end.values):
            lo, hi = np.searchsorted(g.mid.values, [s, e])
            m[G.index.get_indexer(g.index[lo:hi])] = True
    return m


def merge(iv):
    out = []
    for c, d in iv.sort_values(["chromosome", "start"]).groupby("chromosome"):
        s0 = e0 = None
        for s, e in zip(d.start, d.end):
            if s0 is None or s > e0:
                if s0 is not None:
                    out.append((c, s0, e0))
                s0, e0 = s, e
            else:
                e0 = max(e0, e)
        out.append((c, s0, e0))
    return pd.DataFrame(out, columns=["chromosome", "start", "end"])


def stats(m):
    g = G[m]
    x = g[g.expressed]
    return {"genes": len(g), "expressed": g.expressed.mean(), "tau": x.tau.mean(),
            "peak_fibre": x.peak_fibre.mean(), "peak_seed": x.peak_seed.mean(), "fibre_pref": g.fibre_pref.mean()}


def rotate(iv):
    off = {c: rng.integers(0, int(CHLEN[c])) for c in iv.chromosome.unique()}
    r = iv.copy()
    L = r.chromosome.map(CHLEN).values
    o = r.chromosome.map(off).values
    s = (r.start.values + o) % L
    e = s + (r.end.values - r.start.values)
    # an interval that wraps past the chromosome end is split in two
    wrap = e > L
    a = pd.DataFrame({"chromosome": r.chromosome.values, "start": s, "end": np.minimum(e, L)})
    b = pd.DataFrame({"chromosome": r.chromosome.values[wrap], "start": 0, "end": (e - L)[wrap]})
    return pd.concat([a, b])


def rotation_test(iv, name, metrics):
    obs = stats(genes_in(iv))
    null = pd.DataFrame([stats(genes_in(rotate(iv))) for _ in range(NREP)])
    rows = []
    for k in metrics:
        nv = null[k].dropna()
        p = (1 + np.sum(np.abs(nv - nv.mean()) >= abs(obs[k] - nv.mean()))) / (len(nv) + 1)
        rows.append({"test": "rotation", "set": name, "metric": k, "observed": obs[k], "null_mean": nv.mean(),
                     "null_sd": nv.std(), "z": (obs[k] - nv.mean()) / nv.std(), "p": p, "genes": obs["genes"]})
    return rows, null


H = pd.read_csv(f"{T}/hotspots.tsv", sep="\t")
M = pd.read_csv(f"{T}/meta_qtl.tsv", sep="\t")
M = M.assign(start=(M.ci_start_mb * 1e6).astype(int), end=(M.ci_end_mb * 1e6).astype(int))
MET = ["expressed", "tau", "peak_fibre", "peak_seed", "fibre_pref"]
res, nulls = [], {}
for name, iv in [("all hotspots", H), ("fiber-quality hotspots", H[H.dominant_category == "fiber quality"])]:
    r, nulls[name] = rotation_test(iv[["chromosome", "start", "end"]], name, MET)
    res += r
for cat in ["fiber quality", "seed quality", "yield"]:
    iv = merge(M[M.category == cat][["chromosome", "start", "end"]])
    name = f"{cat} meta-QTL"
    r, nulls[name] = rotation_test(iv, name, MET)
    res += r

# test 3: fiber-quality vs other meta-QTL, labels permuted among meta-QTL
mask = {i: genes_in(M.loc[[i], ["chromosome", "start", "end"]]) for i in M.index}
gi = {i: np.flatnonzero(m) for i, m in mask.items()}
pf = G.fibre_pref.values.astype(float)
pk = G.peak_fibre.values


def share(ids, v):
    idx = np.unique(np.concatenate([gi[i] for i in ids])) if len(ids) else np.array([], int)
    x = v[idx]
    return np.nanmean(x) if len(x) else np.nan


fq = M.index[M.category == "fiber quality"].values
ot = M.index[M.category != "fiber quality"].values
for metric, v in [("fibre_pref", pf), ("peak_fibre", pk)]:
    d_obs = share(fq, v) - share(ot, v)
    lab = M.index.values
    perm = []
    for _ in range(NREP):
        s = rng.permutation(lab)
        perm.append(share(s[:len(fq)], v) - share(s[len(fq):], v))
    perm = np.array(perm)
    res.append({"test": "label permutation", "set": "fiber-quality vs other meta-QTL", "metric": metric,
                "observed": d_obs, "null_mean": perm.mean(), "null_sd": perm.std(), "z": (d_obs - perm.mean()) / perm.std(),
                "p": (1 + np.sum(np.abs(perm - perm.mean()) >= abs(d_obs - perm.mean()))) / (NREP + 1),
                "genes": int(sum(len(gi[i]) for i in fq))})
R = pd.DataFrame(res)
R.to_csv(f"{T}/expression_overlay_tests.tsv", sep="\t", index=False)
print(R.to_string(index=False))

# fibre-preferential genes in the A07 and D11 hotspots, with annotation and overlapping fiber meta-QTL
ann = {}
for c in ["A07", "D11"]:
    for r in json.load(open(os.path.join(HERE, "..", "website/public/data/genes/chr", f"{c}.json"))):
        ann[r[0]] = (r[7], r[8].strip(), r[9])
fqm = M[M.category == "fiber quality"]
cand = []
for hid in ["CHS007", "CHS004"]:
    h = H[H.hotspot_id == hid].iloc[0]
    g = G[(G.chromosome == h.chromosome) & (G.mid >= h.start) & (G.mid < h.end)]
    for x in g[g.fibre_pref].itertuples():
        mq = fqm[(fqm.chromosome == x.chromosome) & (fqm.start <= x.mid) & (fqm.end >= x.mid)]
        sym, at, desc = ann.get(x.gene_id, ("", "", ""))
        cand.append({"hotspot": hid, "chromosome": x.chromosome, "gene_id": x.gene_id, "start": x.start, "end": x.end,
                     "tpm_fibre": round(x.tpm_fibre, 1), "max_other_tpm": round(max(getattr(x, f"tpm_{c}") for c in CL if c != "fibre"), 1),
                     "tau": round(x.tau, 2), "symbol": sym, "arabidopsis": at, "description": desc,
                     "fiber_meta_qtl": "; ".join(f"{a} ({b})" for a, b in zip(mq.mqtl_id, mq.trait)),
                     "genes_in_hotspot": len(g)})
C = pd.DataFrame(cand).sort_values(["hotspot", "tpm_fibre"], ascending=[True, False])
C.to_csv(f"{T}/expression_fibre_candidates.tsv", sep="\t", index=False)
print(C.groupby("hotspot").agg(n=("gene_id", "size"), in_mqtl=("fiber_meta_qtl", lambda s: (s != "").sum()),
                               genes=("genes_in_hotspot", "first")))
print(C.head(30)[["hotspot", "gene_id", "tpm_fibre", "max_other_tpm", "symbol", "description", "fiber_meta_qtl"]].to_string(index=False))
G[["gene_id", "chromosome", "mid", "fibre_pref", "peak_class", "tau"] + [f"tpm_{c}" for c in CL]].to_csv(
    f"{T}/expression_gene_atlas_cotton.tsv.gz", sep="\t", index=False)
pd.concat({k: v for k, v in nulls.items()}).to_csv(f"{T}/expression_overlay_nulls.tsv.gz", sep="\t")
print("genome:", {k: round(v, 3) for k, v in stats(np.ones(len(G), bool)).items()})
