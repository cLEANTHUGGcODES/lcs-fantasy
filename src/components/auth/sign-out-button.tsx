"use client";

import { Button } from "@heroui/button";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export const SignOutButton = ({
  className,
  isIconOnly = false,
}: {
  className?: string;
  isIconOnly?: boolean;
}) => {
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
      aria-label="Sign out"
      className={className ?? "h-auto min-h-0 min-w-0 px-1 py-0 text-xs text-default-500"}
      isIconOnly={isIconOnly}
      isLoading={pending}
      size="sm"
      variant="light"
      onPress={handleSignOut}
    >
      {isIconOnly ? <LogOut className="h-4 w-4" /> : "Sign out"}
    </Button>
  );
};
