import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from "discord.js"

const client = new Client({ intents: [GatewayIntentBits.Guilds] })
const MEMORY_TIME = 15 * 60 * 1000
const memory = new Map()
function normalise(text) { return text.toLowerCase().trim() }

// === FULL HIGHER GCSE SCIENCE ===
const scienceTopics = {
  "photosynthesis": "Photosynthesis is the process by which plants produce glucose using sunlight, CO₂, and water: 6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂. Chlorophyll in chloroplasts captures light energy. Important for plant growth and energy in ecosystems.",
  "respiration": "Cellular respiration converts glucose and oxygen into ATP (energy), CO₂, and water: C₆H₁₂O₆ + 6O₂ → 6CO₂ + 6H₂O + energy. Aerobic respiration yields more ATP than anaerobic.",
  "osmosis": "Osmosis is the movement of water molecules across a partially permeable membrane from high water potential to low water potential. Vital for plant turgor and animal cell balance.",
  "diffusion": "Diffusion is the passive movement of particles from high concentration to low concentration.",
  "specific heat capacity": "Energy required to raise 1 kg of a substance by 1°C: Q = mcΔT.",
  "latent heat": "Energy absorbed/released during a change of state without temperature change: Q = mL (L = latent heat of fusion/vaporisation).",
  "relative formula mass": "Sum of relative atomic masses of all atoms in a compound.",
  "forces": "Forces cause motion/deformation. Include gravity, friction, tension, normal. Newton’s laws: F = ma, action-reaction, inertia.",
  "energy": "Energy exists as kinetic, potential, chemical, thermal, nuclear. Work done: W = F × d. Power: P = W / t. Conservation applies.",
  "electricity": "Current, voltage, resistance: V = IR. Power: P = VI. Series and parallel circuit rules.",
  "waves": "Transverse and longitudinal waves transfer energy without moving matter. Properties: wavelength, frequency, amplitude, speed: v = fλ.",
  "magnetism": "Magnets produce magnetic fields. Like poles repel, unlike attract. Electromagnets use current. Fleming’s rules apply.",
  "atoms": "Atoms consist of protons, neutrons, electrons. Atomic number = protons, Mass number = protons+neutrons. Isotopes differ by neutrons.",
  "chemical reactions": "Reactions rearrange atoms. Balanced equations: reactants → products. Endothermic absorbs, exothermic releases energy.",
  "bonding": "Ionic (transfer), covalent (share), metallic (delocalised electrons). Determines melting point, conductivity, solubility.",
  "enzymes": "Catalyse reactions. Active site binds substrate. Temperature/pH affect activity.",
  "genetics": "Genes carry hereditary info. Dominant/recessive alleles determine traits. Punnett squares predict inheritance.",
  "pressure": "Pressure = force/area. Gas laws: pV=constant at constant temperature. Liquid pressure: P=ρgh.",
  "density": "Density = mass/volume. Determines floating/sinking.",
  "acids and bases": "Acids release H⁺, bases release OH⁻. pH 0–14. Neutralisation: acid + base → salt + water.",
  "rates of reaction": "Rate affected by concentration, temperature, surface area, catalysts.",
  "electrolysis": "Ionic compounds split using electricity. Ions move to opposite electrodes.",
  "periodic table": "Elements arranged by increasing atomic number. Groups have similar properties. Period trends affect reactivity."
}

// === FULL HIGHER GCSE MATHS ===
const mathsTopics = {
  "quadratic": "Quadratics: ax²+bx+c=0. Solve: factorise, complete square, quadratic formula x=(-b±√(b²-4ac))/(2a). Example: x²=16 → x=4 or -4.",
  "simultaneous equations": "Solve by substitution/elimination. Example: x+y=5, x-y=1 → x=3, y=2.",
  "surds": "Simplify: √50=5√2. Rationalise denominators: 1/√2=√2/2.",
  "functions": "f(x) maps input x to output. Example: f(x)=2x+3 → f(2)=7.",
  "probability": "P(event)=favorable/total. Coin: P(head)=1/2.",
  "sequences": "Arithmetic: nth term = a+(n-1)d. Geometric: nth term = ar^(n-1). Example: 2,5,8 → nth=3n-1.",
  "graphs": "Linear, quadratic, cubic, reciprocal, trig. Identify intercepts, maxima/minima.",
  "trigonometry": "SOHCAHTOA: sinθ=opp/hyp, cosθ=adj/hyp, tanθ=opp/adj. Pythagoras applies: a²+b²=c².",
  "geometry": "Angles, polygons, circles, congruence, similarity, area, volume.",
  "algebra": "Simplify, expand, factorise, solve inequalities. Example: 2x+3=7 → x=2."
}

// === ENGLISH TECHNIQUES ===
const englishTechniques = {
  "simile": "Compares two things using 'like' or 'as'. Explain effect + meaning.",
  "metaphor": "States something is something else. Explain impact + link to theme.",
  "personification": "Human qualities to non-human objects. Explain effect.",
  "alliteration": "Repetition of consonants. Discuss rhythm/emphasis.",
  "hyperbole": "Exaggeration for effect. Explain intensification.",
  "onomatopoeia": "Words imitate sounds. Enhance imagery + engagement.",
  "imagery": "Appeals to senses. Build mood/atmosphere.",
  "tone": "Author’s attitude. Identify + effect on reader.",
  "theme": "Central idea. Link examples to support interpretation."
}

