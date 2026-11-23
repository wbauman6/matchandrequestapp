# Jewelry vocabulary — glossary & audit sheet

Companion to `app/lib/jewelryTerms.js`. Every rule there is grouped and explained here so a human can audit it; terms that have **no variant spelling** (clarity grades, era dates, most shop slang) live *only* here — they need no rewrite rule.

Notation: **→ canonical** = rewritten (Category 1). **~** = related-but-distinct (Category 2, never rewritten). **[req]** = request-only rewrite; **[both]** = also rewrites product text. Unmarked rewrites are `[both]`.

Sources used throughout: FTC *Guides for the Jewelry, Precious Metals, and Pewter Industries*, 16 CFR Part 23 (2018 rev.) — <https://www.ecfr.gov/current/title-16/chapter-I/subchapter-B/part-23>; GIA *Diamond Grading* and *Gem Encyclopedia* — <https://www.gia.edu/gem-encyclopedia>; CIBJO *Blue Books* (Diamond, Coloured Stone, Pearl) — <https://www.cibjo.org/blue-books/>; UK Hallmarking Act 1973 / Assay Office guidance — <https://www.assayofficelondon.co.uk/hallmarking/>; AGS/GIA cut grading; period definitions per the Antique Jewelry University (Lang Antiques) — <https://www.langantiques.com/university/>.

---

## 0. Collision table — terms with more than one trade meaning

These are the entries most likely to bite. Each row states the ambiguity and how the file resolves it.

