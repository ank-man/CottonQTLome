"""Shared helpers: trait harmonisation and chromosome / coordinate standardisation for cotton."""
import re

# Tetraploid chromosome numbering (c1-c26) -> subgenome nomenclature.
CHR_NUM_TO_SUB = {**{i: f"A{i:02d}" for i in range(1, 14)},
                  14: "D02", 15: "D01", 16: "D07", 17: "D03", 18: "D13", 19: "D05", 20: "D10",
                  21: "D11", 22: "D04", 23: "D09", 24: "D08", 25: "D06", 26: "D12"}

# (regex on normalised trait text, harmonised trait, category). First match wins; order matters.
TRAIT_RULES = [
    # --- biotic stress
    (r"verticillium|\bvw\b|verwil|\bvwr\b|relverwdi", "verticillium wilt resistance", "biotic stress"),
    (r"fusarium|\bfwr?\b|fwd[im]\b|\bfov", "fusarium wilt resistance", "biotic stress"),
    (r"bacterial blight|blackarm|xanthomonas|\bbb\b|\bcbb\b", "bacterial blight resistance", "biotic stress"),
    (r"root[- ]?knot|\brkn\b|meloidogyne|gall(ing)? index|egg(s)? per", "root-knot nematode resistance", "biotic stress"),
    (r"reniform|rotylenchulus", "reniform nematode resistance", "biotic stress"),
    (r"leaf curl|clcud?\b|\bclcuv", "cotton leaf curl disease resistance", "biotic stress"),
    (r"leaf crumple", "cotton leaf crumple virus resistance", "biotic stress"),
    (r"blue disease|\bcbd\b", "cotton blue disease resistance", "biotic stress"),
    (r"aphid|aphdam", "aphid resistance", "biotic stress"),
    (r"whitefly|bollworm|thrips|jassid|lygus|mirid|spider mite|insect", "insect resistance", "biotic stress"),
    (r"rust|target spot|black root rot|thielaviopsis|alternaria|boll rot|damping|rhizoctonia|ramularia",
     "other disease resistance", "biotic stress"),
    (r"aspergillus|aflatoxin", "aspergillus flavus resistance", "biotic stress"),
    (r"senescen|stay[- ]green|\bnawf|\bbop\b|ratio ab\b", "senescence and stay-green", "physiology"),
    (r"flame|heat release|\bhrc\b", "fiber flame resistance", "fiber quality"),
    (r"\b(kl|kw|klw|hkw|ka|kr|kd)\b|(seed|kernel) (length|width|area|size|shape|perimeter|morpholog)", "seed size and shape", "seed quality"),
    (r"^(oc|soc|koc)$", "seed oil and fatty acids", "seed quality"),
    (r"^(pc|spc)$", "seed protein and amino acids", "seed quality"),
    # --- fibre quality
    (r"short fib|\bsfc[nw]?\b|\bsfi\b|shorfib|short fiber rate|\bfr\b", "short fiber content", "fiber quality"),
    (r"uniform|\bfu\b|\bflu\b|\bui\b|\bfui\b|\bur\b|fiblenuni|fibuni", "fiber uniformity", "fiber quality"),
    (r"upper half mean|\buhml?\b|\bfuhml\b|2\.5 ?%? span|span length|\bfl\b|fib(er|re)? ?len|staple length"
     r"|upper quartile length|\buql\b|\bmlw\b|\bmln\b|mean length|avelengnum|avelengwei|topqualen|length by weight|length by number",
     "fiber length", "fiber quality"),
    (r"strength|\bfs\b|\bstr\b|\bbs\b tenacity|tenacity|fibstr", "fiber strength", "fiber quality"),
    (r"micronair|\bmic\b|\bfm\b|\bmv\b|\bmik\b|fibmic", "micronaire", "fiber quality"),
    (r"elongat|\bfe\b|\belo\b|\bel\b|fibelo|eloratr", "fiber elongation", "fiber quality"),
    (r"plant maturity|days to maturity|early maturity", "growth period and maturity", "phenology"),
    (r"matur(ity|e ratio)|\bmat\b|\bfmt\b|\bmr\b|fibmat|immature|immfib|matureratio", "fiber maturity", "fiber quality"),
    (r"fineness|\bfin\b|fibfine|perimeter|wall thickness|arealometer", "fiber fineness", "fiber quality"),
    (r"spin(ning)? ?consist|\bsci\b|spinconind|fibspiconind", "spinning consistency index", "fiber quality"),
    (r"reflectance|\brd\b|fibrel", "fiber reflectance", "fiber quality"),
    (r"yellowness|\+b\b|fibyel", "fiber yellowness", "fiber quality"),
    (r"\bnep|neps", "fiber neps", "fiber quality"),
    (r"lint colou?r|fib(er|re) colou?r|lintcol|\bcolor grade", "fiber color", "fiber quality"),
    (r"fuzz|seedfuz|lintless|fiberless|naked seed", "seed fuzz", "fiber quality"),
    (r"fib(er|re) (initiation|development|cell|elongation stage)|lint (fib(er|re)) density|fiber initial", "fiber development", "fiber quality"),
    # tables listing several traits without naming them per row: kept, but not assigned to a trait
    (r"quality and yield|yield and (fib(er|re) )?quality|fib(er|re) quality|qtl clusters?|clusters and hotspots|all (the )?qtls"
     r"|significant snps|stable qtls|^clu$", "multiple traits (not specified)", "unclassified"),
    # --- yield and components
    (r"lint percent|lint %|\blp\b|\bl%|\bgot\b|gin(ning)? (turn ?out|out ?turn)|lintper|lint fraction", "lint percentage", "yield"),
    (r"lint index|\bli\b|lintind", "lint index", "yield"),
    (r"seed index|\bsi\b|100[- ]seed|hundred[- ](seed|grain)|seedind|\bhsw\b|seed weight", "seed index", "yield"),
    (r"boll weight|\bbw\b|bollwei|seed cotton weight per boll|single boll|boll size|\bbs\b|\bsbw\b", "boll weight", "yield"),
    (r"fib(er|re)? ?wei(ght)? ?per ?bol|lint weight per boll|\blw\b|lint weight|fibweiperbol", "lint weight per boll", "yield"),
    (r"boll number|bolls? per plant|\bbn\b|\bbnp\b|bollnumper|number of bolls|effective boll|\bebn\b|frubolnum",
     "boll number", "yield"),
    (r"lint yield|\bly\b", "lint yield", "yield"),
    (r"dry matter yield|biomass yield", "plant biomass", "growth and vigor"),
    (r"seed cotton yield|\bscy\b|seedcotyie|seed cotton weight|\bscw\b|\bsw\b|yeild|\byield\b", "seed cotton yield", "yield"),
    (r"harvest index|\bhi\b", "harvest index", "yield"),
    (r"seeds? (number )?per boll|seed number|locule", "seed number per boll", "yield"),
    (r"boll (abscission|retention|set)|bollset|fruit retention", "boll retention", "yield"),
    # --- seed composition
    (r"\boil\b|fatty acid|linole|oleic|palmit|stearic|myristic|\bc1[4-8]\b|\bc20\b|heptadecanoic", "seed oil and fatty acids", "seed quality"),
    (r"protein|amino acid|arginine|aspartate|cysteine|glycine|leucine|phenylalanine|serine", "seed protein and amino acids", "seed quality"),
    (r"gossypol|pig(ment)? ?gla|gland|terpenoid|raimondal", "gossypol and glands", "seed quality"),
    (r"kernel|seed coat|hull|seedcoa", "seed physical traits", "seed quality"),
    # --- abiotic stress
    (r"salt|salin|nacl|\bna\+|sodium|\bk\+/na", "salt tolerance", "abiotic stress"),
    (r"drought|water deficit|water stress|\bpeg\b|osmotic|relative (leaf )?water|relwatcon|carbon isotope|canopy temperature"
     r"|excised leaf|wilting|water use|\bwue\b|drs[ir]\b|dehydration", "drought tolerance", "abiotic stress"),
    (r"cold|chill|low[- ]temperature|freez", "cold tolerance", "abiotic stress"),
    (r"heat|high[- ]temperature|thermo", "heat tolerance", "abiotic stress"),
    (r"waterlog|flood|alkal|cadmium|heavy metal|nitrogen|phosph|potassium|nutrient|\bnue\b|low[- ]p\b|herbicide|glyphosate",
     "nutrient and other abiotic stress", "abiotic stress"),
    (r"chlorophyll|chlcon|\bspad\b", "chlorophyll content", "physiology"),
    (r"photosynth|stomat|transpir|gas exchange|\bpn\b", "photosynthesis and gas exchange", "physiology"),
    (r"malondialde|\bmda\b|electr(ic|olyte)|relelecon|proline|\bsod\b|\bpod\b|\bcat\b activity|nitrate reductase",
     "stress indicators (MDA, electrolyte leakage, proline)", "physiology"),
    (r"concentration|ion content|mineral|\biron\b|zinc|boron|calcium|copper|magnesium|manganese|sulfur", "mineral content", "physiology"),
    # --- phenology
    (r"flower(ing)? ?(time|date|day|dat\b)|days to (first )?flower|\bft\b|\bfd\b|\bdff\b|flowdat|sowflo|bud period|squar"
     r"|flowering (stage|period)|\bfp\b", "flowering time", "phenology"),
    (r"growth period|grow(ing)? (stage|period)|\bwgp\b|\bgp\b|whogroper|maturity|earliness|boll open|\bbd\b|bollopend"
     r"|days .* boll|boll period|\bfbp\b|seedling period|photoperiod|\bymp\b", "growth period and maturity", "phenology"),
    # --- plant architecture / morphology
    (r"node of (the )?first fruit|first fruit(ing)? (branch|spur)|\bnffb\b|\bhnffb\b|\bhffbn\b|\bffbn\b|\bffbp\b|\bffsh\b|\bhffb\b"
     r"|frubranod|symbranod", "first fruiting branch position", "plant architecture"),
    (r"fruit(ing)? ?(branch|spur)|sympodi|\bfbn\b|\bfbt\b|\befbn\b|\bbfn\b|\bfsbn\b|frubranum|\bfbl\b|\bfba\b|branch (angle|length|number|type)"
     r"|monopodi|vegetative branch|\bafb\b|symbratyp", "branch traits", "plant architecture"),
    (r"plant height|\bph\b|\brph\b|plahei|stem (length|height)|stelen|stemlen|internode|\bhnr\b|node number|plant type|platyp"
     r"|stem diameter|stemdia|dwarf", "plant height and stature", "plant architecture"),
    (r"root", "root system traits", "plant architecture"),
    (r"hyclen|hypocotyl|seedling (length|height)", "germination and seedling vigor", "growth and vigor"),
    (r"trichome|pubescen|hair|leafpub|stempub|stepub|\blpa\b|smooth leaf|glabrous", "trichome and pubescence", "morphology"),
    (r"leaf (shape|area|size|lobe|length|width|thick|color|colour|weight|angle|depth|number|sublobe|main|2nd|3rd)"
     r"|okra|leafsha|leafare|leaflen|leafwid|leafthi|leafcol|leaf(dry|fre|tur)wei|leafspo|leafbasspo|leafnec|leafgla"
     r"|virescent|\bleaf\b", "leaf morphology", "morphology"),
    (r"petal|pollen|anther|stigma|style|bract|flower (colou?r|size)|corolla|filament|gynoecium|antcol|petcol|petspo|corcol"
     r"|brashape|nectar|open bud|floral", "flower morphology", "morphology"),
    (r"boll (shape|length|width|diameter|type|colou?r)|bollshap|bolcol|bollsettyp|carpel|peduncle|\bbl\b|\bbd\b", "boll morphology", "morphology"),
    (r"stem (colou?r|hardness|tumor)|stemcol|stecol|stemhar|hard(low|up)|plant colou?r|anthocyan|red plant|sunred", "stem and plant color", "morphology"),
    (r"callus|regenerat|embryogen", "tissue culture response", "growth and vigor"),
    (r"vigor|vigour|germinat|gerrat|emergence|survival|seedsur|relsurrat|\bgi\b|\bgr\b|\bvi\b|\bmgt\b",
     "germination and seedling vigor", "growth and vigor"),
    (r"dry (weight|matter)|fresh weight|biomass|drywei|frewei|shoot|sholen|totdrw|seedling weight"
     r"|\br?[srt]?(fw|dw)\b|\b[srt](fw|dw)\w?\b", "plant biomass", "growth and vigor"),
    (r"^(k|mg|ca|na|zn|fe|mn|cu|b|p|n|s)$|\bbor\b", "mineral content", "physiology"),
    (r"\b(srl|trl|rl|rsa|rv|rad|rtn|lrn)\b", "root system traits", "plant architecture"),
    # --- fertility
    (r"steril|fertil|restor|\bcms\b|\bgms\b|semigam|cleistogam|lethal|hybrid (necrosis|breakdown)|heterosis", "fertility and sterility", "fertility"),
]
TRAIT_RULES = [(re.compile(p), t, c) for p, t, c in TRAIT_RULES]

