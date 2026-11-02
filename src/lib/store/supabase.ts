import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppError, Errors } from "../errors";
import { mergeSettings, type Artwork, type Carousel, type Job, type Settings, type SimilarityMatch, type TopicRecord } from "../types";
import type { NewCarousel, NewJob, NewTopic, QuotaLimits, Store, TopicQuery } from "./types";

/**
 * Production store backed by Supabase Postgres (+pgvector) and Supabase Storage.
 * Uses the service-role key, so it must only ever run on the server.
 */
export class SupabaseStore implements Store {
  readonly kind = "supabase" as const;
  private readonly sb: SupabaseClient;

  constructor(url: string, serviceRoleKey: string, private readonly bucket: string) {
    this.sb = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-client-info": "drtrader-carousel-factory" } },
    });
  }

  async createJob(job: NewJob, carousels: NewCarousel[], limits: QuotaLimits) {
    const { data, error } = await this.sb.rpc("create_generation_job", {
      p_mode: job.mode,
      p_input: job.input,
      p_idempotency_key: job.idempotency_key,
      p_estimated_cost: job.estimated_cost_usd,
      p_mock: job.mock,
      p_carousels: carousels,
      p_daily_limit: limits.dailyCarousels,
      p_monthly_budget: limits.monthlyBudgetUsd,
    });
    if (error) throw mapDbError(error);
    const row = (data as Array<{ job: Job; created: boolean }>)[0];
    return { job: normalizeJob(row.job), created: row.created };
  }

  async consumeCarouselQuota(count: number, limits: QuotaLimits) {
    const { error } = await this.sb.rpc("consume_carousel_quota", {
      p_count: count,
      p_daily_limit: limits.dailyCarousels,
      p_monthly_budget: limits.monthlyBudgetUsd,
    });
    if (error) throw mapDbError(error);
  }

  async getJob(id: string) {
    const { data, error } = await this.sb.from("generation_jobs").select("*").eq("id", id).maybeSingle();
    if (error) throw mapDbError(error);
    return data ? normalizeJob(data) : null;
  }

  async listJobs(limit: number) {
    const { data, error } = await this.sb.from("generation_jobs").select("*").order("created_at", { ascending: false }).limit(limit);
    if (error) throw mapDbError(error);
    return (data ?? []).map(normalizeJob);
  }

  async updateJob(id: string, patch: Partial<Job>) {
    const { data, error } = await this.sb
      .from("generation_jobs")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw mapDbError(error);
    return normalizeJob(data);
  }

  async claimJob(workerId: string, leaseSeconds: number) {
    const { data, error } = await this.sb.rpc("claim_generation_job", { p_worker: workerId, p_lease_seconds: leaseSeconds, p_job_id: null });
    if (error) throw mapDbError(error);
    const row = (data as Job[] | null)?.[0];
    return row ? normalizeJob(row) : null;
  }

  async claimJobById(jobId: string, workerId: string, leaseSeconds: number) {
    const { data, error } = await this.sb.rpc("claim_generation_job", { p_worker: workerId, p_lease_seconds: leaseSeconds, p_job_id: jobId });
    if (error) throw mapDbError(error);
    const row = (data as Job[] | null)?.[0];
    return row ? normalizeJob(row) : null;
  }

  async releaseJob(jobId: string, workerId: string) {
    const { error } = await this.sb.rpc("release_generation_job", { p_job_id: jobId, p_worker: workerId });
    if (error) throw mapDbError(error);
  }

  async reactivateJob(jobId: string) {
    const { data, error } = await this.sb.rpc("reactivate_generation_job", { p_job_id: jobId });
    if (error) throw mapDbError(error);
    const row = (data as Job[] | null)?.[0];
    if (!row) throw Errors.notFound("งาน");
    return normalizeJob(row);
  }

  async listCarousels(jobId: string) {
    const { data, error } = await this.sb.from("carousels").select("*").eq("job_id", jobId).order("position");
    if (error) throw mapDbError(error);
    return (data ?? []).map(normalizeCarousel);
  }

  async getCarousel(id: string) {
    const { data, error } = await this.sb.from("carousels").select("*").eq("id", id).maybeSingle();
    if (error) throw mapDbError(error);
    return data ? normalizeCarousel(data) : null;
  }

  async updateCarousel(id: string, expectedVersion: number, patch: Partial<Carousel>) {
    const { data, error } = await this.sb.rpc("update_carousel_cas", {
      p_id: id,
      p_expected_version: expectedVersion,
      p_patch: patch,
    });
    if (error) throw mapDbError(error);
    const row = (data as Carousel[] | null)?.[0];
    return row ? normalizeCarousel(row) : null;
  }

  async insertTopic(topic: NewTopic) {
    const { data, error } = await this.sb
      .from("topic_history")
      .insert({ ...topic, embedding: topic.embedding ? toVector(topic.embedding) : null })
      .select("*")
      .single();
    if (error) throw mapDbError(error);
    return normalizeTopic(data);
  }

  async updateTopicsForCarousel(carouselId: string, patch: Partial<TopicRecord>, onlyStatus?: TopicRecord["status"][]) {
    const body: Record<string, unknown> = { ...patch };
    if (patch.embedding) body.embedding = toVector(patch.embedding);
    let q = this.sb.from("topic_history").update(body).eq("carousel_id", carouselId);
    if (onlyStatus?.length) q = q.in("status", onlyStatus);
    const { error } = await q;
    if (error) throw mapDbError(error);
  }

  async getTopicsForCarousel(carouselId: string) {
    const { data, error } = await this.sb
      .from("topic_history")
      .select("id,carousel_id,job_id,title,normalized_topic,category,angle,learning_objective,summary,embedding_model,status,source,created_at,completed_at")
      .eq("carousel_id", carouselId);
    if (error) throw mapDbError(error);
    return (data ?? []).map((d) => normalizeTopic({ ...d, embedding: null }));
  }

  async listTopics(query: TopicQuery) {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    let q = this.sb
      .from("topic_history")
      .select("id,carousel_id,job_id,title,normalized_topic,category,angle,learning_objective,summary,embedding_model,status,source,created_at,completed_at", {
        count: "exact",
      })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (query.status) q = q.eq("status", query.status);
    if (query.category) q = q.eq("category", query.category);
    if (query.q?.trim()) {
      const term = query.q.trim().replace(/[%,()]/g, " ");
      q = q.or(`title.ilike.%${term}%,angle.ilike.%${term}%,summary.ilike.%${term}%`);
    }
    const { data, error, count } = await q;
    if (error) throw mapDbError(error);
    return { items: (data ?? []).map((d) => normalizeTopic({ ...d, embedding: null })), total: count ?? 0 };
  }

  async recentTopics(limit: number) {
    const { data, error } = await this.sb
      .from("topic_history")
      .select("id,carousel_id,job_id,title,normalized_topic,category,angle,learning_objective,summary,embedding_model,status,source,created_at,completed_at")
      .in("status", ["completed", "reserved"])
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw mapDbError(error);
    return (data ?? []).map((d) => normalizeTopic({ ...d, embedding: null }));
  }

  async findExactTopics(normalized: string) {
    const { data, error } = await this.sb
      .from("topic_history")
      .select("id,title,created_at")
      .eq("normalized_topic", normalized)
      .in("status", ["completed", "reserved"])
      .limit(5);
    if (error) throw mapDbError(error);
    return (data ?? []).map<SimilarityMatch>((d) => ({ topic_id: d.id, title: d.title, similarity: 1, exact: true, created_at: d.created_at }));
  }

  async usedNormalizedTopics(limit: number) {
    const { data, error } = await this.sb
      .from("topic_history")
      .select("normalized_topic")
      .in("status", ["completed", "reserved"])
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw mapDbError(error);
    return new Set((data ?? []).map((d) => d.normalized_topic as string));
  }

  async matchTopics(embedding: number[], embeddingModel: string, count: number, excludeCarouselIds: string[] = []) {
    const { data, error } = await this.sb.rpc("match_topics", {
      p_embedding: toVector(embedding),
      p_embedding_model: embeddingModel,
      p_count: count,
      p_exclude_carousels: excludeCarouselIds,
    });
    if (error) throw mapDbError(error);
    return ((data ?? []) as Array<{ topic_id: string; title: string; similarity: number; created_at: string }>).map((d) => ({
      ...d,
      similarity: Number(d.similarity),
      exact: false,
    }));
  }

  async findReusableArtwork(category: Artwork["category"], motif: Artwork["motif"], maxUses: number, excludeIds: string[]) {
    let q = this.sb.from("artworks").select("*").eq("motif", motif).lt("usage_count", maxUses).order("usage_count").limit(1);
    q = category ? q.eq("category", category) : q.is("category", null);
    if (excludeIds.length) q = q.not("id", "in", `(${excludeIds.join(",")})`);
    const { data, error } = await q;
    if (error) throw mapDbError(error);
    return (data?.[0] as Artwork | undefined) ?? null;
  }

  async insertArtwork(artwork: Omit<Artwork, "id" | "created_at" | "usage_count">) {
    const { data, error } = await this.sb.from("artworks").insert(artwork).select("*").single();
    if (error) throw mapDbError(error);
    return data as Artwork;
  }

  async incrementArtworkUse(id: string) {
    const { error } = await this.sb.rpc("increment_artwork_use", { p_id: id });
    if (error) throw mapDbError(error);
  }

  async getArtwork(id: string) {
    const { data, error } = await this.sb.from("artworks").select("*").eq("id", id).maybeSingle();
    if (error) throw mapDbError(error);
    return (data as Artwork | null) ?? null;
  }

  async recordUsage(usage: Parameters<Store["recordUsage"]>[0]) {
    const { error } = await this.sb.from("api_usage").insert(usage);
    if (error) throw mapDbError(error);
  }

  async addCost(jobId: string | null, carouselId: string | null, costUsd: number) {
    const { error } = await this.sb.rpc("add_generation_cost", { p_job_id: jobId, p_carousel_id: carouselId, p_cost: costUsd });
    if (error) throw mapDbError(error);
  }

  async usageSince(sinceIso: string) {
    const [{ data: usage, error: e1 }, { count, error: e2 }] = await Promise.all([
      this.sb.from("api_usage").select("cost_usd").gte("created_at", sinceIso),
      this.sb.from("carousels").select("id", { count: "exact", head: true }).gte("created_at", sinceIso).eq("status", "completed"),
    ]);
    if (e1) throw mapDbError(e1);
    if (e2) throw mapDbError(e2);
    return { costUsd: (usage ?? []).reduce((s, u) => s + Number(u.cost_usd), 0), carousels: count ?? 0 };
  }

  async hitRateLimit(key: string, windowSeconds: number, max: number) {
    const { data, error } = await this.sb.rpc("rate_limit_hit", { p_key: key, p_window_seconds: windowSeconds, p_max: max });
    if (error) throw mapDbError(error);
    const row = (data as Array<{ allowed: boolean; current_count: number; reset_at: string }>)[0];
    return { allowed: row.allowed, count: row.current_count, resetAt: row.reset_at };
  }

  async getSettings() {
    const { data, error } = await this.sb.from("app_settings").select("value").eq("id", 1).maybeSingle();
    if (error) throw mapDbError(error);
    return mergeSettings(data?.value);
  }

  async saveSettings(settings: Settings) {
    const { error } = await this.sb.from("app_settings").upsert({ id: 1, value: settings, updated_at: new Date().toISOString() });
    if (error) throw mapDbError(error);
    return settings;
  }

  async putBlob(key: string, data: Buffer, contentType: string) {
    const { error } = await this.sb.storage.from(this.bucket).upload(key, data, { contentType, upsert: true });
    if (error) throw Errors.storage(error.message);
  }

  async getBlob(key: string) {
    const { data, error } = await this.sb.storage.from(this.bucket).download(key);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  }

  async signedBlobUrl(key: string, expiresInSec: number) {
    const { data, error } = await this.sb.storage.from(this.bucket).createSignedUrl(key, expiresInSec);
    if (error) return null;
    return data.signedUrl;
  }
}

