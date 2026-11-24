import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EQUIVALENTS,
  RELATED_TERMS,
  normalizeRequestTerms,
  normalizeProductTerms,
  normalizeTerms,
} from "./jewelryTerms.js";

const req = (s) => normalizeRequestTerms(s);
const prod = (s) => normalizeProductTerms(s);

// A realistic corpus. Every string must be stable under a second pass in BOTH scopes.
const CORPUS = [
  "14k WG dia eng ring emerald cut 1.5ct",
  "18ct YG sapph cluster",
  "9ct rose gold morganite halo",
  "SS Rolex sub no date 40mm",
  "ss tennis brac 3cttw",
  "Tiffany setting solitaire 1 1/2 ct G VS1",
  "tiffany & co bean pendant",
  "Old mine cut cushion antique ring Victorian 15ct",
  "OEC 2.10ct J VS2 GIA cert no fluor",
  "gucci link chain 24in 14k",
  "omega speedy pro moonwatch hesalite",
  "omega chain 18 inch",
  "cartier love bracelet size 17 yg",
  "love bracelet knockoff",
  "trinity ring cartier",
  "trilogy ring 3 stone",
  "herkimer diamond pendant",
  "cultured pearl strand princess length 7mm akoya",
  "SS pearl strand 11-12mm",
  "lab grown 2ct oval F VS1 IGI",
  "CVD diamond 3ct",
  "HPHT treated natural diamond",
  "natural earth mined diamond",
  "cz stud earrings 925",
  "moissy ring 14kw",
  "smoky topaz cocktail ring",
  "green amethyst earrings",
  "ceylon sapphire 3 ct oval unheated",
  "Burma ruby ring plat",
  "pt950 band 4mm comfort fit",
  "25 pt diamond pendant",
  "18kwg riviere necklace",
  "riviera bracelet 5ctw",
  "Diamonds by the yard 18 station",
  "byzantine chain 22 inch 10k",
  "art deco platinum filigree ring c. 1925",
  "vintage style halo ring",
  "estate pre-owned Datejust 36 jubilee two tone",
  "DJ41 blue dial fluted bezel",
  "pepsi gmt ss",
  "18ct gold diamond ring hallmarked London",
  "0.18ct dia",
  "2.18 ct pear",
  "gold filled locket",
  "14KP class ring",
  "hoops 30mm",
  "shirt studs and cufflinks dress set",
  "w/ dias 14k w/g",
  "size 6 1/2 solitaire",
  "sz 7 band",
  "under $750 gift",
  "750 gold bracelet",
  "quartz movement ladies watch",
  "rose quartz cabochon ring",
  "Grand Seiko snowflake",
  "Seiko 5 automatic",
  "GS SBGA211",
  "AP royal oak 15500",
  "audemars 15202 jumbo",
  "tsav garnet ring",
  "rhodolite garnet",
  "paraiba tourm 1ct",
  "mabe pearl earrings",
  "half eternity band 14ky",
  "eternity ring wg",
  "engagement",
  "e-ring 2ct",
  "earrings",
  "ear rings",
  "cable bracelet yurman",
  "cable chain 20in",
  "tennis",
  "tennis necklace",
  "lobster",
  "toggle necklace",
  "claw set solitaire",
  "rub over sapphire ring 18ct",
  "bezel set diamond",
  "milgrain edge",
  "millgrain",
  "Sterling ring",
  "sterling silver ring",
  "stainless watch",
  "steel bracelet",
  "damascus steel band",
  "princess cut",
  "princess length pearls",
  "cushion halo",
  "cushion cut",
  "radiant cut",
  "asscher",
  "trillion sides",
  "bags on the sides",
  "tapered bags",
  "half moon side stones",
  "black diamond",
  "champagne diamond",
  "canary diamond",
  "fancy yellow",
  "salt and pepper diamond",
  "certified",
  "gia certified",
  "GIA cert",
  "papers only",
  "box and papers",
  "full set",
  "signed piece",
  "unsigned",
  "unmarked tests 14k",
  "stamped 750",
  "mother of pearl dial",
  "mop pendant",
  "morganite",
  "aquamarine",
  "aqua ring",
  "citrine",
  "tourmaline",
  "paraiba tourmaline",
  "Bvlgari b.zero1 ring",
  "Bulgari serpenti",
  "VCA alhambra",
  "van cleef alhambra",
  "JLC reverso",
  "vacheron overseas",
  "lange 1",
  "panerai pam 372",
  "richard mille rm 011",
  "hermes clic clac",
  "le vian chocolate diamond",
  "harry winston cluster",
  "10k white gold",
  "585 ring",
  "18 karat",
  "18 carat gold",
  "24k pure gold",
  "999 gold",
  "two tone gold",
  "tri color gold",
  "tt gold ring",
  "Everose 40mm",
  "rolesor datejust",
  "sedna gold",
  "gold plated chain",
  "gp chain",
  "vermeil hoops",
  "silver tone brooch",
  "gold tone",
  "base metal",
  "carat total weight",
  "ct",
  "3 carats",
  "half carat",
  "quarter carat",
  "50 pointer",
  "dwt",
  "5 dwt",
  "10 grams",
  "troy oz",
  "appraisal value",
  "with appraisal",
  "keystone",
  "on memo",
  "in the case",
  "scrap gold",
  "as is",
  "NOS",
  "BNIB",
  "mint",
  "polish and clean",
  "p&c",
  "ultrasonic",
  "retip",
  "re-rhod",
  "rhodium dip",
  "sizing beads",
  "resize",
  "size up",
  "laser weld",
  "restring",
  "spring bar",
  "deployant",
  "deployment clasp",
  "tang buckle",
  "nato",
  "hallmark",
  "maker's mark",
  "assay",
  "touchstone",
  "sweeps",
  "findings",
  "goods",
  "fine make",
  "commercial grade",
  "eye clean",
  "loupe clean",
  "circa 1920",
  "ca 1920",
  "c. 1890",
  "cal. 3135",
  "victorian",
  "edwardian",
  "belle epoque",
  "georgian",
  "retro",
  "mid century",
  "mcm",
  "modernist",
  "brutalist",
  "1970s",
  "1980s",
  "arts and crafts",
  "etruscan revival",
  "mourning ring",
  "memento mori",
  "hair jewelry",
  "jet brooch",
  "french jet",
  "vintage",
  "antique",
  "vtg",
  "repro",
  "reproduction",
  "art deco style",
  "deco ring",
  "deco",
  "jewellery",
  "colour",
  "grey",
  "centre stone",
  "Type A jadeite bangle",
  "jadeite",
  "nephrite",
  "new jade",
  "turquoise",
  "sleeping beauty turquoise",
  "block turquoise",
  "lapis",
  "lapis lazuli",
  "onyx",
  "black onyx",
  "carnelian",
  "sardonyx",
  "moonstone",
  "labradorite",
  "iolite",
  "water sapphire",
  "oriental emerald",
  "balas ruby",
  "kunzite",
  "apatite",
  "sphene",
  "benitoite",
  "larimar",
  "malachite",
  "coral",
  "angel skin coral",
  "amber",
  "copal",
  "hematite",
  "marcasite",
  "pyrite",
  "paste brooch",
  "georgian paste",
  "rhinestone",
  "swarovski crystal",
  "austrian crystal",
  "cameo",
  "shell cameo",
  "hardstone cameo",
  "intaglio",
  "micromosaic",
  "scarab",
  "birthstone",
  "semi precious",
  "gems",
  "gemstones",
  "multi gem",
  "tutti frutti",
  "south sea",
  "south sea pearl",
  "golden south sea",
  "tahitian",
  "tahitian pearl",
  "akoya",
  "freshwater",
  "fw pearls",
  "keshi",
  "baroque pearl",
  "seed pearl",
  "biwa",
  "conch pearl",
  "natural pearl",
  "imitation pearl",
  "majorica",
  "hanadama",
  "pearls",
  "pearl",
  "mikimoto",
  "strand of pearls",
  "opera length",
  "rope length pearls",
  "matinee",
  "collar",
  "choker",
  "lariat",
  "y necklace",
  "bib",
  "torsade",
  "sautoir",
  "negligee necklace",
  "lavaliere",
  "festoon",
  "graduated",
  "multi strand",
  "locket",
  "slide pendant",
  "charm holder",
  "dog tag",
  "cross",
  "crucifix",
  "star of david",
  "hamsa",
  "evil eye",
  "miraculous medal",
  "cuff",
  "cuff bracelet",
  "bangle",
  "bangles",
  "hinged bangle",
  "charm bracelet",
  "id bracelet",
  "bolo bracelet",
  "slide bracelet",
  "anklet",
  "ankle bracelet",
  "hand chain",
  "slave bracelet",
  "buckle bracelet",
  "watch band",
  "belly ring",
  "nose stud",
  "toe ring",
  "brooch",
  "broach",
  "bar pin",
  "stick pin",
  "stickpin",
  "hat pin",
  "lapel pin",
  "tie tack",
  "tie tac",
  "tie pin",
  "tie bar",
  "tie clip",
  "cufflinks",
  "cuff links",
  "dress clip",
  "fur clip",
  "duette",
  "fibula",
  "money clip",
  "key fob",
  "collar bar",
  "chatelaine",
  "compact",
  "cigarette case",
  "round brilliant",
  "RBC",
  "rnd",
  "old euro",
  "transitional",
  "old cut",
  "rose cut",
  "single cut",
  "swiss cut",
  "8/8 cut",
  "oval",
  "oval cut",
  "pear",
  "pear shaped",
  "teardrop diamond",
  "marquise",
  "navette",
  "heart shaped",
  "trillion",
  "trilliant",
  "baguette",
  "baguettes",
  "tapered baguette",
  "half moon",
  "trapezoid",
  "shield cut",
  "kite cut",
  "hexagon",
  "bullet",
  "french cut",
  "portrait cut",
  "checkerboard",
  "briolette",
  "cabochon",
  "cab",
  "sugarloaf",
  "buff top",
  "concave cut",
  "rose de france",
  "moval",
  "step cut",
  "mixed cut",
  "fancy shape",
  "hearts and arrows",
  "H&A",
  "triple ex",
  "3x",
  "ideal cut",
  "prong",
  "4 prong",
  "six prong",
  "double prong",
  "shared prong",
  "v prong",
  "half bezel",
  "channel set",
  "bar set",
  "bead set",
  "grain set",
  "bright cut",
  "flush set",
  "gypsy set",
  "gypsy ring",
  "tension set",
  "invisible set",
  "mystery set",
  "illusion setting",
  "halo",
  "hidden halo",
  "double halo",
  "cathedral",
  "trellis",
  "basket",
  "knife edge",
  "comfort fit",
  "filigree",
  "openwork",
  "engraved",
  "hand engraved",
  "chased",
  "repousse",
  "granulation",
  "cannetille",
  "enamel",
  "cloisonne",
  "champleve",
  "plique a jour",
  "guilloche",
  "basse-taille",
  "niello",
  "mokume gane",
  "pietra dura",
  "bail",
  "jump ring",
  "lobster clasp",
  "spring ring",
  "bolt ring",
  "toggle",
  "box clasp",
  "fishhook clasp",
  "barrel clasp",
  "magnetic clasp",
  "s hook",
  "safety chain",
  "figure 8",
  "hidden clasp",
  "extender",
  "post",
  "butterfly back",
  "friction back",
  "la pousette",
  "screw back",
  "lever back",
  "leverback",
  "french wire",
  "fishhook earrings",
  "omega back",
  "clip on",
  "clip-on",
  "shank",
  "head",
  "peg head",
  "semi mount",
  "mounting",
  "center stone",
  "side stones",
  "accent stones",
  "melee",
  "melle",
  "titanium",
  "tungsten",
  "tungsten carbide",
  "cobalt",
  "zirconium",
  "ceramic ring",
  "damascus",
  "carbon fiber",
  "meteorite ring",
  "surgical steel",
  "316L",
  "palladium",
  "pd950",
  "platinum",
  "plat",
  "pt",
  "plt",
  "pt 950",
  "plat/irid",
  "black hills gold",
  "green gold",
  "black gold",
  "purple gold",
  "red gold",
  "pink gold",
  "yel gold",
  "wht gold",
  "14ky",
  "14kw",
  "14kr",
  "18kt",
  "18 kt",
  "18k gold",
  "karat gold",
  "375",
  "417",
  "916",
  "950",
  "999",
  "925",
  ".925",
  "sterling",
  "ster",
  "stg silver",
  "fine silver",
  "coin silver",
  "german silver",
  "nickel silver",
  "silver plated",
  "EPNS",
  "gf",
  "1/20 12k gf",
  "rolled gold",
  "rgp",
  "hge",
  "electroplated",
  "pvd",
  "ion plated",
  "plumb gold",
  "solid gold",
  "real gold",
  "automatic",
  "auto",
  "manual wind",
  "hand wound",
  "chrono",
  "chronograph",
  "chronometer",
  "cosc",
  "moonphase",
  "perpetual calendar",
  "annual calendar",
  "tourbillon",
  "minute repeater",
  "dive watch",
  "diver",
  "dress watch",
  "pilot watch",
  "flieger",
  "field watch",
  "sports watch",
  "wristwatch",
  "pocket watch",
  "hunter case",
  "ladies watch",
  "cocktail watch",
  "midsize",
  "head only",
  "jubilee",
  "oyster bracelet",
  "president bracelet",
  "presidential",
  "day date",
  "leather strap",
  "rubber strap",
  "oysterflex",
  "integrated bracelet",
  "case size",
  "lug to lug",
  "lug width",
  "caseback",
  "exhibition back",
  "subdials",
  "diamond bezel",
  "diamond dial",
  "factory diamonds",
  "aftermarket diamonds",
  "iced out",
  "bust down",
  "tropical dial",
  "gilt dial",
  "meteorite dial",
  "ref 116610",
  "reference 5711",
  "serviced",
  "unpolished",
  "polished case",
  "water resistant",
  "wr 300m",
  "sapphire crystal",
  "acrylic crystal",
  "plexi",
  "mineral crystal",
  "cyclops",
  "lume",
  "superluminova",
  "power reserve",
  "caliber 3235",
  "17 jewels",
  "17j",
  "hacking",
  "jump hour",
  "worldtimer",
  "skeleton",
  "small seconds",
  "big date",
  "gmt function",
  "cerachrom",
  "aluminum bezel",
  "fluted bezel",
  "smooth bezel",
  "rotating bezel",
  "tachymeter",
  "submariner",
  "sub",
  "no date sub",
  "daytona",
  "datejust",
  "gmt master ii",
  "gmt master",
  "yachtmaster",
  "sea dweller",
  "deepsea",
  "air king",
  "oyster perpetual",
  "op41",
  "explorer ii",
  "explorer",
  "batman",
  "hulk",
  "kermit",
  "smurf",
  "root beer",
  "coke",
  "sprite",
  "bluesy",
  "panda dial",
  "reverse panda",
  "seamaster",
  "smp",
  "aqua terra",
  "planet ocean",
  "constellation",
  "royal oak",
  "royal oak offshore",
  "roo",
  "nautilus",
  "aquanaut",
  "calatrava",
  "tank",
  "santos",
  "ballon bleu",
  "pasha",
  "juste un clou",
  "juc",
  "panthere",
  "perlee",
  "return to tiffany",
  "rtt",
  "tiffany t",
  "hardwear",
  "peretti",
  "paloma picasso",
  "schlumberger",
  "lagos caviar",
  "albion",
  "hearts on fire",
  "hof",
  "levian",
  "buccellati",
  "roberto coin",
  "marco bicego",
  "john hardy",
  "david webb",
  "georg jensen",
  "louis vuitton",
  "verragio",
  "tacori",
  "lazare kaplan",
  "bb&b",
  "black starr & frost",
  "shreve crump & low",
  "je caldwell",
  "marcus & co",
  "seaman schepps",
  "raymond yard",
  "mauboussin",
  "boucheron",
  "chaumet",
  "graff",
  "chopard",
  "piaget",
  "pomellato",
  "ippolita",
  "judith ripka",
  "kwiat",
  "forevermark",
  "pandora charm",
  "tudor black bay",
  "tudor bb58",
  "breitling",
  "brietling",
  "iwc",
  "longines",
  "movado",
  "bulova",
  "hamilton khaki",
  "tissot",
  "oris",
  "baume mercier",
  "franck muller",
  "girard perregaux",
  "glashutte",
  "bell & ross",
  "ulysse nardin",
  "raymond weil",
  "patek",
  "patek nautilus",
  "vca",
  "t&co",
  "tiffany",
  "tiffanys",
  "cartier",
  "rolex",
  "rollie",
  "omega",
  "omega watch",
  "bvlgari",
  "tag heuer",
  "tag carrera",
  "yurman",
  "custom order",
  "bespoke",
  "special order",
  "take in",
  "at the bench",
  "in the shop",
  "quoted",
  "cost",
  "at cost",
  "wholesale",
  "triple key",
  "obo",
  "wtb",
  "iso",
  "looking for",
  "fs",
  "nfs",
  "trade in",
  "approx 2ct",
  "~2ct",
  "about 1 carat",
  "pr of studs",
  "pair of earrings",
  "ea",
  "qty 2",
  "w/o center stone",
  "without stone",
  "w dias",
  "budget 5000",
  "budget $5,000",
  "under $3k",
  "max 2000",
  "men's band",
  "mens ring",
  "gents ring",
  "ladies ring",
  "women's",
  "unisex",
  "pinky ring",
  "signet",
  "crest ring",
  "midi ring",
  "mother's ring",
  "class ring",
  "dome ring",
  "bombe ring",
  "cigar band",
  "wide band",
  "cluster ring",
  "bypass ring",
  "crossover",
  "solitaire",
  "promise ring",
  "contour band",
  "curved band",
  "shadow band",
  "ring wrap",
  "ring guard",
  "ring jacket",
  "enhancer",
  "pendant enhancer",
  "wedding band",
  "wedding ring",
  "wb",
  "bridal set",
  "wedding set",
  "anniversary band",
  "stackable ring",
  "stacking rings",
  "stacker",
  "claddagh",
  "cladagh",
  "toi et moi",
  "moi et toi",
  "two stone ring",
  "3-stone",
  "five stone",
  "cocktail ring",
  "dinner ring",
  "right hand ring",
  "rhr",
  "statement ring",
];

