// Chemistry Guide — plain-language reference for how every product in the
// program works. Mirrors the printed booklet ("How Our Chemistry Works").
// Content compiled from product labels + standard turf references (FRAC/HRAC
// classifications, university extension). Educational only — the label is the
// law. Anywhere a card is marked verify:true, confirm the AI before acting.

// Semantic category hues — one per job the chemistry does.
export const CHEM_HUES = {
  fung: '#0E7C7B', // Protect — teal
  pgr: '#6D4AC2',  // Regulate — violet
  def: '#C2622A',  // Defend — burnt orange
  fert: '#C9A84C', // Feed — amber/gold
  bio: '#8A6D3B',  // Build — brown
  herb: '#C0392B', // Control — red
  wet: '#2E6F9E',  // Move water — blue
  ins: '#9C3587',  // Control (insects) — plum
  other: '#64748B',// Other — slate
}

// The categories the "Add a product" form offers, and how each maps onto a
// guide section + hue. The label strings match the AI label-reader's enum so a
// scanned product drops straight into the right section.
export const CHEM_CATEGORIES = [
  { label: 'Fungicide', sectionId: 'fungicides', hue: 'fung' },
  { label: 'Growth regulator', sectionId: 'pgrs', hue: 'pgr' },
  { label: 'Plant defense', sectionId: 'defense', hue: 'def' },
  { label: 'Fertility', sectionId: 'fertility', hue: 'fert' },
  { label: 'Biological', sectionId: 'biologicals', hue: 'bio' },
  { label: 'Herbicide', sectionId: 'herbicides', hue: 'herb' },
  { label: 'Insecticide', sectionId: 'insecticides', hue: 'ins' },
  { label: 'Wetting agent', sectionId: 'wetting', hue: 'wet' },
  { label: 'Other', sectionId: 'other', hue: 'other' },
]

// Section meta for categories that have no built-in section above (so team-added
// products in these classes still render under a proper header).
export const CHEM_EXTRA_SECTIONS = {
  insecticides: { id: 'insecticides', hue: 'ins', title: 'Insecticides', tag: 'Control', heading: 'Insecticides — controlling insects', intro: 'Insecticides target a process the insect needs. Like fungicides they carry a resistance group (the IRAC number) — rotate modes of action to keep them working.' },
  other: { id: 'other', hue: 'other', title: 'Other', tag: '', heading: 'Other products', intro: 'Products your team added that don’t fall into the classes above.' },
}

// The "big idea" — every product is doing one of a few jobs.
export const CHEM_JOBS = [
  { job: 'Protect', hue: 'fung', blurb: 'Stop or slow disease — the fungicides.' },
  { job: 'Regulate', hue: 'pgr', blurb: 'Manage growth — the PGRs.' },
  { job: 'Feed', hue: 'fert', blurb: 'Supply nutrients — the fertility.' },
  { job: 'Defend', hue: 'def', blurb: "Switch on the plant's own immunity — SAR." },
  { job: 'Build', hue: 'bio', blurb: 'Feed the soil biology — biologicals.' },
  { job: 'Move water', hue: 'wet', blurb: 'Rewet the rootzone — wetting agents.' },
]

