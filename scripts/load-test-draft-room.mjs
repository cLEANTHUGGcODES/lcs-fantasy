#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const ENV_PATH = path.join(process.cwd(), ".env.local");
const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const DEFAULT_DURATION_SECONDS = 75;
const DEFAULT_THINK_TIME_MS = 280;
const DEFAULT_PRESENCE_RATIO = 0.25;
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    draftId: null,
    usersFile: null,
    durationSeconds: DEFAULT_DURATION_SECONDS,
    thinkTimeMs: DEFAULT_THINK_TIME_MS,
    presenceRatio: DEFAULT_PRESENCE_RATIO,
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    summaryWindowMinutes: 180,
    outFile: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--base-url" && next) {
      options.baseUrl = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--draft-id" && next) {
      options.draftId = Number.parseInt(next, 10);
      index += 1;
      continue;
    }
    if (arg === "--users-file" && next) {
      options.usersFile = next;
      index += 1;
      continue;
    }
    if (arg === "--duration" && next) {
      options.durationSeconds = Math.max(5, Number.parseInt(next, 10));
      index += 1;
      continue;
    }
    if (arg === "--think-ms" && next) {
      options.thinkTimeMs = Math.max(0, Number.parseInt(next, 10));
      index += 1;
      continue;
    }
    if (arg === "--presence-ratio" && next) {
      const parsed = Number.parseFloat(next);
      options.presenceRatio = Number.isFinite(parsed)
        ? Math.max(0, Math.min(1, parsed))
        : DEFAULT_PRESENCE_RATIO;
      index += 1;
      continue;
    }
    if (arg === "--request-timeout-ms" && next) {
      options.requestTimeoutMs = Math.max(1000, Number.parseInt(next, 10));
      index += 1;
      continue;
    }
    if (arg === "--window-minutes" && next) {
      options.summaryWindowMinutes = Math.max(1, Number.parseInt(next, 10));
      index += 1;
      continue;
    }
    if (arg === "--out" && next) {
      options.outFile = next;
      index += 1;
      continue;
    }
  }

  return options;
};

const loadEnvFile = () => {
  if (!fs.existsSync(ENV_PATH)) {
    return;
  }

  const lines = fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex < 1) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    const rawValue = trimmed.slice(eqIndex + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
};

