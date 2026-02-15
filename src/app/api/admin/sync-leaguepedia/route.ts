import { syncLeaguepediaSnapshot } from "@/lib/snapshot-sync";

const validateSyncToken = (request: Request): boolean => {
  const expectedToken = process.env.SYNC_API_TOKEN;
  if (!expectedToken) {
    return true;
  }

  const providedToken = request.headers.get("x-sync-token");
  return providedToken === expectedToken;
};

export async function POST(request: Request) {
  if (!validateSyncToken(request)) {
    return Response.json(
      {
        error: "unauthorized",
        message: "Missing or invalid x-sync-token.",
      },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const requestedSourcePage =
    searchParams.get("page") ??
    process.env.LEAGUEPEDIA_PAGE ??
    null;

  try {
    const result = await syncLeaguepediaSnapshot({
      requestedSourcePage,
      createdBy: "api-sync-leaguepedia",
    });
    return Response.json(result, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown sync failure";
    return Response.json(
      {
        error: "sync_failed",
        message,
      },
      { status: 500 },
    );
  }
}