COTTONGEN_CATEGORY = {
    "quality trait": "fiber quality", "yield trait": "yield", "biotic stress trait": "biotic stress",
    "abiotic stress trait": "abiotic stress", "morphological trait": "morphology",
    "phenological trait": "phenology", "physiological trait": "physiology",
    "stature or vigor trait": "plant architecture", "biochemical trait": "seed quality",
    "fertility or sterility trait": "fertility",
}


def split_camel(code):
    """CottonGVD trait codes look like FibLen_XJ_15: strip site/year suffix and split camel case."""
    base = re.split(r"[_-]", code)[0]
    return re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", base)


def normalise_trait_text(raw):
    t = str(raw or "")
    t = re.sub(r"\bBLUP of\b|\bBLUE of\b|\baverage of\b|\bmean of\b", " ", t, flags=re.I)
    t = t.replace("fibre", "fiber").replace("_", " ")
    t = re.sub(r"[()\[\],;:]", " ", t)
    return re.sub(r"\s+", " ", t).strip().lower()


# CottonGVD camel-case trait codes (site/year suffix removed, lower-cased, no spaces).
GVD_RULES = [(re.compile(p), t, c) for p, t, c in [
    (r"^fiblenuni|^fibuni", "fiber uniformity", "fiber quality"),
    (r"^fiblen|^aveleng|^topqualen|^ln5perc", "fiber length", "fiber quality"),
    (r"^fibstr", "fiber strength", "fiber quality"), (r"^fibmic", "micronaire", "fiber quality"),
    (r"^fibelo|^eloratr", "fiber elongation", "fiber quality"),
    (r"^fibmat|^matureratio|^immfib", "fiber maturity", "fiber quality"),
    (r"^fibfine", "fiber fineness", "fiber quality"), (r"^fibrel", "fiber reflectance", "fiber quality"),
    (r"^fibyel", "fiber yellowness", "fiber quality"),
    (r"^fibspiconind|^spinconind", "spinning consistency index", "fiber quality"),
    (r"^sfc|^shorfibind", "short fiber content", "fiber quality"), (r"nep", "fiber neps", "fiber quality"),
    (r"^lintcol", "fiber color", "fiber quality"), (r"fuz", "seed fuzz", "fiber quality"),
    (r"^lintper", "lint percentage", "yield"), (r"^lintind", "lint index", "yield"),
    (r"^seedind", "seed index", "yield"), (r"^bollwei", "boll weight", "yield"),
    (r"^fibweiperbol", "lint weight per boll", "yield"),
    (r"^bollnumper|^frubolnum", "boll number", "yield"), (r"^seedcotyie", "seed cotton yield", "yield"),
    (r"^flowdat|^sowflo", "flowering time", "phenology"),
    (r"^whogroper|^bollopend", "growth period and maturity", "phenology"),
    (r"^frubranod|^symbranod", "first fruiting branch position", "plant architecture"),
    (r"^frubranum|^symbratyp|^bollsettyp", "branch traits", "plant architecture"),
    (r"^plahei|^stemlen|^stelen|^stemdia|^platyp|^relstelen", "plant height and stature", "plant architecture"),
    (r"root", "root system traits", "plant architecture"), (r"^hyclen", "germination and seedling vigor", "growth and vigor"),
    (r"pub$", "trichome and pubescence", "morphology"),
    (r"^verwil|^relverwdi", "verticillium wilt resistance", "biotic stress"),
    (r"^fwd", "fusarium wilt resistance", "biotic stress"), (r"^aphdam", "aphid resistance", "biotic stress"),
    (r"^c\d\d$", "seed oil and fatty acids", "seed quality"),
    (r"gossypol|piggla|^leafgla", "gossypol and glands", "seed quality"), (r"^seedcoa", "seed physical traits", "seed quality"),
    (r"^drs|^relwatcon|^(down|up|tot)(wr|war)$", "drought tolerance", "abiotic stress"),
    (r"chlcon|^spad", "chlorophyll content", "physiology"),
    (r"mda$|^relelecon", "stress indicators (MDA, electrolyte leakage, proline)", "physiology"),
    (r"^fibcol", "fiber whiteness and colorimetry", "fiber quality"),
    (r"^grosta", "growth period and maturity", "phenology"),
    (r"^petcol|^petspo|^antcol|^corcol|^brashape|nec$|^stig|^petlen|^bralen|^gynlen", "flower morphology", "morphology"),
    (r"^bollshap|^bolcol", "boll morphology", "morphology"),
    (r"^stemcol|^stecol|hard(low|up)$|^stemhar", "stem and plant color", "morphology"),
    (r"^leaf", "leaf morphology", "morphology"),
    (r"^gerrat|sur", "germination and seedling vigor", "growth and vigor"),
    (r"wei$|drw$|frw$|^sholen", "plant biomass", "growth and vigor"),
]]


