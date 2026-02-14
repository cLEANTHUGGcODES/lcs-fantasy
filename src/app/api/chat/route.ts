import { requireAuthUser } from "@/lib/draft-auth";
import {
  GlobalChatError,
  MAX_GLOBAL_CHAT_MESSAGE_LENGTH,
  listGlobalChatMessages,
  normalizeGlobalChatMessage,
  recordChatObservabilityEvents,
  submitGlobalChatMessage,
} from "@/lib/global-chat";
import { getSupabaseAuthServerClient } from "@/lib/supabase-auth-server";
import {
  getUserAvatarBorderColor,
  getUserAvatarUrl,
  getUserDisplayName,
  getUserTeamName,
} from "@/lib/user-profile";
import { getSupabaseAuthEnv } from "@/lib/supabase-auth-env";

type PostChatBody = {
  message?: string;
};

const RATE_LIMIT_ERROR_CODES = new Set(["RATE_LIMIT_SHORT", "RATE_LIMIT_MINUTE"]);
const BAD_REQUEST_ERROR_CODES = new Set([
  "INVALID_SENDER_LABEL",
  "EMPTY_MESSAGE",
  "MESSAGE_TOO_LONG",
  "INVALID_IDEMPOTENCY_KEY",
]);

const buildSenderLabel = ({
  teamName,
  userLabel,
}: {
  teamName: string | null;
  userLabel: string;
}): string => (teamName ? `${teamName} (${userLabel})` : userLabel);

const parsePositiveInteger = (value: string | null): number | undefined => {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const parseIdempotencyKey = (request: Request): string | null => {
  const headerValue = request.headers.get("x-idempotency-key");
  if (!headerValue) {
    return null;
  }
  const normalized = headerValue.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length > 128) {
    throw new GlobalChatError("Idempotency key must be 128 characters or fewer.", "INVALID_IDEMPOTENCY_KEY");
  }
  return normalized;
};

const durationMetricValue = (startedAtMs: number): number =>
  Math.max(1, Math.round(Date.now() - startedAtMs));

export async function GET(request: Request) {
  const startedAt = Date.now();
  let metricUserId: string | null = null;
  let metricStatusCode = 200;
  let metricSupabase: Awaited<ReturnType<typeof getSupabaseAuthServerClient>> | null = null;

  try {
    const supabase = await getSupabaseAuthServerClient();
    metricSupabase = supabase;
    const user = await requireAuthUser(supabase);
    metricUserId = user.id;

    const { searchParams } = new URL(request.url);
    const limit = parsePositiveInteger(searchParams.get("limit"));
    const afterId = parsePositiveInteger(searchParams.get("afterId"));
    const beforeId = parsePositiveInteger(searchParams.get("beforeId"));

    const result = await listGlobalChatMessages({
      supabase,
      limit,
      afterId,
      beforeId,
    });

    return Response.json(
      {
        messages: result.messages,
        hasMore: result.hasMore,
        nextBeforeId: result.nextBeforeId,
      },
      { status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load chat.";
    metricStatusCode = message === "UNAUTHORIZED" ? 401 : 500;
    return Response.json({ error: message }, { status: metricStatusCode });
  } finally {
    if (metricUserId && metricSupabase) {
      void recordChatObservabilityEvents({
        supabase: metricSupabase,
        userId: metricUserId,
        source: "server",
        events: [
          {
            metricName: "fetch_latency_ms",
            metricValue: durationMetricValue(startedAt),
            metadata: { statusCode: metricStatusCode },
          },
        ],
      }).catch(() => undefined);
    }
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  let metricUserId: string | null = null;
  let metricStatusCode = 201;
  let metricDuplicate = false;
  let metricSupabase: Awaited<ReturnType<typeof getSupabaseAuthServerClient>> | null = null;

  try {
    const supabase = await getSupabaseAuthServerClient();
    metricSupabase = supabase;
    const user = await requireAuthUser(supabase);
    metricUserId = user.id;

    const idempotencyKey = parseIdempotencyKey(request);
    const body = (await request.json()) as PostChatBody;
    const message = normalizeGlobalChatMessage(body.message ?? "");
    if (!message) {
      metricStatusCode = 400;
      return Response.json({ error: "Message cannot be empty." }, { status: 400 });
    }
    if (message.length > MAX_GLOBAL_CHAT_MESSAGE_LENGTH) {
      metricStatusCode = 400;
      return Response.json(
        {
          error: `Message must be ${MAX_GLOBAL_CHAT_MESSAGE_LENGTH} characters or fewer.`,
        },
        { status: 400 },
      );
    }

    const userLabel = getUserDisplayName(user) ?? user.id;
    const teamName = getUserTeamName(user);
    const senderLabel = buildSenderLabel({ teamName, userLabel });
    const senderAvatarUrl = getUserAvatarUrl({
      user,
      supabaseUrl: getSupabaseAuthEnv().supabaseUrl,
    });
    const senderAvatarBorderColor = getUserAvatarBorderColor(user);

    const submitted = await submitGlobalChatMessage({
      supabase,
      senderLabel,
      senderAvatarUrl,
      senderAvatarBorderColor,
      message,
      idempotencyKey,
    });

    metricDuplicate = submitted.duplicate;
    metricStatusCode = submitted.duplicate ? 200 : 201;
    return Response.json(
      {
        message: submitted.message,
        duplicate: submitted.duplicate,
      },
      { status: metricStatusCode },
    );
  } catch (error) {
    if (error instanceof GlobalChatError) {
      if (RATE_LIMIT_ERROR_CODES.has(error.code ?? "")) {
        metricStatusCode = 429;
        return Response.json({ error: error.message, code: error.code }, { status: 429 });
      }
      if (BAD_REQUEST_ERROR_CODES.has(error.code ?? "")) {
        metricStatusCode = 400;
        return Response.json({ error: error.message, code: error.code }, { status: 400 });
      }
    }

    const message = error instanceof Error ? error.message : "Unable to send chat message.";
    metricStatusCode = message === "UNAUTHORIZED" ? 401 : 500;
    return Response.json({ error: message }, { status: metricStatusCode });
  } finally {
    if (metricUserId && metricSupabase) {
      void recordChatObservabilityEvents({
        supabase: metricSupabase,
        userId: metricUserId,
        source: "server",
        events: [
          {
            metricName: "send_latency_ms",
            metricValue: durationMetricValue(startedAt),
            metadata: {
              statusCode: metricStatusCode,
              duplicate: metricDuplicate,
            },
          },
        ],
      }).catch(() => undefined);
    }
  }
}
