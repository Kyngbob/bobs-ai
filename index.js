// index.js (ESM) — requires: "type": "module" in package.json
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
} from "discord.js";

/* =========================
   ENV / CONFIG
========================= */
const DISCORD_TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || "").replace(/\/+$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";

// Make timeouts longer so /ask doesn’t abort on your i3/4GB
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 120000);

// /rp memory only
const RP_MEMORY_TTL_MS = 15 * 60 * 1000;
const RP_MAX_CONTEXT_TURNS = Number(process.env.RP_MAX_CONTEXT_TURNS || 12);

// output chunking
const MAX_DISCORD_CHARS = 1800;

// cooldowns
const COOLDOWN_MS_ASK = Number(process.env.COOLDOWN_MS_ASK || 6000);
const COOLDOWN_MS_RP = Number(process.env.COOLDOWN_MS_RP || 9000);
const COOLDOWN_MS_ADMIN = 1500;

// Admin identity (for lock/unlock/status/say)
// Recommended: set ADMIN_USER_ID in Railway for bulletproof admin control
const ADMIN_USER_ID = process.env.ADMIN_USER_ID || "";

// EXACT username required for grant command
const GRANT_ONLY_USERNAME = ".kyngbob";

// Role to grant
const HOSTER_ROLE_NAME = "; GW HOSTER :)";

/* =========================
   CLIENT
========================= */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// /rp memory only: userId -> [{role, content, t}]
const rpMemory = new Map();

// cooldown tracking
const cooldowns = new Map(); // Map<userId, Map<cmd, lastTime>>

// lock state (in-memory)
let botLocked = false;

/* =========================
   SLASH COMMANDS
========================= */
const commands = [
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
        .setDescription("Optional style: chaotic, dramatic, texting, etc.")
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

  // Admin commands
  new SlashCommandBuilder()
    .setName("lock")
    .setDescription("ADMIN: Lock Bob’s AI (stops /ask and /rp for everyone).")
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),

  new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("ADMIN: Unlock Bob’s AI.")
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("ADMIN: Show status.")
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),

  new SlashCommandBuilder()
    .setName("say")
    .setDescription("ADMIN: Make the bot say something in the channel.")
    .addStringOption((opt) =>
      opt.setName("text").setDescription("What should the bot say?").setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),

  // Grant command (ONLY .kyngbob)
  new SlashCommandBuilder()
    .setName("grant_hoster")
    .setDescription(`ADMIN: Give yourself the role "${HOSTER_ROLE_NAME}"`)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
].map((c) => c.toJSON());

async function registerCommands() {
  if (!DISCORD_TOKEN || !CLIENT_ID) {
    console.error("Missing TOKEN or CLIENT_ID.");
    return;
  }
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

  try {
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
      console.log("✅ Registered GUILD slash commands.");
    } else {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
      console.log("✅ Registered GLOBAL slash commands (may take time to appear).");
    }
  } catch (err) {
    console.error("❌ Command registration failed:", err);
  }
}

/* =========================
   HELPERS
========================= */
const now = () => Date.now();

function isAdmin(interaction) {
  // For lock/unlock/status/say
  if (ADMIN_USER_ID && interaction.user.id === ADMIN_USER_ID) return true;

  // Fallback: allow if username or display name matches exactly ".kyngbob"
  const uname = interaction.user.username || "";
  const gname = interaction.user.globalName || "";
  return uname === GRANT_ONLY_USERNAME || gname === GRANT_ONLY_USERNAME;
}

function isGrantOwner(interaction) {
  // ONLY .kyngbob can run grant (no ID override)
  const uname = interaction.user.username || "";
  const gname = interaction.user.globalName || "";
  return uname === GRANT_ONLY_USERNAME || gname === GRANT_ONLY_USERNAME;
}

function getCooldown(userId, cmd) {
  const m = cooldowns.get(userId);
  return m?.get(cmd) || 0;
}

function setCooldown(userId, cmd) {
  let m = cooldowns.get(userId);
  if (!m) {
    m = new Map();
    cooldowns.set(userId, m);
  }
  m.set(cmd, now());
}