test("brands written one way but SAID another resolve on the request side", () => {
  // enewton is written as one word and pronounced "e newton". Staff type what
  // they say, so "silver e newton" previously embedded as the unrelated words
  // "e" and "newton" and returned nothing from a catalog that stocks the brand.
  assert.match(req("silver e newton"), /enewton/);
  assert.match(req("E Newton bracelet"), /enewton/);
  assert.match(req("e-newton"), /enewton/);
  // Already correct — must not double-rewrite.
  assert.equal(req("enewton classic"), "enewton classic");
  // Listings already spell it correctly; product text must be untouched.
  assert.equal(prod("enewton classic bracelet"), "enewton classic bracelet");
  assert.equal(prod("E Newton Design necklace"), "E Newton Design necklace");
});

test("request normalization is idempotent over the corpus", () => {
  const failures = [];
  for (const s of CORPUS) {
    const once = req(s);
    const twice = req(once);
    if (once !== twice) failures.push({ s, once, twice });
  }
  assert.deepEqual(failures, [], JSON.stringify(failures, null, 2));
});

test("product normalization is idempotent over the corpus", () => {
  const failures = [];
  for (const s of CORPUS) {
    const once = prod(s);
    const twice = prod(once);
    if (once !== twice) failures.push({ s, once, twice });
  }
  assert.deepEqual(failures, [], JSON.stringify(failures, null, 2));
});

