import { Client, GatewayIntentBits } from 'discord.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

// 15-min memory per user
const userMemory = new Map();

// === MASTER GCSE TOPIC MAP ===
const masterTopics = {
  // --- BIOLOGY ---
  "cell structure": "Cells are the basic units of life. Animal cells: nucleus, cytoplasm, membrane. Plant cells: cell wall, chloroplasts, vacuole.",
  "cell division": "Mitosis: identical cells for growth/repair. Meiosis: gametes with half chromosomes for sexual reproduction.",
  "organ systems": "Digestive, circulatory, respiratory, nervous, endocrine, excretory systems. Organs form systems.",
  "transport in humans": "Blood carries oxygen/nutrients; arteries, veins, capillaries; heart structure and circulation.",
  "homeostasis": "Maintaining stable internal conditions: temperature, water, blood glucose. Feedback loops.",
  "enzymes": "Biological catalysts. Specific substrate. Rate affected by temperature, pH, concentration.",
  "photosynthesis": "6CO2 + 6H2O → C6H12O6 + 6O2. Light energy → chemical energy in chloroplasts.",
  "respiration": "Aerobic: glucose + O2 → CO2 + H2O + energy. Anaerobic: glucose → lactic acid (animals) or ethanol + CO2 (yeast/plants).",
  "diffusion osmosis active transport": "Diffusion: high→low concentration. Osmosis: water across membrane. Active transport: against gradient, needs energy.",
  "genetics": "DNA → chromosomes → genes. Alleles, homozygous/heterozygous, Punnett squares, inheritance.",
  "evolution": "Variation, selection, adaptation, survival of fittest, evolution over generations.",
  "ecology": "Ecosystems, food chains/webs, energy transfer, nutrient cycles, population dynamics, human impact.",
  "disease and immunity": "Pathogens, vaccinations, antibiotics, lifestyle, white blood cells, antibodies.",

  // --- CHEMISTRY ---
  "atomic structure": "Atoms: protons, neutrons, electrons. Relative atomic mass, isotopes, electronic configuration.",
  "periodic table": "Elements by atomic number; groups/families; trends, metals/non-metals, transition metals.",
  "bonding": "Ionic, covalent, metallic. Properties determined by bonding type.",
  "chemical reactions": "Exothermic/endothermic, displacement, neutralisation, combustion, precipitation, redox reactions.",
  "quantitative chemistry": "RFM, moles, reacting masses, concentration, limiting reagents, percentage yield.",
  "rates of reaction": "Collision theory: concentration, temperature, catalysts, surface area.",
  "energy changes": "Exothermic releases energy; endothermic absorbs. Enthalpy change calculations.",
  "electrolysis": "Ionic compounds split using electricity. Cations → cathode, anions → anode.",
  "acids and bases": "pH, strong/weak acids, neutralisation, salts, indicators.",
  "organic chemistry": "Hydrocarbons (alkanes, alkenes, alcohols, carboxylic acids), functional groups, polymerisation.",
  "chemical analysis": "Purity, chromatography, spectroscopy, gas/ion tests.",

  // --- PHYSICS ---
  "forces": "Force causes acceleration/deformation. F=ma, Newton’s laws, moments, pressure, terminal velocity.",
  "motion": "Speed, velocity, acceleration: v=d/t, a=Δv/t. Motion graphs.",
  "energy": "Kinetic, thermal, chemical, gravitational potential, elastic. Work: W=Fd, Power: P=W/t, efficiency.",
  "waves": "Transverse/longitudinal, speed, frequency, wavelength, reflection/refraction, sound & EM spectrum.",
  "electricity": "Current, voltage, resistance: V=IR. Series/parallel circuits. Power: P=VI. Domestic electricity.",
  "magnetism": "Magnetic fields, electromagnets, motor effect, electromagnetic induction.",
  "pressure": "Pressure = force/area; gas laws: pV=constant; liquid pressure: P=ρgh.",
  "density": "Density = mass/volume. Archimedes principle.",
  "particle model": "States of matter, density, diffusion, gas pressure, specific heat capacity, latent heat.",
  "radioactivity": "Alpha, beta, gamma radiation, half-life, contamination, safety.",

  // --- MATHS ---
  "algebra": "Simplify, expand, factorise, solve equations/inequalities. Quadratics: factorise, complete square, quadratic formula.",
  "simultaneous equations": "Solve by substitution or elimination.",
  "functions": "f(x) notation, composite, inverse functions.",
  "sequences": "Arithmetic: nth term = a+(n-1)d. Geometric: nth term = ar^(n-1).",
  "trigonometry": "SOHCAHTOA, sine/cosine rule, exact values, graphs.",
  "geometry": "Angles, polygons, circles, Pythagoras, area, perimeter, volume.",
  "vectors": "Addition, scalar multiplication, magnitude/direction.",
  "probability": "Theoretical probability, combined events, tree diagrams, independent/dependent events.",
  "statistics": "Mean, median, mode, range, cumulative frequency, box plots, histograms.",
  "graphs": "Linear, quadratic, cubic, reciprocal, exponential, circle graphs.",
  "transformations": "Reflections, rotations, translations, enlargements, combinations.",

  // --- ENGLISH LANGUAGE & LIT ---
  "simile": "Compares using 'like' or 'as'. Analyse effect on imagery/mood.",
  "metaphor": "States one thing is another. Analyse meaning and theme.",
  "personification": "Human qualities to non-human things. Analyse reader impact.",
  "alliteration": "Repeating consonants. Shows emphasis, rhythm.",
  "hyperbole": "Exaggeration for effect. Analyse tone/intensity.",
  "onomatopoeia": "Sound-imitating words. Enhance imagery.",
  "imagery": "Language appealing to senses. Build mood/theme.",
  "tone": "Author’s attitude. Analyse with evidence.",
  "theme": "Central idea. Link textual evidence to theme.",
  "structural techniques": "Flashback, foreshadowing, narrative perspective. Analyse effect.",
  "language techniques": "Diction, syntax, rhetorical questions, irony. Explain purpose."
};

