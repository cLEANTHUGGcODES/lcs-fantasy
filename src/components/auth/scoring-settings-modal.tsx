"use client";

import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@heroui/modal";
import { Spinner } from "@heroui/spinner";
import { Save, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FantasyScoring } from "@/types/fantasy";

const MIN_SCORING_VALUE = -100;
const MAX_SCORING_VALUE = 100;
const ROUND_FACTOR = 1000;
const SCORING_FIELDS = [
  "kill",
  "death",
  "assist",
  "win",
  "csPer100",
  "goldPer1000",
] as const;

type ScoringField = (typeof SCORING_FIELDS)[number];

type ScoringSettingsResponse = {
  scoring: FantasyScoring;
  updatedAt: string | null;
  source?: "default" | "database";
  error?: string;
};

const FIELD_LABELS: Record<
  ScoringField,
  { label: string; description: string; step: string }
> = {
  kill: {
    label: "Kill Points",
    description: "Points awarded per kill.",
    step: "0.1",
  },
  death: {
    label: "Death Points",
    description: "Points applied per death (usually negative).",
    step: "0.1",
  },
  assist: {
    label: "Assist Points",
    description: "Points awarded per assist.",
    step: "0.1",
  },
  win: {
    label: "Win Bonus",
    description: "Bonus applied when player wins map.",
    step: "0.1",
  },
  csPer100: {
    label: "CS Bonus per 100",
    description: "Bonus applied per 100 creep score.",
    step: "0.1",
  },
  goldPer1000: {
    label: "Gold Bonus per 1000",
    description: "Bonus applied per 1000 gold earned.",
    step: "0.1",
  },
};

const roundValue = (value: number): number =>
  Math.round((value + Number.EPSILON) * ROUND_FACTOR) / ROUND_FACTOR;

const toInputValues = (scoring: FantasyScoring): Record<ScoringField, string> => ({
  kill: `${scoring.kill}`,
  death: `${scoring.death}`,
  assist: `${scoring.assist}`,
  win: `${scoring.win}`,
  csPer100: `${scoring.csPer100}`,
  goldPer1000: `${scoring.goldPer1000}`,
});

const parseFormValues = (
  values: Record<ScoringField, string>,
):
  | { ok: true; scoring: FantasyScoring }
  | { ok: false; error: string } => {
  const parsed = {} as Record<ScoringField, number>;

  for (const field of SCORING_FIELDS) {
    const raw = values[field].trim();
    const numeric = Number(raw);

    if (raw.length === 0 || !Number.isFinite(numeric)) {
      return { ok: false, error: `${FIELD_LABELS[field].label} must be a valid number.` };
    }

    if (numeric < MIN_SCORING_VALUE || numeric > MAX_SCORING_VALUE) {
      return {
        ok: false,
        error: `${FIELD_LABELS[field].label} must be between ${MIN_SCORING_VALUE} and ${MAX_SCORING_VALUE}.`,
      };
    }

    parsed[field] = roundValue(numeric);
  }

  return {
    ok: true,
    scoring: {
      kill: parsed.kill,
      death: parsed.death,
      assist: parsed.assist,
      win: parsed.win,
      csPer100: parsed.csPer100,
      goldPer1000: parsed.goldPer1000,
    },
  };
};

const formatSavedAt = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toLocaleString();
};

const formatSigned = (value: number): string => (value >= 0 ? `+${value}` : `${value}`);