test("no both-scope rule re-fires on any both-scope canonical (static self-collision check)", () => {
  const both = EQUIVALENTS.filter((e) => (e.scope || "both") === "both");
  const failures = [];
  for (const a of both) {
    // Canonicals containing $-substitutions can't be statically checked; skip them.
    if (/\$/.test(a.to)) continue;
    const out = normalizeTerms(a.to, "product");
    if (out !== a.to) failures.push({ to: a.to, becomes: out });
  }
  assert.deepEqual(failures, [], JSON.stringify(failures, null, 2));
});

test("product scope never applies request-only rules (SS stays SS on product text)", () => {
  // The point of this test is that "SS" is NOT expanded on product text, where
  // it means stainless steel. "diver" is no longer rewritten on the product
  // side either: §2 vocabulary is request-only, because applying watch/style
  // vocabulary to a merchant's own listing corrupted 95% of a real catalog
  // (e.g. "Band Width" on RINGS became "lug width"). See .hermes/jewelry-terms-review.md.
  assert.equal(prod("Seiko SS Diver 200m"), "Seiko SS Diver 200m");
  assert.equal(prod("Ladies GS Ring"), "Ladies GS Ring");
  assert.equal(prod("14K WG Ring"), "14K WG Ring");
  assert.equal(prod("Tiffany setting"), "Tiffany setting");
  assert.equal(prod("18ct gold ring"), "18ct gold ring");
});

