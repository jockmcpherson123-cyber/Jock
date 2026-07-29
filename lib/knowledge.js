// ── Knowledge Center ─────────────────────────────────────────────────────────
// Curated agronomic reference: turf disease / weed / insect profiles (keyed to
// the same ids the risk models use, so a risk score can link straight to "what
// it is and what to do"), plus the essential plant nutrients. General guidance —
// always follow the product label and local extension recommendations.

// kind: 'Disease' | 'Weed' | 'Insect'
// grasses: lowercase tokens ('bent','poa','rye','bluegrass','fescue','bermuda',
// 'zoysia') or ['any'] — matches lib/pests.js so the two stay in sync.
export const PROFILES = [
  {
    id: 'dollar_spot', name: 'Dollar spot', kind: 'Disease', grasses: ['any'],
    pathogen: 'Clarireedia spp. (formerly Sclerotinia homoeocarpa)',
    blurb: 'The most common and costly disease on cool-season greens and fairways. Small, silver-dollar-sized straw-colored spots that can merge into larger blighted areas.',
    favoredBy: 'Warm days (60–85°F), mild humid nights with heavy dew, long leaf-wetness periods, and low nitrogen. Classic warm-day/cool-humid-night pattern.',
    identify: 'Sunken, bleached spots ~1–3" across; hourglass lesions on leaf blades with tan centers and reddish-brown borders. White cottony mycelium in early-morning dew.',
    manage: 'Keep nitrogen adequate (low N raises risk). Remove dew early (mow, roll, or drag). Rotate FRAC groups (DMI, SDHI, nitrile) to avoid resistance — it develops readily. Extend intervals in cool/dry spells.',
  },
  {
    id: 'brown_patch', name: 'Brown patch', kind: 'Disease', grasses: ['any'],
    pathogen: 'Rhizoctonia solani',
    blurb: 'Circular patches in hot, humid weather — especially on tall fescue, ryegrass and bentgrass.',
    favoredBy: 'Warm nights (≥60°F), warm days (≥80°F), high humidity and extended leaf wetness. High nitrogen and lush growth worsen it.',
    identify: 'Roughly circular patches a few inches to several feet; a grayish "smoke ring" at the margin in the morning on close-cut turf. Tan, water-soaked lesions on leaves.',
    manage: 'Avoid excess nitrogen in summer. Improve air movement and drainage; water early so leaves dry by evening. Preventive fungicides (SDHI, QoI, DMI) on a rotation during high-risk stretches.',
  },
  {
    id: 'pythium', name: 'Pythium blight', kind: 'Disease', grasses: ['bent', 'poa', 'rye', 'bluegrass', 'fescue'],
    pathogen: 'Pythium spp.',
    blurb: 'A fast, destructive disease that can wipe out turf overnight in hot, saturated conditions. Follows drainage and mowing patterns.',
    favoredBy: 'Hot days (≥86°F), warm nights (≥68°F), very high humidity and standing water / poor drainage. Spreads along water flow and equipment.',
    identify: 'Greasy, water-soaked, dark patches that collapse quickly; cottony white mycelium in early morning. Often in streaks following surface drainage.',
    manage: 'Improve drainage and airflow; avoid evening irrigation and mowing wet turf. This is an oomycete — needs Pythium-specific chemistry (e.g. mefenoxam, cyazofamid, phosphonates, ethazole); most fungicides do not touch it. Act preventively before hot, wet spells.',
  },
  {
    id: 'anthracnose', name: 'Anthracnose', kind: 'Disease', grasses: ['poa', 'bent'],
    pathogen: 'Colletotrichum cereale',
    blurb: 'Foliar blight and basal rot, most damaging on stressed annual bluegrass greens.',
    favoredBy: 'Stress — low nitrogen, low mowing, drought, compaction. Warm, humid weather. Poa annua under summer stress is most vulnerable.',
    identify: 'Yellow-to-bronze irregular patches; black fruiting bodies (acervuli) with tiny spines visible under a hand lens. Basal rot blackens the crown/stem base.',
    manage: 'Reduce stress: raise mowing height slightly, keep nitrogen adequate, relieve compaction, manage moisture. Rotate fungicides (QoI, DMI, SDHI, benzimidazole) preventively on Poa greens.',
  },
  {
    id: 'gray_leaf', name: 'Gray leaf spot', kind: 'Disease', grasses: ['rye', 'fescue'],
    pathogen: 'Pyricularia grisea',
    blurb: 'Explosive blighting of perennial ryegrass (and tall fescue), especially late summer.',
    favoredBy: 'Hot days (≥86°F), warm nights (≥70°F), prolonged leaf wetness/humidity. Newly seeded rye and high-nitrogen turf are most at risk.',
    identify: 'Gray-to-tan leaf lesions with dark borders; twisted, "fishhook" leaf tips. Rapid thinning that can look like drought.',
    manage: 'Avoid high nitrogen in late summer; water to minimize leaf wetness. Preventive fungicides (QoI, DMI) during the risk window — resistance to QoI is common, so rotate.',
  },
  {
    id: 'microdochium', name: 'Microdochium patch', kind: 'Disease', grasses: ['bent', 'poa', 'rye', 'fescue', 'bluegrass'],
    pathogen: 'Microdochium nivale',
    blurb: 'Cool-season patch disease (also called pink snow mold) active in cold, wet weather — no snow required.',
    favoredBy: 'Cool temps (32–55°F), high humidity, prolonged leaf wetness and rain. Fall through spring; under snow cover too.',
    identify: 'Small water-soaked spots enlarging to tan/pink patches a few inches across; pinkish mycelium at margins in wet conditions.',
    manage: 'Avoid late-fall nitrogen flushes; improve drainage and airflow; remove leaf debris. Preventive fungicides ahead of cold, wet periods and before snow cover.',
  },
  {
    id: 'large_patch', name: 'Large patch', kind: 'Disease', grasses: ['zoysia', 'bermuda'],
    pathogen: 'Rhizoctonia solani AG2-2 LP',
    blurb: 'A warm-season-turf disease (zoysia, bermuda) active in the transition seasons.',
    favoredBy: 'Soil ~50–70°F with moisture, in spring green-up and fall dormancy. Excess water and thatch worsen it.',
    identify: 'Large circular patches (often several feet) with orange-firing at the advancing edge; rotted leaf sheaths that pull away easily.',
    manage: 'Time preventive fungicides to soil temperature in fall (and spring). Reduce thatch, improve drainage, avoid spring nitrogen before full green-up.',
  },
  {
    id: 'summer_patch', name: 'Summer patch', kind: 'Disease', grasses: ['poa', 'bluegrass', 'fescue', 'bent'],
    pathogen: 'Magnaporthiopsis poae',
    blurb: 'A root-infecting patch disease of Poa annua, Kentucky bluegrass and fine fescue that shows up as summer heat arrives.',
    favoredBy: 'Root infection begins as soil warms through ~65°F at 2" in spring; symptoms appear later under summer heat/drought stress.',
    identify: 'Rings and crescents of yellow-to-straw turf, often with a green tuft in the center ("frog-eye"). Dark, rotted roots.',
    manage: 'Preventive fungicides applied in spring at the soil-temperature window (drenched to the roots) — curative sprays in summer are far less effective. Raise mowing height, avoid drought stress, use acidifying N.',
  },
  {
    id: 'spring_dead_spot', name: 'Spring dead spot', kind: 'Disease', grasses: ['bermuda'],
    pathogen: 'Ophiosphaerella spp.',
    blurb: 'The most serious disease of bermudagrass — circular dead patches that appear at spring green-up.',
    favoredBy: 'Infection in fall as soil cools through ~55–70°F; damage revealed in spring. Worse on high-maintenance, heavily thatched, poorly drained bermuda.',
    identify: 'Bleached, sunken circular patches (inches to feet) that stay dead into spring while surrounding turf greens up; dark rotted roots and stolons.',
    manage: 'Fall fungicides at the soil-temperature window are the key preventive step. Reduce thatch, improve drainage, avoid late-season high nitrogen, use ammonium-based N.',
  },
  {
    id: 'crabgrass', name: 'Crabgrass', kind: 'Weed', grasses: ['any'],
    pathogen: 'Digitaria spp.',
    blurb: 'Summer annual grassy weed that germinates in spring and thrives in thin, hot turf.',
    favoredBy: 'Soil warming through ~55°F (≈ forsythia bloom); thin turf, low mowing, compaction and moist surfaces.',
    identify: 'Light-green, coarse, spreading grass with finger-like seedheads; prostrate growth that roots at nodes.',
    manage: 'Apply a pre-emergent before germination (soil ~55°F / early crabgrass GDD). Maintain dense turf and adequate mowing height. Post-emergent options exist but are easiest on young plants.',
  },
  {
    id: 'goosegrass', name: 'Goosegrass', kind: 'Weed', grasses: ['any'],
    pathogen: 'Eleusine indica',
    blurb: 'Tough summer annual that germinates about two weeks after crabgrass and tolerates close mowing and compaction.',
    favoredBy: 'Soil warming past ~60–65°F; compacted, wet, thin areas — cart paths, approaches, worn collars.',
    identify: 'Flattened "goosefoot" rosette with a white-to-silver center; zipper-like seedheads. Very tough to pull.',
    manage: 'Pre-emergent timed a bit later than crabgrass (soil ~60–65°F). Relieve compaction and improve drainage. Post-emergent control is difficult — treat young plants.',
  },
  {
    id: 'poa_germ', name: 'Annual bluegrass (Poa annua)', kind: 'Weed', grasses: ['any'],
    pathogen: 'Poa annua',
    blurb: 'The classic invasive/weed grass of cool-season turf — prolific seedhead producer that fills gaps.',
    favoredBy: 'Germinates as soil cools below ~70°F (mainly a fall flush, favored 50–64°F); thrives in moist, compacted, close-cut turf.',
    identify: 'Light-green, fine-bladed clumps with boat-shaped leaf tips; abundant whitish seedheads even at low mowing.',
    manage: 'Fall pre-emergent ahead of the germination window; reduce compaction and surface moisture. Where Poa is the desired surface, manage it agronomically instead.',
  },
  {
    id: 'abw', name: 'Annual bluegrass weevil (ABW)', kind: 'Insect', grasses: ['poa', 'bent'],
    pathogen: 'Listronotus maculicollis',
    blurb: 'A damaging insect of Poa annua and bentgrass on greens, tees and fairway edges in the Northeast/transition zone.',
    favoredBy: 'Adults migrate in early spring; multiple overlapping generations through summer. Damage concentrates on Poa-dominant, close-cut turf.',
    identify: 'Small yellow-to-straw patches spreading from collars/edges; larvae (legless, cream with brown head) in the crown/thatch; adults are small black weevils.',
    manage: 'Target the most susceptible stage: adults at first migration, or small larvae (egg-lay window by GDD). Rotate insecticide chemistry (IRAC groups). Monitor with soap flushes / thatch checks.',
  },
  {
    id: 'white_grub', name: 'White grubs', kind: 'Insect', grasses: ['any'],
    pathogen: 'Scarab larvae (Japanese beetle, chafers, etc.)',
    blurb: 'Root-feeding larvae that cause wilting, thinning and turf that pulls up like carpet; secondary animal digging.',
    favoredBy: 'Adult flight in early summer; eggs hatch to young grubs in mid-to-late summer — the best treatment window.',
    identify: 'C-shaped white larvae in the top few inches of soil; irregular wilting/browning that peels back with no roots. Skunks/birds digging.',
    manage: 'Preventive products (e.g. chlorantraniliprole) applied ahead of egg hatch; curative products against young grubs. Confirm thresholds by scouting (cup-cutter counts). Water in soil-applied insecticides.',
  },
  {
    id: 'billbug', name: 'Bluegrass billbug', kind: 'Insect', grasses: ['bluegrass', 'rye', 'fescue'],
    pathogen: 'Sphenophorus parvulus',
    blurb: 'A weevil whose larvae hollow out stems and feed on crowns, causing drought-like thinning that resists watering.',
    favoredBy: 'Adults active in spring; larvae feed early-to-mid summer. Damage often mistaken for drought or dormancy.',
    identify: 'Adult billbugs (small, snout-nosed weevils) crossing paths in spring; stems break easily and are packed with fine, sawdust-like frass. Turf pulls up at the crown.',
    manage: 'Target adults in spring or small larvae early summer (by GDD). Endophyte-enhanced grasses resist billbugs; maintain healthy, non-drought-stressed turf.',
  },
]

