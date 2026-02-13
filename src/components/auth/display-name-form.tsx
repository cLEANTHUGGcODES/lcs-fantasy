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
  pinSubmitToBottom = false,
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
  pinSubmitToBottom?: boolean;
}) => {
  const router = useRouter();
  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const [teamName, setTeamName] = useState(initialTeamName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const normalizedInitialFirstName = normalizePersonName(initialFirstName);
  const normalizedInitialLastName = normalizePersonName(initialLastName);
  const isFirstNameLocked = Boolean(normalizedInitialFirstName);
  const isLastNameLocked = Boolean(normalizedInitialLastName);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const normalizedFirstName = normalizePersonName(firstName);
    const normalizedLastName = normalizePersonName(lastName);
    const normalizedTeamName = normalizeTeamName(teamName);
    const firstNameToSave = isFirstNameLocked ? normalizedInitialFirstName : normalizedFirstName;
    const lastNameToSave = isLastNameLocked ? normalizedInitialLastName : normalizedLastName;

    if (
      isFirstNameLocked &&
      normalizedFirstName &&
      normalizedFirstName !== normalizedInitialFirstName
    ) {
      setError("First name cannot be changed once set.");
      return;
    }

    if (
      isLastNameLocked &&
      normalizedLastName &&
      normalizedLastName !== normalizedInitialLastName
    ) {
      setError("Last name cannot be changed once set.");
      return;
    }

    if (!firstNameToSave) {
      setError("First name is required.");
      return;
    }
    if (!lastNameToSave) {
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
        first_name: firstNameToSave,
        last_name: lastNameToSave,
        team_name: normalizedTeamName,
        display_name: `${firstNameToSave} ${lastNameToSave}`,
        full_name: `${firstNameToSave} ${lastNameToSave}`,
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
      firstName: firstNameToSave,
      lastName: lastNameToSave,
      teamName: normalizedTeamName,
      displayLabel: `${firstNameToSave} ${lastNameToSave[0]!.toUpperCase()}.`,
    });
    router.refresh();
  };

  return (
    <form className={pinSubmitToBottom ? "flex h-full flex-col" : "space-y-2"} onSubmit={handleSubmit}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Input
          isRequired
          autoComplete="given-name"
          isDisabled={isFirstNameLocked}
          label="First Name"
          labelPlacement="outside"
          placeholder="James"
          value={firstName}
          onValueChange={setFirstName}
        />
        <Input
          isRequired
          autoComplete="family-name"
          isDisabled={isLastNameLocked}
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
      {pinSubmitToBottom ? (
        <div className="mt-auto flex items-end gap-2 pt-2">
          <div className="min-h-[1rem] flex-1">
            {error ? <p className="text-xs text-danger-400">{error}</p> : null}
            {!error && message ? <p className="text-xs text-success-400">{message}</p> : null}
          </div>
          <Button color="primary" isLoading={pending} size="sm" type="submit" variant="flat">
            {saveLabel}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {error ? <p className="text-xs text-danger-400">{error}</p> : null}
          {message ? <p className="text-xs text-success-400">{message}</p> : null}
          <Button
            className="ml-auto"
            color="primary"
            isLoading={pending}
            size="sm"
            type="submit"
            variant="flat"
          >
            {saveLabel}
          </Button>
        </div>
      )}
    </form>
  );
};