function splitForDiscord(text) {
  const chunks = [];
  let s = text || "";
  while (s.length > MAX_DISCORD_CHARS) {
    let cut = s.lastIndexOf("\n", MAX_DISCORD_CHARS);
    if (cut < 800) cut = MAX_DISCORD_CHARS;
    chunks.push(s.slice(0, cut));
    s = s.slice(cut).trimStart();
  }
  if (s.length) chunks.push(s);
  return chunks;
}

function looksLikeMath(q) {
  const s = (q || "").toLowerCase();
  return (
    /(\bsolve\b|\bcalculate\b|\bfind\b|\bequation\b|\bsimplify\b|\bfactor\b|\bexpand\b|\bprove\b|\bshow that\b)/.test(s) ||
    /[0-9]/.test(s) ||
    /[\+\-\*\/\=\^]/.test(s)
  );
}

// lightweight routing
function classifyAsk(question) {
  const q = (question || "").toLowerCase();

  const gcseHints = [
    "gcse", "aqa", "edexcel", "ocr", "wjec", "paper", "mark scheme",
    "higher", "foundation", "6 marker", "9 marker",
    "osmosis", "photosynthesis", "respiration", "enzymes", "mitosis",
    "moles", "bonding", "electrolysis", "alkanes", "alkenes",
    "forces", "waves", "circuits", "radiation", "pressure",
    "quadratic", "trigonometry", "circle theorem", "simultaneous",
    "macbeth", "an inspector calls", "poem", "analysis", "structure",
    "history", "geography", "computer science", "religious",
    "french", "spanish"
  ];
  const lifeHints = ["revise", "revision", "study", "exam stress", "motivation", "how do i", "help", "tips"];
  const triviaHints = ["trivia", "general knowledge", "who is", "what is", "capital", "when was", "where is"];

  let gcse = 0, life = 0, trivia = 0;
  for (const t of gcseHints) if (q.includes(t)) gcse += 3;
  for (const t of lifeHints) if (q.includes(t)) life += 3;
  for (const t of triviaHints) if (q.includes(t)) trivia += 2;

  if (looksLikeMath(question)) gcse += 2;

  const best = [
    { cat: "gcse", score: gcse },
    { cat: "life", score: life },
    { cat: "trivia", score: trivia },
  ].sort((a, b) => b.score - a.score)[0];

  if (best.score <= 0) return { category: "other", confidence: 45 };

  const confidence = Math.max(35, Math.min(95, 40 + best.score * 7));
  return { category: best.cat, confidence };
}

function adjustConfidence(base, answer) {
  let c = base;
  const a = (answer || "").toLowerCase();
  if (/\bnot sure\b|\bunsure\b|\bmaybe\b|\bi think\b/.test(a)) c -= 10;
  if (/\bfinal answer\b|\btherefore\b|\bstep\b|\bworking\b/.test(a)) c += 6;
  return Math.max(5, Math.min(99, Math.round(c)));
}

/* =========================
   RP MEMORY
========================= */
function cleanRpMemory(userId) {
  const mem = rpMemory.get(userId) || [];
  const fresh = mem.filter((m) => now() - m.t < RP_MEMORY_TTL_MS);
  const trimmed = fresh.slice(-RP_MAX_CONTEXT_TURNS);
  rpMemory.set(userId, trimmed);
  return trimmed;
}

function pushRp(userId, role, content) {
  const mem = cleanRpMemory(userId);
  mem.push({ role, content, t: now() });
  rpMemory.set(userId, mem.slice(-RP_MAX_CONTEXT_TURNS));
}

