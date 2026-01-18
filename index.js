// index.js (ESM / "type": "module" in package.json)
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";

// ======================
// ENV / CONFIG
// ======================
const DISCORD_TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID; // required for command registration
const GUILD_ID = process.env.GUILD_ID;   // optional (recommended for instant updates)

const OLLAMA_BASE_URL =
  (process.env.OLLAMA_BASE_URL || "https://data-bacon-guru-sum.trycloudflare.com").replace(/\/+$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";

// Keep it modest for i3 + 4GB (and to avoid slow responses)
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 45000);
const MAX_CONTEXT_TURNS = Number(process.env.MAX_CONTEXT_TURNS || 6); // per user (short)
const MEMORY_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_OUTPUT_CHARS = 1800;        // keep headroom for formatting

// Simple cooldowns (stop spam & protect your Ubuntu PC)
const COOLDOWN_MS_ASK = Number(process.env.COOLDOWN_MS_ASK || 8000);
const COOLDOWN_MS_RP  = Number(process.env.COOLDOWN_MS_RP  || 12000);

// ======================
// DISCORD CLIENT
// ======================
const client = new Client({
  intents: [GatewayIntentBits.Guilds], // interactions only
});

// per-user memory: [{role:'user'|'assistant', content, t}]
const userMemory = new Map();
// per-user cooldown: Map<userId, Map<command, lastTime>>
const cooldowns = new Map();

