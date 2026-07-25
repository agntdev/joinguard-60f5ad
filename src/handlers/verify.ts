import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, now } from "../toolkit/index.js";
import { isAdmin, loadGroup, log, member, saveGroup } from "../groupguard.js";

type Verification = { targetId: number; code: string; expiresAt: number; attempts: number };
type VerificationSession = { verifications?: Record<string, Verification> };
const composer = new Composer<Ctx>();

function flow(ctx: Ctx): VerificationSession { return ctx.session as VerificationSession; }
function pendingFor(ctx: Ctx, userId: number): Verification | undefined { return flow(ctx).verifications?.[String(userId)]; }
function clearPending(ctx: Ctx, userId: number): void {
  if (flow(ctx).verifications) delete flow(ctx).verifications![String(userId)];
}
function codeFor(userId: number): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String((bytes[0] ^ userId) % 900000 + 100000);
}

async function verify(ctx: Ctx, targetId: number): Promise<boolean> {
  const { state } = await loadGroup(ctx);
  const target = member(state, targetId);
  target.verified = true;
  target.postRestrictions = false;
  log(state, { actionType: "verify", actorId: ctx.from?.id ?? 0, targetId, reason: "Verification completed" });
  if (ctx.chat) {
    await ctx.api.restrictChatMember(ctx.chat.id, targetId, { can_send_messages: true, can_send_other_messages: true, can_send_polls: true, can_add_web_page_previews: true, can_change_info: false, can_invite_users: true, can_pin_messages: false });
  }
  return saveGroup(ctx, state);
}

composer.on("chat_member", async (ctx) => {
  const update = ctx.chatMember;
  const wasMember = ["member", "administrator", "creator", "restricted"].includes(update.old_chat_member.status);
  const isMember = ["member", "restricted"].includes(update.new_chat_member.status);
  if (wasMember || !isMember || update.new_chat_member.user.is_bot) return;
  const target = update.new_chat_member.user;
  const { state } = await loadGroup(ctx);
  const record = member(state, target.id);
  if (state.trustedIds.includes(target.id)) {
    record.verified = true;
    record.postRestrictions = false;
    log(state, { actionType: "trusted_join", actorId: 0, targetId: target.id, reason: "Trusted member" });
    await saveGroup(ctx, state);
    return;
  }
  const code = codeFor(target.id);
  const verifications = flow(ctx).verifications ?? (flow(ctx).verifications = {});
  verifications[String(target.id)] = { targetId: target.id, code, expiresAt: now() + state.verificationTimeout, attempts: 3 };
  record.postRestrictions = true;
  log(state, { actionType: "join", actorId: 0, targetId: target.id, reason: "Verification required" });
  await saveGroup(ctx, state);
  await ctx.api.restrictChatMember(ctx.chat.id, target.id, { can_send_messages: false });
  await ctx.reply(`${state.welcomeMessage}\n\nRules: ${state.rulesText}\n\nReply with this code within ${Math.round(state.verificationTimeout / 60_000)} minutes: ${code}`);
});

composer.on("message:text", async (ctx, next) => {
  if (!ctx.from) return next();
  const pending = pendingFor(ctx, ctx.from.id);
  if (!pending) return next();
  if (now() > pending.expiresAt) {
    if (ctx.chat) await ctx.api.banChatMember(ctx.chat.id, pending.targetId);
    const { state } = await loadGroup(ctx);
    log(state, { actionType: "remove", actorId: 0, targetId: pending.targetId, reason: "Verification timed out" });
    await saveGroup(ctx, state);
    clearPending(ctx, pending.targetId);
    await ctx.reply("Your verification time ran out, so you’ve been removed. Ask an admin for a new invite.");
    return;
  }
  if (ctx.message.text.trim() !== pending.code) {
    pending.attempts -= 1;
    if (pending.attempts <= 0) {
      if (ctx.chat) await ctx.api.banChatMember(ctx.chat.id, pending.targetId);
      const { state } = await loadGroup(ctx);
      log(state, { actionType: "remove", actorId: 0, targetId: pending.targetId, reason: "Verification attempts exceeded" });
      await saveGroup(ctx, state);
      clearPending(ctx, pending.targetId);
      await ctx.reply("That code wasn’t accepted. You’ve been removed; ask an admin for a new invite.");
    } else await ctx.reply(`That code doesn’t match. You have ${pending.attempts} attempt${pending.attempts === 1 ? "" : "s"} left.`);
    return;
  }
  await verify(ctx, pending.targetId);
  clearPending(ctx, pending.targetId);
  await ctx.reply("You’re verified and can post now.");
});

composer.command("verify", async (ctx) => {
  if (!(await isAdmin(ctx))) { await ctx.reply("Only group admins can verify members."); return; }
  const replyTo = ctx.message?.reply_to_message?.from?.id;
  if (!replyTo) { await ctx.reply("Reply to a member’s message with /verify to approve them."); return; }
  await verify(ctx, replyTo);
  await ctx.reply("That member is verified and can post now.");
});

composer.callbackQuery("verify:me", async (ctx) => {
  await ctx.answerCallbackQuery();
  const pending = pendingFor(ctx, ctx.from.id);
  if (!pending) {
    await ctx.editMessageText("There’s no active verification for you. Ask an admin to add you again.");
    return;
  }
  await ctx.editMessageText("Send the six-digit code from the welcome message.", { reply_markup: inlineKeyboard([[inlineButton("Back", "menu:main")]]) });
});

export default composer;