/* =========================
   OLLAMA CALL
========================= */
async function ollamaChat(messages, { temperature = 0.4, num_predict = 200 } = {}) {
  if (!OLLAMA_BASE_URL) throw new Error("Missing OLLAMA_BASE_URL");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        messages,
        options: { temperature, num_predict },
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Ollama HTTP ${res.status}: ${txt.slice(0, 250)}`);
    }

    const data = await res.json();
    return (data?.message?.content || "").trim();
  } finally {
    clearTimeout(timer);
  }
}

/* =========================
   PROMPTS (FAST but detailed)
========================= */
function askSystemPrompt(category, isMath) {
  if (category === "gcse") {
    return (
      `You are Bob's AI, a UK GCSE tutor.\n` +
      `Be accurate and exam-focused.\n` +
      `Answer in this structure:\n` +
      `1) Key facts/definitions (short but important)\n` +
      `2) Method/Steps (clear)\n` +
      `3) Exam-style explanation (marks-focused)\n` +
      `4) Final answer / conclusion\n` +
      `5) 1 common mistake\n` +
      (isMath ? `For maths: show neat working and clearly state the final answer.\n` : "") +
      `No fluff. Be detailed but efficient.\n`
    );
  }
  if (category === "life") {
    return (
      `You are Bob's AI.\n` +
      `Give practical life advice.\n` +
      `Structure:\n1) What’s going on\n2) Options\n3) Best plan (steps)\n4) Quick checklist\n` +
      `Be efficient but helpful.\n`
    );
  }
  return (
    `You are Bob's AI.\n` +
    `Answer trivia/general knowledge.\n` +
    `Structure:\n1) Direct answer\n2) 2 useful facts\n` +
    `Be concise.\n`
  );
}

function rpSystemPrompt(intensity, styleHint) {
  const hint = styleHint ? `User style request: ${styleHint}\n` : "";
  return (
    `You are roleplaying with the user.\n` +
    `Match their typing style.\n` +
    `Intensity: ${intensity}/5 (higher = weirder/chaotic).\n` +
    hint +
    `Do not mention rules.\n`
  );
}

/* =========================
   ADMIN: ROLE GRANT
========================= */
async function grantHosterRole(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: "❌ This command only works in a server.", ephemeral: true });
    return;
  }

  const guild = interaction.guild;
  const member = await guild.members.fetch(interaction.user.id);

  const role = guild.roles.cache.find((r) => r.name === HOSTER_ROLE_NAME);
  if (!role) {
    await interaction.reply({
      content: `❌ Role not found: "${HOSTER_ROLE_NAME}". Create it in Server Settings → Roles (exact name).`,
      ephemeral: true,
    });
    return;
  }

  const botMember = await guild.members.fetchMe();
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({
      content: "❌ I need the **Manage Roles** permission to do that.",
      ephemeral: true,
    });
    return;
  }

  if (role.position >= botMember.roles.highest.position) {
    await interaction.reply({
      content:
        `❌ I can’t assign that role because it’s **above or equal to my top role**.\n` +
        `Move "${HOSTER_ROLE_NAME}" below the bot's role in Server Settings → Roles.`,
      ephemeral: true,
    });
    return;
  }

  if (member.roles.cache.has(role.id)) {
    await interaction.reply({ content: `✅ You already have "${HOSTER_ROLE_NAME}".`, ephemeral: true });
    return;
  }

  await member.roles.add(role, "Hoster role granted by .kyngbob");
  await interaction.reply(`✅ Granted you the role: **${HOSTER_ROLE_NAME}**`);
}

