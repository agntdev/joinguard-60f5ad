import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { formatSummary, isAdmin, loadGroup } from "../groupguard.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";

registerMainMenuItem({ label: "Summary", data: "summary:show", order: 30 });
const composer = new Composer<Ctx>();
async function sendSummary(ctx: Ctx, edit: boolean): Promise<void> {
  if (!(await isAdmin(ctx))) { if (edit) await ctx.editMessageText("Only group admins can view this summary."); else await ctx.reply("Only group admins can view this summary."); return; }
  const { state } = await loadGroup(ctx);
  const options = { reply_markup: inlineKeyboard([[inlineButton("Back", "menu:main")]]) };
  if (edit) await ctx.editMessageText(formatSummary(state), options); else await ctx.reply(formatSummary(state), options);
}
composer.command("summary", async (ctx) => sendSummary(ctx, false));
composer.callbackQuery("summary:show", async (ctx) => { await ctx.answerCallbackQuery(); await sendSummary(ctx, true); });
export default composer;
