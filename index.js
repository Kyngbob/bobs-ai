import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from "discord.js"

const client = new Client({ intents: [GatewayIntentBits.Guilds] })
const MEMORY_TIME = 15 * 60 * 1000
const memory = new Map()

function normalise(text) { return text.toLowerCase().trim() }

// === HIGHER GCSE SCIENCE TOPICS ===
const scienceTopics = {
  "photosynthesis": "Photosynthesis is the process by which plants produce glucose. Chloroplasts capture light energy to convert carbon dioxide and water into glucose and oxygen.",
  "respiration": "Cellular respiration converts glucose and oxygen into energy (ATP), carbon dioxide, and water. Essential for all living organisms.",
  "osmosis": "Osmosis is the movement of water molecules across a partially permeable membrane from a high water potential to a low water potential.",
  "diffusion": "Diffusion is the passive movement of particles from an area of high concentration to low concentration.",
  "specific heat capacity": "Specific heat capacity (c) is the energy needed to raise 1 kg of a substance by 1°C: Q = mcΔT",
  "relative formula mass": "Relative formula mass (RFM) is the sum of the relative atomic masses of all atoms in a compound.",
  "forces": "Forces cause motion or change of shape. Include gravity, friction, tension, normal force. Newton’s laws describe relationships between force, mass, and acceleration.",
  "energy": "Energy can exist as kinetic, thermal, potential, chemical, or nuclear. Conservation of energy applies: energy cannot be created or destroyed.",
  "electricity": "Electricity involves current, voltage, resistance. Ohm’s law: V = IR. Power: P = VI. Circuits can be series or parallel.",
  "waves": "Waves transfer energy without transferring matter. Includes transverse and longitudinal waves. Key properties: wavelength, frequency, amplitude, speed.",
  "magnetism": "Magnets produce magnetic fields. Opposite poles attract, like poles repel. Electromagnets use current to produce a field.",
  "atoms": "Atoms consist of protons, neutrons, and electrons. Atomic number = protons; mass number = protons + neutrons. Isotopes have same protons but different neutrons.",
  "chemical reactions": "Chemical reactions involve rearrangement of atoms. Represented by balanced equations. Reactants → Products.",
  "bonding": "Ionic, covalent, and metallic bonding determine properties of substances.",
  "enzymes": "Enzymes catalyse reactions. Active site binds substrate; temperature and pH affect activity.",
  "genetics": "Genes carry hereditary information. Dominant and recessive alleles determine traits. Punnett squares predict inheritance."
}

// === HIGHER GCSE MATHS TOPICS ===
const mathsTopics = {
  "quadratic": "Quadratic equations: ax² + bx + c = 0. Solve using factorisation, completing the square, or quadratic formula: x = (-b ± √(b²-4ac))/(2a)",
  "simultaneous equations": "Solve by substitution or elimination methods.",
  "surds": "Simplify surds: √50 = 5√2. Rationalise denominators where needed.",
  "functions": "A function maps input values to output values. f(x) notation represents dependent variables.",
  "probability": "Probability = favorable outcomes / total outcomes. Ensure values between 0 and 1. Use rules for independent or combined events.",
  "sequences": "Arithmetic: nth term = a + (n-1)d. Geometric: nth term = ar^(n-1). Identify patterns.",
  "graphs": "Understand linear, quadratic, cubic, reciprocal, and trigonometric graphs. Identify key points: intercepts, maxima/minima.",
  "trigonometry": "Use sine, cosine, tangent ratios: SOHCAHTOA. Apply Pythagoras where necessary.",
  "geometry": "Angles, circles, polygons, Pythagoras theorem, congruence, similarity. Apply rules for area and volume.",
  "algebra": "Simplify, expand, factorise, rearrange equations. Solve inequalities and simultaneous equations."
}