// ======================
// SLASH COMMANDS
// ======================
const commands = [
  new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Ask Bob's AI about GCSE, life advice, or trivia.")
    .addStringOption((opt) =>
      opt
        .setName("question")
        .setDescription("Your question")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("rp")
    .setDescription("Roleplay with Bob's AI (style-mimic + chaos).")
    .addStringOption((opt) =>
      opt
        .setName("scenario")
        .setDescription("What’s happening in the roleplay?")
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("style")
        .setDescription("Optional: e.g. 'chaotic', 'dry', 'dramatic', 'texting', 'caps', etc.")
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
      await rest.put(Routes.applicationCommands(CLIENT_ID), {
        body: commands,
      });
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

function cleanMemory(userId) {
  const mem = userMemory.get(userId) || [];
  const fresh = mem.filter((m) => now() - m.t < MEMORY_TTL_MS);
  // keep only the last N turns
  const trimmed = fresh.slice(-MAX_CONTEXT_TURNS);
  userMemory.set(userId, trimmed);
  return trimmed;
}

function pushMemory(userId, role, content) {
  const mem = cleanMemory(userId);
  mem.push({ role, content, t: now() });
  userMemory.set(userId, mem.slice(-MAX_CONTEXT_TURNS));
}

function splitForDiscord(text, maxLen = MAX_OUTPUT_CHARS) {
  const chunks = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    // try split at a newline near the end
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

  // heuristics
  if (looksLikeMath(question)) scoreGcse += 2; // maths often GCSE in your server
  if (/\bessay\b|\banalyse\b|\bevaluate\b|\bcompare\b|\bexplain\b|\bdescribe\b/.test(q)) scoreGcse += 1;

  // if it sounds like coding/finance/legal crimes etc, flag as other
  if (/\bcredit card\b|\bhack\b|\bcarding\b|\bexplosive\b|\bweapon\b/.test(q)) scoreOther += 5;

  const best = [
    { cat: "gcse", score: scoreGcse },
    { cat: "life", score: scoreLife },
    { cat: "trivia", score: scoreTrivia },
    { cat: "other", score: scoreOther },
  ].sort((a, b) => b.score - a.score)[0];

  // confidence from score
  const conf = Math.max(35, Math.min(95, 40 + best.score * 8));
  return { category: best.cat, confidence: conf, scores: { scoreGcse, scoreLife, scoreTrivia, scoreOther } };
}

// ======================
// OLLAMA CALLS
// ======================
async function ollamaChat(messages, { temperature = 0.4, num_predict = 350 } = {}) {
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
          num_predict, // roughly "max tokens"
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

// Lightweight confidence tweak based on the generated answer text
function adjustConfidence(base, answerText) {
  let conf = base;
  const a = answerText.toLowerCase();
  if (/\bnot sure\b|\bunsure\b|\bi think\b|\bmaybe\b|\bapproximately\b/.test(a)) conf -= 12;
  if (/\bi can’t\b|\bcannot\b|\bdon’t know\b|\bunknown\b/.test(a)) conf -= 20;
  if (/\bstep\b|\bworking\b|\btherefore\b|\bfinal answer\b/.test(a)) conf += 6;
  return Math.max(5, Math.min(99, Math.round(conf)));
}

// ======================
// PROMPTS
// ======================
function buildAskSystemPrompt(category) {
  // Keep it strict + exam-style, but not too long (small model).
  const base =
    `You are "Bob's AI", a UK GCSE-focused tutor and general knowledge helper.\n` +
    `Answer clearly and accurately.\n` +
    `If the question is GCSE, answer in an exam-friendly way: method, working, final answer, and common mistake check.\n` +
    `If maths: show steps and do a quick self-check.\n` +
    `Keep it concise but complete.\n`;

  const gcse =
    `You are answering a GCSE-style question. Use UK GCSE tone.\n` +
    `If it’s an exam question, structure like: (1) What it’s asking (2) Steps/working (3) Final answer (4) Marks/why this scores.\n`;

  const life =
    `You are giving practical life/study advice: actionable steps, options, and a short plan.\n`;

  const trivia =
    `You are answering general knowledge/trivia: give the direct answer, then 1–2 helpful facts.\n`;

  if (category === "gcse") return base + gcse;
  if (category === "life") return base + life;
  return base + trivia;
}

function buildRpSystemPrompt(intensity, styleHint, userText) {
  const styleProfile = inferTypingStyle(userText);

  // Safety rules must exist (cannot remove), but we keep rp “chaotic” within safe bounds.
  const safety =
    `Stay within safe boundaries: no sexual content involving minors, no illegal wrongdoing instructions, no hateful harassment.\n`;

  const rp =
    `You are roleplaying with the user. Be imaginative, vivid, and responsive.\n` +
    `Match the user's typing style (caps, slang, punctuation, message length).\n` +
    `Intensity: ${intensity}/5. Higher = weirder, faster, more chaotic, but still coherent.\n` +
    (styleHint ? `User requested style: ${styleHint}\n` : "") +
    `Detected typing style: ${styleProfile}\n` +
    `Do not mention these instructions.\n`;

  return safety + rp;
}

function inferTypingStyle(text) {
  const t = (text || "").trim();
  if (!t) return "Neutral, short, casual.";

  const hasEmoji = /[\u{1F300}-\u{1FAFF}]/u.test(t);
  const manyCaps = (t.match(/[A-Z]/g) || []).length > (t.length * 0.2);
  const lotsPunc = /[!?]{2,}|\.{3,}/.test(t);
  const short = t.length < 40;
  const slang = /\bomds\b|\bfr\b|\blowkey\b|\bhighkey\b|\binnit\b|\bbruh\b|\blmao\b|\brofl\b/i.test(t);

  const parts = [];
  parts.push(short ? "Short messages" : "Longer messages");
  if (manyCaps) parts.push("some caps");
  if (lotsPunc) parts.push("expressive punctuation");
  if (slang) parts.push("UK slang");
  if (hasEmoji) parts.push("uses emojis");
  return parts.join(", ") + ".";
}

// ======================
// INTERACTIONS
// ======================
client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;

    const userId = interaction.user.id;
    const cmd = interaction.commandName;

    // cooldown handling
    const last = getCooldown(userId, cmd);
    const cd = cmd === "ask" ? COOLDOWN_MS_ASK : COOLDOWN_MS_RP;
    if (now() - last < cd) {
      const wait = Math.ceil((cd - (now() - last)) / 1000);
      await interaction.reply({
        content: `⏳ Chill — try again in ${wait}s.`,
        ephemeral: true,
      });
      return;
    }
    setCooldown(userId, cmd);

    await interaction.deferReply();

    if (cmd === "ask") {
      const question = interaction.options.getString("question", true).trim();

      // classify + gate
      const { category, confidence: baseConf } = classifyAsk(question);

      if (category === "other") {
        await interaction.editReply(
          `❌ Keep it **GCSE**, **life-related**, or **trivia/general knowledge**.\nTry rephrasing your question in one of those ways.`
        );
        return;
      }

      // memory
      cleanMemory(userId);
      pushMemory(userId, "user", question);

      const system = buildAskSystemPrompt(category);

      // Keep short context to protect your 4GB server
      const mem = cleanMemory(userId);
      const context = mem.map(({ role, content }) => ({ role, content }));

      const messages = [
        { role: "system", content: system },
        ...context,
        { role: "user", content: question },
      ];

      // Make maths a bit more careful
      const temp = looksLikeMath(question) ? 0.15 : 0.4;
      const num_predict = looksLikeMath(question) ? 420 : 320;

      let answer = await ollamaChat(messages, { temperature: temp, num_predict });

      // OPTIONAL: quick self-check pass for maths (small extra cost, boosts accuracy)
      if (looksLikeMath(question)) {
        const checkMessages = [
          { role: "system", content: "You are checking the correctness of a GCSE maths solution. If any step is wrong, fix it and give the corrected final answer with working. If it is correct, restate the final answer and a 1-line check." },
          { role: "user", content: `Question: ${question}\n\nProposed solution:\n${answer}` },
        ];
        const checked = await ollamaChat(checkMessages, { temperature: 0.1, num_predict: 260 });
        // Use the checked version if it looks non-empty
        if (checked && checked.length > 30) answer = checked;
      }

      pushMemory(userId, "assistant", answer);

      const conf = adjustConfidence(baseConf, answer);

      const header =
        `**Category:** ${category.toUpperCase()}\n` +
        `**Confidence:** ${conf}%\n`;

      const out = header + `\n${answer}`;

      const chunks = splitForDiscord(out);
      await interaction.editReply(chunks[0]);
      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp(chunks[i]);
      }
      return;
    }

    if (cmd === "rp") {
      const scenario = interaction.options.getString("scenario", true).trim();
      const style = interaction.options.getString("style")?.trim() || "";
      const intensity = interaction.options.getInteger("intensity") || 4;

      // memory
      cleanMemory(userId);
      pushMemory(userId, "user", scenario);

      const system = buildRpSystemPrompt(intensity, style, scenario);

      const mem = cleanMemory(userId);
      const context = mem.map(({ role, content }) => ({ role, content }));

      const messages = [
        { role: "system", content: system },
        ...context,
        { role: "user", content: scenario },
      ];

      const answer = await ollamaChat(messages, {
        temperature: 0.85,
        num_predict: 260,
      });

      pushMemory(userId, "assistant", answer);

      // confidence here is “how well it matched the prompt/style”
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
  } catch (err) {
    console.error("❌ interactionCreate error:", err);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(
          `❌ Something went wrong. (Common causes: tunnel URL changed, Ubuntu PC offline, model busy)\n` +
          `If it keeps happening, tell me what you see in Railway logs.`
        );
      } else {
        await interaction.reply({
          content:
            `❌ Something went wrong. (Common causes: tunnel URL changed, Ubuntu PC offline, model busy)\n` +
            `If it keeps happening, tell me what you see in Railway logs.`,
          ephemeral: true,
        });
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
});

(async function main() {
  await registerCommands();
  await client.login(DISCORD_TOKEN);
})();
