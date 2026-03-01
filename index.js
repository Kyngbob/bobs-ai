// index.js (ESM) — discord.js v14
// package.json should include: { "type": "module" }

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
const GUILD_ID = process.env.GUILD_ID || null;

// IMPORTANT: put your Discord user ID here (Railway Variables)
const OWNER_USER_ID = process.env.OWNER_USER_ID || "";

/* =========================
   STATE
========================= */
let isLocked = false;
let lockReason = "";

// Light cooldown for admin/owner commands to prevent spam
const COOLDOWN_ADMIN_MS = 1500;
const cooldowns = new Map(); // key -> last timestamp

/* =========================
   HELPERS
========================= */
function now() {
  return Date.now();
}

function isOwner(user) {
  return OWNER_USER_ID && user.id === OWNER_USER_ID;
}

function isAdminMember(member, user) {
  if (isOwner(user)) return true;
  try {
    return member?.permissions?.has?.(PermissionFlagsBits.Administrator) ?? false;
  } catch {
    return false;
  }
}

function checkCooldown(key, userId, ms) {
  const k = `${key}:${userId}`;
  const last = cooldowns.get(k) || 0;
  const t = now();
  if (t - last < ms) return ms - (t - last);
  cooldowns.set(k, t);
  return 0;
}

function normalizeRoleName(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[\s"'`~|]/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function parseDurationMs(s) {
  // supports: 10s, 5m, 2h, 1d, 1w
  const m = /^(\d+)\s*([smhdw])$/i.exec((s ?? "").trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[unit];
  return n * mult;
}

function extractUserId(token) {
  // token can be: <@123>, <@!123>, 123
  const t = (token ?? "").trim();
  const m = t.match(/^<@!?(\d+)>$/) || t.match(/^(\d{15,25})$/);
  return m ? m[1] : null;
}

/* =========================
   /cmd parser (owner-only)
========================= */
async function runOwnerCommand(interaction, input) {
  // tokenizer: keeps quoted parts together
  const parts = input.match(/"([^"]+)"|\S+/g)?.map((p) => p.replace(/^"|"$/g, "")) ?? [];
  if (parts.length === 0) return "No command provided.";

  const verb = parts[0].toLowerCase();

  async function getTargetMember() {
    const id = extractUserId(parts[1] ?? "");
    if (!id) throw new Error("2nd argument must be a user mention or ID.");
    const member = await interaction.guild.members.fetch(id).catch(() => null);
    if (!member) throw new Error("User not found in this server.");
    return member;
  }

  if (verb === "ban") {
    const member = await getTargetMember();
    const reason = parts.slice(2).join(" ") || "No reason provided";
    await member.ban({ reason });
    return `✅ Banned ${member.user.tag}\nReason: ${reason}`;
  }

  if (verb === "kick") {
    const member = await getTargetMember();
    const reason = parts.slice(2).join(" ") || "No reason provided";
    await member.kick(reason);
    return `✅ Kicked ${member.user.tag}\nReason: ${reason}`;
  }

  if (verb === "timeout") {
    const member = await getTargetMember();
    const dur = parseDurationMs(parts[2] ?? "");
    if (!dur) throw new Error('Duration invalid. Example: timeout @user 10m spamming');
    const max = 28 * 24 * 60 * 60 * 1000;
    if (dur > max) throw new Error("Max timeout is 28 days.");
    const reason = parts.slice(3).join(" ") || "No reason provided";
    await member.timeout(dur, reason);
    return `✅ Timed out ${member.user.tag} for ${parts[2]}\nReason: ${reason}`;
  }

  if (verb === "untimeout" || verb === "unmute") {
    const member = await getTargetMember();
    const reason = parts.slice(2).join(" ") || "No reason provided";
    await member.timeout(null, reason);
    return `✅ Removed timeout for ${member.user.tag}\nReason: ${reason}`;
  }

  return `Unknown command: ${verb}\nSupported: ban, kick, timeout, untimeout`;
}

/* =========================
   SLASH COMMANDS
========================= */
const commands = [
  new SlashCommandBuilder()
    .setName("cmd")
    .setDescription("OWNER ONLY: run moderation commands (ban/kick/timeout/etc)")
    .addStringOption((opt) =>
      opt
        .setName("command")
        .setDescription('Example: ban @user reason | timeout @user 10m reason')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("lock")
    .setDescription("ADMIN: Lock commands (blocks most commands for non-admins).")
    .addStringOption((opt) =>
      opt.setName("reason").setDescription("Optional reason shown while locked").setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),

  new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("ADMIN: Unlock commands.")
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
    .addStringOption((opt) => opt.setName("text").setDescription("Text").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),

  new SlashCommandBuilder()
    .setName("hoster")
    .setDescription("OWNER ONLY: give the owner the hoster role"),
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
      console.log(`✅ Registered guild commands to ${GUILD_ID}`);
    } else {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
      console.log("✅ Registered global commands (can take time to appear)");
    }
  } catch (err) {
    console.error("Failed to register commands:", err);
  }
}

