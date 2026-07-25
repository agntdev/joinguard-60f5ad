import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";

registerMainMenuItem({ label: "Verify", data: "verify:start", order: 10 });
const composer = new Composer<Ctx>();

composer.callbackQuery("verify:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText("New members receive a code when they join. If you have a pending code, send it here.", {
    reply_markup: inlineKeyboard([[inlineButton("Enter my code", "verify:me")], [inlineButton("Back", "menu:main")]]),
  });
});

export default composer;
