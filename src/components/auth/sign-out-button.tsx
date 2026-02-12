"use client";

import { Button } from "@heroui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export const SignOutButton = () => {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const handleSignOut = async () => {
    setPending(true);
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace("/auth");
    router.refresh();
    setPending(false);
  };

  return (
    <Button
      className="h-auto min-h-0 min-w-0 px-1 py-0 text-xs text-default-500"
      isLoading={pending}
      size="sm"
      variant="light"
      onPress={handleSignOut}
    >
      Sign out
    </Button>
  );
};
