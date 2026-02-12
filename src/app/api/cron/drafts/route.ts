import { processDueDrafts } from "@/lib/draft-automation";

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
  return Response.json(
    {
      ok: true,
      ...result,
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
