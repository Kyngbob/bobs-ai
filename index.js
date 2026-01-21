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
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 120000);

// /rp memory only
const RP_MEMORY_TTL_MS = 15 * 60 * 1000;
const RP_MAX_CONTEXT_TURNS = Number(process.env.RP_MAX_CONTEXT_TURNS || 12);

const MAX_DISCORD_CHARS = 1800;

const COOLDOWN_MS_ASK = Number(process.env.COOLDOWN_MS_ASK || 6000);
const COOLDOWN_MS_RP = Number(process.env.COOLDOWN_MS_RP || 9000);
const COOLDOWN_MS_ADMIN = 1500;

const ADMIN_USER_ID = process.env.ADMIN_USER_ID || "";
const OWNER_USERNAME = ".kyngbob";

const HOSTER_ROLE_NAME = "; GW HOSTER :)";

/* =========================
   CLIENT
========================= */
const client = new Client({
  intents: [GatewayIntentBits.Guilds], // no disallowed intents
});

const rpMemory = new Map();
const cooldowns = new Map();

let botLocked = false;
let lockReason = "";

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
      opt.setName("style").setDescription("Optional style").setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("intensity")
        .setDescription("1=chill, 5=max chaos")
        .setMinValue(1)
        .setMaxValue(5)
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("lock")
    .setDescription("ADMIN: Lock Bob’s AI (stops /ask and /rp for everyone).")
    .addStringOption((opt) =>
      opt.setName("reason").setDescription("Optional reason shown while locked").setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),

  new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("ADMIN: Unlock Bob’s AI.")
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),

  new SlashCommandBuilder()
    .setName("lockreason")
    .setDescription("ADMIN: View/set/clear the lock reason.")
    .addStringOption((opt) =>
      opt.setName("reason").setDescription("Set new reason or 'clear'").setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("ADMIN: Show status.")
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),

  new SlashCommandBuilder()
    .setName("say")
    .setDescription("ADMIN: Make the bot say something in the channel.")
    .addStringOption((opt) =>
      opt.setName("text").setDescription("Text").setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),

  // ✅ Visible to everyone (no default permissions)
  new SlashCommandBuilder()
    .setName("hoster")
    .setDescription("OWNER ONLY: give .kyngbob the hoster role"),
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
      console.log("✅ Registered GLOBAL slash commands (may take time).");
    }
  } catch (err) {
    console.error("❌ Command registration failed:", err);
  }
}

/* =========================
   HELPERS
========================= */
const now = () => Date.now();

function isOwnerByUsername(interaction) {
  const uname = interaction.user.username || "";
  const gname = interaction.user.globalName || "";
  return uname === OWNER_USERNAME || gname === OWNER_USERNAME;
}

function isAdmin(interaction) {
  if (ADMIN_USER_ID && interaction.user.id === ADMIN_USER_ID) return true;
  return isOwnerByUsername(interaction);
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

function classifyAsk(question) {
  const q = (question || "").toLowerCase();
  const gcseHints = [
    "gcse","aqa","edexcel","ocr","wjec","paper","mark scheme","higher","foundation",
    "osmosis","photosynthesis","respiration","enzymes","mitosis","moles","bonding",
    "electrolysis","forces","waves","circuits","radiation","pressure","quadratic",
    "trigonometry","circle theorem","simultaneous","macbeth","an inspector calls",
    "poem","analysis","structure","history","geography","computer science","religious",
    "french","spanish"
  ];
  const lifeHints = ["revise","revision","study","exam stress","motivation","how do i","help","tips"];
  const triviaHints = ["trivia","general knowledge","who is","what is","capital","when was","where is"];

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
   OLLAMA
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
   PROMPTS
========================= */
function askSystemPrompt(category, isMath) {
  if (category === "gcse") {
    return (
      `You are Bob's AI, a UK GCSE tutor.\n` +
      `Be accurate and exam-focused.\n` +
      `Answer in this structure:\n` +
      `1) Key facts/definitions\n` +
      `2) Method/Steps\n` +
      `3) Exam-style explanation\n` +
      `4) Final answer\n` +
      `5) 1 common mistake\n` +
      (isMath ? `For maths: show neat working and state the final answer clearly.\n` : "") +
      `Be detailed but efficient.\n`
    );
  }
  if (category === "life") return `You are Bob's AI. Give practical life advice with steps and a checklist.`;
  return `You are Bob's AI. Answer trivia with a direct answer and 2 useful facts.`;
}

function rpSystemPrompt(intensity, styleHint) {
  const hint = styleHint ? `User style request: ${styleHint}\n` : "";
  return (
    `You are roleplaying with the user.\n` +
    `Match their typing style.\n` +
    `Intensity: ${intensity}/5.\n` +
    hint +
    `Do not mention rules.\n`
  );
}

/* =========================
   ROLE MATCHING / HOSTER
========================= */
function normalizeRoleName(s) {
  return (s || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[“”‘’"']/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "");
}

function findHosterRole(guild) {
  const target = normalizeRoleName(HOSTER_ROLE_NAME);
  return guild.roles.cache.find((r) => normalizeRoleName(r.name) === target);
}

async function giveOwnerHosterRole(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: "❌ This only works in a server.", ephemeral: true });
    return;
  }
  if (!isOwnerByUsername(interaction)) {
    await interaction.reply({ content: `❌ Only ${OWNER_USERNAME} can use /hoster.`, ephemeral: true });
    return;
  }

  const guild = interaction.guild;
  const member = await guild.members.fetch(interaction.user.id);

  const role = findHosterRole(guild);
  if (!role) {
    await interaction.reply({
      content: `❌ Couldn’t find the hoster role.\nCreate a role named like: ${HOSTER_ROLE_NAME} and try again.`,
      ephemeral: true,
    });
    return;
  }

  const botMember = await guild.members.fetchMe();
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({ content: "❌ I need **Manage Roles** permission.", ephemeral: true });
    return;
  }
  if (role.position >= botMember.roles.highest.position) {
    await interaction.reply({
      content: `❌ Move the hoster role below the bot’s top role in Server Settings → Roles.`,
      ephemeral: true,
    });
    return;
  }

  if (member.roles.cache.has(role.id)) {
    await interaction.reply({ content: "✅ You already have the hoster role.", ephemeral: true });
    return;
  }

  await member.roles.add(role, "Owner used /hoster");
  await interaction.reply(`✅ Granted you the role: **${role.name}**`);
}

