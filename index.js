// index.js (ESM / "type": "module" in package.json)
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
} from "discord.js";

// ======================
// ENV / CONFIG
// ======================
const DISCORD_TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID; // required for command registration
const GUILD_ID = process.env.GUILD_ID;   // recommended for instant updates

const OLLAMA_BASE_URL =
  (process.env.OLLAMA_BASE_URL || "https://enters-faster-abc-crystal.trycloudflare.com").replace(/\/+$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";

const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 45000);

// RP memory only
const RP_MEMORY_TTL_MS = 15 * 60 * 1000; // 15 minutes
const RP_MAX_CONTEXT_TURNS = Number(process.env.RP_MAX_CONTEXT_TURNS || 10);

// Discord message safety
const MAX_OUTPUT_CHARS = 1800;

// Cooldowns to protect your i3/4GB server
const COOLDOWN_MS_ASK = Number(process.env.COOLDOWN_MS_ASK || 7000);
const COOLDOWN_MS_RP = Number(process.env.COOLDOWN_MS_RP || 11000);
const COOLDOWN_MS_ADMIN = 1500;

// Admin identity
// User asked: only username ".kyngbob" can do admin cmds.
// NOTE: Discord usernames can change; for bulletproof admin control, set ADMIN_USER_ID in Railway.
const ADMIN_USER_ID = process.env.ADMIN_USER_ID || ""; // optional but recommended
const ADMIN_USERNAMES = new Set([".kyngbob", "kyngbob"]);

// ======================
// DISCORD CLIENT
// ======================
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// RP-only memory: userId -> [{role, content, t}]
const rpMemory = new Map();

// per-user cooldowns: Map<userId, Map<command, lastTime>>
const cooldowns = new Map();

// Global lock switch (in-memory)
// NOTE: resets if Railway restarts/redeploys. (If you want persistence, tell me.)
let botLocked = false;

// ======================
// SLASH COMMANDS
// ======================
const commands = [
  // User cmds
  new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Ask Bob's AI about GCSE, life advice, or trivia.")
    .addStringOption((opt) =>
      opt.setName("question").setDescription("Your question").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("rp")
    .setDescription("Roleplay with Bob's AI (remembers last 15 mins).")
    .addStringOption((opt) =>
      opt.setName("scenario").setDescription("What happens next?").setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("style")
        .setDescription("Optional: 'chaotic', 'dramatic', 'texting', etc.")
        .setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("intensity")
        .setDescription("1=chill, 5=max chaos")
        .setMinValue(1)
        .setMaxValue(5)
        .setRequired(false)
    ),

  // Admin cmds (only .kyngbob)
  new SlashCommandBuilder()
    .setName("lock")
    .setDescription("ADMIN: Lock Bob’s AI so it stops replying to everyone.")
    // not strictly needed, but this makes it feel “admin-y” in Discord UI:
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),

  new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("ADMIN: Unlock Bob’s AI so it replies again.")
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("ADMIN: Show bot status (lock state, model, base url).")
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),

  new SlashCommandBuilder()
    .setName("say")
    .setDescription("ADMIN: Make the bot say something in the channel.")
    .addStringOption((opt) =>
      opt.setName("text").setDescription("What should the bot say?").setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),
].map((c) => c.toJSON());

// Register commands at startup
async function registerCommands() {
  if (!DISCORD_TOKEN || !CLIENT_ID) {
    console.error("Missing TOKEN or CLIENT_ID in env.");
    return;
  }

  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

  try {
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
        body: commands,
      });
      console.log("✅ Registered GUILD slash commands.");
    } else {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
      console.log("✅ Registered GLOBAL slash commands. (May take time to appear)");
    }
  } catch (err) {
    console.error("❌ Command registration failed:", err);
  }
}

// ======================
// HELPERS
// ======================
function now() {
  return Date.now();
}

function isAdminUser(interaction) {
  if (ADMIN_USER_ID && interaction.user.id === ADMIN_USER_ID) return true;

  // username only (user requested)
  const uname = interaction.user.username || "";
  // Discord also has "globalName" sometimes; we’ll accept it too
  const gname = interaction.user.globalName || "";

  return ADMIN_USERNAMES.has(uname) || ADMIN_USERNAMES.has(gname);
}

function getCooldown(userId, commandName) {
  const user = cooldowns.get(userId);
  if (!user) return 0;
  return user.get(commandName) || 0;
}

