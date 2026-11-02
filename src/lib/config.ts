import "server-only";
import path from "node:path";

/**
 * Server-only configuration. Never import this from client components:
 * the `server-only` import makes the build fail if that happens, so secrets
 * cannot leak into client bundles.
 */

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function num(v: string | undefined, fallback: number): number {
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export interface ServerConfig {
  /** true when OpenAI calls are replaced with deterministic mock output */
  mockAi: boolean;
  /** "supabase" when Supabase credentials exist, otherwise "local" (file-based dev store) */
  storeKind: "supabase" | "local";
  openai: {
    apiKey?: string;
    textModel: string;
    ideationModel: string;
    imageModel: string;
    embeddingModel: string;
    embeddingDimensions: number;
    reasoningEffort: "minimal" | "low" | "medium" | "high" | "none";
    timeoutMs: number;
    maxRetries: number;
  };
  supabase: { url?: string; serviceRoleKey?: string; bucket: string };
  localDataDir: string;
  auth: { password?: string; sessionSecret?: string; sessionHours: number };
  cronSecret?: string;
  workerSecret?: string;
  vercelBypassSecret?: string;
  appUrl?: string;
  worker: { budgetMs: number; concurrency: number; maxAttempts: number; leaseSeconds: number };
}

let cached: ServerConfig | null = null;

export function getConfig(): ServerConfig {
  if (cached) return cached;
  const env = process.env;
  const apiKey = env.OPENAI_API_KEY || undefined;
  const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || undefined;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || undefined;
  const effort = (env.OPENAI_REASONING_EFFORT || "low") as ServerConfig["openai"]["reasoningEffort"];

  cached = {
    // Mock mode is explicit (MOCK_MODE=true) or automatic when no OpenAI key exists.
    mockAi: bool(env.MOCK_MODE, !apiKey),
    storeKind: supabaseUrl && serviceRoleKey ? "supabase" : "local",
    openai: {
      apiKey,
      textModel: env.OPENAI_TEXT_MODEL || "gpt-5",
      ideationModel: env.OPENAI_IDEATION_MODEL || "gpt-5-mini",
      imageModel: env.OPENAI_IMAGE_MODEL || "gpt-image-1-mini",
      embeddingModel: env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
      embeddingDimensions: 1536,
      reasoningEffort: effort,
      timeoutMs: num(env.OPENAI_TIMEOUT_MS, 150_000),
      maxRetries: num(env.OPENAI_MAX_RETRIES, 2),
    },
    supabase: { url: supabaseUrl, serviceRoleKey, bucket: env.SUPABASE_STORAGE_BUCKET || "carousel-assets" },
    localDataDir: env.LOCAL_DATA_DIR || (env.VERCEL ? "/tmp/drtrader-data" : path.join(process.cwd(), ".data")),
    auth: {
      password: env.DASHBOARD_PASSWORD || undefined,
      sessionSecret: env.SESSION_SECRET || undefined,
      sessionHours: num(env.SESSION_HOURS, 24 * 7),
    },
    cronSecret: env.CRON_SECRET || undefined,
    workerSecret: env.WORKER_SECRET || env.CRON_SECRET || undefined,
    vercelBypassSecret: env.VERCEL_AUTOMATION_BYPASS_SECRET || undefined,
    appUrl: env.APP_URL || (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : undefined),
    worker: {
      budgetMs: num(env.WORKER_BUDGET_MS, 240_000),
      concurrency: Math.max(1, Math.min(5, num(env.WORKER_CONCURRENCY, 3))),
      maxAttempts: Math.max(1, num(env.STEP_MAX_ATTEMPTS, 3)),
      leaseSeconds: num(env.WORKER_LEASE_SECONDS, 300),
    },
  };
  return cached;
}

/** Test helper: forget cached config so tests can change env vars. */
export function resetConfigForTests() {
  cached = null;
}

/** Public, non-secret runtime info for the UI. */
export function publicRuntimeInfo() {
  const c = getConfig();
  return {
    mockAi: c.mockAi,
    storeKind: c.storeKind,
    textModel: c.mockAi ? "mock" : c.openai.textModel,
    imageModel: c.mockAi ? "mock" : c.openai.imageModel,
  };
}
