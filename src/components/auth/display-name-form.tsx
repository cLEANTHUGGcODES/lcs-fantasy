"use client";

import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { normalizePersonName, normalizeTeamName } from "@/lib/user-profile";

export const DisplayNameForm = ({
  initialFirstName = "",
  initialLastName = "",
  initialTeamName = "",
  onSaved,
  saveLabel = "Save Name",
  showSavedMessage = true,
}: {
  initialFirstName?: string;
  initialLastName?: string;
  initialTeamName?: string;
  onSaved?: (payload: {
    firstName: string;
    lastName: string;
    teamName: string;
    displayLabel: string;
  }) => void;
  saveLabel?: string;
  showSavedMessage?: boolean;
}) => {
  const router = useRouter();
  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const [teamName, setTeamName] = useState(initialTeamName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const normalizedFirstName = normalizePersonName(firstName);
    const normalizedLastName = normalizePersonName(lastName);
    const normalizedTeamName = normalizeTeamName(teamName);
    if (!normalizedFirstName) {
      setError("First name is required.");
      return;
    }
    if (!normalizedLastName) {
      setError("Last name is required.");
      return;
    }
    if (!normalizedTeamName) {
      setError("Team name is required.");
      return;
    }

    setPending(true);
    const supabase = getSupabaseBrowserClient();
    const { error: updateError } = await supabase.auth.updateUser({
      data: {
        first_name: normalizedFirstName,
        last_name: normalizedLastName,
        team_name: normalizedTeamName,
        display_name: `${normalizedFirstName} ${normalizedLastName}`,
        full_name: `${normalizedFirstName} ${normalizedLastName}`,
      },
    });
    setPending(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    if (showSavedMessage) {
      setMessage("Name saved.");
    }
    onSaved?.({
      firstName: normalizedFirstName,
      lastName: normalizedLastName,
      teamName: normalizedTeamName,
      displayLabel: `${normalizedFirstName} ${normalizedLastName[0]!.toUpperCase()}.`,
    });
    router.refresh();
  };

  return (
    <form className="space-y-2" onSubmit={handleSubmit}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Input
          isRequired
          autoComplete="given-name"
          label="First Name"
          labelPlacement="outside"
          placeholder="James"
          value={firstName}
          onValueChange={setFirstName}
        />
        <Input
          isRequired
          autoComplete="family-name"
          label="Last Name"
          labelPlacement="outside"
          placeholder="Shaw"
          value={lastName}
          onValueChange={setLastName}
        />
        <Input
          isRequired
          autoComplete="organization"
          label="Team Name"
          labelPlacement="outside"
          placeholder="Cloud9"
          value={teamName}
          onValueChange={setTeamName}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button color="primary" isLoading={pending} size="sm" type="submit" variant="flat">
          {saveLabel}
        </Button>
        {error ? <p className="text-xs text-danger-400">{error}</p> : null}
        {message ? <p className="text-xs text-success-400">{message}</p> : null}
      </div>
    </form>
  );
};