export const ScoringSettingsModal = ({
  isOpen,
  initialScoring,
  onOpenChange,
}: {
  isOpen: boolean;
  initialScoring: FantasyScoring;
  onOpenChange: (open: boolean) => void;
}) => {
  const router = useRouter();
  const [formValues, setFormValues] = useState<Record<ScoringField, string>>(
    () => toInputValues(initialScoring),
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    setFormValues(toInputValues(initialScoring));
  }, [initialScoring]);

  const formulaPreview = useMemo(() => {
    const parsed = parseFormValues(formValues);
    if (!parsed.ok) {
      return "Enter valid numeric values to preview formula.";
    }

    const scoring = parsed.scoring;
    return `${formatSigned(scoring.kill)}×K + ${formatSigned(scoring.death)}×D + ${formatSigned(
      scoring.assist,
    )}×A + ${formatSigned(scoring.win)}×Win + (${formatSigned(
      scoring.csPer100,
    )}×CS/100) + (${formatSigned(scoring.goldPer1000)}×Gold/1000)`;
  }, [formValues]);

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/scoring-settings", {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response.json()) as ScoringSettingsResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load scoring settings.");
      }

      setFormValues(toInputValues(payload.scoring));
      setUpdatedAt(payload.updatedAt ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load scoring settings.");
      setFormValues(toInputValues(initialScoring));
      setUpdatedAt(null);
    } finally {
      setIsLoading(false);
    }
  }, [initialScoring]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    void loadSettings();
  }, [isOpen, loadSettings]);

  const updateField = (field: ScoringField, value: string) => {
    setFormValues((previous) => ({
      ...previous,
      [field]: value,
    }));
  };

  const handleSave = async () => {
    setError(null);
    setNotice(null);

    const parsed = parseFormValues(formValues);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch("/api/scoring-settings", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          scoring: parsed.scoring,
        }),
      });
      const payload = (await response.json()) as ScoringSettingsResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to save scoring settings.");
      }

      setFormValues(toInputValues(payload.scoring));
      setUpdatedAt(payload.updatedAt ?? null);
      setNotice("Scoring settings saved.");
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save scoring settings.");
    } finally {
      setIsSaving(false);
    }
  };

  const savedAtLabel = formatSavedAt(updatedAt);

  return (
    <Modal
      classNames={{
        wrapper: "z-[260]",
      }}
      isOpen={isOpen}
      placement="center"
      scrollBehavior="inside"
      size="2xl"
      onOpenChange={onOpenChange}
    >
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader className="border-b border-default-200/40 pb-3">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-default-500">League Settings</p>
                <h2 className="flex items-center gap-2 text-base font-semibold text-default-100">
                  <SlidersHorizontal className="h-4 w-4 text-[#C79B3B]" />
                  Scoring Settings
                </h2>
                <p className="text-xs text-default-500">
                  Update all scoring amounts used for standings and H2H totals.
                </p>
              </div>
            </ModalHeader>
            <ModalBody className="space-y-4 py-4">
              {isLoading ? (
                <div className="flex min-h-[220px] items-center justify-center">
                  <Spinner label="Loading scoring settings..." />
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {SCORING_FIELDS.map((field) => (
                      <Input
                        key={field}
                        description={FIELD_LABELS[field].description}
                        label={FIELD_LABELS[field].label}
                        labelPlacement="outside"
                        max={MAX_SCORING_VALUE}
                        min={MIN_SCORING_VALUE}
                        step={FIELD_LABELS[field].step}
                        type="number"
                        value={formValues[field]}
                        onValueChange={(value) => updateField(field, value)}
                      />
                    ))}
                  </div>

                  <div className="rounded-large border border-default-200/35 bg-content2/35 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-default-500">Formula Preview</p>
                    <p className="mono-points mt-1 break-words text-xs text-default-200">
                      {formulaPreview}
                    </p>
                  </div>

                  {savedAtLabel ? (
                    <p className="text-xs text-default-500">Last saved: {savedAtLabel}</p>
                  ) : null}
                  {error ? <p className="text-sm text-danger-400">{error}</p> : null}
                  {!error && notice ? <p className="text-sm text-success-400">{notice}</p> : null}
                </>
              )}
            </ModalBody>
            <ModalFooter className="border-t border-default-200/40 pt-3">
              <Button variant="flat" onPress={onClose}>
                Close
              </Button>
              <Button
                className="bg-[#C79B3B] font-semibold text-black data-[hover=true]:bg-[#d9ab45]"
                isLoading={isSaving}
                startContent={isSaving ? null : <Save className="h-4 w-4" />}
                onPress={() => {
                  void handleSave();
                }}
              >
                Save Settings
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
};