function toVector(v: number[]): string {
  return `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(7) : "0")).join(",")}]`;
}

function parseVector(v: unknown): number[] | null {
  if (!v) return null;
  if (Array.isArray(v)) return v.map(Number);
  if (typeof v === "string") return JSON.parse(v) as number[];
  return null;
}

function normalizeJob(row: Record<string, unknown> | Job): Job {
  const r = row as Job;
  return { ...r, estimated_cost_usd: Number(r.estimated_cost_usd), actual_cost_usd: Number(r.actual_cost_usd) };
}

function normalizeCarousel(row: Record<string, unknown> | Carousel): Carousel {
  const r = row as Carousel;
  return { ...r, cost_usd: Number(r.cost_usd), hashtags: r.hashtags ?? [], slide_keys: r.slide_keys ?? [], similarity: r.similarity ?? [] };
}

function normalizeTopic(row: Record<string, unknown>): TopicRecord {
  return { ...(row as unknown as TopicRecord), embedding: parseVector(row.embedding) };
}

/** Translate custom exceptions raised by SQL functions into AppErrors. */
export function mapDbError(error: { message: string; code?: string }): AppError {
  const msg = error.message ?? "";
  const active = msg.match(/active_job:([0-9a-f-]*)/);
  if (active) return Errors.activeJob(active[1]);
  const daily = msg.match(/quota_daily:(\d+):(\d+)/);
  if (daily) return Errors.quotaExceeded(`เกินโควตารายวัน (${daily[1]}/${daily[2]} carousel) กรุณาลองใหม่พรุ่งนี้หรือปรับโควตาในหน้าตั้งค่า`);
  const budget = msg.match(/quota_budget:([\d.]+):([\d.]+)/);
  if (budget) return Errors.quotaExceeded(`เกินงบประมาณรายเดือน ($${budget[1]} / $${budget[2]})`);
  return Errors.storage(msg);
}