| Term | Meaning A | Meaning B | Handling |
|---|---|---|---|
| **SS** | sterling silver (jeweler) | stainless steel (watch trade) | `[req]` → stainless steel when adjacent to a watch word (Rolex, Omega, sub, GMT, Datejust, "watch"…); → South Sea before "pearl/strand"; otherwise → sterling silver. **Never** touched in product text. |
| **GS** | Grand Seiko | plain Seiko in product text; also "gem set" | `[req]` → Grand Seiko. Product text untouched. |
| **ct / CT** | carat (stone weight) | karat (UK: "18ct gold") | digit + ct + **no** tw/gold → *N carat*. digit-in-karat-set (9,10,12,14,15,18,22,24) + ct/kt/carat/karat → *Nk*. `18ct tw` stays carat. |
| **carat gold** | UK karat | — | "18 carat gold" → *18k gold*. |
| **pt / PT** | platinum | points (1/100 ct) | `N pt` where N ≤ 99 and not followed by 950/900/850 → *N points* (runs first). Everything else → platinum. |
| **AP** | Audemars Piguet | "appraisal", "as per" | → Audemars Piguet only before royal/watch/5-digit ref/end of clause. |
| **TW** | total weight | Tiffany "T Wire" | `N tw` → carat total weight; "t wire" with Tiffany in-text → Tiffany T. |
| **baguette** | the step cut | the bread (irrelevant) | Always the cut. |
| **rose** | rose gold, rose cut, rose quartz, rose de France | — | Longest phrase wins: *rose de France* → amethyst; *rose cut* → cut; *rose quartz* → stone; bare "rose gold" untouched. Bare "rose" alone is left. |
| **emerald** | the stone | emerald *cut* | "emerald cut / em cut / emerald shape" → cut; bare "emerald(s)" → stone. |
| **princess** | princess cut | princess-length strand (17–19") | "princess length/strand/necklace" → strand; else → cut. |
| **cushion** | modern cushion cut | antique cushion (= old mine) | "antique/old/vintage cushion" → *antique cushion cut*; "elongated cushion" kept; bare "cushion" → *cushion cut* unless followed by halo/setting/ring/stone etc. |
| **tennis** | tennis bracelet | tennis necklace/earrings | Bare "tennis" → bracelet `[req]`; "tennis necklace" etc. untouched. |
| **Tiffany** | the brand | Tiffany *setting* (generic six-prong head) | "tiffany setting/style/mount/head" → *six-prong solitaire setting* first; remaining "tiffany" → brand. |
| **trinity** | Cartier Trinity (rolling ring) | three-stone ("trilogy") | → Cartier Trinity only when "cartier" is in the text; else → three-stone. |
| **love bracelet** | Cartier Love | generic | Branded only when "cartier" is in the text. |
| **cable** | David Yurman Cable | cable chain; generic cable cuff | → DY only when "yurman" in text; "cable chain" → chain; "cable bracelet/cuff" → generic. |
| **omega** | Omega watches | omega chain / omega back (earring) | Chain and back rules run first; "omega" → brand only before watch/model words. |
| **tank** | Cartier Tank | — | Only before louis/francaise/solo/must/watch/cartier or end of clause. |
| **jubilee / oyster / president** | Rolex bracelets | jubilee (anniversary), oyster (shell) | Bracelet reading only next to bracelet/band/Rolex/model words. |
| **quartz** | the stone (rose, smoky, rutilated, rock crystal) | quartz *movement* | "quartz movement/watch/battery" → *quartz movement* `[both]`; stone phrases handled by name. Bare "quartz" untouched. |
| **crystal** | sapphire/acrylic/mineral crystal (watch glass) | Swarovski/Austrian "crystal" (glass) | Watch glass phrases named explicitly; "swarovski/austrian/german crystal" → *crystal* (glass, not a gem). |
| **sapphire crystal** | watch glass | — | Kept as phrase; **not** the gemstone. |
| **zircon vs zirconia** | natural zircon (gem) | cubic zirconia (simulant) | Never merged. "blue zircon" stays; "cz/zirconia" → cubic zirconia. |
| **zirconium** | the metal (black rings) | — | Never merged with zirconia. |
| **cultured** | cultured *pearl* (legit) | "cultured diamond" (FTC: misleading) | "cultured diamond" → *lab grown diamond* `[req]`; "cultured pearl" kept. |
| **synthetic** | = lab-grown (FTC-legal) | colloquially "fake" | → *lab grown* `[req]`. Never → simulant. |
| **created / man-made / grown** | lab-grown | — | → *lab grown* `[req]`. |
| **HPHT** | growth method (lab) | treatment of natural diamond | "hpht grown/cvd" → lab grown; "hpht treated/processed" → *color treated*. |
| **white sapphire / white topaz** | natural colorless gems | sold as diamond alternatives | Kept as their own species; related to each other ~, **never** to diamond. |
| **estate / vintage / antique** | see §9 | — | "pre-owned/used/second-hand" → *estate* `[req]`. antique ~ vintage ~ estate are Category 2 only. |
| **Tudor** | the watch brand | the era (1485–1603) | Brand only before black bay/pelagos/watch/ref. Era is not a jewelry period in trade use. |
| **Retro** | 1935–50 period | "retro" adjective | → Retro only before ring/era/style/bracelet/gold or end of clause. |
| **deco** | Art Deco | — | Only before ring/era/style/etc. |
| **1920s / 1930s** | Art Deco | — | → Art Deco (date range collapses to era). |
| **half moon** | side-stone shape | — | Unambiguous in trade. |
| **head** | setting head (prong basket) | watch head (case w/o bracelet) | "peg/setting/solitaire head" → *setting head*; "watch head / head only" → *watch head only*. Bare "head" left alone. |
| **size** | US numeric ring size | UK letter size / EU size | `size 6.5` numeric; `size M` / `uk size M` → *UK size M*; `eu 52` → *EU size 52*. Never converted between systems. |
| **mm** | millimeters (stone/case) | momme (pearl weight, Japanese) | Only "momme" spelled out → momme. |
| **grain** | pearl weight (¼ ct) | troy grain | Only before pearl/weight → *grain*. |
| **jet** | the gemstone (fossil wood) | "French jet" (black glass) | "french jet / vauxhall glass" → *black glass*. |
| **marcasite** | jewelry marcasite (actually pyrite) | mineral marcasite | Trade term wins: "pyrite / fool's gold" → *marcasite*. |
| **paste** | Georgian leaded glass | glue | Only before stones/jewelry/brooch etc. |
| **enhancer** | ring enhancer (band wrap) | pendant/pearl enhancer | Distinguished by adjacent noun. |
| **cuff** | cuff bracelet | ear cuff; cufflinks | "ear cuff" and "cuff links" run first. |
| **stud** | stud earrings | shirt/tuxedo studs | "shirt/tux/dress studs" run first. |
| **band** | wedding band; watch band | — | "watch band/strap" → watch band; else band. |
| **halo** | the setting | "hidden/double halo" | Longest phrase first. |
| **Chocolate Diamonds®** | Le Vian trademark | brown diamond | → *brown diamond* (the stone); "Le Vian" → brand separately. |
| **Mystery Set™** | VCA trademark | invisible setting (generic) | → *invisible set* (technique). |

---

## 1. Metals & alloys

### Karat & fineness → `Nk` [req]

| Input | → | Note |
|---|---|---|
| 9ct, 9 carat, 9k, 9kt, 375 | 9k | UK/Australia minimum legal gold (Hallmarking Act 1973) |
| 10k, 417 | 10k | US minimum to be called "gold" (FTC §23.4) |
| 12k, 500 | 12k | rare; Victorian-era |
| 14k, 14kt, 585 | 14k | 58.5% — US default |
| 15ct, 625 | 15k | UK standard discontinued 1932; dates a piece pre-1932 |
| 18k, 18ct, 750 | 18k | 75% |
| 22k, 916 | 22k | Indian/Middle-East standard |
| 24k, 999, 999.9, "chuk kam" | 24k | pure; "chuk kam" = Cantonese 足金 |
| 14KP | 14k plumb gold | **P = plumb (exact karat), NOT plated** — common misread |
| 14kw / 14kwg / 14k w | 14k white gold | letter suffixes |
| 14ky / 14kyg | 14k yellow gold | |
| 14kr / 14krg / 14kpg | 14k rose gold | |
| 14ktt | 14k two-tone | |

Bare fineness numbers (585/750/375/417/916) are rewritten only when not part of a decimal or price (`$750`, `1.750` untouched). Product text is never rewritten — a SKU can contain these numbers.

### Metal colors

| Input | → | Note |
|---|---|---|
| wg, w/g, wht gold, white g | white gold [req] | |
| yg, y/g, yel gold | yellow gold [req] | |
| rg, r/g, pg, pink gold, red gold, russian gold, copper gold | rose gold [req] | all one color family (higher copper = redder); **color is a hard gate** |
| Everose (Rolex), Sedna (Omega), King Gold (Hublot) | rose gold | proprietary alloy names |
| Honeygold (Lange) | yellow gold [req] | |
| Canopus / Moonshine gold (Omega) | white gold [req] | |
| green gold, electrum | green gold | pale-green Au-Ag alloy; **not** yellow — gate applies |
| black gold | black rhodium | always a surface treatment on white gold |
| purple / blue / amethyst gold | colored gold alloy | intermetallic novelty; brittle |
| two tone, 2-tone, bicolor, TT, 2T, Rolesor (Rolex) | two-tone | |
| tri-color, tricolor, three-tone, 3T, tri-gold | tri-color | |
| palladium white gold, Pd white gold, nickel-free | white gold | alloy detail only |
| Black Hills gold, BHG | Black Hills gold | tri-color leaf motif; must be made in Black Hills SD (court-protected origin) |

### Platinum group

| Input | → |
|---|---|
| plat, plt, PT, pt950/900/850, platinum 950, plat/irid, platinum-iridium, platinum-ruthenium, platinum-cobalt | platinum |
| plat/gold, platinum & 18k | platinum and gold two-tone |
| palladium, pd, pd950, pd500 | palladium |

FTC §23.7: "platinum" unqualified requires ≥950 ppt; 850–950 must be marked (e.g. "900 Plat"). Alloy suffix (irid/ruth/cobalt) does not change the matcher's metal type.

### Silver

| Input | → | Note |
|---|---|---|
| sterling, ster, stg, stlg, st silver, 925, .925, 925 silver, solid/real/genuine silver | sterling silver | 92.5% |
| fine silver, 999 silver, pure silver | fine silver | |
| coin silver, 800/830/835/900 silver, continental silver | coin silver | sub-sterling European standards |
| nickel silver, German silver, alpaca, new silver | nickel silver | **contains no silver** (Cu-Ni-Zn) |
| silver tone, silver plated, EPNS, SP (brooch/bracelet) | silver tone | not sterling |

### Non-solid gold (all fail a "gold" request — see Related §)

| Input | → | Note |
|---|---|---|
| gold plated, GP, HGE, GE, EP, electroplate, gold overlay, gold wash, gold dipped, PVD gold, IP gold, flash plated | gold plated | FTC §23.5: "gold plate" requires ≥0.5 µm |
| gold filled, GF, 1/20 12k GF, gold bonded, rolled gold, RGP, doublé | gold filled | FTC: GF = mechanically bonded, ≥1/20 by weight; RGP is thinner — merged as "not solid" |
| vermeil, gold over sterling, silver gilt | vermeil | FTC: ≥2.5 µm gold over sterling |
| gold tone, gold finish, gilt, gilded | gold tone | costume |
| base metal, pot metal, white metal, brass (ring/bracelet…), pewter, costume/fashion jewelry | base metal | |
| solid gold, real gold, genuine gold, not plated | solid gold | |
| plumb gold, plumb | plumb gold | exact karat |

### Alternative metals

| Input | → |
|---|---|
| titanium, ti (ring/band), grade 2/5 titanium | titanium |
| tungsten, tungsten carbide, wolfram | tungsten |
| cobalt chrome, cobalt (ring) | cobalt |
| zirconium, black zirconium | zirconium |
| ceramic (ring/watch), high-tech ceramic | ceramic |
| damascus, damascus steel | damascus steel |
| carbon fiber/fibre, forged carbon | carbon fiber |
| meteorite (ring/inlay), Gibeon, Muonionalusta | meteorite |
| stainless, steel, surgical steel, 316L, 904L, Oystersteel | stainless steel [req] |

### Weights & measures [req]

| Input | → |
|---|---|
| dwt, pennyweight, pwt | pennyweight (1.555 g; 20 dwt = 1 troy oz) |
| troy oz, ozt, t oz | troy ounce (31.103 g) |
| 5 g / gr / gm / grams | 5 grams |
| grain (pearl) | grain (¼ carat = 50 mg) |
| momme | momme (3.75 g; pearl trade) |
| 18", 18 in, 18 inches | 18 inch |
| 6 mm, 6 millimeters | 6mm |
| mm (bare) | millimeter |

---

## 2. Diamonds

### Weight [req]

| Input | → |
|---|---|
| 2ct, 2 ct., 2cts, 2 carats | 2 carat |
| 1 1/2 ct, 1½ ct | 1.5 carat |
| half carat, ½ ct, .50ct | 0.5 carat |
| quarter carat, 1/4 ct | 0.25 carat |
| 3/4 carat | 0.75 carat |
| 1/3, 2/3, 1/5, 1/8, 1/10 | 0.33, 0.67, 0.2, 0.125, 0.1 |
| 3cttw, 3ctw, 3 tcw, 3 tdw, 3 tw, 3 ct total | 3 carat total weight |
| cttw, ctw, tcw, tdw, TW, total carat weight | carat total weight |
| 25 pt, 25 points, 25-pointer | 25 points |
| melee, melle, mêlée, stars (melee), full-cut melee | melee (small round diamonds < ~0.18 ct) |

### Clarity (GIA scale) — glossary only, no rewrite

FL (flawless) · IF (internally flawless) · VVS1 · VVS2 (very very slightly included) · VS1 · VS2 (very slightly included) · SI1 · SI2 (slightly included; SI3 is EGL-only, not GIA) · I1 · I2 · I3 (included; AGS/older trade "P1/P2/P3" = piqué).

| Input | → |
|---|---|
| loupe clean, flawless | loupe clean (no inclusions at 10×; ≈ FL/IF) |
| eye clean, clean to the eye | eye clean (no inclusions to naked eye; ≈ VS2+) |
| clar, clty | clarity |

### Color (GIA scale) — glossary only

D E F (colorless) · G H I J (near colorless) · K L M (faint) · N–R (very light) · S–Z (light). Beyond Z = fancy color, graded Faint → Very Light → Light → Fancy Light → Fancy → Fancy Intense → Fancy Vivid / Fancy Deep / Fancy Dark. "Cape" = old trade term for yellowish (K–M). "Blue-white" = FTC-prohibited puffery.

| Input | → | Note |
|---|---|---|
| colorless, colourless, white diamond | colorless | |
| col G, clr H | color G | grade abbreviation |
| fancy yellow, canary, fancy intense/vivid yellow | yellow diamond | |
| champagne, cognac, chocolate, mocha, cinnamon, coffee, fancy brown | brown diamond | "Chocolate Diamonds" is Le Vian's trademark |
| black diamond, carbonado, fancy black | black diamond | most commercial black diamonds are treated |
| pink diamond, argyle pink, fancy pink | pink diamond | |
| blue diamond, fancy blue | blue diamond | |
| fancy color/coloured diamond, FCD | fancy color diamond | |
| salt and pepper, S&P, rustic, galaxy, grey/gray diamond | salt and pepper diamond | |

### Cut grade (GIA/AGS) — glossary only

Excellent (EX) · Very Good (VG) · Good (G) · Fair · Poor. AGS uses 0 (Ideal) – 10. "Triple Ex / 3EX / XXX" = Excellent cut, polish, symmetry.

| Input | → |
|---|---|
| hearts and arrows, H&A, super ideal, ideal cut, Tolkowsky | hearts and arrows |
| triple ex, 3ex, 3x, XXX | triple excellent |
| ex / xl (cut/polish/symmetry) | excellent |
| vg, gd | very good, good |
| sym, symm | symmetry |
| pol | polish |
| depth %, table % | depth percentage, table percentage |
| meas, dims, measurements | measurements |

Proportions vocabulary (glossary only): **table** (top flat facet) · **crown** (above girdle) · **girdle** (outer edge; graded thin→thick) · **pavilion** (below girdle) · **culet** (bottom point; "none" is modern, "open/large" = antique) · **bow-tie** (dark band in fancy shapes) · **windmill** (asscher's pinwheel) · **spread** (looks bigger than weight) · **fisheye** (girdle reflection from too-shallow pavilion) · **nailhead** (dark center from too-deep pavilion) · **crushed ice** (non-patterned sparkle, radiants/cushions) · **chunky** (large-facet cushion) · **windowing** (see-through in colored stones).

### Fluorescence

| Input | → |
|---|---|
| fluor, fluorescent, fl., blue fluorescence | fluorescence |
| none/no fluorescence, non-fluorescent, inert | no fluorescence |

GIA scale: None · Faint · Medium · Strong · Very Strong.

### Certification [req]

| Input | → | Note |
|---|---|---|
| GIA cert/report/dossier/graded | GIA certified | Gemological Institute of America — trade reference lab |
| AGS cert | AGS certified | American Gem Society; lab merged into GIA in 2022 |
| IGI cert | IGI certified | International Gemological Institute — dominant for lab-grown |
| EGL / EGL USA cert | EGL certified | European Gemological Laboratory — grades run soft; trade discounts |
| HRD cert | HRD certified | Antwerp |
| GCAL cert | GCAL certified | Gem Certification & Assurance Lab, NY |
| cert, certed, w/ cert, grading report, lab report | certified | |
| no cert, uncerted, non-cert | uncertified | |
| laser inscribed, inscription, girdle inscription | laser inscribed | |

### Origin & treatment — hard gate (FTC §23.12, §23.25)

| Input | → | Note |
|---|---|---|
| lab grown, lab created, lab made, laboratory-grown, man-made, synthetic, created diamond, grown diamond, CVD, HPHT-grown, LGD, LG, lab (dia) | lab grown [req] | FTC 2018: "synthetic", "lab-grown", "lab-created", "[manufacturer]-created" all acceptable **with** the qualifier; bare "diamond" is not |
| cultured diamond | lab grown diamond [req] | FTC: "cultured" alone is deceptive for diamonds |
| natural, earth-mined, mined, genuine diamond, real diamond, nat | natural diamond [req] | |
| clarity enhanced, fracture filled, glass filled, Yehuda, CE, laser drilled | clarity enhanced | natural but treated; must be disclosed (FTC §23.24) |
| HPHT treated/processed, color treated/enhanced, irradiated, treated black/blue/pink | color treated | |

### Simulants — never equivalent to diamond

| Input | → | Note |
|---|---|---|
| CZ, CZs, cubic zirconia, zirconia, Diamonique, Diamonaire, Diamonelle | cubic zirconia [req] | ZrO₂, Mohs 8–8.5 |
| moissanite, moissy, moiss, Charles & Colvard, Forever One, Forever Brilliant | moissanite [req] | SiC, Mohs 9.25, doubly refractive |
| diamond simulant, simulated diamond, faux/fake/imitation diamond, diamond alternative | diamond simulant | |
| white sapphire, colorless sapphire | white sapphire | natural corundum |
| white topaz, clear topaz | white topaz | |
| rhinestone, diamanté, diamante | rhinestone | glass |
| paste, strass, Georgian paste | paste | 18th–19th c. leaded glass |
| Swarovski / Austrian / German / Czech / Bohemian crystal, leaded crystal | crystal | glass |
| YAG, GGG, strontium titanate ("Fabulite") | — | rare in modern trade; glossary only. **Not** rewritten. |

Related: moissanite ~ cubic zirconia; white sapphire ~ white topaz; moissanite ~ white sapphire — **all** flagged "never for a diamond request".

---

## 3. Colored stones

### Corundum

| Input | → | Note |
|---|---|---|
| sapph, saph, sapp, saf, sapphires, blue sapphire, royal blue, cornflower | sapphire | blue is the default |
| Ceylon / Ceylonese / Sri Lankan sapphire | Ceylon sapphire | origin trade name (legit) |
| Kashmir sapphire | Kashmir sapphire | top origin |
| pink sapphire, hot pink | pink sapphire | ~ ruby (borderline — same mineral; GIA draws the line by saturation) |
| padparadscha (+ 6 misspellings), pad, pad sapphire | padparadscha | pink-orange; Sinhalese "lotus" |
| peach sapphire, sunset, padparadscha-color | peach sapphire | sub-pad |
| teal, Montana, mermaid, peacock, bi-color, parti sapphire | teal sapphire | |
| white sapphire, colorless | white sapphire | |
| yellow, golden, canary sapphire, pukhraj | yellow sapphire | |
| purple, violet, lavender, plum | purple sapphire | |
| green, olive, forest sapphire | green sapphire | |
| star sapphire, asteriated | star sapphire | six-ray asterism (cabochon) |
| color-change sapphire | color-change sapphire | |
| oriental emerald | green sapphire | **misnomer** (19th c.) |
| oriental amethyst / topaz / aquamarine / peridot | sapphire | 19th-c. misnomers for fancy corundum |
| rubies, rubys, rby, rub | ruby | |
| Burma / Burmese / Myanmar / Mogok ruby, pigeon's blood | Burma ruby | origin trade name |
| star ruby | star ruby | |
| balas ruby, spinel ruby | red spinel | **misnomer** — the Black Prince's "Ruby" is spinel |
| cape / arizona / bohemian / colorado / american ruby, bohemian garnet | pyrope garnet | **misnomers** |

Glossary only: **heated / unheated / no heat** (heat is the standard disclosed treatment; "no heat" commands a premium) · **beryllium diffused** (must disclose) · **glass-filled ruby / composite** (low-grade lead-glass; FTC requires disclosure) · **silk** (rutile needle inclusions).

### Beryl

| Input | → | Note |
|---|---|---|
| emer, emrld, emeralds, green emerald | emerald | |
| Colombian / Columbian / Muzo emerald | Colombian emerald | |
| trapiche emerald | trapiche emerald | six-spoke growth pattern |
| green beryl | green beryl | too pale to be emerald (trade distinction) |
| aquamarine, aqua marine, aquamarin, aqua (ring/stone…), Santa Maria | aquamarine | |
| morganite, morganit, pink/peach beryl, morg | morganite | |
| heliodor, golden/yellow beryl | heliodor | |
| goshenite, white/colorless beryl | goshenite | |
| bixbite, red beryl, red emerald | red beryl | Utah only; **not** emerald |
| Brazilian emerald | green tourmaline | **misnomer** |
| evening emerald | peridot | **misnomer** |
| Uralian emerald | demantoid garnet | **misnomer** |

Glossary only: **oiling / cedar oil / minor–moderate–significant** (standard emerald clarity treatment; must disclose beyond "minor"; Opticon/resin is more serious) · **jardin** (French: garden — emerald's inclusions).

### Quartz

| Input | → | Note |
|---|---|---|
| amethyst (+ 5 misspellings), amy, ameth | amethyst | |
| rose de France | rose de France amethyst | pale lilac |
| green amethyst, prasiolite, vermarine | prasiolite | **"green amethyst" is an FTC-flagged misnomer** (heated amethyst) |
| citrine, citrin, cit | citrine | most is heated amethyst |
| Madeira / Spanish / Palmeira / golden topaz | citrine | **misnomers** |
| smoky quartz, smokey quartz, morion | smoky quartz | |
| smoky/smokey/scotch topaz, cairngorm | smoky quartz | **misnomers** (FTC §23.26 lists "smoky topaz") |
| rose quartz | rose quartz | |
| rutilated quartz, rutile quartz, Venus hair stone | rutilated quartz | |
| rock crystal, crystal quartz, clear quartz, quartz crystal | rock crystal | |
| Herkimer diamond | herkimer quartz | **misnomer**; rewritten on **both** sides |
| ametrine | — | glossary only (no variant) |
| tiger's eye, cat's eye (quartz), aventurine, chalcedony (see below) | — | |

### Garnet group

| Input | → |
|---|---|
| garnet (+ misspellings), garn, gar | garnet |
| tsavorite, tsav, tsavolite, green grossular | tsavorite garnet |
| demantoid | demantoid garnet (horsetail inclusions; Russian) |
| rhodolite, malaya/malaia garnet | rhodolite garnet |
| spessartite, spessartine, mandarin garnet, spess | spessartite garnet |
| hessonite, cinnamon stone, Mali garnet, grossular garnet | grossular garnet |
| almandine, almandite | almandine garnet |
| pyrope, anthill garnet | pyrope garnet |
| color-change garnet | color-change garnet |

### Tourmaline

| Input | → |
|---|---|
| tourmaline (+ misspellings), tourm | tourmaline |
| paraiba, paraíba, cuprian, neon, copper-bearing tourmaline | paraiba tourmaline (Cu-bearing; Brazil/Mozambique/Nigeria; LMHC definition) |
| rubellite, rubelite, pink/red tourmaline | rubellite tourmaline |
| indicolite, indigolite, blue tourmaline | indicolite tourmaline |
| verdelite, chrome, green tourmaline | green tourmaline |
| watermelon, bi-color, parti tourmaline | watermelon tourmaline |
| schorl, black tourmaline | black tourmaline |

### Other transparent gems

| Input | → | Note |
|---|---|---|
| spinel | — | glossary only; "red spinel" from misnomers above |
| tanzanite (+ misspellings), tanz | tanzanite | blue-violet zoisite; Tanzania only; almost always heated |
| zircon, blue zircon, starlite | blue zircon | **natural** zircon — not CZ |
| matara / matura / Ceylon diamond | colorless zircon | **misnomers** |
| topaz, topaze | topaz | |
| imperial / precious / sherry topaz | imperial topaz | orange-pink; Ouro Preto |
| London blue, Swiss blue, sky blue topaz | (each kept) | all irradiated+heated; shades darkest→lightest |
| mystic topaz, rainbow topaz, azotic | mystic topaz | thin-film coated — treated |
| white / clear / colorless topaz | white topaz | |
| peridot (+ misspellings), peri | peridot | olivine; "evening emerald" misnomer above |
| alexandrite, alex | alexandrite | color-change chrysoberyl |
| cat's eye chrysoberyl, cymophane | cat's eye chrysoberyl | |
| iolite, cordierite, water sapphire, dichroite | iolite | "water sapphire" is a **misnomer** |
| kunzite, pink spodumene | kunzite | |
| hiddenite, green spodumene | hiddenite | |
| apatite, neon apatite | apatite | |
| sphene, titanite | sphene | |
| benitoite | benitoite | California state gem |
| moonstone, rainbow/blue/Ceylon moonstone, adularia | moonstone | feldspar; adularescence |
| labradorite, spectrolite | labradorite | |
| sunstone, Oregon sunstone | sunstone | |

### Opal

| Input | → | Note |
|---|---|---|
| opal, opel | opal | |
| black opal, Lightning Ridge | black opal | dark body tone (N1–N4) |
| boulder opal, Queensland, Yowah, Koroit | boulder opal | opal on ironstone matrix |
| fire opal, Mexican opal, jelly opal | fire opal | orange body; may lack play-of-color |
| white opal, milky, light opal, Coober Pedy | white opal | |
| crystal opal, water opal | crystal opal | transparent body |
| Ethiopian opal, Welo, Wello, hydrophane | Ethiopian opal | absorbs water; disclose |
| solid opal | solid opal | |
| opal doublet | opal doublet | 2-layer assembled; disclose |
| opal triplet | opal triplet | 3-layer with cap; disclose |
| opalite, sea opal, synthetic/Gilson/created/lab opal | synthetic opal | |

### Jade & opaque/ornamental stones

| Input | → | Note |
|---|---|---|
| jadeite, jadeite jade, Burmese jade, imperial jade, fei cui | jadeite | the precious jade |
| nephrite, Hetian/Hotan, mutton-fat, BC/Canadian/Siberian jade | nephrite | the other true jade |
| Type A / Grade A jade, natural untreated | Type A jadeite | untreated (wax only) — Hong Kong Jade & Stone Lab standard |
| Type B, bleached, polymer-impregnated | Type B jadeite | disclose |
| Type C, dyed | Type C jadeite | disclose |
| new jade, Korean jade, serpentine jade, bowenite | serpentine | **misnomers** — not jade |
| Australian jade, chrysoprase, chrysophrase, prase chalcedony | chrysoprase | "Australian jade" is a **misnomer** |
| turquoise (+ misspellings), turq; Sleeping Beauty, Kingman, Persian, Morenci, Bisbee, #8, Lander Blue | turquoise | mine names collapse to species (glossary keeps them) |
| stabilized, enhanced, treated turquoise | stabilized turquoise | resin-hardened; disclose |
| block, reconstituted, compressed, imitation turquoise, howlite (dyed) | imitation turquoise | |
| lapis, lapis lazuli, lapiz, denim/Afghan lapis | lapis lazuli | |
| onyx, onix, black onyx, black agate, black chalcedony | black onyx | nearly all is dyed chalcedony |
| sardonyx, banded onyx | sardonyx | |
| carnelian, cornelian, sard | carnelian | |
| chalcedony, calcedony; blue chalcedony, blue agate, holly blue | chalcedony / blue chalcedony | |
| moss agate | moss agate | |
| malachite | malachite | |
| azurmalachite | azurmalachite | |
| chrysocolla, gem silica | chrysocolla | |
| larimar, Stefilia's stone, blue pectolite | larimar | Dominican Republic |
| hematite, haematite, hematine, hemalyke | hematite | hematine/hemalyke are imitations |
| pyrite, fool's gold, marcasite | marcasite | trade name for pyrite in jewelry |
| tiger's eye, cat's eye (bare) | (kept) | |

### Organics

| Input | → | Note |
|---|---|---|
| coral, precious/Mediterranean/Sardinian/red coral | coral | CITES-listed species; check |
| angel skin coral, pelle d'angelo, pink coral | angel skin coral | |
| oxblood, moro coral | oxblood coral | |
| amber, Baltic amber, succinite | amber | |
| copal, young amber | copal | immature resin — **not** amber |
| jet, Whitby jet, jet beads/brooch | jet | fossilized wood; Victorian mourning |
| French jet, Vauxhall glass | black glass | **misnomer** |
| shell cameo, carved shell | shell cameo | |
| hardstone/agate/onyx/stone cameo | hardstone cameo | |
| cameo, camio | cameo | |
| intaglio, carved seal | intaglio | |
| micromosaic, micro mosaic, Roman mosaic | micromosaic | |
| pietra dura, pietre dure | pietra dura | Florentine hardstone inlay |
| scarab | scarab | |
| mother of pearl, MOP | mother of pearl | |
| abalone, paua | — | glossary only |

### Generic stone words

| Input | → |
|---|---|
| gemstone, gem stones, gems | gemstone |
| semi-precious, semiprecious | semi-precious (CIBJO discourages the term; kept for matching) |
| birthstone, birth stone, month stone | birthstone |
| multi-gem, multistone, multicolor, tutti frutti, rainbow gem | multi-gem |
| Mohs hardness / scale | Mohs hardness |

---

## 4. Pearls

| Input | → | Note |
|---|---|---|
| pearl, pearls, perl, pearles, prl | pearl | |
| natural pearl, wild, Basra, Gulf, natural saltwater | natural pearl | **origin gate** — natural ≠ cultured; X-ray tested; Basra = Persian Gulf |
| cultured pearl, cultivated, CP | cultured pearl | FTC §23.20: "cultured" must be stated |
| imitation, faux, fake, simulated, glass, shell, costume, plastic pearl, Majorica/Mallorca/Majorca | imitation pearl | Majorica = trade name for glass-based imitation |
| Akoya, Japanese pearl, oriental pearl, Japanese akoya | Akoya pearl | *Pinctada fucata*; 2–10 mm; "Japanese/Oriental pearl" = Akoya cultured in trade use |
| South Sea, Australian, Philippine, Indonesian pearl | South Sea pearl | *P. maxima*; 9–20 mm |
| golden South Sea, gold pearl | golden South Sea pearl | |
| Tahitian, black lip, black South Sea | Tahitian pearl | *P. margaritifera*; naturally dark |
| freshwater, FWP, FW pearl, Chinese pearl, Edison, Ming | freshwater pearl | mussel-grown; usually tissue-nucleated (all nacre) |
| keshi, keishi, poppy seed pearl | keshi pearl | non-nucleated by-product |
| mabé, mabe, half pearl, blister pearl, composite | mabé pearl | hemispherical, grown on shell |
| baroque, semi-baroque, circled, ringed pearl | baroque pearl | |
| seed pearl, rice, potato, micro pearl | seed pearl | < 2 mm |
| Biwa, stick, cross pearl | Biwa pearl | Lake Biwa; now generic for Japanese-style FW |
| conch pearl, pink conch, queen conch | conch pearl | non-nacreous; flame structure |
| melo pearl, melo melo | melo pearl | non-nacreous; orange |
| hanadama, hana dama | hanadama | PSL (Japan) top Akoya certificate |
| Mikimoto, mikomoto | Mikimoto [req] | brand |

Glossary only: **nacre** (thickness; Akoya min ~0.35 mm for durability) · **luster/lustre** (sharpness of reflection — the #1 value factor) · **overtone** (secondary color: rosé, cream, silver, green) · **orient** (iridescence) · **AAA / AA+ / AA / A** (retailer grading; not standardized) · **A–D / Tahitian system** (French Polynesian legal grading) · **matching** · **surface / blemish** · **bead-nucleated vs tissue-nucleated** · **strand** (a full string; "temporary strung" = unknotted) · **knotted** (silk knots between pearls).

### Strand lengths

| Input | → | Length |
|---|---|---|
| collar length, pearl collar | pearl collar | 12–13" (multi-strand, on the neck) |
| choker, pearl choker, choker length | choker / pearl choker | 14–16" |
| princess length/strand/necklace | princess length strand | 17–19" |
| matinee, matinée length | matinee length strand | 20–24" |
| opera length | opera length strand | 28–36" |
| rope length, pearl rope | rope length strand | 37"+ |

---

## 5. Cuts & shapes

### Antique cuts

| Input | → | Note |
|---|---|---|
| old mine cut, old miner, mine cut, OMC, cushion old cut, antique cushion brilliant | old mine cut | c. 1700–1890; cushion outline, small table, high crown, open culet |
| old european cut, old euro, OEC, european cut, old cut round | old european cut | c. 1890–1930; round outline |
| transitional cut, early modern brilliant, early american cut | transitional cut | c. 1920–1940; between OEC and modern |
| old cut, antique cut | old cut | generic |
| rose cut, rosecut | rose cut | flat back, domed faceted top; Georgian–Victorian |
| single cut, 8/8 cut, eight cut, swiss cut | single cut | 17 facets; melee |
| French cut | French cut | square with cross-shaped table; Deco accent |
| portrait cut, lasque, flat-cut | portrait cut | thin flat slab (Mughal) |
| briolette | briolette | fully faceted drop, no girdle |
| antique / old / vintage cushion | antique cushion cut | ≈ old mine |

### Modern brilliant & mixed

| Input | → |
|---|---|
| round brilliant, RBC, RB, rnd, rd, round cut, full cut, modern round | round brilliant cut (57/58 facets) |
| princess, princess cut, square modified brilliant, quadrillion | princess cut |
| cushion, cushion cut, pillow cut, cush, cushion modified brilliant | cushion cut |
| elongated / rectangular / long cushion | elongated cushion |
| radiant, radiant cut, (cut-cornered) rectangular modified brilliant | radiant cut |
| oval, oval cut, ov | oval |
| pear, pear shape, teardrop, pendeloque | pear shape |
| marquise, marquis, navette, marq, mq, football cut, eye-shaped | marquise |
| heart, heart shape, hs | heart shape |
| trillion, trilliant, trillian, triangle cut, trielle, tri cut | trillion |
| moval, marquise-oval | moval |
| checkerboard, checker cut | checkerboard cut |
| concave cut | concave cut |
| modified brilliant | modified brilliant |
| fancy shape, fancy cut, fancies | fancy shape (any non-round) |
| mixed cut | mixed cut (brilliant crown + step pavilion) |

### Step cuts

| Input | → |
|---|---|
| emerald cut, em cut, emerald shape, EC | emerald cut |
| asscher, asher/ascher/assher cut, sq emerald cut, Royal Asscher | asscher cut (1902 patent; octagonal step; "windmill") |
| baguette, bags, baggies, bag | baguette |
| tapered baguette, tapered bags | tapered baguette |
| step cut | step cut |
| carré, cushion step | — glossary only |

### Side / accent shapes

| Input | → |
|---|---|
| half moon, halfmoon, demi-lune, lunette | half moon |
| trapezoid, trapeze cut, traps | trapezoid |
| shield cut/shape | shield cut |
| kite cut/shape | kite cut |
| hexagon cut, hex cut | hexagon cut |
| octagon cut | octagon cut |
| bullet cut/shape | bullet cut |
| epaulette, cadillac | — glossary only (rare) |

### Cabochon family

| Input | → |
|---|---|
| cabochon, cab, cabs, en cabochon, cabachon | cabochon |
| sugarloaf, sugar loaf cab | sugarloaf cabochon (pyramidal) |
| buff top, bufftop, buff-topped | buff top (cab dome + faceted pavilion) |

Related (Category 2): emerald~asscher, emerald~baguette, emerald~step cut, princess~radiant, radiant~cushion, radiant~emerald, cushion~antique cushion, antique cushion~old mine, old mine~old european, OEC~transitional, transitional~RBC, OEC~RBC, old cut~rose cut, old mine~rose cut, single~RBC, oval~elongated cushion, oval~moval, marquise~moval, oval~pear, pear~marquise, pear~briolette, trillion~kite, trillion~shield, half moon~trapezoid, baguette~tapered baguette, tapered baguette~bullet, cabochon~sugarloaf, cabochon~buff top, cabochon~rose cut, checkerboard~cushion, French~single, French~princess, hexagon~octagon, portrait~rose cut, H&A~triple ex.

---

## 6. Jewelry types

### Rings

| Input | → | Note |
|---|---|---|
| engagement, eng ring, e-ring, engagment ring | engagement ring [req] | |
| wedding ring, wed band, wedder, marriage band, WB | wedding band | |
| bridal set, wedding set, engagement set | bridal set | e-ring + matching band |
| eternity ring, full eternity, infinity band | eternity band | stones all the way round; cannot be resized |
| half eternity, halfway band | half-eternity band | |
| anniversary ring/band | anniversary band | |
| cocktail ring, dinner ring, right-hand ring, RHR | statement ring | "dinner ring" = 1940s–50s term |
| cluster ring, daisy ring, flower cluster | cluster ring | |
| dome ring, domed, bombé, bombe ring | dome ring | bombé = French "bombed" (convex) |
| cigar band, wide band, cigar ring | cigar band | |
| toi et moi, moi et toi, two-stone, 2-stone | toi et moi | "you and me"; bypass with two stones |
| three-stone, 3-stone, trilogy, trinity (non-Cartier) | three-stone | |
| five-stone, 5-stone | five-stone | Victorian "half-hoop" |
| solitaire ring, single-stone ring | solitaire | |
| bypass, crossover, cross-over, wrap-around ring | bypass ring | |
| stackable / stacking / stacker ring | stacking ring | |
| midi, knuckle, above-the-knuckle ring | midi ring | |
| promise, purity, pre-engagement ring | promise ring | |
| class, school, graduation, college ring | class ring | |
| mourning, memorial, memento mori ring | mourning ring | |
| signet, crest, seal, monogram, initial ring | signet ring | |
| pinky, pinkie, little finger ring | pinky ring | |
| mother's, family, birthstone family ring | mother's ring | |
| Claddagh (+ misspellings) | Claddagh | hands-heart-crown; Irish |
| contour, curved, notched, shadow, chevron, fitted, shaped band | contour band | |
| ring enhancer, wrap, guard, jacket, insert; band enhancer; solitaire wrap | ring enhancer | |
| gypsy ring | gypsy ring | Victorian flush-set, usually three stones |
| poison ring, puzzle ring, posy/posey ring, fede ring, gimmel ring, regard/dearest ring, snake ring, buckle ring | — | glossary only (no variant spellings). Regard = Ruby-Emerald-Garnet-Amethyst-Ruby-Diamond acrostic |
| men's / mens / gents / gentleman's | men's [req] | |
| women's / womens / ladies | women's [req] | |

### Earrings

| Input | → |
|---|---|
| earrings, earings, ear rings, ers, earr | earrings |
| stud, studs, ear studs | stud earrings |
| hoops, hoop earrings | hoop earrings |
| huggie, huggies, huggy, huggers | huggie earrings (small close-fitting hoops) |
| drop, drops, ear drops, pendant earrings | drop earrings |
| dangle, dangles, danglers | dangle earrings |
| chandelier earrings | chandelier earrings |
| girandole | girandole earrings (18th–19th c. three-drop) |
| ear jacket, jacket earrings | earring jacket |
| ear climber, crawler, ear sweep, ear pin | ear climber |
| threader, ear threader | threader earrings |
| ear cuff, cuff earrings | ear cuff |
| clip-on, clip on, non-pierced, unpierced | clip-on |
| single earring, solo/mono earring | single earring |
| cluster earrings, halo earrings | — glossary only |

Earring backs: **friction back** (butterfly, push back, post & butterfly) · **la pousette** (poussette, locking back) · **screw-back** · **lever-back** (leverback) · **French wire** (fishhook, shepherd's hook, French hook) · **omega back** (omega clip) · **post** (the pin) · **clip** (non-pierced) · **threader**.

### Necklaces & chains

| Input | → | Note |
|---|---|---|
| necklace (+ misspellings), nk, nkl, neck | necklace [req] | |
| pendant (+ misspellings), pend, pdt | pendant | **item-type gate**: pendant ≠ necklace |
| diamonds by the yard, DBTY | diamond station | Tiffany/Peretti origin, now generic |
| station necklace, floating diamond necklace | diamond station necklace | |
| line necklace | tennis necklace | |
| riviere, rivière, riviera necklace | riviera | graduated line |
| Y necklace, Y-drop, Y chain | Y necklace | |
| lariat, lasso, wrap necklace | lariat necklace | |
| choker | choker | 14–16" |
| bib, statement necklace | bib necklace | |
| collar, collier, collarette | collar necklace | |
| torsade, twisted multi-strand | torsade | |
| sautoir | sautoir | Deco long strand, often tasselled |
| negligee, lavaliere, lavalliere | negligee necklace | two unequal drops (Edwardian) |
| festoon, swag, garland necklace | festoon necklace | |
| graduated necklace | graduated necklace | |
| multi-strand, double/triple strand | multi-strand | |
| locket, photo/picture locket | locket | |
| slide pendant, omega slide | slide pendant | |
| pendant/pearl/necklace enhancer | pendant enhancer | |
| charm holder/carrier | charm holder | |
| dog tag | dog tag pendant | |
| cross, crucifix | cross pendant | |
| Star of David, Magen David, Jewish star | Star of David | |
| hamsa, hand of Fatima, khamsa | hamsa | |
| evil eye, nazar, mati | evil eye | |
| miraculous medal, St. X medal, saint medal | religious medal | |
| mezuzah / chai pendant | judaica pendant | |
| extender, chain extender | extender chain | |

Chain styles (all `[both]`; UK↔US pairs noted):

| Input | → | Note |
|---|---|---|
| cable, cable link, trace (UK), standard link | cable chain | |
| rolo, rollo, belcher (UK) | rolo chain | |
| curb, curb link | curb chain | |
| cuban, cuban link, Miami cuban | cuban link chain | heavy tight curb |
| figaro | figaro chain | |
| rope, twisted rope, French rope, diamond-cut rope | rope chain | |
| box, venetian | box chain | |
| snake, Brazilian snake | snake chain | |
| herringbone | herringbone chain | |
| wheat, spiga, espiga | wheat chain | |
| byzantine, birdcage, king's chain, etruscan chain | byzantine chain | |
| mariner, anchor, gucci link, marina, puffed mariner | mariner chain | "Gucci link" = trade nickname, not the house |
| franco | franco chain | |
| bead, ball, pallini, dog tag chain, military chain | ball chain | |
| moon cut, diamond-cut bead | moon cut ball chain | |
| omega chain/necklace/collar | omega chain | |
| san marco, macaroni | san marco chain | |
| foxtail | foxtail chain | |
| singapore, twisted curb | singapore chain | |
| paperclip, elongated/rectangle link | paperclip chain | |
| popcorn | popcorn chain | |
| bismarck, bismark | bismarck chain | |
| mesh, milanese | mesh | |
| prince of wales | prince of wales chain | |
| cheval, chevalier | cheval chain | |
| d/c, dia cut, diamond-cut (chain) | diamond-cut [req] | faceted finish |

### Bracelets

| Input | → |
|---|---|
| bracelet (+ misspellings), brac, brclt, br | bracelet |
| line, eternity, straight-line, in-line bracelet; tennis | tennis bracelet |
| riviera bracelet | riviera bracelet |
| bangle, bangles, slip-on bangle | bangle |
| hinged bangle, oval hinged, clamper | hinged bangle |
| cuff, cuff bracelet, open bangle, wrist cuff | cuff bracelet |
| cable bracelet/cuff (non-Yurman) | cable bracelet |
| charm bracelet | charm bracelet |
| ID, identity, identification, nameplate bracelet | ID bracelet |
| bolo, slider, pull-tie, lariat bracelet | bolo bracelet |
| slide bracelet, Victorian slide | slide bracelet |
| anklet, ankle bracelet/chain | anklet |
| hand chain, slave bracelet, ring bracelet, hand harness | hand chain |
| buckle, belt bracelet | buckle bracelet |
| bypass / crossover bangle | bypass bangle |
| watch band/strap/bracelet | watch band |
| mesh / milanese bracelet | mesh |

### Brooches, men's & objects

| Input | → |
|---|---|
| brooch, broach, brooch pin, bar pin, bar brooch, pins | brooch |
| stick pin, stickpin, scarf pin, cravat pin | stickpin |
| hat pin | hatpin |
| lapel pin/badge/stud | lapel pin |
| tie tack, tie tac, tie pin | tie tack |
| tie bar, tie clip, tie slide, tie clasp | tie bar |
| cufflinks, cuff links, cuff buttons, sleeve links | cufflinks |
| shirt / tuxedo / tux / dress studs | shirt studs |
| dress set, tuxedo set, stud set | dress set |
| dress clip, fur clip, duette, double-clip brooch | dress clip |
| fibula, penannular brooch | fibula brooch |
| money clip, bill clip | money clip |
| key ring/chain/fob, watch fob | key fob |
| collar bar/pin/stay | collar bar |
| chatelaine | chatelaine |
| compact, powder compact, vanity case, minaudière | compact |
| cigarette / card / vesta case, match safe | case |

Body jewelry: **navel ring** (belly ring/bar/button) · **nose ring** (nose stud/pin/screw/hoop, nostril) · **toe ring** · **body jewelry** (piercing jewelry).

---

## 7. Settings & construction

### Stone settings

| Input | → | Note |
|---|---|---|
| prong set, prong setting, claw set (UK), claw setting | prong set | UK "claw" = US "prong" |
| 4-prong / four claw | four-prong | |
| 6-prong / six claw | six-prong | |
| 8-prong | eight-prong | |
| double prong/claw | double-prong | |
| shared prong, common prong, U-prong, fishtail | shared prong | |
| V-tip, V-prong, chevron prong | V-prong | protects points |
| Tiffany setting/style/mount/head | six-prong solitaire setting | generic (1886 Tiffany design) — **not** the brand |
| bezel set, rub-over (UK), full bezel, bezelled | bezel set | |
| half / semi / partial / open / split bezel | half bezel | |
| channel set | channel set | |
| bar set | bar set | |
| bead set, beadset, grain set (UK) | bead set | |
| bright cut, brightcut | bright cut | bead-set with polished border |
| pavé, pave, pav, pavee | pavé | |
| pavé set | pavé set | |
| micro-pavé, micropave | micro-pavé | |
| French pavé, fishtail pavé | — | glossary only (appears in Related) |
| flush set, gypsy set, burnish set, hammer set, star set | flush set | |
| tension set | tension set | |
| invisible set, mystery set, serti mystérieux | invisible set | "Mystery Set" = VCA trademark |
| illusion setting/head/plate | illusion setting | white-metal plate makes stone look larger |
| halo setting/style, framed setting | halo | |
| hidden halo, under halo, peek-a-boo, secret halo | hidden halo | |
| double halo, 2 halo | double halo | |
| cluster setting | cluster | |
| cathedral setting/style/mount | cathedral setting | |
| trellis setting | trellis setting | |
| basket setting/head | basket setting | |
| peg head, setting head, solitaire head, crown head | setting head | |
| semi-mount, semimount, empty mounting, mounting only, no center stone, without center stone | semi-mount | |
| mtg, mnt | mounting [req] | |
| center stone, centre stone, main/principal stone, CS | center stone | |
| side stones, accent stones/diamonds, SD | side stones | |

### Shank & sizing

| Input | → |
|---|---|
| sizing beads/balls/bumps/dots, speed bumps | sizing beads |
| hinged / arthritic / spring shank, Superfit, Finger-Fit, clip shank | hinged shank |
| re-shank, new shank, half shank | re-shank |
| knife edge | knife-edge |
| comfort fit | comfort-fit |
| euro shank, cathedral shank, split shank, tapered shank | — glossary only |

### Decorative techniques

| Input | → |
|---|---|
| milgrain, millgrain, mill grain, millegrain, milligrain | milgrain (beaded edge) |
| filigree (+ misspellings) | filigree |
| openwork, open work, pierced work, pierced gallery, open gallery | openwork |
| ajouré | ajouré (pierced) |
| engraved, engr, engrv, engraving | engraved |
| hand engraved | hand engraved |
| engine turned/turning | engine turned |
| chased, chasing, hand chased | chased (pushed from front) |
| repoussé, repousse | repoussé (pushed from back) |
| granulation, granulated | granulation (fused gold beads; Etruscan) |
| cannetille, canetille | cannetille (Georgian wire filigree) |
| enamel, enamelled, enameled, enamelling | enamel |
| cloisonné | cloisonné (wire cells) |
| champlevé | champlevé (carved cells) |
| plique-à-jour | plique-à-jour (backless, stained-glass) |
| guilloché, guilloche | guilloché (translucent enamel over engine-turning) |
| basse-taille, niello, taille d'épargne | — glossary only |
| mokume-gane, mokume | mokume-gane (layered-metal woodgrain) |
| hammered, hammer finish, hand hammered | hammered |
| brushed / satin / matte finish | brushed finish |
| high polish, hi-polish, mirror finish | high polish |
| florentine finish | florentine finish (cross-hatched) |
| sandblast finish | sandblast finish |
| rhodium plated, re-rhodium, re-rhod, rhodium dip, rh plated, white rhodium | rhodium plated |
| black rhodium, black gold | black rhodium |
| pietra dura, micromosaic | (see organics) |

### Findings & clasps

| Input | → | Note |
|---|---|---|
| bail, bale | bail | pendant loop |
| jump ring, split ring | jump ring | |
| lobster, lobster claw/clasp/catch, trigger clasp | lobster clasp | |
| spring ring, bolt ring (UK) | spring ring clasp | |
| toggle, T-bar, toggle bar | toggle clasp | |
| box clasp/catch, tongue clasp, tongue-in-groove, push clasp, insert clasp | box clasp | |
| fishhook clasp, pearl clasp, filigree clasp | fishhook clasp | pearl strands |
| barrel clasp, screw clasp, torpedo clasp | barrel clasp | |
| magnetic clasp | magnetic clasp | |
| hook and eye, S-hook, hook clasp | hook clasp | |
| safety chain/catch/clasp, figure 8, figure-eight | safety catch | |
| hidden / integrated / invisible / concealed / mystery clasp | hidden clasp | |
| slide clasp/lock | slide clasp | |
| deployant, deployment clasp/buckle, fold-over, folding clasp, butterfly clasp | deployant clasp | watch |
| tang buckle, pin buckle, ardillon | tang buckle | watch |
| spring bar, springbar, strap pin | spring bar | watch |
| extender chain | extender chain | |
| head, peg, shank, gallery, bezel cup, post, butterfly | (see above) | |
| findings, components, jewelry parts | findings | |

---

## 8. Periods, eras & styles

Dates are approximate and overlap; trade usage (Lang Antiques AJU, Christie's/Sotheby's catalogue conventions).

| Era → canonical | Dates | Inputs collapsed | Signature |
|---|---|---|---|
| **Georgian** | 1714–1837 | 1700s, 1780s–1820s, regency, 18th century | closed-back foil settings, rose/old mine cuts, cannetille, paste, silver-topped gold, memorial |
| **Victorian** | 1837–1901 | vict, 1800s, 1850s–1890s, early/mid/late Victorian, Romantic (1837–60), Grand (1860–85), Aesthetic (1885–1901) | snakes, hair work, jet, cameos, seed pearls, garnets, old mine cuts, gypsy settings |
| **Etruscan Revival** | 1860s–80s | archaeological revival, Castellani/Giuliano style | granulation, filigree, bullae |
| **Egyptian Revival** | 1860s–70s & 1920s | pharaonic, egyptomania | scarabs, lotus, Tut (1922) |
| **Renaissance Revival** | 1860s–90s | holbeinesque, neo-renaissance | enamel, pendant jewels |
| **Gothic Revival** | 1840s–70s | neo-gothic | tracery |
| **mourning jewelry** | 1600s–1900s (peak 1861+) | memento mori, memorial, hair jewelry, hairwork, sentimental | jet, black enamel, hair, urns, "In Memory Of" |
| **Arts & Crafts** | 1880–1920 | arts and crafts, craftsman style | hand-wrought silver, cabochons, enamel, Ashbee/Gaskin |
| **Art Nouveau** | 1890–1915 | artnouveau, nouveau, Jugendstil, Liberty style | whiplash lines, plique-à-jour, female figures, insects; Lalique |
| **Edwardian** | 1901–1915 | belle époque, 1900s, 1910s, garland style | platinum, filigree, milgrain, bows/garlands, pearls, OECs |
| **Art Deco** | 1920–1935 | art-deco, deco, 1920s, 1930s, jazz age | geometry, calibré cuts, onyx/coral/jade, platinum, baguettes |
| **Retro** | 1935–1950 | retro-modern, 1940s, cocktail era, Hollywood glam, wartime | rose/two-tone gold, big volume, scrolls, synthetic rubies, tank bracelets |
| **Mid-Century** | 1945–1965 | midcentury, MCM, 1950s, 1960s, mid-mod | textured gold, clusters, turquoise/coral, Boucheron/Cartier animals |
| **Modernist** | 1940s–70s | modernism, Scandinavian/Danish modern, studio jewelry | silver, abstract; Jensen, Cooper, Persson |
| **Brutalist** | 1960s–70s | brutalism, 1970s, seventies, free-form, organic abstract | raw textured gold, cast forms |
| **1980s** | 1980s | eighties, bold gold | chunky, Bvlgari/Chopard |
| **vintage-inspired** | modern | vintage-style/inspired/look, antique-style, heirloom-style, deco-style, Victorian-style, old-world | **modern manufacture — not period** |
| **reproduction** | modern | repro, replica, in the style/manner of, after the antique | |

**Trade definitions (hard):**
- **antique** = 100+ years old (US Customs rule, 19 CFR 10.53; also the 1930 Tariff Act). `antq` → antique.
- **vintage** = roughly 20–100 years old (no legal definition; some dealers say 50+). `vtg`, `vint` → vintage.
- **estate** = previously owned, **any** age (may be last season). `pre-owned`, `pre-loved`, `used`, `second-hand` → estate.
- These are Category 2 only (antique ~ vintage ~ estate); never rewritten into each other.

`circa 1920`, `ca. 1920`, `c. 1920` → *circa 1920* [req] (`cal. 3135` excluded).

---

## 9. Condition, trade & shop-floor slang

All `[req]` unless noted.

| Input | → | Meaning |
|---|---|---|
| estate, pre-owned, preloved, previously loved, used, second-hand | estate | previously owned |
| new old stock, NOS, dead stock | new old stock | unsold old inventory, unworn |
| unworn, NWT, NIB, BNIB, LNIB, new in box, stickers on | unworn | |
| mint, mint condition, excellent condition, pristine, like new, near mint | excellent condition | |
| as-is, sold as is, for parts, project piece, needs work/TLC | as-is | no warranty |
| scrap, melt, scrap gold/value/lot, for melt | scrap | metal value only |
| on memo, memo, consignment, consigned, memorandum | memo | goods held on approval, not owned |
| in the case, in stock, on hand, in the showcase/vault/safe, on the floor, avail, ready to ship | in stock | |
| custom order, special order, made to order, MTO, bespoke, commission, one-off | custom order | |
| take-in, intake, repair ticket/envelope, job envelope | repair intake | |
| at/on the bench, in the shop, with the jeweler | at the bench | in repair |
| size up/down, resize, re-size, ring sizing | resize | |
| re-tip, retip, new prongs, prong rebuild | re-tip | rebuild worn prong tips |
| re-shank, half shank | re-shank | |
| rhodium, re-rhod, dip, rhodium plate | rhodium plated | white-gold refresh |
| polish and clean, P&C, clean & polish, buff and polish, spa treatment | polish and clean | |
| ultrasonic, sonic clean | ultrasonic cleaning | |
| steam, steam clean | steam cleaning | |
| laser weld, laser repair/solder, lasered | laser weld | |
| solder, soldered, torch work | solder | |
| prong check, stone check, tighten stones, loose stone | stone tightening | |
| restring, re-string, knotted, hand-knotted, silk thread, pearl stringing | restringing | |
| battery change, watch battery, cell change | battery replacement | |
| crystal replacement, new crystal | crystal replacement | watch glass |
| spring bar | spring bar | |
| serviced, recently/just serviced, full service, overhauled | serviced | watch |
| appraisal, appr, apprsl, appraised, valuation | appraisal | |
| appraisal value, appraised at, replacement value, RRV, insurance value | appraisal value | retail replacement figure; **not** a sale price |
| keystone, key, 2× cost | keystone | 100% markup (2× wholesale) |
| triple key, 3× cost | triple keystone | 3× wholesale |
| cost, cost price, wholesale, our cost, at cost, dealer/trade/net price | cost | |
| quoted, quote, got a quote, estimate | quoted | |
| commercial grade/quality/goods, promo goods, mall grade, bread-and-butter | commercial grade | mass-market quality |
| fine make, well-made, good/nice make, fine jewelry, high-end, upscale, luxury | fine make | "make" = quality of manufacture |
| poor/bad/cheap make, cheaply made, lightweight goods | poor make | |
| goods, merch, merchandise, pieces, inventory | goods | |
| findings, components | findings | |
| sweeps, floor/bench sweeps, polishing dust | sweeps | recoverable metal dust |
| hallmark, hallmarked, hall mark, HM (London/Birmingham…), assay mark, fully hallmarked | hallmarked [both] | official assay-office mark (UK: sponsor + fineness + office + date letter) |
| maker's mark, makers mark, sponsor's mark, manufacturer's mark, shop/workshop mark | maker's mark [both] | |
| signed, signed piece, designer-signed | signed [both] | bears a recognizable maker's mark |
| unsigned, not signed, no signature, unattributed | unsigned [both] | |
| unmarked, no marks, no stamp, unstamped, no hallmark | unmarked [both] | |
| stamped 14k, marked 750, stamped plat | stamped 14k | self-applied purity stamp (not an assay mark) |
| tests 14k, acid tested, tested as 18k, XRF tested, touchstone tested | tests 14k | metal verified by test |
| assay, assayed, fineness/purity test | assay | |
| touchstone | (in "tests") | acid + streak test on a black stone |
| loupe, 10× loupe, under the loupe, under magnification | under magnification | |
| for sale, FS | for sale | |
| WTB, want to buy, ISO, in search of, looking for, seeking | looking for | |
| WTS, want to sell | for sale | |
| WTT, trade-in, trade up, upgrade program | trade-in | |
| OBO, ONO, or best/nearest offer | or best offer | |
| NFS, not for sale, display only | not for sale | |
| approx, apx, appx, ~, about/around/roughly (before a number) | approximately | |
| pr, pair of, pairs of | pair of | |
| ea, each, per piece, pc, pcs | each | |
| qty | quantity | |
| w/, w (before a number/stone word) | with | |
| w/o, w/out, sans, without | without | |
| budget $5,000, under $3k, max 2000, up to $X, price range $X | budget $X | |
| sz 7, size 7, ring size 7, US 7 | size 7 | US numeric |
| UK size M, size M | UK size M | letter scale; **not converted** |
| EU 52, size 52 | EU size 52 | |
| 6 1/2, 6 and a half, 6½ | 6.5 | |

Glossary only (no variant spelling): **bench jeweler** · **goldsmith / silversmith** · **setter** · **polisher** · **model maker** · **caster** · **lost wax / investment casting** · **die-struck** · **hand-fabricated** · **CAD/CAM** · **plumb** · **dwt** · **melt value** · **spot price** · **LBMA** · **refiner** · **lot** · **parcel** (loose stones) · **sight** (De Beers) · **RapNet / Rapaport / "Rap sheet"** (diamond price list; "X% back of Rap") · **memo goods** · **layaway** · **keystone** · **MSRP** · **shrink** · **counter sketch** · **stone paper / parcel paper**.

---

## 10. Watches

Request-only unless noted; product listings already carry model names.

### Rolex

| Input | → |
|---|---|
| submariner, sub, subby, sub date | Submariner |
| no-date sub, sub no date, ND sub | Submariner no-date |
| datejust, date-just, DJ, DJ41 | Datejust (41) |
| day-date, daydate, DD40, president, presidential, prez | Day-Date (40) |
| GMT master ii, GMT ii, GMT2, GMT master, GMT | GMT-Master II |
| pepsi (bezel/GMT) | GMT-Master II red and blue bezel |
| batman, batgirl | GMT-Master II blue and black bezel |
| coke | GMT-Master II red and black bezel |
| root beer | GMT-Master II brown and black bezel |
| sprite | GMT-Master II green and black bezel |
| hulk | Submariner green dial green bezel |
| kermit, starbucks | Submariner green bezel black dial |
| smurf | Submariner white gold blue dial blue bezel |
| bluesy | Submariner two-tone blue dial |
| yacht-master, YM | Yacht-Master |
| sea-dweller, deepsea | Sea-Dweller |
| air-king | Air-King |
| oyster perpetual, OP41 | Oyster Perpetual (41) |
| explorer ii, exp 2 | Explorer II |
| explorer i, exp 1 | Explorer |
| daytona | (kept) |
| jubilee (bracelet) | Jubilee bracelet |
| oyster (bracelet) | Oyster bracelet |
| president bracelet, prez bracelet | President bracelet |
| Rolesor | two-tone [both] |
| Everose | rose gold [both] |
| Oystersteel, 904L | stainless steel |
| Cerachrom, ceramic bezel/insert | ceramic bezel |
| cyclops, date magnifier | cyclops |
| Chromalight | lume |
| ref 116610, reference 116610 | reference 116610 |
| rolex, rollie, rolly | Rolex |

### Omega

| Input | → |
|---|---|
| speedy, speedmaster pro, moonwatch | Speedmaster Professional |
| SMP, seamaster pro, seamaster diver 300m | Seamaster Professional |
| aqua terra, AT 38/41/150 | Seamaster Aqua Terra |
| planet ocean, PO 39–45/600 | Seamaster Planet Ocean |
| connie, constellation | Omega Constellation |
| Sedna gold | rose gold; Canopus/Moonshine gold → white gold |
| hesalite | acrylic crystal |

### Other brands & models

| Input | → |
|---|---|
| AP, audemars | Audemars Piguet |
| royal oak, RO 15xxx | Royal Oak |
| royal oak offshore, ROO | Royal Oak Offshore |
| jumbo, 15202, 16202 | Royal Oak Jumbo |
| patek, patek philippe | Patek Philippe |
| nautilus, 5711, 5712, 5726, 5980 | Patek Philippe Nautilus |
| aquanaut, 5167, 5168 | Patek Philippe Aquanaut |
| calatrava | Patek Philippe Calatrava |
| cartier tank, tank (louis/francaise/solo/must/anglaise/cintrée/basculante) | Cartier Tank |
| santos (de cartier/dumont/100/galbée) | Cartier Santos |
| ballon bleu | Cartier Ballon Bleu |
| pasha | Cartier Pasha |
| panthère (de cartier) | Cartier Panthère |
| JLC, jaeger, lecoultre | Jaeger-LeCoultre |
| vacheron, VC | Vacheron Constantin |
| lange, A. Lange & Söhne, Lange 1 | A. Lange & Söhne |
| honeygold | yellow gold |
| tudor black bay, BB58/54/41/36/31, pelagos | Tudor Black Bay / Tudor Pelagos |
| baume mercier | Baume & Mercier |
| franck/frank muller | Franck Muller |
| girard perregaux | Girard-Perregaux |
| glashütte (original) | Glashütte Original |
| bell & ross, B&R | Bell & Ross |
| richard mille, RM 011 | Richard Mille (011) |
| panerai, PAM 372 | Panerai (372) |
| breitling, brietling | Breitling |
| ulysse nardin | Ulysse Nardin |
| raymond weil | Raymond Weil |
| tag heuer, tag (carrera/monaco/aquaracer) | TAG Heuer |
| grand seiko, GS | Grand Seiko (plain Seiko untouched) |
| breguet, blancpain, hublot, zenith, IWC, longines, movado, bulova, hamilton, tissot, oris, ebel, concord, citizen, corum | (kept as typed — no nicknames to expand) |

### Watch vocabulary

| Input | → |
|---|---|
| automatic (movement/winding), auto, self-winding, automatique | automatic |
| manual wind, hand-wound, hand-winding, manual | manual wind |
| quartz movement/watch/battery, battery-powered | quartz movement [both] |
| chrono, chronograph | chronograph |
| COSC, chronometer, superlative chronometer | chronometer (accuracy cert — **not** chronograph) |
| moonphase, moon phase | moonphase |
| perpetual calendar, QP, quantième perpétuel | perpetual calendar |
| annual / complete / triple / full calendar | calendar complication |
| tourbillon, flying tourbillon | tourbillon |
| minute repeater, repeater | minute repeater |
| world timer, worldtime, dual time, second time zone | world time |
| GMT function/hand/complication | GMT complication |
| jump hour, jumping hours | jump hour |
| skeleton, skeletonized, openworked | skeleton |
| small seconds, sub-seconds, seconds at 6/9 | small seconds |
| big date, grande date, large date | big date |
| power reserve, PR 70h, réserve de marche | power reserve (70) |
| cal. 3135, caliber/calibre 3135 | caliber 3135 |
| 17 jewels, 17j | 17 jewel movement |
| hacking, hack seconds, stop-seconds | hacking seconds |
| dive watch, diver, diver's watch | dive watch |
| dress watch, formal watch | dress watch |
| pilot / aviator watch, flieger | pilot watch |
| field / military watch | field watch |
| sports / tool watch | sports watch |
| wristwatch, timepiece | watch |
| pocket watch, fob watch, hunter case, open-face, railroad watch | pocket watch |
| ladies watch, women's watch, cocktail watch, evening watch | ladies watch |
| midsize, mid-size, boy's size, unisex size | midsize (31–36 mm) |
| full set, box & papers, B&P, complete set | box and papers |
| papers only, with papers, warranty card | papers |
| head only, watch head, no bracelet | watch head only |
| NATO strap, zulu | NATO strap |
| leather / alligator / croc / calf strap | leather strap |
| rubber / silicone strap, Oysterflex | rubber strap |
| integrated bracelet | integrated bracelet |
| case size/diameter/width | case size |
| lug to lug, L2L | lug to lug |
| lug width, strap width | lug width |
| caseback, exhibition/display/see-through back | caseback |
| subdials, sub-dials, registers, totalizers | subdials |
| diamond bezel/dial/markers/indices/lugs | diamond-set diamond bezel… |
| factory diamonds/set/bezel/dial, OEM diamonds | factory diamond set |
| aftermarket diamonds/bezel/dial, custom diamonds, non-factory, iced out, bust down, bussdown, fully iced, flooded | aftermarket diamond set (lowers collector value; disclose) |
| tropical / tropic / faded / patina / spider / gilt dial | vintage dial patina |
| meteorite / MOP / stone / onyx / malachite / lapis / tiger's eye dial | exotic dial |
| panda dial | white dial black subdials |
| reverse panda | black dial white subdials |
| unpolished, never polished, sharp lugs, thick/fat lugs, original finish | unpolished |
| polished case, refinished, repolished | polished case |
| water resistant, WR 300m, waterproof | water resistant (300) |
| sapphire crystal/glass | sapphire crystal (watch glass) |
| acrylic / plexi / hesalite / plastic crystal | acrylic crystal |
| mineral crystal/glass, Hardlex | mineral crystal |
| lume, luminous, Super-LumiNova, Chromalight, radium/tritium dial | lume |
| fluted bezel, engine-turned bezel | fluted bezel |
| smooth / domed / plain bezel | smooth bezel |
| rotating / unidirectional / bidirectional / dive / timer bezel | rotating bezel |
| aluminum / aluminium / alu bezel | aluminum bezel |
| tachymeter, tachymetre, tachy | tachymeter |

---

## 11. Brands (jewelry) — all `[req]`

Tiffany & Co. (tiffany, tiffanys, T&Co) · Return to Tiffany (RTT) · Tiffany T · Tiffany HardWear · Tiffany & Co. Elsa Peretti (peretti, bone cuff, bean, open heart) · Tiffany & Co. Paloma Picasso · Tiffany & Co. Schlumberger · Tiffany & Co. Soleste / Victoria / Atlas · Van Cleef & Arpels (VCA, van cleef) · VCA Alhambra (alhambra, vintage/sweet/magic alhambra, VCA clover) · VCA Perlée · Cartier (Love bracelet — only with "cartier"; Juste un Clou / JUC; Trinity; Panthère) · Bvlgari (bulgari; B.zero1; Serpenti) · David Yurman (yurman; Albion; Cable — only with "yurman") · Lagos Caviar · Hearts On Fire (HOF) · Harry Winston (HW, winston) · Le Vian (levian; "chocolate diamond" → brown diamond) · Buccellati · Roberto Coin · Marco Bicego · John Hardy · David Webb · Georg Jensen · Hermès · Louis Vuitton (LV) · Verragio · Tacori · Lazare Kaplan · Mikimoto · Pandora · Chopard (Happy Diamonds) · Piaget · Pomellato · Ippolita · Judith Ripka · Kwiat · Forevermark · Graff · Boucheron · Chaumet · Mauboussin (Trabert & Hoeffer) · Fabergé · American period houses: Bailey Banks & Biddle (BB&B), Black Starr & Frost (& Gorham), Shreve Crump & Low, J.E. Caldwell, Marcus & Co., Seaman Schepps, Raymond Yard (guarded against "by the yard").

---

## 12. Uncertain / deliberately excluded

Flagged rather than guessed:

- **"Diamonique" / "Diamonaire" / "Diamonelle"** → cubic zirconia: these are QVC/HSN CZ brands; correct but low-frequency in estate trade.
- **YAG, GGG, strontium titanate** — historically significant simulants but essentially absent from modern shop-floor typing; glossary only.
- **"Cape"** (yellowish diamond) and **"blue-white"** — historical/prohibited; not rewritten because a modern typist means something else ("Cape Cod bracelet").
- **"Boy's size"** → midsize: still heard from older salespeople; kept.
- **"Gucci link"** → mariner chain: universal US trade nickname, but a customer might genuinely mean the Gucci brand. Chose the chain reading (far more common); flagged.
- **"Pink gold" → rose gold**: merged on color-family grounds (same as existing file). Some houses (Cartier "pink gold") distinguish; the metal-color gate is preserved either way since both map to rose.
- **"Red gold" → rose gold**: same logic; Russian/Eastern-European pieces. Flagged.
- **Green gold ~ yellow gold**: listed as related at *low* confidence since a customer asking for yellow may accept pale-green period gold, but it's a color gate — the note says so.
- **Ruby ~ pink sapphire**: same mineral; GIA's boundary is saturation-based and disputed. Listed as BORDERLINE with an explicit "low confidence only" note. The reasoner should treat "ruby" as a hard gemstone gate and use this only for "red/pink corundum" style requests.
- **Natural pearl ~ cultured pearl**: origin is a hard gate for diamonds; for pearls the trade routinely offers cultured to a "pearl" request. Listed as BORDERLINE with disclosure note.
- **Karat rewrites on numeric fineness (585/750/375/417/916)**: guarded against decimals and prices, but a request like "750 size" could still misfire. Request-only, so worst case is a mis-expanded request, never a corrupted product.
- **Clarity/color grade tokens (VS1, G, etc.)** are *not* rewritten or validated — "G VS1" is left verbatim for the reasoner.
- **Size systems** (US/UK/EU) are tagged, not converted. Conversion tables are a separate concern.
- **"Tennis" bare → tennis bracelet**: a request that says only "tennis" almost always means the bracelet; but "tennis-style earrings" exist; the negative lookahead guards `earr…`.
- **Pearl "grain" and "momme"**: kept only when spelled out; "mm" always means millimeters.
- **Regional "ct" for gold with karats outside {9,10,12,14,15,18,22,24}** (e.g. "20ct") is treated as carat weight. Deliberate — 20k gold is rare in English-speaking trade.