/* =========================
   INTERACTION HANDLER
========================= */
client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;

    const userId = interaction.user.id;
    const cmd = interaction.commandName;

    // ===== LOCK BEHAVIOUR (FIXED) =====
    // When locked: /ask and /rp NEVER respond for anyone (including you).
    // Only admin utilities allowed: /unlock, /status, /lock, /say, /grant_hoster
    if (botLocked && (cmd === "ask" || cmd === "rp")) {
      await interaction.reply({ content: "🔒 Bob’s AI is locked by the admin.", ephemeral: true });
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

    // ===== ADMIN COMMANDS =====
    if (cmd === "lock" || cmd === "unlock" || cmd === "status" || cmd === "say") {
      if (!isAdmin(interaction)) {
        await interaction.reply({ content: "❌ Not allowed.", ephemeral: true });
        return;
      }

      if (cmd === "lock") {
        botLocked = true;
        await interaction.reply("🔒 Locked. /ask and /rp are disabled for everyone until `/unlock`.");
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
          `Base URL: **${OLLAMA_BASE_URL || "(missing)"}**\n` +
          `Timeout: **${OLLAMA_TIMEOUT_MS}ms**\n` +
          `RP memory: **${RP_MAX_CONTEXT_TURNS} turns** (15min TTL)\n`
        );
        return;
      }

      if (cmd === "say") {
        const text = interaction.options.getString("text", true);
        await interaction.reply({ content: "✅ Sent.", ephemeral: true });
        await interaction.channel?.send(text);
        return;
      }
    }

    // ===== GRANT COMMAND (ONLY .kyngbob) =====
    if (cmd === "grant_hoster") {
      if (!isGrantOwner(interaction)) {
        await interaction.reply({ content: "❌ Only .kyngbob can use this command.", ephemeral: true });
        return;
      }
      await grantHosterRole(interaction);
      return;
    }

    // defer for AI calls
    await interaction.deferReply();

    // ===== /ASK (NO MEMORY) =====
    if (cmd === "ask") {
      const question = interaction.options.getString("question", true).trim();
      const { category, confidence: baseConf } = classifyAsk(question);

      if (category === "other") {
        await interaction.editReply(
          `❌ Keep it **GCSE**, **life-related**, or **trivia/general knowledge**.\n` +
          `Try: “GCSE biology: …” or “Life advice: …” or “Trivia: …”`
        );
        return;
      }

      const isMath = looksLikeMath(question);

      // Faster but still detailed:
      // - structured prompt forces detail
      // - output cap stays moderate to avoid timeouts
      const num_predict = isMath ? 220 : 200;
      const temperature = isMath ? 0.15 : 0.35;

      const messages = [
        { role: "system", content: askSystemPrompt(category, isMath) },
        { role: "user", content: question },
      ];

      const answer = await ollamaChat(messages, { temperature, num_predict });
      const conf = adjustConfidence(baseConf, answer);

      const out =
        `**Category:** ${category.toUpperCase()}\n` +
        `**Confidence:** ${conf}%\n\n` +
        answer;

      const chunks = splitForDiscord(out);
      await interaction.editReply(chunks[0]);
      for (let i = 1; i < chunks.length; i++) await interaction.followUp(chunks[i]);
      return;
    }

    // ===== /RP (WITH MEMORY) =====
    if (cmd === "rp") {
      const scenario = interaction.options.getString("scenario", true).trim();
      const style = interaction.options.getString("style")?.trim() || "";
      const intensity = interaction.options.getInteger("intensity") || 4;

      cleanRpMemory(userId);
      pushRp(userId, "user", scenario);

      const context = cleanRpMemory(userId).map(({ role, content }) => ({ role, content }));

      const messages = [
        { role: "system", content: rpSystemPrompt(intensity, style) },
        ...context,
        { role: "user", content: scenario },
      ];

      const answer = await ollamaChat(messages, { temperature: 0.9, num_predict: 240 });
      pushRp(userId, "assistant", answer);

      const conf = adjustConfidence(70 + (intensity - 3) * 3, answer);

      const out = `**Confidence:** ${conf}%\n\n${answer}`;
      const chunks = splitForDiscord(out);

      await interaction.editReply(chunks[0]);
      for (let i = 1; i < chunks.length; i++) await interaction.followUp(chunks[i]);
      return;
    }

    await interaction.editReply("❓ Unknown command.");
  } catch (err) {
    console.error("❌ interactionCreate error:", err);

    const msg =
      "❌ Something went wrong.\n" +
      "Likely cause: model took too long, tunnel URL changed, or server is busy.\n";

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(msg);
      } else {
        await interaction.reply({ content: msg, ephemeral: true });
      }
    } catch {}
  }
});

/* =========================
   STARTUP
========================= */
client.once("ready", () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  console.log(`🔗 Ollama Base URL: ${OLLAMA_BASE_URL}`);
  console.log(`🧠 Model: ${OLLAMA_MODEL}`);
  console.log(`⏱️ Timeout: ${OLLAMA_TIMEOUT_MS}ms`);
  console.log(`🔒 Locked: ${botLocked ? "YES" : "NO"}`);
});

(async function main() {
  await registerCommands();
  await client.login(DISCORD_TOKEN);
})();
