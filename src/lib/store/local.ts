import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Errors } from "../errors";
import { cosineSimilarity } from "../topics/similarity";
import { bangkokDay, bangkokMonthStartIso, nowIso, addSeconds } from "../time";
import {
  ACTIVE_JOB_STATUSES,
  DEFAULT_SETTINGS,
  mergeSettings,
  type Artwork,
  type Carousel,
  type Job,
  type Settings,
  type SimilarityMatch,
  type TopicRecord,
  type UsageRecord,
} from "../types";
import type { NewCarousel, NewJob, NewTopic, QuotaLimits, Store, TopicQuery } from "./types";

interface Db {
  jobs: Job[];
  carousels: Carousel[];
  topics: TopicRecord[];
  artworks: Artwork[];
  usage: Array<UsageRecord & { id: string; created_at: string }>;
  rateLimits: Record<string, { windowStart: number; count: number }>;
  dailyCounters: Record<string, number>;
  settings: Settings;
}

const emptyDb = (): Db => ({
  jobs: [],
  carousels: [],
  topics: [],
  artworks: [],
  usage: [],
  rateLimits: {},
  dailyCounters: {},
  settings: DEFAULT_SETTINGS,
});

/**
 * File-backed development store. All mutations run inside a single in-process
 * mutex, which makes each method atomic within one Node.js process. It is meant
 * for local development and mock testing only, NOT for multi-instance production.
 */
export class LocalStore implements Store {
  readonly kind = "local" as const;
  private db: Db | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly file: string;
  private readonly blobDir: string;

  constructor(private readonly dir: string) {
    this.file = path.join(dir, "db.json");
    this.blobDir = path.join(dir, "blobs");
  }

  private async load(): Promise<Db> {
    if (this.db) return this.db;
    try {
      const raw = await fs.readFile(this.file, "utf8");
      this.db = { ...emptyDb(), ...(JSON.parse(raw) as Partial<Db>) };
    } catch {
      this.db = emptyDb();
    }
    return this.db;
  }