// === ENGLISH TECHNIQUES ===
const englishTechniques = {
  "simile": "A simile compares two things using 'like' or 'as'. Explain its effect on the reader and meaning.",
  "metaphor": "A metaphor states something is something else. Explain its impact and connection to theme.",
  "personification": "Assigns human qualities to non-human objects. Explain how it affects reader engagement.",
  "alliteration": "Repetition of consonant sounds. Discuss its effect on rhythm, emphasis, or tone.",
  "hyperbole": "Exaggeration for effect. Explain how it intensifies meaning or emotion.",
  "onomatopoeia": "Words imitating sounds. Show how it enhances imagery and engages readers.",
  "imagery": "Descriptive language appealing to senses. Explain how it builds atmosphere or mood.",
  "tone": "Author’s attitude in writing. Identify and explain the effect on reader.",
  "theme": "Central idea or message. Link textual examples to support interpretation."
}

// === Categorisation ===
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
  if (/explain|describe|compare|why|calculate/.test(q)) scores.science += 1
  if (/quote|language|poem|analyse|technique|writer/.test(q)) scores.english += 2

  let best = "general", bestScore = 0
  for (const key in scores) if (scores[key] > bestScore) { bestScore = scores[key]; best = key }

  const confidence = Math.min(95, 40 + bestScore * 10)
  return { category: best, confidence }
}

// === Maths Solver ===
function solveArithmetic(q) {
  try { return `Answer: ${Function("return "+q.replace(/[^0-9\+\-\*\/\.\(\)]/g,""))()}` }
  catch { return "Arithmetic looks invalid." }
}
function solveAlgebra(q) {
  const normalized = normalise(q).replace(/\s/g,"")
  if (normalized === "x^2=16") return "x² = 16 → x = 4 or x = −4"
  return "Rearrange equation to isolate variable. Consider positive & negative solutions."
}

// === Science Answer ===
function scienceAnswer(q) {
  const nq = normalise(q)
  for (let topic in scienceTopics) if (nq.includes(topic)) return scienceTopics[topic]
  return "Identify the process, use correct scientific terms, explain cause & effect clearly for full marks."
}

// === English Answer ===
function englishAnswer(q) {
  const nq = normalise(q)
  for (let tech in englishTechniques) if (nq.includes(tech)) return englishTechniques[tech]
  return "Identify techniques, explain effect, link to theme/writer's intention. Give examples."
}

// === Life / Advice (Exam-style reasoning) ===
function lifeAnswer() {
  return "Consider all factors, analyse consequences, and reason logically. Support your answer with structured explanation."
}

// === Ready / Command Registration ===
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

// === Interaction Handler ===
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "ask") return
  const question = interaction.options.getString("question")
  const userId = interaction.user.id
  const now = Date.now()

  // === Memory ===
  if (!memory.has(userId)) memory.set(userId, [])
  let userMemory = memory.get(userId).filter(m=>now-m.time<MEMORY_TIME)
  memory.set(userId, userMemory)

  if (/what (did i ask|was my last question|was my last answer)/i.test(question)) {
    const last = userMemory.slice(-1)[0]
    if (last) await interaction.reply(`Your last question: "${last.question}"\nAnswer: ${last.answer || "No answer stored"}`)
    else await interaction.reply("No memory found in last 15 minutes.")
    return
  }

  // === Categorise & Answer ===
  const result = categorise(question)
  let answer = ""
  if (result.category === "arithmetic") answer = solveArithmetic(question)
  else if (result.category === "algebra") answer = solveAlgebra(question)
  else if (result.category === "science") answer = scienceAnswer(question)
  else if (result.category === "english") answer = englishAnswer(question)
  else if (result.category === "life") answer = lifeAnswer()
  else answer = "General reasoning: answer logically and clearly."

  userMemory.push({question, category: result.category, answer, time: now})
  memory.set(userId, userMemory)

  const uncertainty = 100 - result.confidence
  await interaction.reply(`**Category:** ${result.category.toUpperCase()}\n\n${answer}\n\n**Confidence:** ${result.confidence}%\n**Uncertainty:** ${uncertainty}%`)
})

client.login(process.env.TOKEN)
