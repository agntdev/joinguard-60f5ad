import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { applyAction, isAdmin, isTrusted, loadGroup, member, saveGroup } from "../groupguard.js";
import { now } from "../toolkit/index.js";

const composer = new Composer<Ctx>();

composer.on("message:text", async (ctx, next) => {
  if (!ctx.from || !ctx.chat || ctx.message.text.startsWith("/")) return next();
  const { state } = await loadGroup(ctx);
  if (isTrusted(state, ctx.from.id)) return next();
  const record = member(state, ctx.from.id);
  const at = now();
  const text = ctx.message.text.trim().toLowerCase();
  record.lastMessages = [...record.lastMessages.filter((message) => at - message.at <= 10_000), { text, at }];
  const repeats = record.lastMessages.filter((message) => message.text === text).length;
  const flooding = record.lastMessages.length > state.floodLimit;
  if (!text || (!flooding && repeats < state.repeatThreshold)) { await saveGroup(ctx, state); return next(); }
  record.spamScore += 1;
  const action = state.actionSequence[Math.min(record.spamScore - 1, state.actionSequence.length - 1)];
  await applyAction(ctx, state, ctx.from.id, action, flooding ? "Flood limit exceeded" : "Repeated message limit exceeded");
  await saveGroup(ctx, state);
  await ctx.reply(`A moderation action was applied: ${action}.`);
  if (state.privateNotifications) {
    try {
      const admins = await ctx.api.getChatAdministrators(ctx.chat.id);
      for (const admin of admins) {
        try { await ctx.api.sendMessage(admin.user.id, `A moderation action was applied in your group: ${action}.`); } catch { /* A blocked or cold DM must not stop moderation. */ }
      }
    } catch { /* Group alert above remains available if Telegram denies admin lookup. */ }
  }
});

composer.command("spam", async (ctx) => {
  if (!(await isAdmin(ctx))) { await ctx.reply("Only group admins can review spam settings."); return; }
  const { state } = await loadGroup(ctx);
  await ctx.reply(`Spam protection is on. It flags ${state.repeatThreshold} matching messages or more than ${state.floodLimit} messages in 10 seconds.`);
});

export default composer;
