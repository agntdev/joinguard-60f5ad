import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { applyAction, isAdmin, loadGroup, log, member, saveGroup } from "../groupguard.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";

type AdminSession = { groupGuardStep?: "welcome" | "rules" | "timeout" | "thresholds" | "moderation" };
const composer = new Composer<Ctx>();
const session = (ctx: Ctx) => ctx.session as AdminSession;
const back = () => inlineKeyboard([[inlineButton("Back", "menu:main")]]);

registerMainMenuItem({ label: "Moderation", data: "moderation:menu", order: 20 });

async function requireAdmin(ctx: Ctx, edit = true): Promise<boolean> {
  if (await isAdmin(ctx)) return true;
  if (edit) await ctx.editMessageText("Only group admins can change moderation settings.");
  else await ctx.reply("Only group admins can change moderation settings.");
  return false;
}

async function showMenu(ctx: Ctx): Promise<void> {
  if (!(await requireAdmin(ctx))) return;
  await ctx.editMessageText("Set rules, spam limits, trusted members, and notification preferences.", {
    reply_markup: inlineKeyboard([
      [inlineButton("Welcome message", "moderation:welcome"), inlineButton("Group rules", "moderation:rules")],
      [inlineButton("Verification timeout", "moderation:timeout"), inlineButton("Spam limits", "moderation:thresholds")],
      [inlineButton("Action sequence", "moderation:actions"), inlineButton("Trusted member", "moderation:trust")],
      [inlineButton("Private alerts", "moderation:notify")],
      [inlineButton("Back", "menu:main")],
    ]),
  });
}

composer.callbackQuery("moderation:menu", async (ctx) => { await ctx.answerCallbackQuery(); await showMenu(ctx); });
composer.callbackQuery(["moderation:welcome", "moderation:rules", "moderation:timeout", "moderation:thresholds"], async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireAdmin(ctx))) return;
  const kind = ctx.callbackQuery.data.split(":")[1] as Exclude<AdminSession["groupGuardStep"], undefined>;
  session(ctx).groupGuardStep = kind;
  const prompts: Record<string, string> = {
    welcome: "Send the welcome message new members should see.", rules: "Send the group rules text.",
    timeout: "Send a verification timeout in whole minutes, from 1 to 60.", thresholds: "Send two numbers: repeat limit and flood limit. Example: 3 5.",
  };
  await ctx.editMessageText(prompts[kind], { reply_markup: back() });
});

composer.callbackQuery("moderation:actions", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireAdmin(ctx))) return;
  await ctx.editMessageText("Choose the progressive action sequence.", { reply_markup: inlineKeyboard([
    [inlineButton("Warn → mute → remove", "moderation:setactions:full")],
    [inlineButton("Mute → remove", "moderation:setactions:short")], [inlineButton("Back", "moderation:menu")],
  ]) });
});
composer.callbackQuery(["moderation:setactions:full", "moderation:setactions:short"], async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireAdmin(ctx))) return;
  const { state } = await loadGroup(ctx);
  state.actionSequence = ctx.callbackQuery.data.endsWith("full") ? ["warn", "mute", "remove"] : ["mute", "remove"];
  if (!(await saveGroup(ctx, state))) { await ctx.editMessageText("Settings storage isn’t set up yet. Ask the owner to finish deployment."); return; }
  await ctx.editMessageText("Your moderation sequence is saved.", { reply_markup: back() });
});

composer.callbackQuery("moderation:notify", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireAdmin(ctx))) return;
  const { state } = await loadGroup(ctx);
  state.privateNotifications = !state.privateNotifications;
  if (!(await saveGroup(ctx, state))) { await ctx.editMessageText("Settings storage isn’t set up yet. Ask the owner to finish deployment."); return; }
  await ctx.editMessageText(`Private admin alerts are ${state.privateNotifications ? "on" : "off"}.`, { reply_markup: back() });
});

composer.callbackQuery("moderation:trust", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!(await requireAdmin(ctx))) return;
  await ctx.editMessageText("Reply to a member’s message with /moderation trust to exempt them from automatic moderation.", { reply_markup: back() });
});

composer.command("moderation", async (ctx) => {
  if (!(await requireAdmin(ctx, false))) return;
  const message = ctx.message;
  if (!message) return;
  const words = message.text.trim().split(/\s+/);
  const action = words[1];
  const target = message.reply_to_message?.from?.id;
  if (action === "trust") {
    if (!target) { await ctx.reply("Reply to a member’s message, then send /moderation trust."); return; }
    const { state } = await loadGroup(ctx);
    if (!state.trustedIds.includes(target)) state.trustedIds.push(target);
    await saveGroup(ctx, state);
    await ctx.reply("That member is now trusted.");
    return;
  }
  if (!target || !["warn", "mute", "kick", "ban"].includes(action)) {
    await ctx.reply("Reply to a member and send /moderation warn, mute, kick, ban, or trust."); return;
  }
  const { state } = await loadGroup(ctx);
  const chosen = (action === "kick" || action === "ban" ? "remove" : action) as "warn" | "mute" | "remove";
  member(state, target);
  await applyAction(ctx, state, target, chosen, `Manual ${action} by an admin`);
  await saveGroup(ctx, state);
  await ctx.reply(`The ${action} action was recorded.`);
});

composer.on("message:text", async (ctx, next) => {
  const step = session(ctx).groupGuardStep;
  if (!step) return next();
  if (!(await isAdmin(ctx))) { delete session(ctx).groupGuardStep; await ctx.reply("Only group admins can change moderation settings."); return; }
  const text = ctx.message.text.trim();
  const { state } = await loadGroup(ctx);
  if (step === "welcome" || step === "rules") {
    if (!text || text.length > 1000) { await ctx.reply("Send text between 1 and 1,000 characters."); return; }
    if (step === "welcome") state.welcomeMessage = text; else state.rulesText = text;
  } else if (step === "timeout") {
    const minutes = Number(text);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) { await ctx.reply("Send a whole number from 1 to 60."); return; }
    state.verificationTimeout = minutes * 60_000;
  } else if (step === "thresholds") {
    const [repeats, flood, ...extra] = text.split(/\s+/).map(Number);
    if (extra.length || !Number.isInteger(repeats) || !Number.isInteger(flood) || repeats < 2 || flood < 2 || flood > 20) { await ctx.reply("Send two whole numbers, such as 3 5. Repeats must be at least 2; flood limit is 2–20."); return; }
    state.repeatThreshold = repeats; state.floodLimit = flood;
  }
  if (!(await saveGroup(ctx, state))) { await ctx.reply("Settings storage isn’t set up yet. Ask the owner to finish deployment."); return; }
  delete session(ctx).groupGuardStep;
  await ctx.reply("Your moderation setting is saved.");
});

export default composer;
