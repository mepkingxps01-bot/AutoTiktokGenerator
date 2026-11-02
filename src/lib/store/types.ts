import type {
  Artwork,
  Carousel,
  Category,
  Job,
  JobInput,
  JobMode,
  Motif,
  Settings,
  SimilarityMatch,
  TopicRecord,
  TopicStatus,
  UsageRecord,
} from "../types";

export interface NewCarousel {
  position: number;
  stage: Carousel["stage"];
  title?: string | null;
  normalized_topic?: string | null;
  category?: Category | null;
  similarity?: SimilarityMatch[];
}

export interface NewJob {
  mode: JobMode;
  input: JobInput;
  idempotency_key: string | null;
  estimated_cost_usd: number;
  mock: boolean;
}

export interface QuotaLimits {
  dailyCarousels: number;
  monthlyBudgetUsd: number;
}

export interface TopicQuery {
  q?: string;
  status?: TopicStatus;
  category?: Category;
  limit?: number;
  offset?: number;
}

export type NewTopic = Omit<TopicRecord, "id" | "created_at" | "completed_at"> & { id?: string };

export type CarouselPatch = Partial<Omit<Carousel, "id" | "job_id" | "created_at">>;
export type JobPatch = Partial<Omit<Job, "id" | "created_at">>;

export interface UsageTotals {
  costUsd: number;
  carousels: number;
}

/**
 * Persistence contract implemented by the Supabase store (production) and the
 * file-based local store (development / mock testing). Methods that the
 * pipeline relies on for correctness are documented as atomic.
 */
export interface Store {
  readonly kind: "supabase" | "local";

  /**
   * Atomically: enforce idempotency key, single active job, daily carousel quota
   * and monthly budget, then insert the job with its carousels.
   * Returns { job, created:false } when the idempotency key already exists.
   * Throws AppError active_job_exists / quota_exceeded.
   */
  createJob(job: NewJob, carousels: NewCarousel[], limits: QuotaLimits): Promise<{ job: Job; created: boolean }>;
  getJob(id: string): Promise<Job | null>;
  listJobs(limit: number): Promise<Job[]>;
  updateJob(id: string, patch: JobPatch): Promise<Job>;
  /** Atomic: claim the oldest active job whose lease is free/expired. */
  claimJob(workerId: string, leaseSeconds: number): Promise<Job | null>;
  /** Atomic: claim a specific active job if its lease is free/expired. */
  claimJobById(jobId: string, workerId: string, leaseSeconds: number): Promise<Job | null>;
  releaseJob(jobId: string, workerId: string): Promise<void>;
  /** Atomic: reactivate a finished job (for regenerate/retry) unless another job is active. */
  reactivateJob(jobId: string): Promise<Job>;

  listCarousels(jobId: string): Promise<Carousel[]>;
  getCarousel(id: string): Promise<Carousel | null>;
  /**
   * Compare-and-set update: applies only when the carousel's version still equals
   * `expectedVersion`. Returns the updated row, or null when it was superseded.
   */
  updateCarousel(id: string, expectedVersion: number, patch: CarouselPatch): Promise<Carousel | null>;

  insertTopic(topic: NewTopic): Promise<TopicRecord>;
  updateTopicsForCarousel(carouselId: string, patch: Partial<TopicRecord>, onlyStatus?: TopicStatus[]): Promise<void>;
  getTopicsForCarousel(carouselId: string): Promise<TopicRecord[]>;
  listTopics(query: TopicQuery): Promise<{ items: TopicRecord[]; total: number }>;
  recentTopics(limit: number): Promise<TopicRecord[]>;
  findExactTopics(normalized: string): Promise<SimilarityMatch[]>;
  usedNormalizedTopics(limit: number): Promise<Set<string>>;
  /** Nearest completed/reserved topics by cosine similarity (pgvector in Supabase). */
  matchTopics(embedding: number[], embeddingModel: string, count: number, excludeCarouselIds?: string[]): Promise<SimilarityMatch[]>;

  findReusableArtwork(category: Category | null, motif: Motif, maxUses: number, excludeIds: string[]): Promise<Artwork | null>;
  insertArtwork(artwork: Omit<Artwork, "id" | "created_at" | "usage_count">): Promise<Artwork>;
  incrementArtworkUse(id: string): Promise<void>;
  getArtwork(id: string): Promise<Artwork | null>;

  /** Atomic: add `count` carousels to today's (Asia/Bangkok) counter, or throw quota_exceeded. */
  consumeCarouselQuota(count: number, limits: QuotaLimits): Promise<void>;

  recordUsage(usage: UsageRecord): Promise<void>;
  /** Adds cost to job and carousel totals atomically. */
  addCost(jobId: string | null, carouselId: string | null, costUsd: number): Promise<void>;
  usageSince(sinceIso: string): Promise<UsageTotals>;

  /** Fixed-window rate limiting. Atomic increment. */
  hitRateLimit(key: string, windowSeconds: number, max: number): Promise<{ allowed: boolean; count: number; resetAt: string }>;

  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<Settings>;

  putBlob(key: string, data: Buffer, contentType: string): Promise<void>;
  getBlob(key: string): Promise<Buffer | null>;
  /** Optional: short-lived URL for a blob (Supabase signed URL). */
  signedBlobUrl?(key: string, expiresInSec: number): Promise<string | null>;
}
