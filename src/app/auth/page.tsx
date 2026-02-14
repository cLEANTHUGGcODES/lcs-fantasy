import { Card, CardBody, CardHeader } from "@heroui/card";
import { redirect } from "next/navigation";
import { AuthForm } from "@/app/auth/auth-form";
import { getSupabaseAuthServerClient } from "@/lib/supabase-auth-server";

type SearchParams = Record<string, string | string[] | undefined>;

const resolveNextPath = (raw: string | string[] | undefined): string => {
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  if (!candidate) {
    return "/";
  }
  if (!candidate.startsWith("/") || candidate.startsWith("//")) {
    return "/";
  }
  return candidate;
};

export default async function AuthPage({
  searchParams,
}: {
  searchParams?: SearchParams | Promise<SearchParams>;
}) {
  const params = (await searchParams) ?? {};
  const nextPath = resolveNextPath(params.next);

  try {
    const supabase = await getSupabaseAuthServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      redirect(nextPath);
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Auth configuration is missing or invalid.";

    return (
      <main className="mx-auto flex min-h-[100svh] max-w-6xl items-center justify-center px-4 py-10 supports-[min-height:100dvh]:min-h-[100dvh]">
        <Card className="w-full max-w-2xl border border-danger-300/40 bg-danger-50/5">
          <CardHeader>
            <h1 className="text-2xl font-semibold">Authentication Setup Required</h1>
          </CardHeader>
          <CardBody className="space-y-2 text-sm text-default-500">
            <p>{message}</p>
            <p>
              Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
              <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> (or{" "}
              <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>) to{" "}
              <code>.env.local</code>, then restart <code>npm run dev</code>.
            </p>
          </CardBody>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[100svh] max-w-6xl items-center justify-center px-4 py-10 supports-[min-height:100dvh]:min-h-[100dvh]">
      <AuthForm nextPath={nextPath} />
    </main>
  );
}
