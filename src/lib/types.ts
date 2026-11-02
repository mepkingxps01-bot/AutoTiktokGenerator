import { z } from "zod";

export const CATEGORIES = [
  "ict_smc",
  "market_structure",
  "liquidity",
  "fair_value_gap",
  "order_blocks",
  "multi_timeframe",
  "risk_management",
  "trading_psychology",
  "trading_mistakes",
  "practical_education",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  ict_smc: "ICT / Smart Money Concepts",
  market_structure: "Market Structure",
  liquidity: "Liquidity",
  fair_value_gap: "Fair Value Gap",
  order_blocks: "Order Blocks",
  multi_timeframe: "Multi-Timeframe Analysis",
  risk_management: "Risk Management",
  trading_psychology: "Trading Psychology",
  trading_mistakes: "Trading Mistakes",
  practical_education: "Practical Trading Education",
};

export const SLIDE_ROLES = ["hook", "foundation", "insight", "application", "takeaway"] as const;
export type SlideRole = (typeof SLIDE_ROLES)[number];

export const SLIDE_ROLE_LABELS: Record<SlideRole, string> = {
  hook: "HOOK",
  foundation: "FOUNDATION",
  insight: "KEY INSIGHT",
  application: "PRACTICAL APPLICATION",
  takeaway: "TAKEAWAY",
};

export const DIAGRAMS = [
  "none",
  "market_structure",
  "mss",
  "liquidity_sweep",
  "fvg",
  "order_block",
  "multi_timeframe",
  "risk_reward",
  "position_sizing",
  "drawdown",
  "psychology_cycle",
  "checklist",
] as const;
export type DiagramKind = (typeof DIAGRAMS)[number];

export const MOTIFS = ["candles", "shield", "brain", "chess", "compass", "target", "scale", "mountain", "waves", "lighthouse"] as const;
export type Motif = (typeof MOTIFS)[number];

export const LAYOUTS = ["classic", "centered", "editorial", "frame"] as const;
export type LayoutVariant = (typeof LAYOUTS)[number];

// ---------- AI output schemas ----------

export const SlideSchema = z.object({
  role: z.enum(SLIDE_ROLES),
  kicker: z.string(),
  headline: z.string(),
  body: z.array(z.string()),
  highlight: z.string().nullable(),
  diagram: z.enum(DIAGRAMS),
});
export type Slide = z.infer<typeof SlideSchema>;

export const ScriptSchema = z.object({
  title: z.string(),
  category: z.enum(CATEGORIES),
  angle: z.string(),
  learning_objective: z.string(),
  summary: z.string(),
  slides: z.array(SlideSchema),
  caption: z.string(),
  hashtags: z.array(z.string()),
  illustration: z.object({ motif: z.enum(MOTIFS), prompt: z.string() }),
});
export type CarouselScript = z.infer<typeof ScriptSchema>;

export const TopicCandidateSchema = z.object({
  title: z.string(),
  category: z.enum(CATEGORIES),
  angle: z.string(),
  learning_objective: z.string(),
  educational_value: z.number(),
  originality: z.number(),
  rationale: z.string(),
});
export type TopicCandidate = z.infer<typeof TopicCandidateSchema>;

// ---------- Persistence types ----------

export type JobMode = "auto" | "custom";
export type JobStatus = "queued" | "running" | "completed" | "partial" | "failed" | "cancelled";
export type JobStage = "ideation" | "production" | "done";
export const ACTIVE_JOB_STATUSES: JobStatus[] = ["queued", "running"];

export interface JobInput {
  topic?: string;
  angles?: boolean;
  count: number;
  overrideSimilarity?: boolean;
}