/* =========================
   DISCORD CLIENT
========================= */
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once("ready", () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const userId = interaction.user.id;
  const member = interaction.member;

  // Cooldown for admin/owner commands
  if (["lock", "unlock", "lockreason", "status", "say", "cmd", "hoster"].includes(interaction.commandName)) {
    const left = checkCooldown("admin", userId, COOLDOWN_ADMIN_MS);
    if (left > 0) {
      return interaction.reply({ content: `One sec… (${Math.ceil(left / 1000)}s)`, ephemeral: true });
    }
  }

  // Lock gate: when locked, block most commands for non-admins/owner
  // (Owner/admin can still use everything.)
  const allowedWhileLocked = new Set(["status", "lockreason", "unlock", "lock", "cmd", "hoster"]);
  if (isLocked && !isAdminMember(member, interaction.user) && !allowedWhileLocked.has(interaction.commandName)) {
    const reason = lockReason ? `\nReason: ${lockReason}` : "";
    return interaction.reply({
      content: `🔒 Locked right now.${reason}`,
      ephemeral: true,
    });
  }

  try {
    /* ===== /cmd (owner only) ===== */
    if (interaction.commandName === "cmd") {
      if (!isOwner(interaction.user)) {
        return interaction.reply({ content: "Owner only ❌", ephemeral: true });
      }
      const input = interaction.options.getString("command", true).trim();
      await interaction.deferReply({ ephemeral: true });

      const out = await runOwnerCommand(interaction, input);
      return interaction.editReply(out);
    }

    /* ===== /lock ===== */
    if (interaction.commandName === "lock") {
      if (!isAdminMember(member, interaction.user)) {
        return interaction.reply({ content: "Admin only ❌", ephemeral: true });
      }
      isLocked = true;
      lockReason = interaction.options.getString("reason") || "";
      return interaction.reply({
        content: `🔒 Locked.${lockReason ? ` Reason: ${lockReason}` : ""}`,
        ephemeral: true,
      });
    }

    /* ===== /unlock ===== */
    if (interaction.commandName === "unlock") {
      if (!isAdminMember(member, interaction.user)) {
        return interaction.reply({ content: "Admin only ❌", ephemeral: true });
      }
      isLocked = false;
      lockReason = "";
      return interaction.reply({ content: "🔓 Unlocked.", ephemeral: true });
    }

    /* ===== /lockreason ===== */
    if (interaction.commandName === "lockreason") {
      if (!isAdminMember(member, interaction.user)) {
        return interaction.reply({ content: "Admin only ❌", ephemeral: true });
      }
      const reason = interaction.options.getString("reason");
      if (!reason) {
        return interaction.reply({
          content: `Current lock reason: ${lockReason ? lockReason : "(none)"}`,
          ephemeral: true,
        });
      }
      if (reason.toLowerCase() === "clear") {
        lockReason = "";
        return interaction.reply({ content: "Cleared lock reason.", ephemeral: true });
      }
      lockReason = reason;
      return interaction.reply({ content: `Set lock reason: ${lockReason}`, ephemeral: true });
    }

    /* ===== /status ===== */
    if (interaction.commandName === "status") {
      if (!isAdminMember(member, interaction.user)) {
        return interaction.reply({ content: "Admin only ❌", ephemeral: true });
      }
      return interaction.reply({
        content:
          `**Status**\n` +
          `Locked: ${isLocked ? "YES" : "NO"}\n` +
          `Reason: ${lockReason || "(none)"}\n` +
          `Owner ID set: ${OWNER_USER_ID ? "YES" : "NO"}\n`,
        ephemeral: true,
      });
    }

    /* ===== /say ===== */
    if (interaction.commandName === "say") {
      if (!isAdminMember(member, interaction.user)) {
        return interaction.reply({ content: "Admin only ❌", ephemeral: true });
      }
      const text = interaction.options.getString("text", true);
      await interaction.reply({ content: "✅ Sent.", ephemeral: true });
      return interaction.channel?.send(text);
    }

    /* ===== /hoster (owner only) ===== */
    if (interaction.commandName === "hoster") {
      if (!isOwner(interaction.user)) {
        return interaction.reply({ content: "Owner only ❌", ephemeral: true });
      }

      const desired = `; GW HOSTER :)`;
      const desiredNorm = normalizeRoleName(desired);

      const role = interaction.guild.roles.cache.find((r) => normalizeRoleName(r.name) === desiredNorm);

      if (!role) {
        return interaction.reply({
          content: `Couldn't find the role "${desired}". Create it first (exact name), then run /hoster again.`,
          ephemeral: true,
        });
      }

      const me = await interaction.guild.members.fetch(interaction.user.id);
      if (me.roles.cache.has(role.id)) {
        return interaction.reply({ content: "You already have the role ✅", ephemeral: true });
      }

      await me.roles.add(role);
      return interaction.reply({ content: `✅ Added role: ${role.name}`, ephemeral: true });
    }

    return interaction.reply({ content: "Unknown command.", ephemeral: true });
  } catch (err) {
    console.error("Command error:", err);
    const msg = `${err?.message ?? String(err)}`.slice(0, 1500);

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(`❌ Error: ${msg}`);
      } else {
        await interaction.reply({ content: `❌ Error: ${msg}`, ephemeral: true });
      }
    } catch {}
  }
});

/* =========================
   STARTUP
========================= */
(async () => {
  await registerCommands();

  if (!DISCORD_TOKEN) {
    console.error("Missing TOKEN env var.");
    process.exit(1);
  }

  await client.login(DISCORD_TOKEN);
})();