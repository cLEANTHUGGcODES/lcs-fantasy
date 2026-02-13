import { Link } from "@heroui/link";
import { redirect } from "next/navigation";
import { GlobalChatPanel } from "@/components/chat/global-chat-panel";
import { DraftRoom } from "@/components/drafts/draft-room";
import { requireAuthUser } from "@/lib/draft-auth";
import { getUserDisplayName } from "@/lib/user-profile";

export default async function DraftRoomPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const routeParams = await params;
  let user: Awaited<ReturnType<typeof requireAuthUser>> | null = null;
  try {
    user = await requireAuthUser();
  } catch {
    redirect(`/auth?next=/drafts/${routeParams.draftId}`);
  }
  if (!user) {
    redirect(`/auth?next=/drafts/${routeParams.draftId}`);
  }

  const draftId = Number.parseInt(routeParams.draftId, 10);
  if (!Number.isFinite(draftId) || draftId < 1) {
    redirect("/drafts");
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-3 py-5 pb-28 md:px-6 md:py-8 md:pb-24">
      <div className="mb-4 flex flex-wrap gap-3">
        <Link href="/" underline="hover">
          ← Back To Dashboard
        </Link>
        <Link href="/drafts" underline="hover">
          Back To Draft Management
        </Link>
      </div>
      <DraftRoom
        currentUserId={user.id}
        currentUserLabel={getUserDisplayName(user) ?? user.id}
        draftId={draftId}
      />
      <GlobalChatPanel currentUserId={user.id} />
    </main>
  );
}