def harmonise_gvd(code):
    base = re.split(r"[_-]", str(code))[0].lower()
    if re.fullmatch(r"cc|ee|hh|ll|r457|rx|ry|rz|wf|wh|aa|bb|w10", base):
        # cottonAD1.383 panel: CottonGVD does not document these codes. They match standard
        # colorimetry notation (L*, a*, b*, chroma C, hue H, colour difference E, tristimulus
        # reflectances Rx/Ry/Rz, ISO brightness R457, whiteness W10/WH/WF), so they are read as
        # fibre colour measurements - an inference, kept visible through trait_original.
        return "fiber whiteness and colorimetry", "fiber quality"
    if re.fullmatch(r"(rel)?defrat", base):
        return "defoliation rate", "physiology"
    if re.fullmatch(r"(rel)?petstr", base):
        return "petiole strength", "morphology"
    for rx, trait, cat in GVD_RULES:
        if rx.search(base):
            return trait, cat
    return harmonise_trait(split_camel(str(code)))


def harmonise_trait(raw, cottongen_category=None):
    """Return (harmonised_trait, category). Unmatched traits keep their cleaned name."""
    text = normalise_trait_text(raw)
    if not text or text in {"nan", "trait", " undefined trait"}:
        return "unspecified", "unclassified"
    for rx, trait, cat in TRAIT_RULES:
        if rx.search(text):
            return trait, cat
    # Environment-tagged abbreviations such as "FS09KU", "LP16-3", "FBT-K-15", "BW_SCA": retry on the stem.
    m = re.match(r"([a-z%]{2,6})(?=\d|[-_ .]|$)", text)
    if m and m.group(1) != text:
        for rx, trait, cat in TRAIT_RULES:
            if rx.search(m.group(1)):
                return trait, cat
    return text, COTTONGEN_CATEGORY.get(str(cottongen_category or "").strip().lower(), "unclassified")


