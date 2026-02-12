import { isGlobalAdminUser } from "@/lib/admin-access";
import { requireAuthUser } from "@/lib/draft-auth";
import { listRegisteredUsers } from "@/lib/draft-data";

export async function GET() {
  try {
    const user = await requireAuthUser();
    const canManageDrafts = await isGlobalAdminUser({ userId: user.id });
    if (!canManageDrafts) {
      return Response.json({ error: "Only the admin can view draft users." }, { status: 403 });
    }
    const users = await listRegisteredUsers();
    return Response.json({ users }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load users.";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
}