// === LIFE / GENERAL ===
function lifeAnswer(q) {
  return "Break the scenario down logically: identify the problem, weigh options, explain reasoning step-by-step, and provide structured advice supported by examples.";
}

// === CATEGORY FUNCTION ===
function categorise(question) {
  const q = question.toLowerCase();
  let scores = { science: 0, maths: 0, english: 0, life: 0, general: 0 };
  for (let topic in masterTopics) {
    if (q.includes(topic)) {
      if (["cell","bio","genetics","ecology","photosynthesis","respiration","enzyme","disease"].some(x=>topic.includes(x))) scores.science += 4;
      else if (["atomic","bond","reaction","chemistry","acids","organic","quantitative"].some(x=>topic.includes(x))) scores.science += 4;
      else if (["force","motion","energy","waves","electricity","magnetism","pressure","density","particle","radioactivity"].some(x=>topic.includes(x))) scores.science += 4;
      else if (["algebra","functions","geometry","trig","vectors","probability","statistics","graphs","sequences","simultaneous","transformations"].some(x=>topic.includes(x))) scores.maths += 4;
      else if (["simile","metaphor","personification","alliteration","hyperbole","onomatopoeia","imagery","tone","theme","structural","language"].some(x=>topic.includes(x))) scores.english += 4;
      else scores.general += 2;
    }
  }
  if (/[0-9]/.test(q) || /solve|calculate|equation/.test(q)) scores.maths += 2;
  if (/explain|describe|justify|analyse|compare/.test(q)) scores.science += 1;
  if (/quote|language|poem|analyse|technique|writer/.test(q)) scores.english += 2;
  if (/life|advice|should|help|how/.test(q)) scores.life += 3;
  let best="general", bestScore=0;
  for (const key in scores) if (scores[key]>bestScore){bestScore=scores[key];best=key;}
  const confidence = Math.min(95,40+bestScore*10);
  return { category: best, confidence };
}

// === ANSWER FUNCTION ===
function generateAnswer(q) {
  const lc = q.toLowerCase();
  for (let topic in masterTopics) if (lc.includes(topic)) return `${masterTopics[topic]} Step-by-step explanation if applicable.`;
  return lifeAnswer(q);
}

// === DISCORD MESSAGE HANDLER ===
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'ask') {
    const question = interaction.options.getString('question');
    
    // Memory store
    const mem = userMemory.get(interaction.user.id) || [];
    mem.push({ question, time: Date.now() });
    userMemory.set(interaction.user.id, mem.filter(x=>Date.now()-x.time<900000)); // 15 min memory
    
    const { category, confidence } = categorise(question);
    const answer = generateAnswer(question);
    await interaction.reply(`**Category:** ${category}\n**Confidence:** ${confidence}%\n**Answer:** ${answer}`);
  }
});

client.login(process.env.TOKEN);
