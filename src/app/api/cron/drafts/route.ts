import { processDueDrafts } from "@/lib/draft-automation";
import { cleanupGlobalChatData, getChatObservabilitySummary } from "@/lib/global-chat";

const readBearer = (authorization: string | null): string | null => {
  if (!authorization) {
    return null;
  }
  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }
  return token.trim();
};

const isAuthorizedCronRequest = (request: Request): boolean => {
  const expectedToken = process.env.DRAFT_AUTOMATION_TOKEN ?? process.env.CRON_SECRET ?? "";
  const tokenFromHeader = request.headers.get("x-cron-token")?.trim() ?? "";
  const tokenFromBearer = readBearer(request.headers.get("authorization")) ?? "";

  if (expectedToken) {
    return tokenFromHeader === expectedToken || tokenFromBearer === expectedToken;
  }

  return request.headers.has("x-vercel-cron");
};

const handle = async (request: Request) => {
  if (!isAuthorizedCronRequest(request)) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const result = await processDueDrafts();
  let chatCleanup: {
    deletedMessages: number;
    deletedObservabilityEvents: number;
  } | null = null;
  let chatCleanupError: string | null = null;
  let chatObservabilitySummary: Record<string, unknown> | null = null;
  let chatObservabilitySummaryError: string | null = null;
  try {
    chatCleanup = await cleanupGlobalChatData();
  } catch (error) {
    chatCleanupError = error instanceof Error ? error.message : "Unable to clean up chat data.";
  }
  try {
    chatObservabilitySummary = await getChatObservabilitySummary();
  } catch (error) {
    chatObservabilitySummaryError =
      error instanceof Error ? error.message : "Unable to load chat observability summary.";
  }
  return Response.json(
    {
      ok: true,
      ...result,
      chatCleanup,
      chatCleanupError,
      chatObservabilitySummary,
      chatObservabilitySummaryError,
      serverNow: new Date().toISOString(),
    },
    { status: 200 },
  );
};

export async function GET(request: Request) {
  try {
    return await handle(request);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to process draft automation.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    return await handle(request);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to process draft automation.";
    return Response.json({ error: message }, { status: 500 });
  }
}