test("product scope with collapse:false is byte-identical when nothing matches", () => {
  const s = "  Some   product\n\ttext with   14K WG  ";
  assert.equal(normalizeProductTerms(s, { collapse: false }), s);
});

test("hard gates — natural vs lab, simulant vs diamond, brand nickname vs generic style", () => {
  // lab-grown stays qualified
  assert.match(req("lg diamond 2ct"), /lab grown diamond/);
  assert.match(req("cvd 2ct"), /lab grown/);
  assert.match(req("cultured diamond"), /lab grown diamond/);
  assert.doesNotMatch(req("cultured pearl"), /lab grown/);
  // HPHT-treated is a treatment, not origin
  assert.match(req("hpht treated"), /color treated/);
  assert.doesNotMatch(req("hpht treated"), /lab grown/);
  // simulants never become diamond
  assert.doesNotMatch(req("cz studs"), /\bdiamond\b/);
  assert.doesNotMatch(req("moissy"), /\bdiamond\b/);
  assert.equal(req("herkimer diamond"), "herkimer quartz");
  assert.equal(prod("Herkimer Diamond Pendant"), "herkimer quartz Pendant");
  // Tiffany setting is not the brand
  assert.equal(req("tiffany setting solitaire"), "six-prong solitaire setting solitaire");
  assert.doesNotMatch(req("tiffany style ring"), /Tiffany & Co/);
  assert.match(req("tiffany ring"), /Tiffany & Co\./);
  // Gucci link is a chain
  assert.equal(req("gucci link"), "mariner chain");
  // SS by a watch is steel; alone is sterling; before pearl is South Sea
  assert.match(req("ss rolex"), /stainless steel Rolex/);
  assert.match(req("rolex ss"), /Rolex stainless steel/);
  assert.equal(req("ss ring"), "sterling silver ring");
  assert.match(req("ss pearl"), /South Sea pearl/);
  // Trinity: Cartier only when Cartier is named
  assert.match(req("cartier trinity"), /Cartier Trinity ring/);
  assert.equal(req("trinity ring"), "three-stone ring");
  // Love bracelet only branded when Cartier named
  assert.doesNotMatch(req("love bracelet"), /Cartier/);
  assert.match(req("cartier love bracelet"), /Cartier Love bracelet/);
  // Yard brand must not eat "by the yard"
  assert.equal(req("diamonds by the yard"), "diamond station");
  assert.doesNotMatch(req("sapphire by the yard"), /Raymond Yard/);
  // quartz stone vs quartz movement
  assert.equal(req("rose quartz cabochon"), "rose quartz cabochon");
  assert.equal(req("quartz movement"), "quartz movement");
  // omega
  assert.equal(req("omega chain"), "omega chain");
  assert.equal(req("omega watch"), "Omega watch");
  // Tudor watch vs era untouched
  assert.match(req("tudor black bay"), /Tudor/);
  // zircon ≠ zirconia
  assert.equal(req("blue zircon"), "blue zircon");
  assert.doesNotMatch(req("blue zircon"), /cubic/);
  // seiko vs grand seiko
  assert.equal(req("seiko 5"), "seiko 5");
  assert.equal(req("gs"), "Grand Seiko");
});