export interface Job {
  id: string;
  mode: JobMode;
  status: JobStatus;
  stage: JobStage;
  input: JobInput;
  idempotency_key: string | null;
  error: string | null;
  ideation_attempts: number;
  estimated_cost_usd: number;
  actual_cost_usd: number;
  mock: boolean;
  lease_owner: string | null;
  lease_expires_at: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

/** Next stage a carousel needs; "done" once rendered and stored. */
export type CarouselStage = "topic" | "script" | "illustrate" | "render" | "done";
export type CarouselStatus = "queued" | "completed" | "failed" | "cancelled";

export interface SimilarityMatch {
  topic_id: string;
  title: string;
  similarity: number;
  exact: boolean;
  created_at: string;
}

export interface Carousel {
  id: string;
  job_id: string;
  position: number;
  version: number;
  stage: CarouselStage;
  status: CarouselStatus;
  title: string | null;
  normalized_topic: string | null;
  category: Category | null;
  angle: string | null;
  learning_objective: string | null;
  script: CarouselScript | null;
  caption: string | null;
  hashtags: string[];
  layout: LayoutVariant | null;
  artwork_id: string | null;
  slide_keys: string[];
  similarity: SimilarityMatch[];
  attempts: number;
  next_attempt_at: string | null;
  error: string | null;
  cost_usd: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export type TopicStatus = "reserved" | "completed" | "failed" | "discarded";

export interface TopicRecord {
  id: string;
  carousel_id: string | null;
  job_id: string | null;
  title: string;
  normalized_topic: string;
  category: Category | null;
  angle: string | null;
  learning_objective: string | null;
  summary: string | null;
  embedding: number[] | null;
  embedding_model: string | null;
  status: TopicStatus;
  source: JobMode;
  created_at: string;
  completed_at: string | null;
}

export interface Artwork {
  id: string;
  category: Category | null;
  motif: Motif;
  source: "openai" | "procedural" | "mock";
  prompt: string;
  storage_key: string;
  usage_count: number;
  created_at: string;
}

export interface UsageRecord {
  job_id: string | null;
  carousel_id: string | null;
  stage: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  images: number;
  cost_usd: number;
  estimated: boolean;
  mock: boolean;
}

// ---------- Settings ----------

export const SettingsSchema = z.object({
  similarity: z.object({
    /** custom-topic warning threshold (cosine similarity 0..1) */
    warnThreshold: z.number().min(0.5).max(1),
    /** auto-mode rejection threshold against history */
    rejectThreshold: z.number().min(0.5).max(1),
    /** maximum similarity allowed between topics in the same batch */
    batchThreshold: z.number().min(0.5).max(1),
    /** batch threshold for "5 angles of one topic" mode (angles are naturally closer) */
    angleBatchThreshold: z.number().min(0.5).max(1),
  }),
  ideation: z.object({
    candidateCount: z.number().int().min(10).max(30),
    historyWindow: z.number().int().min(20).max(1000),
    maxRounds: z.number().int().min(1).max(5),
  }),
  quotas: z.object({
    dailyCarousels: z.number().int().min(1).max(500),
    monthlyBudgetUsd: z.number().min(0).max(10_000),
  }),
  images: z.object({
    mode: z.enum(["ai", "procedural"]),
    quality: z.enum(["low", "medium", "high"]),
    reuseArtwork: z.boolean(),
    maxReusePerArtwork: z.number().int().min(1).max(100),
  }),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  similarity: { warnThreshold: 0.86, rejectThreshold: 0.88, batchThreshold: 0.85, angleBatchThreshold: 0.93 },
  ideation: { candidateCount: 12, historyWindow: 200, maxRounds: 3 },
  quotas: { dailyCarousels: 40, monthlyBudgetUsd: 30 },
  images: { mode: "ai", quality: "medium", reuseArtwork: true, maxReusePerArtwork: 6 },
};

export function mergeSettings(partial: unknown): Settings {
  const p = (partial ?? {}) as Partial<Settings>;
  const merged = {
    similarity: { ...DEFAULT_SETTINGS.similarity, ...(p.similarity ?? {}) },
    ideation: { ...DEFAULT_SETTINGS.ideation, ...(p.ideation ?? {}) },
    quotas: { ...DEFAULT_SETTINGS.quotas, ...(p.quotas ?? {}) },
    images: { ...DEFAULT_SETTINGS.images, ...(p.images ?? {}) },
  };
  const parsed = SettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}