def std_chromosome(raw):
    """Map chromosome / linkage-group labels to A01..A13, D01..D13 (or diploid e.g. A2_05)."""
    s = str(raw or "").strip()
    if not s or s.lower() == "nan":
        return ""
    m = re.search(r"AD_ch\d+_([AD])t\.(\d+)", s)            # CottonGen standardised tetraploid
    if m:
        return f"{m.group(1)}{int(m.group(2)):02d}"
    m = re.fullmatch(r"([A-K])\.(\d+)", s)                    # CottonGen standardised diploid
    if m:
        return f"{m.group(1)}{int(m.group(2)):02d}"
    m = re.match(r"([A-K])\d?[_-]?chr[._ ]*0*(\d{1,2})$", s, re.I)   # diploid, e.g. A2_Chr07
    if m and 1 <= int(m.group(2)) <= 13:
        return f"{m.group(1).upper()}{int(m.group(2)):02d}"
    m = re.search(r"(?:^|[^A-Za-z])(?:Gh(?:ir)?|Gb(?:ar)?)?_?([AD])t?_?(?:chr)?_?(\d{1,2})(?!\d)", s, re.I)
    if m and 1 <= int(m.group(2)) <= 13:
        return f"{m.group(1).upper()}{int(m.group(2)):02d}"
    m = re.search(r"(?:^|[^A-Za-z])(?:chr(?:omosome)?|ch|c|lg)[\s._-]*0*(\d{1,2})(?!\d)", s, re.I)
    if m and 1 <= int(m.group(1)) <= 26:
        return CHR_NUM_TO_SUB[int(m.group(1))]
    m = re.fullmatch(r"0*(\d{1,2})", s)
    if m and 1 <= int(m.group(1)) <= 26:
        return CHR_NUM_TO_SUB[int(m.group(1))]
    return ""


def parse_location(loc):
    """'Gbar_A06:105151224..105151224' -> (seqid, start, end)."""
    m = re.match(r"(.+?):(\d+)\.\.(\d+)$", str(loc or ""))
    if not m:
        return "", None, None
    a, b = int(m.group(2)), int(m.group(3))
    return m.group(1), min(a, b), max(a, b)
