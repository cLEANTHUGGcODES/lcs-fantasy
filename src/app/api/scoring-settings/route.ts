import { isGlobalAdminUser } from "@/lib/admin-access";
import { requireAuthUser } from "@/lib/draft-auth";
import {
  getActiveScoringSettings,
  saveScoringSettings,
  validateScoringSettingsInput,
} from "@/lib/scoring-settings";

const unauthorizedResponse = () =>
  Response.json({ error: "UNAUTHORIZED" }, { status: 401 });

const forbiddenResponse = () =>
  Response.json(
    { error: "Only the admin can manage scoring settings." },
    { status: 403 },
  );

export async function GET() {
  try {
    const user = await requireAuthUser();
    const canManageScoring = await isGlobalAdminUser({ userId: user.id });
    if (!canManageScoring) {
      return forbiddenResponse();
    }

    const settings = await getActiveScoringSettings();
    return Response.json(
      {
        scoring: settings.scoring,
        updatedAt: settings.updatedAt,
        source: settings.source,
      },
      { status: 200 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load scoring settings.";
    if (message === "UNAUTHORIZED") {
      return unauthorizedResponse();
    }
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuthUser();
    const canManageScoring = await isGlobalAdminUser({ userId: user.id });
    if (!canManageScoring) {
      return forbiddenResponse();
    }

    const body = (await request.json()) as unknown;
    const payload =
      typeof body === "object" && body !== null && "scoring" in body
        ? (body as Record<string, unknown>).scoring
        : body;
    const validation = validateScoringSettingsInput(payload);

    if (!validation.ok) {
      return Response.json({ error: validation.error }, { status: 400 });
    }

    const saved = await saveScoringSettings({
      scoring: validation.scoring,
      updatedByUserId: user.id,
    });

    return Response.json(
      {
        ok: true,
        scoring: saved.scoring,
        updatedAt: saved.updatedAt,
      },
      { status: 200 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to save scoring settings.";
    if (message === "UNAUTHORIZED") {
      return unauthorizedResponse();
    }
    return Response.json({ error: message }, { status: 500 });
  }
}