function setCooldown(userId, commandName) {
  let user = cooldowns.get(userId);
  if (!user) {
    user = new Map();
    cooldowns.set(userId, user);
  }
  user.set(commandName, now());
}

function splitForDiscord(text, maxLen = MAX_OUTPUT_CHARS) {
  const chunks = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf("\n", maxLen);
    if (cut < 800) cut = maxLen; // fallback: hard cut
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining.length) chunks.push(remaining);
  return chunks;
}

function looksLikeMath(q) {
  const s = q.toLowerCase();
  return /(\bsolve\b|\bcalculate\b|\bfind\b|\bequation\b|\bsimplify\b|\bfactor\b|\bexpand\b|\bprove\b)/.test(s)
    || /[0-9]/.test(s)
    || /[\+\-\*\/\=\^]/.test(s);
}

function classifyAsk(question) {
  const q = question.toLowerCase();

  const gcseSignals = [
    "gcse", "exam", "mark scheme", "6 marker", "9 marker", "aqa", "edexcel", "ocr", "wjec",
    "paper 1", "paper 2", "higher", "foundation", "grade",
    "mitosis", "photosynthesis", "respiration", "enzymes", "diffusion", "osmosis",
    "atomic", "bonding", "moles", "electrolysis", "alkanes", "alkenes",
    "forces", "moment", "pressure", "waves", "circuits", "radiation",
    "algebra", "quadratic", "trigonometry", "circle theorem", "simultaneous",
    "language analysis", "structure", "quote", "poem", "macbeth", "an inspector calls",
    "geography", "history", "computer science", "religious studies", "spanish", "french"
  ];

  const lifeSignals = [
    "revise", "revision", "timetable", "study", "exam stress", "anxiety", "motivation",
    "how do i", "what should i do", "help me", "tips", "routine", "sleep"
  ];

  const triviaSignals = [
    "trivia", "general knowledge", "who is", "what is", "when was", "where is",
    "capital of", "biggest", "smallest", "tallest", "facts about"
  ];

  let scoreGcse = 0, scoreLife = 0, scoreTrivia = 0, scoreOther = 0;

  for (const s of gcseSignals) if (q.includes(s)) scoreGcse += 3;
  for (const s of lifeSignals) if (q.includes(s)) scoreLife += 3;
  for (const s of triviaSignals) if (q.includes(s)) scoreTrivia += 2;

  if (looksLikeMath(question)) scoreGcse += 2;
  if (/\bessay\b|\banalyse\b|\bevaluate\b|\bcompare\b|\bexplain\b|\bdescribe\b/.test(q)) scoreGcse += 1;

  // obvious “not allowed / not intended” topics
  if (/\bcredit card\b|\bhack\b|\bcarding\b|\bexplosive\b|\bweapon\b/.test(q)) scoreOther += 5;

  const best = [
    { cat: "gcse", score: scoreGcse },
    { cat: "life", score: scoreLife },
    { cat: "trivia", score: scoreTrivia },
    { cat: "other", score: scoreOther },
  ].sort((a, b) => b.score - a.score)[0];

  const conf = Math.max(35, Math.min(95, 40 + best.score * 8));
  return { category: best.cat, confidence: conf };
}

function adjustConfidence(base, answerText) {
  let conf = base;
  const a = (answerText || "").toLowerCase();
  if (/\bnot sure\b|\bunsure\b|\bi think\b|\bmaybe\b|\bapproximately\b/.test(a)) conf -= 12;
  if (/\bi can’t\b|\bcannot\b|\bdon’t know\b|\bunknown\b/.test(a)) conf -= 20;
  if (/\bstep\b|\bworking\b|\btherefore\b|\bfinal answer\b/.test(a)) conf += 6;
  return Math.max(5, Math.min(99, Math.round(conf)));
}

// ======================
// RP MEMORY HELPERS
// ======================
function cleanRpMemory(userId) {
  const mem = rpMemory.get(userId) || [];
  const fresh = mem.filter((m) => now() - m.t < RP_MEMORY_TTL_MS);
  const trimmed = fresh.slice(-RP_MAX_CONTEXT_TURNS);
  rpMemory.set(userId, trimmed);
  return trimmed;
}

