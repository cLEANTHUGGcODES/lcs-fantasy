import { Link } from "@heroui/link";
import { redirect } from "next/navigation";
import leagueConfigData from "@/data/friends-league.json";
import { isGlobalAdminUser } from "@/lib/admin-access";
import { requireAuthUser } from "@/lib/draft-auth";
import { DraftsManager } from "@/components/drafts/drafts-manager";
import type { LeagueConfig } from "@/types/fantasy";

const leagueConfig = leagueConfigData as LeagueConfig;

export default async function DraftsPage() {
  const user = await requireAuthUser().catch(() => {
    redirect("/auth?next=/drafts");
  });
  const canManageDrafts = await isGlobalAdminUser({ userId: user.id });
  if (!canManageDrafts) {
    redirect("/");
  }
  const defaultSourcePage = process.env.LEAGUEPEDIA_PAGE ?? leagueConfig.sourcePage;

  return (
    <main className="mx-auto min-h-[100svh] w-full max-w-7xl px-3 py-5 supports-[min-height:100dvh]:min-h-[100dvh] md:px-6 md:py-8">
      <div className="mb-4">
        <Link href="/" underline="hover">
          ← Back To Dashboard
        </Link>
      </div>
      <DraftsManager
        canManageAllDrafts={canManageDrafts}
        currentUserId={user.id}
        defaultSourcePage={defaultSourcePage}
      />
    </main>
  );
}
