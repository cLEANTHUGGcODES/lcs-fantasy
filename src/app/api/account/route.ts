import { requireAuthUser } from "@/lib/draft-auth";
import { getSupabaseAuthServerClient } from "@/lib/supabase-auth-server";
import { CHAT_IMAGES_BUCKET, PROFILE_IMAGES_BUCKET } from "@/lib/supabase-storage";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getUserAvatarPath } from "@/lib/user-profile";

type DeleteAccountBody = {
  confirmation?: string;
};

const runDeleteStep = async ({
  label,
  execute,
}: {
  label: string;
  execute: () => Promise<{ error: { message: string } | null }>;
}) => {
  const { error } = await execute();
  if (error) {
    throw new Error(`${label}: ${error.message}`);
  }
};

const removeUserBucketFiles = async ({
  bucket,
  userId,
  seededPath,
}: {
  bucket: string;
  userId: string;
  seededPath: string | null;
}) => {
  const supabase = getSupabaseServerClient();
  const pathsToRemove = new Set<string>();

  if (seededPath) {
    pathsToRemove.add(seededPath);
  }

  const { data: listedFiles, error: listError } = await supabase.storage
    .from(bucket)
    .list(userId, { limit: 1000 });
  if (listError) {
    throw new Error(`${bucket} list failed: ${listError.message}`);
  }

  for (const entry of listedFiles ?? []) {
    if (entry.name) {
      pathsToRemove.add(`${userId}/${entry.name}`);
    }
  }

  if (pathsToRemove.size === 0) {
    return;
  }

  const { error: removeError } = await supabase.storage
    .from(bucket)
    .remove([...pathsToRemove]);
  if (removeError) {
    throw new Error(`${bucket} delete failed: ${removeError.message}`);
  }
};

const deleteUserData = async (userId: string) => {
  const supabase = getSupabaseServerClient();

  await runDeleteStep({
    label: "delete fantasy_drafts",
    execute: async () =>
      supabase
        .from("fantasy_drafts")
        .delete()
        .eq("created_by_user_id", userId),
  });

  await runDeleteStep({
    label: "delete fantasy_draft_picks (participant)",
    execute: async () =>
      supabase
        .from("fantasy_draft_picks")
        .delete()
        .eq("participant_user_id", userId),
  });

  await runDeleteStep({
    label: "delete fantasy_draft_picks (picked_by)",
    execute: async () =>
      supabase
        .from("fantasy_draft_picks")
        .delete()
        .eq("picked_by_user_id", userId),
  });

  await runDeleteStep({
    label: "delete fantasy_draft_participants",
    execute: async () =>
      supabase
        .from("fantasy_draft_participants")
        .delete()
        .eq("user_id", userId),
  });

  await runDeleteStep({
    label: "delete fantasy_draft_presence",
    execute: async () =>
      supabase
        .from("fantasy_draft_presence")
        .delete()
        .eq("user_id", userId),
  });

  await runDeleteStep({
    label: "delete fantasy_global_chat_messages",
    execute: async () =>
      supabase
        .from("fantasy_global_chat_messages")
        .delete()
        .eq("user_id", userId),
  });

  await runDeleteStep({
    label: "delete fantasy_chat_observability_events",
    execute: async () =>
      supabase
        .from("fantasy_chat_observability_events")
        .delete()
        .eq("user_id", userId),
  });

  await runDeleteStep({
    label: "delete fantasy_app_admin",
    execute: async () =>
      supabase
        .from("fantasy_app_admin")
        .delete()
        .eq("admin_user_id", userId),
  });

  await runDeleteStep({
    label: "clear fantasy_scoring_settings.updated_by_user_id",
    execute: async () =>
      supabase
        .from("fantasy_scoring_settings")
        .update({ updated_by_user_id: null })
        .eq("updated_by_user_id", userId),
  });
};

export async function DELETE(request: Request) {
  let authClient: Awaited<ReturnType<typeof getSupabaseAuthServerClient>> | null = null;

  try {
    const payload = (await request.json().catch(() => ({}))) as DeleteAccountBody;
    if (payload.confirmation !== "DELETE") {
      return Response.json(
        { error: "Type DELETE to confirm account removal." },
        { status: 400 },
      );
    }

    authClient = await getSupabaseAuthServerClient();
    const user = await requireAuthUser(authClient);

    await removeUserBucketFiles({
      bucket: PROFILE_IMAGES_BUCKET,
      userId: user.id,
      seededPath: getUserAvatarPath(user),
    });
    await removeUserBucketFiles({
      bucket: CHAT_IMAGES_BUCKET,
      userId: user.id,
      seededPath: null,
    });

    await deleteUserData(user.id);

    const supabase = getSupabaseServerClient();
    const { error: deleteUserError } = await supabase.auth.admin.deleteUser(user.id);
    if (deleteUserError) {
      return Response.json(
        { error: `delete auth user failed: ${deleteUserError.message}` },
        { status: 500 },
      );
    }

    await authClient.auth.signOut().catch(() => undefined);
    return Response.json({ ok: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete account.";
    if (message === "UNAUTHORIZED") {
      return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    return Response.json({ error: message }, { status: 500 });
  }
}