// === LIFE / GENERAL ===
function lifeAnswer(q) {
  return `Life/general: analyse situation, consider consequences, explain reasoning step-by-step, provide structured advice. Example: 'How to manage time?' → Plan, prioritise, review, reflect, revise.`
}

// === COMMAND WORD PARSER ===
function parseCommandWord(q) {
  const lc = normalise(q)
  if (/explain|describe|justify/.test(lc)) return "explain"
  if (/calculate|solve/.test(lc)) return "calculate"
  if (/compare|contrast/.test(lc)) return "compare"
  if (/analyse|evaluate/.test(lc)) return "analyse"
  return "general"
}

// === CATEGORY FUNCTION ===
function categorise(question) {
  const q = normalise(question)
  let scores = { arithmetic: 0, algebra: 0, science: 0, english: 0, life: 0, general: 0 }
  if (/[0-9]/.test(q)) scores.arithmetic += 1
  if (/[\+\-\*\/]/.test(q)) scores.arithmetic += 2
  if (/=/.test(q)) scores.algebra += 2
  if (/x/.test(q)) scores.algebra += 2
  if (/solve|equation|factor|simplify/.test(q)) scores.algebra += 1
  for (let topic in scienceTopics) if (q.includes(topic)) scores.science += 4
  for (let topic in mathsTopics) if (q.includes(topic)) scores.arithmetic += 3
  for (let tech in englishTechniques) if (q.includes(tech)) scores.english += 4
  if (/explain|describe|compare|why|calculate|justify/.test(q)) scores.science += 1
  if (/quote|language|poem|analyse|technique|writer/.test(q)) scores.english += 2
  if (/life|advice|should|help|how/.test(q)) scores.life += 3
  let best = "general", bestScore = 0
  for (const key in scores) if (scores[key] > bestScore) { bestScore = scores[key]; best = key }
  const confidence = Math.min(95, 40 + bestScore * 10)
  return { category: best, confidence }
}

// === MATHS SOLVER ===
function solveArithmetic(q) {
  try { return `Answer: ${Function("return "+q.replace(/[^0-9\+\-\*\/\.\(\)]/g,""))()}` }
  catch { return "Arithmetic looks invalid." }
}
function solveAlgebra(q) {
  const normalized = normalise(q).replace(/\s/g,"")
  if (normalized === "x^2=16") return "x²=16 → x=4 or x=−4"
  return "Rearrange equation, consider positive & negative solutions, show all steps."
}

// === SCIENCE ANSWER ===
function scienceAnswer(q, cmd) {
  const nq = normalise(q)
  for (let topic in scienceTopics) if (nq.includes(topic)) {
    if (cmd === "explain" || cmd === "describe") return `${scienceTopics[topic]} Step-by-step: define → formula → example → units (if applicable).`
    return scienceTopics[topic]
  }
  return "Use relevant scientific terms, explain cause/effect, include formulas/examples."
}

// === ENGLISH ANSWER ===
function englishAnswer(q, cmd) {
  const nq = normalise(q)
  for (let tech in englishTechniques) if (nq.includes(tech)) return `${englishTechniques[tech]} Explain clearly, give textual examples, link to theme or writer’s intention.`
  return "Identify techniques, explain effect, link to theme, give examples."
}

// === READY / COMMAND REGISTRATION ===
client.once("ready", async () => {
  console.log("Bob’s AI online")
  const commands = [
    new SlashCommandBuilder()
      .setName("ask")
      .setDescription("Ask Bob’s AI a question")
      .addStringOption(opt => opt.setName("question").setDescription("Your question").setRequired(true))
  ].map(cmd => cmd.toJSON())
  const rest = new REST({version:"10"}).setToken(process.env.TOKEN)
  await rest.put(Routes.applicationCommands(client.user.id), {body: commands})
})

// === INTERACTION HANDLER ===
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "ask") return
  const question = interaction.options.getString("question")
  const userId = interaction.user.id
  const now = Date.now()

  // === MEMORY ===
  if (!memory.has(userId)) memory.set(userId, [])
  let userMemory = memory.get(userId).filter(m=>now-m.time<MEMORY_TIME)
  memory.set(userId, userMemory)

  if (/what (did i ask|was my last question|was my last answer)/i.test(question)) {
    const last = userMemory.slice(-1)[0]
    if (last) await interaction.reply(`Your last question: "${last.question}"\nAnswer: ${last.answer || "No answer stored"}`)
    else await interaction.reply("No memory found in last 15 minutes.")
    return
  }

  // === CATEGORISE & ANSWER ===
  const result = categorise(question)
  const cmd = parseCommandWord(question)
  let answer = ""
  if (result.category === "arithmetic") answer = solveArithmetic(question)
  else if (result.category === "algebra") answer = solveAlgebra(question)
  else if (result.category === "science") answer = scienceAnswer(question, cmd)
  else if (result.category === "english") answer = englishAnswer(question, cmd)
  else if (result.category === "life") answer = lifeAnswer(question)
  else answer = "Provide a reasoned, structured answer."

  userMemory.push({question, category: result.category, answer, time: now})
  memory.set(userId, userMemory)

  const uncertainty = 100 - result.confidence
  await interaction.reply(`**Category:** ${result.category.toUpperCase()}\n\n${answer}\n\n**Confidence:** ${result.confidence}%\n**Uncertainty:** ${uncertainty}%`)
})

client.login(process.env.TOKEN)