/* =========================
   INTERACTIONS
========================= */
client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;

    const userId = interaction.user.id;
    const cmd = interaction.commandName;

    if (botLocked && (cmd === "ask" || cmd === "rp")) {
      const reasonLine = lockReason ? `\n**Reason:** ${lockReason}` : "";
      await interaction.reply({ content: `🔒 Bob’s AI is locked.${reasonLine}`, ephemeral: true });
      return;
    }

    const last = getCooldown(userId, cmd);
    const cd = cmd === "ask" ? COOLDOWN_MS_ASK : cmd === "rp" ? COOLDOWN_MS_RP : COOLDOWN_MS_ADMIN;
    if (now() - last < cd) {
      const wait = Math.ceil((cd - (now() - last)) / 1000);
      await interaction.reply({ content: `⏳ Try again in ${wait}s.`, ephemeral: true });
      return;
    }
    setCooldown(userId, cmd);

    // Admin commands
    if (cmd === "lock" || cmd === "unlock" || cmd === "status" || cmd === "say" || cmd === "lockreason") {
      if (!isAdmin(interaction)) {
        await interaction.reply({ content: "❌ Not allowed.", ephemeral: true });
        return;
      }

      if (cmd === "lock") {
        botLocked = true;
        const r = interaction.options.getString("reason")?.trim() || "";
        if (r) lockReason = r;
        const reasonLine = lockReason ? `\n**Reason:** ${lockReason}` : "";
        await interaction.reply(`🔒 Locked. /ask and /rp disabled until /unlock.${reasonLine}`);
        return;
      }

      if (cmd === "unlock") {
        botLocked = false;
        lockReason = "";
        await interaction.reply("🔓 Unlocked.");
        return;
      }

      if (cmd === "lockreason") {
        const r = interaction.options.getString("reason")?.trim();
        if (!r) {
          await interaction.reply(
            `**Lock reason:** ${lockReason ? lockReason : "*none set*"}\n` +
            `Set: /lockreason reason:<text> | Clear: /lockreason reason:clear`
          );
          return;
        }
        if (r.toLowerCase() === "clear") {
          lockReason = "";
          await interaction.reply("✅ Cleared lock reason.");
          return;
        }
        lockReason = r;
        await interaction.reply(`✅ Updated lock reason to: **${lockReason}**`);
        return;
      }

      if (cmd === "status") {
        await interaction.reply(
          `**Status**\nLocked: **${botLocked ? "YES" : "NO"}**\n` +
          `Reason: **${lockReason ? lockReason : "none"}**\n` +
          `Model: **${OLLAMA_MODEL}**\nBase URL: **${OLLAMA_BASE_URL || "(missing)"}**\nTimeout: **${OLLAMA_TIMEOUT_MS}ms**`
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

    // /hoster (visible to everyone, usable only by .kyngbob)
    if (cmd === "hoster") {
      await giveOwnerHosterRole(interaction);
      return;
    }

    await interaction.deferReply();

    if (cmd === "ask") {
      const question = interaction.options.getString("question", true).trim();
      const { category, confidence: baseConf } = classifyAsk(question);

      if (category === "other") {
        await interaction.editReply(`❌ Keep it GCSE / life / trivia.`);
        return;
      }

      const isMath = looksLikeMath(question);
      const num_predict = isMath ? 220 : 200;
      const temperature = isMath ? 0.15 : 0.35;

      const messages = [
        { role: "system", content: askSystemPrompt(category, isMath) },
        { role: "user", content: question },
      ];

      const answer = await ollamaChat(messages, { temperature, num_predict });
      const conf = adjustConfidence(baseConf, answer);

      const out = `**Category:** ${category.toUpperCase()}\n**Confidence:** ${conf}%\n\n${answer}`;
      const chunks = splitForDiscord(out);
      await interaction.editReply(chunks[0]);
      for (let i = 1; i < chunks.length; i++) await interaction.followUp(chunks[i]);
      return;
    }

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

      const out = `**Confidence:** ${adjustConfidence(70, answer)}%\n\n${answer}`;
      const chunks = splitForDiscord(out);
      await interaction.editReply(chunks[0]);
      for (let i = 1; i < chunks.length; i++) await interaction.followUp(chunks[i]);
      return;
    }

    await interaction.editReply("❓ Unknown command.");
  } catch (err) {
    console.error("❌ interactionCreate error:", err);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply("❌ Something went wrong (check Railway logs).");
      } else {
        await interaction.reply({ content: "❌ Something went wrong (check Railway logs).", ephemeral: true });
      }
    } catch {}
  }
});

/* =========================
   STARTUP
========================= */
client.once("ready", () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  console.log(`✅ Commands registered to: ${GUILD_ID ? "GUILD" : "GLOBAL"}`);
});

(async function main() {
  await registerCommands();
  await client.login(DISCORD_TOKEN);
})();