test("karat vs carat disambiguation", () => {
  assert.equal(req("18ct yg"), "18k yellow gold");
  assert.equal(req("9ct rose gold"), "9k rose gold");
  assert.equal(req("18 carat gold"), "18k gold");
  assert.equal(req("2ct diamond"), "2 carat diamond");
  assert.equal(req("0.18ct diamond"), "0.18 carat diamond");
  assert.equal(req("2.18 ct pear"), "2.18 carat pear shape");
  assert.equal(req("1 1/2 ct"), "1.5 carat");
  assert.equal(req("3cttw"), "3 carat total weight");
  assert.equal(req("2 ct tw"), "2 carat total weight");
  assert.equal(req("18ct tw"), "18 carat total weight");
  assert.equal(req("14kwg"), "14k white gold");
  assert.equal(req("14KYG"), "14k yellow gold");
  assert.equal(req("14kw"), "14k white gold");
  assert.equal(req("14k w/ dias"), "14k with diamond");
  assert.equal(req("14k w/g"), "14k white gold");
  assert.equal(req("585"), "14k");
  assert.equal(req("750 gold"), "18k gold");
  assert.equal(req("$750"), "$750");
  assert.equal(req("1.750"), "1.750");
  assert.equal(req("14k gold"), "14k gold");
  assert.equal(req("14kp"), "14k plumb gold");
  assert.equal(req("25 pt"), "25 points");
  assert.equal(req("pt 950"), "platinum");
  assert.equal(req("pt950"), "platinum");
  assert.equal(req("plat"), "platinum");
  assert.equal(req("size 6 1/2"), "size 6.5");
  assert.equal(req("sz 7"), "size 7");
});