export function profileById(id) {
  return PROFILES.find((p) => p.id === id) || null
}

// ── Essential plant nutrients (14 mineral elements) ──────────────────────────
// tier: 'Primary' | 'Secondary' | 'Micro'
export const NUTRIENTS = [
  { sym: 'N', name: 'Nitrogen', tier: 'Primary', mobile: true, role: 'Drives shoot growth, density and color; the nutrient you apply most. Central to proteins and chlorophyll.', deficiency: 'Uniform pale-green to yellow older leaves, thin slow growth. Excess brings lush, disease-prone growth and thatch.', sources: 'Urea, ammonium sulfate, methylene urea, polymer-coated ureas, organics.' },
  { sym: 'P', name: 'Phosphorus', tier: 'Primary', mobile: true, role: 'Energy transfer and rooting; most important for seedlings and establishment.', deficiency: 'Dark green to purple/red tint on older leaves, weak rooting, slow establishment.', sources: 'MAP, DAP, triple superphosphate. Often restricted by law on established turf — soil-test first.' },
  { sym: 'K', name: 'Potassium', tier: 'Primary', mobile: true, role: 'Stress, wear, cold and drought tolerance; water regulation. The "health" nutrient.', deficiency: 'Yellowing/scorching along older-leaf margins, poor stress and disease tolerance.', sources: 'Potassium sulfate, potassium chloride (muriate), potassium nitrate.' },
  { sym: 'Ca', name: 'Calcium', tier: 'Secondary', mobile: false, role: 'Cell-wall structure and root development; rarely deficient in turf.', deficiency: 'Distorted new growth and root tips (rare). Managed more for soil structure/pH than turf response.', sources: 'Gypsum (no pH change), lime (raises pH), calcium nitrate.' },
  { sym: 'Mg', name: 'Magnesium', tier: 'Secondary', mobile: true, role: 'Central atom of chlorophyll; photosynthesis.', deficiency: 'Interveinal yellowing of older leaves (veins stay green); sandy, high-K soils most at risk.', sources: 'Epsom salt (magnesium sulfate), dolomitic lime, K-Mag.' },
  { sym: 'S', name: 'Sulfur', tier: 'Secondary', mobile: false, role: 'Proteins and color; mildly acidifies soil. Increasingly limiting as air deposition has dropped.', deficiency: 'General yellowing resembling nitrogen but on newer leaves; common on sandy soils.', sources: 'Ammonium sulfate, elemental sulfate, gypsum, K-Mag.' },
  { sym: 'Fe', name: 'Iron', tier: 'Micro', mobile: false, role: 'Chlorophyll synthesis; delivers deep green color without pushing growth — a favorite for greens.', deficiency: 'Interveinal yellowing of new leaves; common in high-pH or waterlogged soils.', sources: 'Ferrous sulfate, chelated iron (foliar). Fast, temporary color response.' },
  { sym: 'Mn', name: 'Manganese', tier: 'Micro', mobile: false, role: 'Photosynthesis and enzyme function; linked to disease resistance (e.g. take-all).', deficiency: 'Interveinal chlorosis of young leaves; high-pH sands most prone.', sources: 'Manganese sulfate, chelates (foliar).' },
  { sym: 'Zn', name: 'Zinc', tier: 'Micro', mobile: false, role: 'Enzyme systems and growth-hormone (auxin) production.', deficiency: 'Stunted growth and small, mottled new leaves (rare in turf).', sources: 'Zinc sulfate, chelates.' },
  { sym: 'Cu', name: 'Copper', tier: 'Micro', mobile: false, role: 'Enzyme reactions and lignin; needed in very small amounts.', deficiency: 'Wilted, blue-green new growth and dieback (rare; sandy/organic soils).', sources: 'Copper sulfate, chelates. Easy to over-apply — go by soil test.' },
  { sym: 'B', name: 'Boron', tier: 'Micro', mobile: false, role: 'Cell-wall formation and pollen/seed development; narrow safe range.', deficiency: 'Distorted, brittle new growth. Toxicity is a bigger risk than deficiency — apply carefully.', sources: 'Borax, Solubor (very low rates).' },
  { sym: 'Mo', name: 'Molybdenum', tier: 'Micro', mobile: false, role: 'Nitrogen metabolism (nitrate reduction); needed in the smallest amount of all.', deficiency: 'Pale, nitrogen-like yellowing; more likely on acidic soils.', sources: 'Sodium molybdate (trace rates); often corrected by raising low pH.' },
  { sym: 'Cl', name: 'Chlorine', tier: 'Micro', mobile: true, role: 'Osmosis, water regulation and disease suppression.', deficiency: 'Wilting and chlorosis (very rare — usually plentiful from water and fertilizers).', sources: 'Potassium chloride, irrigation water.' },
  { sym: 'Ni', name: 'Nickel', tier: 'Micro', mobile: true, role: 'Part of the urease enzyme that lets plants use urea nitrogen. The most recently confirmed essential element.', deficiency: 'Extremely rare in turf; urea toxicity symptoms if truly deficient.', sources: 'Trace amounts in most fertilizers and soils — rarely applied.' },
]
