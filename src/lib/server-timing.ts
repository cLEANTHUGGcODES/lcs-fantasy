type ServerTimingEntry = {
  name: string;
  durationMs: number;
  description?: string;
};

const nowMs = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const normalizeTimingName = (value: string): string => {
  const compact = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!compact) {
    return "step";
  }
  if (/^[0-9]/.test(compact)) {
    return `step_${compact}`;
  }
  return compact;
};

export class RouteServerTimer {
  private readonly startedAtMs = nowMs();

  private readonly entries: ServerTimingEntry[] = [];

  add(name: string, durationMs: number, description?: string): void {
    if (!Number.isFinite(durationMs)) {
      return;
    }
    this.entries.push({
      name: normalizeTimingName(name),
      durationMs: Math.max(0, durationMs),
      description,
    });
  }

  async measure<T>(name: string, work: () => Promise<T> | T): Promise<T> {
    const startedAt = nowMs();
    try {
      return await work();
    } finally {
      this.add(name, nowMs() - startedAt);
    }
  }

  getTotalDurationMs(): number {
    return Math.max(0, nowMs() - this.startedAtMs);
  }

  getEntries(): ServerTimingEntry[] {
    return [...this.entries];
  }

  toHeaderValue(): string {
    const entries = [...this.entries, { name: "total", durationMs: this.getTotalDurationMs() }];
    return entries
      .map((entry) => {
        const base = `${entry.name};dur=${entry.durationMs.toFixed(1)}`;
        if (!entry.description) {
          return base;
        }
        const escapedDescription = entry.description.replace(/"/g, '\\"');
        return `${base};desc="${escapedDescription}"`;
      })
      .join(", ");
  }
}