const readUsers = (usersFile) => {
  if (!usersFile) {
    throw new Error("Missing --users-file. Provide a JSON array with { email, password } entries.");
  }

  const resolved = path.isAbsolute(usersFile)
    ? usersFile
    : path.join(process.cwd(), usersFile);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Users file not found: ${resolved}`);
  }

  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Users file must be a non-empty JSON array.");
  }

  const users = parsed
    .map((entry, index) => {
      const email = typeof entry?.email === "string" ? entry.email.trim() : "";
      const password = typeof entry?.password === "string" ? entry.password : "";
      if (!email || !password) {
        throw new Error(`Invalid user at index ${index}; both email and password are required.`);
      }
      return { email, password };
    });

  return users;
};

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const percentile = (values, p) => {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[index];
};

const average = (values) => {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const parseServerTimingTotalMs = (headerValue) => {
  if (!headerValue) {
    return null;
  }
  const segments = String(headerValue).split(",");
  for (const segmentRaw of segments) {
    const segment = segmentRaw.trim();
    if (!segment.toLowerCase().startsWith("total")) {
      continue;
    }
    const match = /(?:^|;)\s*dur=([0-9]+(?:\.[0-9]+)?)/i.exec(segment);
    if (!match) {
      continue;
    }
    const parsed = Number.parseFloat(match[1]);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return null;
};

const createAccumulator = () => ({
  totalRequests: 0,
  failures: 0,
  statusCounts: new Map(),
  clientLatencyMs: [],
  serverTotalMs: [],
});

const recordRequest = ({
  accumulator,
  statusCode,
  latencyMs,
  serverTotalMs,
}) => {
  accumulator.totalRequests += 1;
  const currentCount = accumulator.statusCounts.get(statusCode) ?? 0;
  accumulator.statusCounts.set(statusCode, currentCount + 1);

  if (statusCode < 200 || statusCode >= 400) {
    accumulator.failures += 1;
  }

  if (Number.isFinite(latencyMs) && latencyMs >= 0) {
    accumulator.clientLatencyMs.push(latencyMs);
  }
  if (Number.isFinite(serverTotalMs) && serverTotalMs >= 0) {
    accumulator.serverTotalMs.push(serverTotalMs);
  }
};

const summarizeAccumulator = (accumulator) => ({
  requests: accumulator.totalRequests,
  failures: accumulator.failures,
  errorRate: accumulator.totalRequests > 0
    ? Number((accumulator.failures / accumulator.totalRequests).toFixed(4))
    : 0,
  p50ClientMs: Number(percentile(accumulator.clientLatencyMs, 0.5).toFixed(1)),
  p95ClientMs: Number(percentile(accumulator.clientLatencyMs, 0.95).toFixed(1)),
  p99ClientMs: Number(percentile(accumulator.clientLatencyMs, 0.99).toFixed(1)),
  avgClientMs: Number(average(accumulator.clientLatencyMs).toFixed(1)),
  p50ServerMs: Number(percentile(accumulator.serverTotalMs, 0.5).toFixed(1)),
  p95ServerMs: Number(percentile(accumulator.serverTotalMs, 0.95).toFixed(1)),
  avgServerMs: Number(average(accumulator.serverTotalMs).toFixed(1)),
  statusCounts: Object.fromEntries([...accumulator.statusCounts.entries()].sort((a, b) => a[0] - b[0])),
});

const createTimeoutSignal = (timeoutMs) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeout),
  };
};

const loginUsers = async ({ supabaseUrl, supabasePublicKey, users }) => {
  const sessions = [];

  for (const user of users) {
    const client = createClient(supabaseUrl, supabasePublicKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data, error } = await client.auth.signInWithPassword({
      email: user.email,
      password: user.password,
    });

    if (error || !data.session?.access_token) {
      throw new Error(`Unable to sign in ${user.email}: ${error?.message ?? "Missing session"}`);
    }

    sessions.push({
      email: user.email,
      token: data.session.access_token,
    });
  }

  return sessions;
};

const loadDraftObservabilitySummary = async ({
  supabaseUrl,
  serviceRoleKey,
  windowMinutes,
}) => {
  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data, error } = await adminClient.rpc("fantasy_draft_observability_summary", {
    p_window_minutes: windowMinutes,
  });

  if (error) {
    throw new Error(`Unable to load draft observability summary: ${error.message}`);
  }

  return data;
};

const run = async () => {
  loadEnvFile();
  const options = parseArgs();

  if (!Number.isFinite(options.draftId) || options.draftId < 1) {
    throw new Error("Missing or invalid --draft-id.");
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabasePublicKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!supabaseUrl || !supabasePublicKey) {
    throw new Error("Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or ANON key).");
  }

  const users = readUsers(options.usersFile);
  const sessions = await loginUsers({
    supabaseUrl,
    supabasePublicKey,
    users,
  });

  const routeStats = {
    draftGet: createAccumulator(),
    presencePost: createAccumulator(),
  };

  const deadlineMs = Date.now() + options.durationSeconds * 1000;
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const workerPromises = sessions.map(async (session) => {
    while (Date.now() < deadlineMs) {
      const runPresence = Math.random() < options.presenceRatio;
      const endpoint = runPresence
        ? `${baseUrl}/api/drafts/${options.draftId}/presence`
        : `${baseUrl}/api/drafts/${options.draftId}`;
      const method = runPresence ? "POST" : "GET";

      const requestBody = runPresence ? "{}" : null;
      const { signal, cleanup } = createTimeoutSignal(options.requestTimeoutMs);
      const startedAt = performance.now();
      let statusCode = 0;
      let serverTotalMs = null;

      try {
        const response = await fetch(endpoint, {
          method,
          headers: {
            authorization: `Bearer ${session.token}`,
            ...(runPresence ? { "content-type": "application/json" } : {}),
          },
          body: requestBody,
          signal,
        });
        statusCode = response.status;
        serverTotalMs = parseServerTimingTotalMs(response.headers.get("server-timing"));
        await response.text();
      } catch {
        statusCode = 0;
      } finally {
        cleanup();
      }

      const latencyMs = performance.now() - startedAt;
      recordRequest({
        accumulator: runPresence ? routeStats.presencePost : routeStats.draftGet,
        statusCode,
        latencyMs,
        serverTotalMs,
      });

      if (options.thinkTimeMs > 0) {
        const jitter = Math.floor(Math.random() * Math.max(8, options.thinkTimeMs));
        await sleep(jitter);
      }
    }
  });

  const startedAtIso = new Date().toISOString();
  await Promise.all(workerPromises);
  const completedAtIso = new Date().toISOString();

  const output = {
    startedAt: startedAtIso,
    completedAt: completedAtIso,
    baseUrl,
    draftId: options.draftId,
    users: sessions.length,
    durationSeconds: options.durationSeconds,
    thinkTimeMs: options.thinkTimeMs,
    presenceRatio: options.presenceRatio,
    routes: {
      draftGet: summarizeAccumulator(routeStats.draftGet),
      presencePost: summarizeAccumulator(routeStats.presencePost),
    },
  };

  let draftObservabilitySummary = null;
  try {
    draftObservabilitySummary = await loadDraftObservabilitySummary({
      supabaseUrl,
      serviceRoleKey,
      windowMinutes: options.summaryWindowMinutes,
    });
  } catch (error) {
    draftObservabilitySummary = {
      error: error instanceof Error ? error.message : "Unable to load draft observability summary.",
    };
  }

  output.draftObservabilitySummary = draftObservabilitySummary;

  if (options.outFile) {
    const outPath = path.isAbsolute(options.outFile)
      ? options.outFile
      : path.join(process.cwd(), options.outFile);
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
    console.log(`Saved load-test summary: ${outPath}`);
  }

  console.log("\nDraft room load test summary\n");
  console.log(JSON.stringify(output, null, 2));
};

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nLoad test failed: ${message}`);
  process.exit(1);
});