// Each section: a class of chemistry with an intro + product cards.
// card fields: name, chip, ai, group, how, why, note, verify
export const CHEM_SECTIONS = [
  {
    id: 'fungicides',
    hue: 'fung',
    title: 'Fungicides',
    tag: 'Protect',
    heading: 'Fungicides — protecting the plant',
    intro:
      'Two families. Contact (multi-site) fungicides sit on the leaf surface and hit the fungus in many places at once — they can’t move into the plant, so they must be down before infection and reapplied on a tight interval, but resistance almost never develops. Systemic (single-site) fungicides move into the plant and shut down one specific fungal process — longer-lasting and can reach established infections, but because they hit one target, the fungus can adapt, so we rotate groups and often tank-mix a contact to protect them. The FRAC number is the group; same number back-to-back is how resistance gets selected.',
    cards: [
      { name: 'Daconil Action', chip: 'Contact + SAR', ai: 'chlorothalonil + acibenzolar-S-methyl', group: 'FRAC M05 · multi-site + host defense',
        how: 'Chlorothalonil binds fungal enzymes at many sites on the leaf surface, killing spores before they establish. The acibenzolar half switches on the plant’s own defenses (see Plant defense below).',
        why: 'The broad protectant backbone — dollar spot, leaf spot, anthracnose. Very low resistance risk, so it protects the single-site partners it’s mixed with.',
        note: 'Protectant only — it can’t cure an active infection. Get it down ahead of pressure and hold the interval.' },
      { name: 'Secure Action', chip: 'Contact + SAR', ai: 'fluazinam + acibenzolar-S-methyl', group: 'FRAC 29 · multi-target + host defense',
        how: 'Fluazinam uncouples the fungus’s energy production (it can’t make ATP), acting broadly rather than on one site — plus the SAR activator.',
        why: 'Hard-hitting dollar spot contact with a low resistance risk; a strong rotational partner in dollar-spot season.' },
      { name: 'Subdue MAXX', chip: 'Systemic', ai: 'mefenoxam', group: 'FRAC 4 · phenylamide',
        how: 'Moves in the plant and blocks RNA synthesis in water molds (Oomycetes). It only touches Pythium-type organisms — it does nothing to true fungi like dollar spot or brown patch.',
        why: 'Pythium blight and Pythium root dysfunction — our targeted tool when the soil is hot and wet.',
        note: 'High resistance risk. FRAC 4 is single-site and Pythium adapts fast — limit apps and always rotate.', risk: 'hi' },
      { name: 'Insignia SC', chip: 'Systemic', ai: 'pyraclostrobin', group: 'FRAC 11 · QoI / strobilurin',
        how: 'Blocks fungal respiration at complex III — the fungus can’t breathe. Broad spectrum, with modest “plant-health” side benefits.',
        why: 'Brown patch, large patch, anthracnose, Pythium suppression.',
        note: 'High resistance risk. Never run FRAC 11 solo back-to-back — rotate and mix with a multi-site.', risk: 'hi' },
      { name: 'Xzemplar', chip: 'Systemic', ai: 'fluxapyroxad', group: 'FRAC 7 · SDHI',
        how: 'Inhibits succinate dehydrogenase (complex II) in fungal respiration — another energy-pathway block, different site than the strobilurins.',
        why: 'Dollar spot and brown patch with long residual; strong rotational partner to the QoIs.',
        note: 'Rotate. FRAC 7 is single-site — don’t lean on it repeatedly.' },
      { name: 'Chipco 26GT', chip: 'Local systemic', ai: 'iprodione', group: 'FRAC 2 · dicarboximide',
        how: 'Disrupts the fungus’s stress-signalling pathway, stopping spore germination and growth.',
        why: 'Dollar spot, brown patch, leaf spot — an older, reliable rotational chemistry.' },
      { name: 'Densicor', chip: 'Systemic', ai: 'prothioconazole', group: 'FRAC 3 · DMI / triazole',
        how: 'Blocks ergosterol production — the fungus can’t build its cell membranes. As a side effect, DMIs mildly regulate turf growth too (why the app counts them in the growth model).',
        why: 'Broad curative + preventive: dollar spot, brown patch, anthracnose, summer patch.' },
    ],
  },
  {
    id: 'pgrs',
    hue: 'pgr',
    title: 'Growth regulators',
    tag: 'Regulate',
    heading: 'Growth regulators — managing growth',
    intro:
      'PGRs don’t feed or protect — they slow the plant down. They interrupt gibberellic acid (GA), the hormone that drives cell elongation. Less elongation means tighter, denser turf, fewer clippings, better color and more stress tolerance — the growth doesn’t stop, it gets redirected into roots and lateral density. The effect wears off on a degree-day clock (that’s what the GDD & Growth screen tracks), and if you run past it the turf rebounds — surges above normal — so timing is everything.',
    cards: [
      { name: 'Primo MAXX', chip: 'PGR · Class A', ai: 'trinexapac-ethyl', group: 'Late-stage GA inhibitor',
        how: 'Blocks the final step of GA synthesis. Foliar-absorbed and fast, which is why it’s timed by GDD (~200 base 0°C on greens).',
        why: 'Denser canopy, fewer clippings, tighter surfaces, better heat/stress tolerance. The backbone of the growth program.' },
      { name: 'Anuew', chip: 'PGR', ai: 'prohexadione-calcium', group: 'GA inhibitor · earlier step',
        how: 'Also blocks GA, but at an earlier point than trinexapac — so it stacks with Primo for stronger, more even suppression.',
        why: 'Strong Poa annua suppression, lateral growth, reduced clipping yield — often paired with Primo.' },
    ],
  },
  {
    id: 'defense',
    hue: 'def',
    title: 'Plant defense (SAR)',
    tag: 'Defend',
    heading: 'Plant-defense activators — the built-in immune system',
    intro:
      'This one surprises people: acibenzolar-S-methyl (the “Action” in Daconil Action and Secure Action) is not a fungicide. It doesn’t kill anything. It triggers Systemic Acquired Resistance (SAR) — it switches on the plant’s own immune response so the turf defends itself faster and harder when a pathogen shows up. Think of it as a vaccination: it primes the defenses ahead of time.',
    cards: [
      { name: 'Acibenzolar-S-methyl', chip: 'SAR activator', ai: 'In: Daconil Action, Secure Action', group: 'Host plant defense inducer',
        how: 'Mimics the plant’s natural alarm signal, turning on defense genes before infection so the response is already loaded when disease arrives.',
        why: 'Works preventively, alongside a real fungicide — not a rescue. It’s part of why the “Action” formulations hold dollar spot so well.' },
    ],
  },
  {
    id: 'fertility',
    hue: 'fert',
    title: 'Fertility',
    tag: 'Feed',
    heading: 'Fertility — feeding the plant',
    intro:
      'The analysis on the jug (N-P-K) tells you the job. Each nutrient does something specific — and just as important is what a product won’t do: a 0-52-34 feeds without pushing top-growth, which matters when you’re trying to hold the surface. We spoon-feed foliar so the plant takes it up directly and we control the response.',
    cards: [
      { name: '46-0-0 Urea', chip: 'Nitrogen', ai: 'Analysis: 46-0-0', group: 'N — growth & color',
        how: 'Nitrogen drives shoot growth, color and recovery — the pedal. Small, frequent foliar doses keep color without a growth flush.',
        note: 'Too much N = soft, disease-prone growth and more mowing. Restraint in summer.' },
      { name: 'MKP 0-52-34', chip: 'P + K', ai: 'Mono-potassium phosphate · 0-52-34', group: 'Phosphorus & potassium, no N',
        how: 'Phosphorus fuels roots and energy (ATP); potassium builds stress tolerance and cell turgor. Zero nitrogen, so it strengthens without pushing growth.',
        why: 'Root strength and stress-proofing during aggressive growth-regulation and heat.' },
      { name: 'Hydra-Kace 0-0-29', chip: 'Potassium', ai: 'Analysis: 0-0-29', group: 'K — stress & water',
        how: 'Potassium regulates the plant’s water use and hardens it against heat, drought and wear — the “conditioning” nutrient.' },
      { name: 'Hydra-Cal', chip: 'Calcium', ai: 'AI: calcium', group: 'Ca — structure & firmness',
        how: 'Calcium is the glue in cell walls — it firms the plant, strengthens new roots and helps the surface hold up.' },
      { name: 'Hydra-Mn Combo', chip: 'Micronutrient', ai: 'AI: manganese (+ magnesium)', group: 'Mn / Mg — photosynthesis',
        how: 'Manganese drives photosynthesis and helps suppress take-all; magnesium is the core of the chlorophyll molecule — both feed color and energy.',
        note: 'Verify the label — confirm the exact micro blend (Mn vs Mg ratio) for this product before adjusting rates.', verify: true },
      { name: 'HydraPush', chip: 'Fertility', ai: 'AI per label', group: 'Nutrient / carrier blend',
        how: 'A foliar fertility/carrier blend in the Hydra line — check the current label for the exact analysis and role in the tank.', verify: true },
    ],
  },
  {
    id: 'biologicals',
    hue: 'bio',
    title: 'Biologicals',
    tag: 'Build',
    heading: 'Biologicals & biostimulants — feeding the soil',
    intro:
      'These don’t work on the plant the way a fungicide or a fertilizer does — they work on the soil food web. Amino acids, carbon, humic substances and microbes feed and stimulate the soil biology that cycles nutrients, builds structure and out-competes pathogens. Be honest about the evidence: it’s the long game — soil health, efficiency and resilience over a season — not an overnight knockdown. It’s the “building the bank” half of the program.',
    cards: [
      { name: 'Earthworks Protein Plus', chip: 'Biological', ai: 'Protein / amino-acid based · carbon-rich N', group: 'Biostimulant + efficient N',
        how: 'Feeds the turf and the soil microbes with proteins and amino acids — a carbon-rich, nitrogen-efficient source that supplies building blocks and cofactors rather than a raw salt hit.',
        why: 'Steady, gentle feeding that builds soil biology and colour without a growth surge — pairs with the mineral fertility.' },
      { name: 'The Hydra / bio line', chip: 'Biological', ai: 'Calcium, manganese, potassium carriers', group: 'Nutrient + biostimulant delivery',
        how: 'These carry a nutrient and a biostimulant/carbon package, so the plant takes the nutrient up efficiently while the soil biology gets fed at the same time.',
        note: '“Biological” on our sheet flags a soil-health product — read it as feeding the system, not spot-treating a problem.' },
    ],
  },
  {
    id: 'herbicides',
    hue: 'herb',
    title: 'Herbicides',
    tag: 'Control',
    heading: 'Herbicides — removing weeds',
    intro:
      'Herbicides shut down a process the weed needs but the desirable turf can tolerate (or that only exists in certain plants). Like fungicides they carry resistance groups — the HRAC number — and the same rotation logic applies. Post-emergents work on plants that are already up; timing to weed size matters as much as rate.',
    cards: [
      { name: 'Sedgehammer', chip: 'Herbicide', ai: 'halosulfuron-methyl', group: 'HRAC Group 2 · ALS inhibitor',
        how: 'Blocks the ALS enzyme, halting production of the amino acids the plant needs to build protein — the sedge starves from the inside. Slow and systemic.',
        why: 'Yellow and purple nutsedge — one of the few tools that reaches the tubers.' },
      { name: 'Acclaim Extra', chip: 'Herbicide', ai: 'fenoxaprop-p-ethyl', group: 'HRAC Group 1 · ACCase inhibitor',
        how: 'Blocks ACCase, the enzyme grasses use to build fatty acids for new growth — it stops grassy weeds specifically while broadleaf turf shrugs it off.',
        why: 'Post-emergent crabgrass and goosegrass — best on young plants.' },
    ],
  },
  {
    id: 'wetting',
    hue: 'wet',
    title: 'Wetting agents',
    tag: 'Move water',
    heading: 'Wetting agents — moving water',
    intro:
      'A wetting agent (surfactant) doesn’t feed or protect — it changes how water behaves. It lowers water’s surface tension so it wets waxy, water-repellent (hydrophobic) sand instead of beading up and running off, and it pulls moisture down into the rootzone where the roots are, evenly. The result is uniform moisture and no localized dry spot. They wear off on a schedule — which is exactly what the Wetting Agent Timing screen tracks by degree-days and confirms with your moisture readings.',
    cards: [
      { name: 'Soil surfactants', chip: 'Wetting agent', ai: 'Revolution, Dispatch, Cascade, OARS, Fifty90…', group: 'Water-management chemistry',
        how: 'Coats sand particles so water spreads and infiltrates instead of repelling; some hold water in the rootzone, others flush it through — matched to your soil and season.',
        why: 'Effect fades as it breaks down — the app’s degree-day clock plus your moisture-uniformity readings tell you when it’s wearing off, before you see a dry spot.' },
    ],
  },
]

// Rotation primer — the "why" behind the resistance warnings.
export const CHEM_ROTATION = {
  heading: 'Reading the label & rotating chemistry',
  title: 'The one habit that protects the whole program',
  body: [
    'Every fungicide, herbicide and insecticide carries a group number — FRAC for fungicides, HRAC for herbicides, IRAC for insecticides. That number is the mode of action. Two products with the same number attack the same target the same way — so using the same number over and over is exactly how you breed resistance and lose the chemistry for good.',
    'The rule of thumb: rotate group numbers, and when you spray a high-risk single-site product, tank-mix a low-risk multi-site (like chlorothalonil) to cover it. The app’s spray program already flags when a group repeats inside its resistance window — this is the “why” behind those warnings.',
  ],
  low: 'Chlorothalonil (M05), fluazinam (29). Hit the fungus in many places at once — safe to lean on and ideal mix partners.',
  high: 'QoI (11), SDHI (7), DMI (3), dicarboximide (2), phenylamide (4). Powerful and long-lasting, but rotate and protect them.',
  golden: 'And the golden rule for everything in this guide: the label is the law. Active ingredients, group numbers, rates, re-entry intervals and site clearances change — always confirm against the current product label before you mix. This guide explains the why; the label sets the how.',
}
