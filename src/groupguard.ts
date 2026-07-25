import type { Ctx } from "./bot.js";
import { now, readPersistent, writePersistent } from "./toolkit/index.js";

export type Action = "warn" | "mute" | "remove";
export interface Member { userId: number; joinTime: number; verified: boolean; postRestrictions: boolean; spamScore: number; lastMessages: Array<{ text: string; at: number }>; }
export interface Log { actionType: string; actorId: number; targetId: number; timestamp: number; reason: string; }
export interface GroupState {
  welcomeMessage: string;
  rulesText: string;
  verificationTimeout: number;
  repeatThreshold: number;
  floodLimit: number;
  actionSequence: Action[];
  privateNotifications: boolean;
  members: Record<string, Member>;
  memberIds: number[];
  trustedIds: number[];
  logs: Log[];
}

const defaults = (): GroupState => ({
  welcomeMessage: "Welcome. Enter the verification code to start posting.",
  rulesText: "Keep the conversation respectful and avoid spam.",
  verificationTimeout: 5 * 60_000,
  repeatThreshold: 3,
  floodLimit: 5,
  actionSequence: ["warn", "mute", "remove"],
  privateNotifications: false,
  members: {}, memberIds: [], trustedIds: [], logs: [],
});

function groupKey(ctx: Ctx): string | undefined {
  return ctx.chat ? `group:${ctx.chat.id}` : undefined;
}

export async function loadGroup(ctx: Ctx): Promise<{ state: GroupState; durable: boolean }> {
  const key = groupKey(ctx);
  if (!key) return { state: defaults(), durable: false };
  try {
    const state = await readPersistent<GroupState>(ctx, key);
    return { state: state ?? defaults(), durable: Boolean(state) || Boolean((ctx as unknown as { env?: unknown }).env) || (typeof process !== "undefined" && Boolean(process.env.REDIS_URL)) };
  } catch { return { state: defaults(), durable: false }; }
}

export async function saveGroup(ctx: Ctx, state: GroupState): Promise<boolean> {
  const key = groupKey(ctx);
  if (!key) return false;
  try { return await writePersistent(ctx, key, state); } catch { return false; }
}

export function member(state: GroupState, userId: number): Member {
  const found = state.members[String(userId)];
  if (found) return found;
  const next: Member = { userId, joinTime: now(), verified: false, postRestrictions: true, spamScore: 0, lastMessages: [] };
  state.members[String(userId)] = next;
  state.memberIds.push(userId);
  return next;
}

export function log(state: GroupState, entry: Omit<Log, "timestamp">): void {
  state.logs.push({ ...entry, timestamp: now() });
  // Keep the audit record bounded while retaining the latest actions.
  if (state.logs.length > 200) state.logs.splice(0, state.logs.length - 200);
}

export function isTrusted(state: GroupState, userId: number): boolean { return state.trustedIds.includes(userId); }

export async function isAdmin(ctx: Ctx): Promise<boolean> {
  if (!ctx.from || !ctx.chat) return false;
  if (ctx.chat.type === "private") return true;
  try {
    const status = (await ctx.getChatMember(ctx.from.id)).status;
    return status === "administrator" || status === "creator";
  } catch { return false; }
}

export async function applyAction(ctx: Ctx, state: GroupState, targetId: number, action: Action, reason: string): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;
  if (action === "mute") {
    await ctx.api.restrictChatMember(chatId, targetId, { can_send_messages: false });
  } else if (action === "remove") {
    await ctx.api.banChatMember(chatId, targetId);
    await ctx.api.unbanChatMember(chatId, targetId, { only_if_banned: true });
  }
  log(state, { actionType: action, actorId: ctx.from?.id ?? 0, targetId, reason });
}

export function formatSummary(state: GroupState): string {
  const joins = state.memberIds.length;
  const verified = state.memberIds.filter((id) => state.members[String(id)]?.verified).length;
  const removed = state.logs.filter((entry) => entry.actionType === "remove").length;
  return `Moderation summary\nJoined: ${joins}\nVerified: ${verified}\nRemoved: ${removed}\nSpam limits: ${state.repeatThreshold} repeats, ${state.floodLimit} messages in 10 seconds.`;
}