test("common abbreviations expand", () => {
  assert.equal(req("14k WG dia eng ring emerald cut"), "14k white gold diamond engagement ring emerald cut");
  assert.equal(req("18ct YG sapph cluster"), "18k yellow gold sapphire cluster");
  assert.equal(req("9ct rose gold morganite halo"), "9k rose gold morganite halo");
  assert.equal(req("omc"), "old mine cut");
  assert.equal(req("oec"), "old european cut");
  assert.equal(req("rbc"), "round brilliant cut");
  assert.equal(req("e-ring"), "engagement ring");
  assert.equal(req("engagement"), "engagement ring");
  assert.equal(req("engagement ring"), "engagement ring");
  assert.equal(req("earrings"), "earrings");
  assert.equal(req("ear rings"), "earrings");
  assert.equal(req("hoops"), "hoop earrings");
  assert.equal(req("huggies"), "huggie earrings");
  assert.equal(req("studs"), "stud earrings");
  assert.equal(req("shirt studs"), "shirt studs");
  assert.equal(req("cuff links"), "cufflinks");
  assert.equal(req("tennis"), "tennis bracelet");
  assert.equal(req("tennis necklace"), "tennis necklace");
  assert.equal(req("claw set"), "prong set");
  assert.equal(req("rub over"), "bezel set");
  assert.equal(req("belcher chain"), "rolo chain");
  assert.equal(req("trace chain"), "cable chain");
  assert.equal(req("mop"), "mother of pearl");
  assert.equal(req("fw pearls"), "freshwater pearl");
  assert.equal(req("akoya"), "Akoya pearl");
  assert.equal(req("mabe"), "mabé pearl");
  assert.equal(req("smoky topaz"), "smoky quartz");
  assert.equal(req("green amethyst"), "prasiolite");
  assert.equal(req("water sapphire"), "iolite");
  assert.equal(req("navette"), "marquise");
  assert.equal(req("trilliant"), "trillion");
  assert.equal(req("bags"), "baguette");
  assert.equal(req("cab"), "cabochon");
  assert.equal(req("millgrain"), "milgrain");
  assert.equal(req("pave"), "pavé");
  assert.equal(req("micro pave"), "micro-pavé");
  assert.equal(req("pre-owned"), "estate");
  assert.equal(req("vtg"), "vintage");
  assert.equal(req("deco"), "Art Deco");
  assert.equal(req("art deco style"), "vintage-inspired");
  assert.equal(req("c. 1890"), "circa 1890");
  assert.equal(req("cal. 3135"), "caliber 3135");
  assert.equal(req("speedy"), "Speedmaster Professional");
  assert.equal(req("dj41"), "Datejust 41");
  assert.equal(req("pepsi gmt"), "GMT-Master II red and blue bezel");
  assert.equal(req("gmt master ii"), "GMT-Master II");
  assert.equal(req("patek nautilus"), "Patek Philippe Nautilus");
  assert.equal(req("nautilus"), "Patek Philippe Nautilus");
  assert.equal(req("patek"), "Patek Philippe");
  assert.equal(req("vca alhambra"), "Van Cleef & Arpels Alhambra");
  assert.equal(req("alhambra"), "Van Cleef & Arpels Alhambra");
  assert.equal(req("tiffany & co bean pendant"), "Tiffany & Co. Elsa Peretti");
  assert.equal(req("bulgari serpenti"), "Bvlgari Serpenti");
  assert.equal(req("cable bracelet yurman"), "David Yurman Cable David Yurman");
  assert.equal(req("tudor bb58"), "Tudor Black Bay 58");
  assert.equal(req("jlc"), "Jaeger-LeCoultre");
  assert.equal(req("vca"), "Van Cleef & Arpels");
  assert.equal(req("t&co"), "Tiffany & Co.");
  assert.equal(req("jewellery"), "jewelry");
  assert.equal(req("colour"), "color");
  assert.equal(req("riviere"), "riviera");
  assert.equal(req("rolesor"), "two-tone");
  assert.equal(req("everose"), "rose gold");
  assert.equal(req("gf"), "gold filled");
  assert.equal(req("hge"), "gold plated");
  assert.equal(req("dwt"), "pennyweight");
  assert.equal(req("nos"), "new old stock");
  assert.equal(req("p&c"), "polish and clean");
  assert.equal(req("re-rhod"), "rhodium plated");
  assert.equal(req("retip"), "re-tip");
});

