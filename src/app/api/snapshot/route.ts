import { getFantasySnapshot } from "@/lib/get-fantasy-snapshot";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await getFantasySnapshot();
    return Response.json(snapshot, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown snapshot error";

    return Response.json(
      {
        error: "snapshot_unavailable",
        message,
      },
      { status: 500 },
    );
  }
}
