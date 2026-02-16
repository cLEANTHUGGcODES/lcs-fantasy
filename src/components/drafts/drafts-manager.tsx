"use client";

import { Button } from "@heroui/button";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { Input } from "@heroui/input";
import { Link } from "@heroui/link";
import { Spinner } from "@heroui/spinner";
import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DraftSummary, RegisteredUser } from "@/types/draft";

type DraftUsersResponse = {
  users: RegisteredUser[];
  error?: string;
};

type DraftListResponse = {
  drafts: DraftSummary[];
  error?: string;
};

const createDefaultSchedule = (): string => {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  const localIso = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  return localIso;
};

const formatDate = (value: string): string =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export const DraftsManager = ({
  canManageAllDrafts,
  currentUserId,
  defaultSourcePage,
}: {
  canManageAllDrafts: boolean;
  currentUserId: string;
  defaultSourcePage: string;
}) => {
  const [users, setUsers] = useState<RegisteredUser[]>([]);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("Friends LCS Player Draft");
  const [leagueSlug, setLeagueSlug] = useState("LCS");
  const [seasonYear, setSeasonYear] = useState("2026");
  const [sourcePage, setSourcePage] = useState(defaultSourcePage);
  const [scheduledAt, setScheduledAt] = useState(createDefaultSchedule);
  const [roundCount, setRoundCount] = useState("5");
  const [pickSeconds, setPickSeconds] = useState("75");
  const [participantUserIds, setParticipantUserIds] = useState<string[]>([]);
  const [submitPending, setSubmitPending] = useState(false);
  const [deleteDraftIdPending, setDeleteDraftIdPending] = useState<number | null>(null);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);

  const selectedUsers = useMemo(
    () =>
      participantUserIds
        .map((userId) => users.find((entry) => entry.userId === userId))
        .filter((entry): entry is RegisteredUser => Boolean(entry)),
    [participantUserIds, users],
  );

  const availableUsers = useMemo(
    () => users.filter((entry) => !participantUserIds.includes(entry.userId)),
    [users, participantUserIds],
  );

  const reloadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [usersResponse, draftsResponse] = await Promise.all([
        fetch("/api/drafts/users", { cache: "no-store" }),
        fetch("/api/drafts", { cache: "no-store" }),
      ]);

      const usersBody = (await usersResponse.json()) as DraftUsersResponse;
      const draftsBody = (await draftsResponse.json()) as DraftListResponse;

      if (!usersResponse.ok) {
        throw new Error(usersBody.error ?? "Failed to load registered users.");
      }
      if (!draftsResponse.ok) {
        throw new Error(draftsBody.error ?? "Failed to load drafts.");
      }

      setUsers(usersBody.users);
      setDrafts(draftsBody.drafts);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadData().catch((loadError: unknown) => {
      setLoading(false);
      setError(loadError instanceof Error ? loadError.message : "Unable to load draft data.");
    });
  }, [reloadData]);

  const addParticipant = (userId: string) => {
    if (participantUserIds.includes(userId)) {
      return;
    }
    setParticipantUserIds((prev) => [...prev, userId]);
  };

  const removeParticipant = (userId: string) => {
    setParticipantUserIds((prev) => prev.filter((entry) => entry !== userId));
  };

  const moveParticipant = (index: number, direction: -1 | 1) => {
    const next = [...participantUserIds];
    const target = index + direction;
    if (target < 0 || target >= next.length) {
      return;
    }
    const temp = next[index];
    next[index] = next[target];
    next[target] = temp;
    setParticipantUserIds(next);
  };

  const randomizeParticipantOrder = () => {
    setParticipantUserIds((prev) => {
      if (prev.length < 2) {
        return prev;
      }

      const shuffled = [...prev];
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        const temp = shuffled[index];
        shuffled[index] = shuffled[swapIndex];
        shuffled[swapIndex] = temp;
      }

      return shuffled;
    });
  };

  const createDraft = async () => {
    setSubmitPending(true);
    setSubmitMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/drafts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name,
          leagueSlug,
          seasonYear: Number(seasonYear),
          sourcePage,
          scheduledAt: new Date(scheduledAt).toISOString(),
          roundCount: Number(roundCount),
          pickSeconds: Number(pickSeconds),
          participantUserIds,
        }),
      });

      const payload = (await response.json()) as { error?: string; draftId?: number };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to create draft.");
      }

      setSubmitMessage(`Draft #${payload.draftId} created successfully.`);
      await reloadData();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create draft.");
    } finally {
      setSubmitPending(false);
    }
  };

  const deleteDraft = async (draft: DraftSummary) => {
    const confirmed = window.confirm(
      `Delete draft "${draft.name}" (#${draft.id})? This permanently removes all picks and participants for this draft.`,
    );
    if (!confirmed) {
      return;
    }

    setDeleteDraftIdPending(draft.id);
    setSubmitMessage(null);
    setError(null);

    try {
      const response = await fetch(`/api/drafts/${draft.id}`, {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
        },
      });

      const payload = (await response.json()) as { error?: string; draftId?: number };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to delete draft.");
      }

      setSubmitMessage(`Draft #${payload.draftId ?? draft.id} deleted.`);
      await reloadData();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete draft.");
    } finally {
      setDeleteDraftIdPending(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <Spinner label="Loading draft management..." />
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <Card className="border border-primary-300/30 bg-content1/70">
        <CardHeader className="flex flex-col items-start gap-2">
          <h1 className="text-2xl font-semibold">Draft Management</h1>
          <p className="text-sm text-default-500">
            Configure a full reverse-snake player draft for a specific league season.
          </p>
        </CardHeader>
        <CardBody className="space-y-4">
          {error ? <p className="text-sm text-danger-400">{error}</p> : null}
          {submitMessage ? <p className="text-sm text-success-400">{submitMessage}</p> : null}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Input
              isRequired
              label="Draft Name"
              labelPlacement="outside"
              value={name}
              onValueChange={setName}
            />
            <Input
              isRequired
              label="League Slug"
              labelPlacement="outside"
              value={leagueSlug}
              onValueChange={setLeagueSlug}
            />
            <Input
              isRequired
              label="Season Year"
              labelPlacement="outside"
              inputMode="numeric"
              type="number"
              value={seasonYear}
              onValueChange={setSeasonYear}
            />
            <Input
              isRequired
              label="Draft Time"
              labelPlacement="outside"
              type="datetime-local"
              value={scheduledAt}
              onValueChange={setScheduledAt}
            />
            <Input
              isRequired
              label="Rounds"
              labelPlacement="outside"
              description="Maximum 5 rounds (one player per position)."
              inputMode="numeric"
              type="number"
              min={1}
              max={5}
              value={roundCount}
              onValueChange={setRoundCount}
            />
            <Input
              isRequired
              label="Seconds Per Pick"
              labelPlacement="outside"
              description="For bug testing, this can be as low as 1 second."
              min={1}
              max={900}
              inputMode="numeric"
              type="number"
              value={pickSeconds}
              onValueChange={setPickSeconds}
            />
          </div>

          <Input
            isRequired
            description="Use the same source page you sync into Supabase snapshots."
            label="League Source Page"
            labelPlacement="outside"
            value={sourcePage}
            onValueChange={setSourcePage}
          />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Card className="bg-content2/50">
                <CardHeader>
                  <h2 className="text-base font-semibold">Registered Website Players</h2>
                </CardHeader>
                <CardBody className="max-h-[24rem] space-y-2 overflow-auto">
                  {availableUsers.length === 0 ? (
                    <p className="text-sm text-default-500">No additional users available.</p>
                  ) : (
                    availableUsers.map((entry) => (
                      <div
                        key={entry.userId}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-medium border border-default-200/40 px-2 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{entry.displayName}</p>
                        <p className="truncate text-xs text-default-500">
                          Team: {entry.teamName ?? "Not set"}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="flat"
                        onPress={() => addParticipant(entry.userId)}
                      >
                        Add
                      </Button>
                    </div>
                  ))
                )}
              </CardBody>
            </Card>

              <Card className="bg-content2/50">
                <CardHeader className="flex items-center justify-between gap-2">
                  <h2 className="text-base font-semibold">Draft Order (Reverse Snake starts from bottom)</h2>
                  <Button
                    isDisabled={selectedUsers.length < 2}
                    size="sm"
                    variant="flat"
                    onPress={randomizeParticipantOrder}
                  >
                    Randomize Order
                  </Button>
                </CardHeader>
                <CardBody className="max-h-[24rem] space-y-2 overflow-auto">
                  {selectedUsers.length === 0 ? (
                    <p className="text-sm text-default-500">
                      Add at least two participants to enable draft creation.
                  </p>
                ) : (
                  selectedUsers.map((entry, index) => (
                    <div
                      key={entry.userId}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-medium border border-default-200/40 px-2 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          #{index + 1} {entry.displayName}
                        </p>
                        <p className="truncate text-xs text-default-500">
                          Team: {entry.teamName ?? "Not set"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <Button
                          isDisabled={index === 0}
                          size="sm"
                          variant="flat"
                          onPress={() => moveParticipant(index, -1)}
                        >
                          ↑
                        </Button>
                        <Button
                          isDisabled={index === selectedUsers.length - 1}
                          size="sm"
                          variant="flat"
                          onPress={() => moveParticipant(index, 1)}
                        >
                          ↓
                        </Button>
                        <Button
                          color="danger"
                          size="sm"
                          variant="flat"
                          onPress={() => removeParticipant(entry.userId)}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </CardBody>
            </Card>
          </div>

          <div className="flex justify-end">
            <Button
              color="primary"
              isDisabled={participantUserIds.length < 2}
              isLoading={submitPending}
              onPress={createDraft}
            >
              Create Draft
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card className="border border-default-200/30 bg-content1/70">
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Existing Drafts</h2>
          <Button size="sm" variant="flat" onPress={() => void reloadData()}>
            Refresh
          </Button>
        </CardHeader>
        <CardBody className="space-y-2">
          {drafts.length === 0 ? (
            <p className="text-sm text-default-500">No drafts created yet.</p>
          ) : (
            drafts.map((draft) => (
              <div
                key={draft.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-medium border border-default-200/40 px-3 py-2"
              >
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-sm font-semibold">{draft.name}</p>
                  <p className="truncate text-xs text-default-500">
                    {draft.leagueSlug} {draft.seasonYear} • Starts {formatDate(draft.scheduledAt)}
                  </p>
                  <p className="truncate text-xs text-default-500">
                    Picks {draft.pickCount}/{draft.totalPickCount} • {draft.participantCount} players
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Chip
                    color={
                      draft.status === "live"
                        ? "success"
                        : draft.status === "paused"
                        ? "warning"
                        : draft.status === "completed"
                        ? "secondary"
                        : "default"
                    }
                    variant="flat"
                  >
                    {draft.status}
                  </Chip>
                  <Button
                    as={Link}
                    href={`/drafts/${draft.id}`}
                    size="sm"
                    variant="flat"
                  >
                    Open Draft Room
                  </Button>
                  {draft.createdByUserId === currentUserId || canManageAllDrafts ? (
                    <Button
                      color="danger"
                      isDisabled={
                        deleteDraftIdPending !== null &&
                        deleteDraftIdPending !== draft.id
                      }
                      isLoading={deleteDraftIdPending === draft.id}
                      size="sm"
                      startContent={<Trash2 className="h-4 w-4" />}
                      variant="flat"
                      onPress={() => void deleteDraft(draft)}
                    >
                      Delete
                    </Button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </CardBody>
      </Card>
    </section>
  );
};