  private async persist() {
    await fs.mkdir(this.dir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.db));
    await fs.rename(tmp, this.file);
  }

  /** Serialize all access; `write` persists after the callback. */
  private tx<T>(fn: (db: Db) => T | Promise<T>, write = true): Promise<T> {
    const run = this.queue.then(async () => {
      const db = await this.load();
      const result = await fn(db);
      if (write) await this.persist();
      return structuredClone(result);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  createJob(input: NewJob, carousels: NewCarousel[], limits: QuotaLimits) {
    return this.tx((db) => {
      if (input.idempotency_key) {
        const existing = db.jobs.find((j) => j.idempotency_key === input.idempotency_key);
        if (existing) return { job: existing, created: false };
      }
      const active = db.jobs.find((j) => ACTIVE_JOB_STATUSES.includes(j.status));
      if (active) throw Errors.activeJob(active.id);
      this.checkQuota(db, carousels.length, limits, input.estimated_cost_usd);
      const now = nowIso();
      const job: Job = {
        id: randomUUID(),
        mode: input.mode,
        status: "queued",
        stage: carousels.some((c) => c.stage === "topic") ? "ideation" : "production",
        input: input.input,
        idempotency_key: input.idempotency_key,
        error: null,
        ideation_attempts: 0,
        estimated_cost_usd: input.estimated_cost_usd,
        actual_cost_usd: 0,
        mock: input.mock,
        lease_owner: null,
        lease_expires_at: null,
        created_at: now,
        updated_at: now,
        started_at: null,
        finished_at: null,
      };
      db.jobs.push(job);
      for (const c of carousels) db.carousels.push(newCarouselRow(job.id, c, now));
      return { job, created: true };
    });
  }

  private checkQuota(db: Db, count: number, limits: QuotaLimits, extraCost = 0) {
    const day = bangkokDay();
    const used = db.dailyCounters[day] ?? 0;
    if (used + count > limits.dailyCarousels)
      throw Errors.quotaExceeded(`เกินโควตารายวัน (${used}/${limits.dailyCarousels} carousel) กรุณาลองใหม่พรุ่งนี้หรือปรับโควตาในหน้าตั้งค่า`);
    const monthStart = bangkokMonthStartIso();
    const spent = db.usage.filter((u) => u.created_at >= monthStart).reduce((s, u) => s + u.cost_usd, 0);
    if (limits.monthlyBudgetUsd > 0 && spent + extraCost > limits.monthlyBudgetUsd)
      throw Errors.quotaExceeded(`เกินงบประมาณรายเดือน ($${spent.toFixed(2)} / $${limits.monthlyBudgetUsd})`);
    db.dailyCounters[day] = used + count;
  }

  consumeCarouselQuota(count: number, limits: QuotaLimits) {
    return this.tx((db) => this.checkQuota(db, count, limits));
  }

  getJob(id: string) {
    return this.tx((db) => db.jobs.find((j) => j.id === id) ?? null, false);
  }

  listJobs(limit: number) {
    return this.tx((db) => [...db.jobs].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit), false);
  }

  updateJob(id: string, patch: Partial<Job>) {
    return this.tx((db) => {
      const job = db.jobs.find((j) => j.id === id);
      if (!job) throw Errors.notFound("งาน");
      Object.assign(job, patch, { updated_at: nowIso() });
      return job;
    });
  }

  claimJob(workerId: string, leaseSeconds: number) {
    return this.tx((db) => {
      const now = nowIso();
      const job = db.jobs
        .filter((j) => ACTIVE_JOB_STATUSES.includes(j.status) && (!j.lease_expires_at || j.lease_expires_at < now))
        .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
      if (!job) return null;
      return lease(job, workerId, leaseSeconds);
    });
  }

  claimJobById(jobId: string, workerId: string, leaseSeconds: number) {
    return this.tx((db) => {
      const now = nowIso();
      const job = db.jobs.find((j) => j.id === jobId);
      if (!job || !ACTIVE_JOB_STATUSES.includes(job.status)) return null;
      if (job.lease_expires_at && job.lease_expires_at >= now && job.lease_owner !== workerId) return null;
      return lease(job, workerId, leaseSeconds);
    });
  }

  releaseJob(jobId: string, workerId: string) {
    return this.tx((db) => {
      const job = db.jobs.find((j) => j.id === jobId);
      if (job && job.lease_owner === workerId) {
        job.lease_owner = null;
        job.lease_expires_at = null;
      }
    });
  }

  reactivateJob(jobId: string) {
    return this.tx((db) => {
      const job = db.jobs.find((j) => j.id === jobId);
      if (!job) throw Errors.notFound("งาน");
      const other = db.jobs.find((j) => j.id !== jobId && ACTIVE_JOB_STATUSES.includes(j.status));
      if (other) throw Errors.activeJob(other.id);
      if (!ACTIVE_JOB_STATUSES.includes(job.status)) {
        job.status = "queued";
        job.finished_at = null;
        job.error = null;
      }
      job.updated_at = nowIso();
      return job;
    });
  }

  listCarousels(jobId: string) {
    return this.tx((db) => db.carousels.filter((c) => c.job_id === jobId).sort((a, b) => a.position - b.position), false);
  }

  getCarousel(id: string) {
    return this.tx((db) => db.carousels.find((c) => c.id === id) ?? null, false);
  }

  updateCarousel(id: string, expectedVersion: number, patch: Partial<Carousel>) {
    return this.tx((db) => {
      const c = db.carousels.find((x) => x.id === id);
      if (!c || c.version !== expectedVersion) return null;
      Object.assign(c, patch, { updated_at: nowIso() });
      return c;
    });
  }

  insertTopic(topic: NewTopic) {
    return this.tx((db) => {
      const row: TopicRecord = { ...topic, id: topic.id ?? randomUUID(), created_at: nowIso(), completed_at: null };
      db.topics.push(row);
      return row;
    });
  }

  updateTopicsForCarousel(carouselId: string, patch: Partial<TopicRecord>, onlyStatus?: TopicRecord["status"][]) {
    return this.tx((db) => {
      for (const t of db.topics) {
        if (t.carousel_id !== carouselId) continue;
        if (onlyStatus && !onlyStatus.includes(t.status)) continue;
        Object.assign(t, patch);
      }
    });
  }

  getTopicsForCarousel(carouselId: string) {
    return this.tx((db) => db.topics.filter((t) => t.carousel_id === carouselId).map(stripEmbedding), false);
  }

  listTopics(query: TopicQuery) {
    return this.tx((db) => {
      const q = query.q?.trim().toLowerCase();
      const items = db.topics
        .filter((t) => (!query.status || t.status === query.status) && (!query.category || t.category === query.category))
        .filter(
          (t) =>
            !q ||
            [t.title, t.angle, t.summary, t.learning_objective].some((f) => f?.toLowerCase().includes(q)) ||
            t.normalized_topic.includes(q.replace(/\s+/g, "")),
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      const offset = query.offset ?? 0;
      const limit = query.limit ?? 50;
      return { items: items.slice(offset, offset + limit).map(stripEmbedding), total: items.length };
    }, false);
  }

  recentTopics(limit: number) {
    return this.tx(
      (db) =>
        db.topics
          .filter((t) => t.status === "completed" || t.status === "reserved")
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(0, limit)
          .map(stripEmbedding),
      false,
    );
  }

  findExactTopics(normalized: string) {
    return this.tx(
      (db) =>
        db.topics
          .filter((t) => t.normalized_topic === normalized && (t.status === "completed" || t.status === "reserved"))
          .map<SimilarityMatch>((t) => ({ topic_id: t.id, title: t.title, similarity: 1, exact: true, created_at: t.created_at })),
      false,
    );
  }

  usedNormalizedTopics(limit: number) {
    return this.tx((db) => {
      const rows = db.topics
        .filter((t) => t.status === "completed" || t.status === "reserved")
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limit);
      return new Set(rows.map((r) => r.normalized_topic));
    }, false);
  }

  matchTopics(embedding: number[], embeddingModel: string, count: number, excludeCarouselIds: string[] = []) {
    return this.tx(
      (db) =>
        db.topics
          .filter(
            (t) =>
              (t.status === "completed" || t.status === "reserved") &&
              t.embedding &&
              t.embedding_model === embeddingModel &&
              !(t.carousel_id && excludeCarouselIds.includes(t.carousel_id)),
          )
          .map<SimilarityMatch>((t) => ({
            topic_id: t.id,
            title: t.title,
            similarity: cosineSimilarity(embedding, t.embedding as number[]),
            exact: false,
            created_at: t.created_at,
          }))
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, count),
      false,
    );
  }

  findReusableArtwork(category: Artwork["category"], motif: Artwork["motif"], maxUses: number, excludeIds: string[]) {
    return this.tx((db) => {
      const pool = db.artworks.filter((a) => a.usage_count < maxUses && !excludeIds.includes(a.id));
      const match =
        pool.filter((a) => a.category === category && a.motif === motif).sort((a, b) => a.usage_count - b.usage_count)[0] ??
        null;
      return match;
    }, false);
  }

  insertArtwork(artwork: Omit<Artwork, "id" | "created_at" | "usage_count">) {
    return this.tx((db) => {
      const row: Artwork = { ...artwork, id: randomUUID(), usage_count: 0, created_at: nowIso() };
      db.artworks.push(row);
      return row;
    });
  }

  incrementArtworkUse(id: string) {
    return this.tx((db) => {
      const a = db.artworks.find((x) => x.id === id);
      if (a) a.usage_count += 1;
    });
  }

  getArtwork(id: string) {
    return this.tx((db) => db.artworks.find((a) => a.id === id) ?? null, false);
  }

  recordUsage(usage: UsageRecord) {
    return this.tx((db) => {
      db.usage.push({ ...usage, id: randomUUID(), created_at: nowIso() });
    });
  }

  addCost(jobId: string | null, carouselId: string | null, costUsd: number) {
    return this.tx((db) => {
      const job = jobId ? db.jobs.find((j) => j.id === jobId) : undefined;
      if (job) job.actual_cost_usd += costUsd;
      const car = carouselId ? db.carousels.find((c) => c.id === carouselId) : undefined;
      if (car) car.cost_usd += costUsd;
    });
  }

  usageSince(sinceIso: string) {
    return this.tx((db) => {
      const costUsd = db.usage.filter((u) => u.created_at >= sinceIso).reduce((s, u) => s + u.cost_usd, 0);
      const carousels = db.carousels.filter((c) => c.created_at >= sinceIso && c.status === "completed").length;
      return { costUsd, carousels };
    }, false);
  }

  hitRateLimit(key: string, windowSeconds: number, max: number) {
    return this.tx((db) => {
      const now = Date.now();
      const windowStart = Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000;
      const entry = db.rateLimits[key];
      const count = entry && entry.windowStart === windowStart ? entry.count + 1 : 1;
      db.rateLimits[key] = { windowStart, count };
      return { allowed: count <= max, count, resetAt: new Date(windowStart + windowSeconds * 1000).toISOString() };
    });
  }

  getSettings() {
    return this.tx((db) => mergeSettings(db.settings), false);
  }

  saveSettings(settings: Settings) {
    return this.tx((db) => {
      db.settings = settings;
      return settings;
    });
  }

  async putBlob(key: string, data: Buffer) {
    const file = this.blobPath(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
  }

  async getBlob(key: string) {
    try {
      return await fs.readFile(this.blobPath(key));
    } catch {
      return null;
    }
  }

  private blobPath(key: string) {
    const resolved = path.resolve(this.blobDir, key);
    if (!resolved.startsWith(path.resolve(this.blobDir) + path.sep)) throw Errors.badInput("ชื่อไฟล์ไม่ถูกต้อง");
    return resolved;
  }
}

function lease(job: Job, workerId: string, leaseSeconds: number): Job {
  const now = nowIso();
  job.lease_owner = workerId;
  job.lease_expires_at = addSeconds(now, leaseSeconds);
  if (job.status === "queued") job.status = "running";
  job.started_at = job.started_at ?? now;
  job.updated_at = now;
  return job;
}

function stripEmbedding(t: TopicRecord): TopicRecord {
  return { ...t, embedding: null };
}

export function newCarouselRow(jobId: string, c: NewCarousel, now: string): Carousel {
  return {
    id: randomUUID(),
    job_id: jobId,
    position: c.position,
    version: 1,
    stage: c.stage,
    status: "queued",
    title: c.title ?? null,
    normalized_topic: c.normalized_topic ?? null,
    category: c.category ?? null,
    angle: null,
    learning_objective: null,
    script: null,
    caption: null,
    hashtags: [],
    layout: null,
    artwork_id: null,
    slide_keys: [],
    similarity: c.similarity ?? [],
    attempts: 0,
    next_attempt_at: null,
    error: null,
    cost_usd: 0,
    created_at: now,
    updated_at: now,
    completed_at: null,
  };
}