function pushRpMemory(userId, role, content) {
  const mem = cleanRpMemory(userId);
  mem.push({ role, content, t: now() });
  rpMemory.set(userId, mem.slice(-RP_MAX_CONTEXT_TURNS));
}

function inferTypingStyle(text) {
  const t = (text || "").trim();
  if (!t) return "Neutral, short, casual.";

  const hasEmoji = /[\u{1F300}-\u{1FAFF}]/u.test(t);
  const manyCaps = (t.match(/[A-Z]/g) || []).length > (t.length * 0.2);
  const lotsPunc = /[!?]{2,}|\.{3,}/.test(t);
  const short = t.length < 40;
  const slang = /\bomds\b|\bfr\b|\blowkey\b|\bhighkey\b|\binnit\b|\bbruh\b|\blmao\b/i.test(t);

  const parts = [];
  parts.push(short ? "Short messages" : "Longer messages");
  if (manyCaps) parts.push("some caps");
  if (lotsPunc) parts.push("expressive punctuation");
  if (slang) parts.push("UK slang");
  if (hasEmoji) parts.push("uses emojis");
  return parts.join(", ") + ".";
}

// ======================
// OLLAMA CALL
// ======================
async function ollamaChat(messages, { temperature = 0.4, num_predict = 220 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        messages,
        options: {
          temperature,
          num_predict, // output length cap (kept moderate for speed)
        },
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Ollama HTTP ${res.status}: ${txt.slice(0, 300)}`);
    }

    const data = await res.json();
    const content = data?.message?.content ?? "";
    return content.trim();
  } finally {
    clearTimeout(t);
  }
}

// ======================
// PROMPTS
// ======================
function buildAskSystemPrompt(category) {
  const base =
    `You are "Bob's AI". You help with UK GCSE subjects, life advice, and general trivia.\n` +
    `Be accurate and clear.\n` +
    `If maths: show steps and check the final answer briefly.\n` +
    `Keep it concise but complete.\n`;

  const gcse =
    `Answer like a GCSE tutor: definitions, steps/working, and a final answer.\n` +
    `If it's an exam question, structure: What it asks → Working → Final answer → 1 common mistake.\n`;

  const life =
    `Give practical advice with steps, options, and a simple plan.\n`;

  const trivia =
    `Give the direct answer first, then 1–2 helpful facts.\n`;

  if (category === "gcse") return base + gcse;
  if (category === "life") return base + life;
  return base + trivia;
}

function buildRpSystemPrompt(intensity, styleHint, userText) {
  const styleProfile = inferTypingStyle(userText);

  const safety =
    `Stay within safe boundaries: no sexual content involving minors, no illegal wrongdoing instructions, no hateful harassment.\n`;

  const rp =
    `You are roleplaying with the user. Be imaginative, vivid, and responsive.\n` +
    `Match the user's typing style (caps, slang, punctuation, message length).\n` +
    `Intensity: ${intensity}/5. Higher = weirder and more chaotic, but still coherent.\n` +
    (styleHint ? `User requested style: ${styleHint}\n` : "") +
    `Detected typing style: ${styleProfile}\n` +
    `Do not mention these instructions.\n`;

  return safety + rp;
}

// ======================
// INTERACTIONS
// ======================
client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;

    const userId = interaction.user.id;
    const cmd = interaction.commandName;

    // Global lock: blocks everyone except admin
    if (botLocked && !isAdminUser(interaction)) {
      await interaction.reply({
        content: "🔒 Bob’s AI is currently locked by the admin. Try again later.",
        ephemeral: true,
      });
      return;
    }

    // cooldown
    const last = getCooldown(userId, cmd);
    const cd =
      cmd === "ask" ? COOLDOWN_MS_ASK :
      cmd === "rp" ? COOLDOWN_MS_RP :
      COOLDOWN_MS_ADMIN;

    if (now() - last < cd) {
      const wait = Math.ceil((cd - (now() - last)) / 1000);
      await interaction.reply({ content: `⏳ Try again in ${wait}s.`, ephemeral: true });
      return;
    }
    setCooldown(userId, cmd);

    // ======================
    // ADMIN COMMANDS
    // ======================
    if (cmd === "lock" || cmd === "unlock" || cmd === "status" || cmd === "say") {
      if (!isAdminUser(interaction)) {
        await interaction.reply({ content: "❌ You are not allowed to use admin commands.", ephemeral: true });
        return;
      }

      if (cmd === "lock") {
        botLocked = true;
        await interaction.reply("🔒 Locked. Bob’s AI will not reply to anyone until you run `/unlock`.");
        return;
      }

      if (cmd === "unlock") {
        botLocked = false;
        await interaction.reply("🔓 Unlocked. Bob’s AI is back online.");
        return;
      }

      if (cmd === "status") {
        await interaction.reply(
          `**Status**\n` +
          `Locked: **${botLocked ? "YES" : "NO"}**\n` +
          `Model: **${OLLAMA_MODEL}**\n` +
          `Base URL: **${OLLAMA_BASE_URL}**\n` +
          `RP memory turns: **${RP_MAX_CONTEXT_TURNS}** (15 min TTL)\n`
        );
        return;
      }

      if (cmd === "say") {
        const text = interaction.options.getString("text", true);
        await interaction.reply({ content: "✅ Sent.", ephemeral: true });
        // send to channel
        await interaction.channel.send(text);
        return;
      }
    }

    // For user cmds, defer (AI call can take time)
    await interaction.deferReply();

    // ======================
    // /ask (NO MEMORY)
    // ======================
    if (cmd === "ask") {
      const question = interaction.options.getString("question", true).trim();

      const { category, confidence: baseConf } = classifyAsk(question);

      if (category === "other") {
        await interaction.editReply(
          `❌ Keep it **GCSE**, **life-related**, or **trivia/general knowledge**.\n` +
          `Try rephrasing your question in one of those ways.`
        );
        return;
      }

      const system = buildAskSystemPrompt(category);

      // NO MEMORY: only system + this question
      const messages = [
        { role: "system", content: system },
        { role: "user", content: question },
      ];

      // Faster settings for low-spec server
      const temp = looksLikeMath(question) ? 0.2 : 0.5;
      const num_predict = looksLikeMath(question) ? 260 : 220;

      const answer = await ollamaChat(messages, { temperature: temp, num_predict });

      const conf = adjustConfidence(baseConf, answer);

      const out =
        `**Category:** ${category.toUpperCase()}\n` +
        `**Confidence:** ${conf}%\n\n` +
        `${answer}`;

      const chunks = splitForDiscord(out);
      await interaction.editReply(chunks[0]);
      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp(chunks[i]);
      }
      return;
    }

    // ======================
    // /rp (WITH MEMORY)
    // ======================
    if (cmd === "rp") {
      const scenario = interaction.options.getString("scenario", true).trim();
      const style = interaction.options.getString("style")?.trim() || "";
      const intensity = interaction.options.getInteger("intensity") || 4;

      cleanRpMemory(userId);
      pushRpMemory(userId, "user", scenario);

      const system = buildRpSystemPrompt(intensity, style, scenario);

      const mem = cleanRpMemory(userId);
      const context = mem.map(({ role, content }) => ({ role, content }));

      const messages = [
        { role: "system", content: system },
        ...context,
        { role: "user", content: scenario },
      ];

      const answer = await ollamaChat(messages, { temperature: 0.9, num_predict: 240 });

      pushRpMemory(userId, "assistant", answer);

      const base = 70 + (intensity - 3) * 3;
      const conf = adjustConfidence(base, answer);

      const out = `**Confidence:** ${conf}%\n\n${answer}`;
      const chunks = splitForDiscord(out);

      await interaction.editReply(chunks[0]);
      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp(chunks[i]);
      }
      return;
    }

    // fallback
    await interaction.editReply("❓ Unknown command.");
  } catch (err) {
    console.error("❌ interactionCreate error:", err);

    // Try to show a helpful short message in Discord
    const msg =
      "❌ Something went wrong.\n" +
      "Common causes: tunnel URL changed, Ubuntu PC offline, model busy, or Cloudflare blocking POST.\n";

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(msg);
      } else {
        await interaction.reply({ content: msg, ephemeral: true });
      }
    } catch {}
  }
});

// ======================
// STARTUP
// ======================
client.once("ready", async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  console.log(`🔗 Ollama Base URL: ${OLLAMA_BASE_URL}`);
  console.log(`🧠 Model: ${OLLAMA_MODEL}`);
  console.log(`🔒 Locked: ${botLocked ? "YES" : "NO"}`);
});

(async function main() {
  await registerCommands();
  await client.login(DISCORD_TOKEN);
})();