test("RELATED_TERMS shape and no self-pairs", () => {
  for (const r of RELATED_TERMS) {
    assert.ok(Array.isArray(r.terms) && r.terms.length >= 2, JSON.stringify(r));
    assert.notEqual(r.terms[0], r.terms[1], JSON.stringify(r));
    for (const t of r.terms) assert.equal(typeof t, "string");
  }
});

test("RELATED_TERMS never pair across hard gates by rewriting (terms are stable under normalize)", () => {
  // Terms are canonical forms; product-scope normalization must leave them alone.
  const failures = [];
  for (const r of RELATED_TERMS) {
    for (const t of r.terms) {
      const out = prod(t);
      if (out !== t) failures.push({ t, out });
    }
  }
  assert.deepEqual(failures, [], JSON.stringify(failures, null, 2));
});

test("REGRESSION: Batman and Batgirl never normalize to the same text", () => {
  // Same reference (126710BLNR), same blue/black bezel. The BRACELET is the
  // only difference: Oyster = Batman, Jubilee = Batgirl. Collapsing them made
  // each a confident false match for the other — reported from the shop floor
  // after a Batgirl request matched an Oyster-bracelet Batman at score 89.
  const batman = normalizeRequestTerms("Mens rolex GMT-MASTER II 126710BLNR BATMAN");
  const batgirl = normalizeRequestTerms("Mens rolex GMT-MASTER II 126710BLNR BATGIRL");

  assert.notEqual(batman, batgirl, "Batman and Batgirl must not normalize identically");
  assert.match(batman, /Oyster bracelet/i);
  assert.match(batgirl, /Jubilee bracelet/i);
  assert.doesNotMatch(batman, /Jubilee/i);
  assert.doesNotMatch(batgirl, /Oyster/i);

  // Both still resolve the shared bezel, so neither loses real signal.
  for (const s of [batman, batgirl]) assert.match(s, /blue and black bezel/i);
});

test("other GMT bezel nicknames still resolve", () => {
  assert.match(normalizeRequestTerms("pepsi gmt"), /red and blue bezel/i);
  assert.match(normalizeRequestTerms("coke bezel"), /red and black bezel/i);
});
