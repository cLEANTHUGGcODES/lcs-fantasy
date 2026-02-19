import { requireAuthUser } from "@/lib/draft-auth";
import {
  formatChatReactionUserLabel,
  GlobalChatError,
  listGlobalChatReactionsForMessage,
  toggleGlobalChatReaction,
} from "@/lib/global-chat";
import { getSupabaseAuthServerClient } from "@/lib/supabase-auth-server";
import { getUserDisplayName } from "@/lib/user-profile";

type ToggleReactionBody = {
  messageId?: number;
  emoji?: string;
};

const parseMessageId = (value: unknown): number => {
  const numeric = typeof value === "number"
    ? value
    : Number.parseInt(`${value ?? ""}`, 10);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
};

const INVALID_REQUEST_CODES = new Set([
  "INVALID_MESSAGE_ID",
  "INVALID_REACTOR_LABEL",
  "INVALID_EMOJI",
]);

export async function POST(request: Request) {
  try {
    const supabase = await getSupabaseAuthServerClient();
    const user = await requireAuthUser(supabase);
    const body = (await request.json()) as ToggleReactionBody;
    const messageId = parseMessageId(body.messageId);
    const emoji = typeof body.emoji === "string" ? body.emoji.trim() : "";

    const reactionUserLabelSource = getUserDisplayName(user) ?? user.id;
    const reactionUserLabel = formatChatReactionUserLabel(reactionUserLabelSource);
    const result = await toggleGlobalChatReaction({
      supabase,
      messageId,
      userId: user.id,
      reactorLabel: reactionUserLabel,
      emoji,
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof GlobalChatError) {
      if (error.code === "UNAUTHORIZED") {
        return Response.json({ error: error.message, code: error.code }, { status: 401 });
      }
      if (error.code === "MESSAGE_NOT_FOUND") {
        return Response.json({ error: error.message, code: error.code }, { status: 404 });
      }
      if (INVALID_REQUEST_CODES.has(error.code ?? "")) {
        return Response.json({ error: error.message, code: error.code }, { status: 400 });
      }
    }
    const message = error instanceof Error ? error.message : "Unable to toggle reaction.";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
}

export async function GET(request: Request) {
  try {
    const supabase = await getSupabaseAuthServerClient();
    await requireAuthUser(supabase);
    const { searchParams } = new URL(request.url);
    const messageId = parseMessageId(searchParams.get("messageId"));
    const result = await listGlobalChatReactionsForMessage({
      supabase,
      messageId,
    });
    return Response.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof GlobalChatError) {
      if (error.code === "UNAUTHORIZED") {
        return Response.json({ error: error.message, code: error.code }, { status: 401 });
      }
      if (INVALID_REQUEST_CODES.has(error.code ?? "")) {
        return Response.json({ error: error.message, code: error.code }, { status: 400 });
      }
    }
    const message = error instanceof Error ? error.message : "Unable to load reactions.";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
}
