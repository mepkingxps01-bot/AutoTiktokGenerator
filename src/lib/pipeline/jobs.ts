import { getAI } from "../ai";
import { getConfig } from "../config";
import { Errors } from "../errors";
import { estimateCost } from "../pricing";
import { getStore } from "../store";
import type { NewCarousel } from "../store/types";
import { normalizeTopic, topicEmbeddingText } from "../topics/normalize";
import { customTopicMatches } from "../topics/similarity";
import { CAROUSELS_PER_BATCH } from "../brand";
import type { Carousel, Job, Settings, SimilarityMatch } from "../types";
import { trackUsage } from "./usage";

export const TOPIC_MIN = 4;
export const TOPIC_MAX = 140;

export function validateCustomTopic(raw: unknown): string {
  if (typeof raw !== "string") throw Errors.badInput("กรุณาระบุหัวข้อ");
  const topic = raw.normalize("NFC").replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
  if (topic.length < TOPIC_MIN) throw Errors.badInput(`หัวข้อสั้นเกินไป (อย่างน้อย ${TOPIC_MIN} ตัวอักษร)`);
  if (topic.length > TOPIC_MAX) throw Errors.badInput(`หัวข้อยาวเกินไป (ไม่เกิน ${TOPIC_MAX} ตัวอักษร)`);
  if (!/[฀-๿a-zA-Z]/.test(topic)) throw Errors.badInput("หัวข้อต้องมีตัวอักษรภาษาไทยหรืออังกฤษ");
  return topic;
}

/** Similarity check for a custom topic (exact + semantic). */
export async function checkTopicSimilarity(topic: string) {
  const store = getStore();
  const ai = getAI();
  const settings = await store.getSettings();
  const normalized = normalizeTopic(topic);
  const exact = await store.findExactTopics(normalized);
  const emb = await ai.embed([topicEmbeddingText({ title: topic })]);
  await trackUsage(store, emb.usage, { jobId: null, carouselId: null, stage: "similarity-check", mock: ai.name === "mock" });
  const semantic = await store.matchTopics(emb.embeddings[0], ai.embeddingModel, 5);
  const matches = customTopicMatches(semantic, exact, settings);
  return { normalized, matches, embedding: emb.embeddings[0], threshold: settings.similarity.warnThreshold };
}

export function batchEstimate(settings: Settings, carousels: number, ideation: boolean) {
  const cfg = getConfig();
  return estimateCost({
    carousels,
    ideation,
    textModel: cfg.openai.textModel,
    ideationModel: cfg.openai.ideationModel,
    imageModel: cfg.openai.imageModel,
    imageQuality: settings.images.quality,
    imageMode: settings.images.mode,
    expectedReuse: settings.images.reuseArtwork ? 0.3 : 0,
    mock: cfg.mockAi,
  });
}

export interface CreateJobRequest {
  mode: "auto" | "custom";
  topic?: string;
  angles?: boolean;
  overrideSimilarity?: boolean;
  idempotencyKey?: string | null;
}

export async function createGenerationJob(req: CreateJobRequest): Promise<{ job: Job; created: boolean; warnings: SimilarityMatch[] }> {
  const store = getStore();
  const ai = getAI();
  const settings = await store.getSettings();
  const mock = ai.name === "mock";
  let carousels: NewCarousel[];
  let warnings: SimilarityMatch[] = [];
  let topic: string | undefined;
  let embedding: number[] | undefined;

  if (req.mode === "custom") {
    topic = validateCustomTopic(req.topic);
    const check = await checkTopicSimilarity(topic);
    warnings = check.matches;
    embedding = check.embedding;
    if (warnings.length && !req.overrideSimilarity) throw Errors.similarTopic({ matches: warnings });
    carousels = req.angles
      ? Array.from({ length: CAROUSELS_PER_BATCH }, (_, i) => ({ position: i + 1, stage: "topic" as const }))
      : [{ position: 1, stage: "script", title: topic, normalized_topic: check.normalized, similarity: warnings }];
  } else {
    carousels = Array.from({ length: CAROUSELS_PER_BATCH }, (_, i) => ({ position: i + 1, stage: "topic" as const }));
  }

  const needsIdeation = carousels.some((c) => c.stage === "topic");
  const estimate = batchEstimate(settings, carousels.length, needsIdeation);
  const { job, created } = await store.createJob(
    {
      mode: req.mode,
      input: { topic, angles: !!req.angles, count: carousels.length, overrideSimilarity: !!req.overrideSimilarity },
      idempotency_key: req.idempotencyKey ?? null,
      estimated_cost_usd: estimate.totalUsd,
      mock,
    },
    carousels,
    settings.quotas,
  );

  // Custom single topic: reserve it in topic memory right away (the script step re-checks).
  if (created && topic && !req.angles && embedding) {
    const [c] = await store.listCarousels(job.id);
    await store.insertTopic({
      carousel_id: c.id,
      job_id: job.id,
      title: topic,
      normalized_topic: normalizeTopic(topic),
      category: null,
      angle: null,
      learning_objective: null,
      summary: null,
      embedding,
      embedding_model: ai.embeddingModel,
      status: "reserved",
      source: "custom",
    });
  }
  return { job, created, warnings };
}

/** Regenerate ONE carousel without touching the other four. */
export async function regenerateCarousel(carouselId: string, opts: { newTopic: boolean }): Promise<Carousel> {
  const store = getStore();
  const c = await store.getCarousel(carouselId);
  if (!c) throw Errors.notFound("carousel");
  const job = await store.getJob(c.job_id);
  if (!job) throw Errors.notFound("งาน");
  if (c.status === "queued") throw Errors.badInput("carousel นี้กำลังสร้างอยู่ กรุณารอให้เสร็จก่อน");
  if (opts.newTopic && job.mode === "custom" && !job.input.angles) {
    throw Errors.badInput("carousel จากหัวข้อที่ระบุเองสร้างใหม่ได้เฉพาะหัวข้อเดิม");
  }
  const settings = await store.getSettings();
  await store.reactivateJob(job.id); // throws if another job is active
  try {
    await store.consumeCarouselQuota(1, settings.quotas);
  } catch (e) {
    await restoreJobStatus(job.id);
    throw e;
  }

  const updated = await store.updateCarousel(c.id, c.version, {
    version: c.version + 1,
    status: "queued",
    stage: opts.newTopic ? "topic" : "script",
    attempts: 0,
    error: null,
    next_attempt_at: null,
    script: null,
    caption: null,
    hashtags: [],
    layout: null,
    artwork_id: null,
    slide_keys: [],
    completed_at: null,
    ...(opts.newTopic ? { title: null, normalized_topic: null, category: null, angle: null, learning_objective: null, similarity: [] } : {}),
  });
  if (!updated) throw Errors.badInput("carousel ถูกแก้ไขพร้อมกันจากที่อื่น กรุณารีเฟรชแล้วลองใหม่");
  if (opts.newTopic) {
    await store.updateTopicsForCarousel(c.id, { status: "discarded" });
    await store.updateJob(job.id, { stage: "ideation" });
  } else {
    await store.updateTopicsForCarousel(c.id, { status: "reserved", completed_at: null }, ["completed", "failed"]);
    await store.updateJob(job.id, { stage: "production" });
  }
  return updated;
}

/** Re-queue failed carousels; completed carousels are kept as they are. */
export async function retryJob(jobId: string) {
  const store = getStore();
  const job = await store.getJob(jobId);
  if (!job) throw Errors.notFound("งาน");
  const carousels = await store.listCarousels(jobId);
  const failed = carousels.filter((c) => c.status === "failed");
  if (!failed.length && !["queued", "running"].includes(job.status)) throw Errors.badInput("ไม่มี carousel ที่ล้มเหลวให้ลองใหม่");
  await store.reactivateJob(jobId);
  for (const c of failed) {
    await store.updateCarousel(c.id, c.version, { status: "queued", attempts: 0, error: null, next_attempt_at: null });
    await store.updateTopicsForCarousel(c.id, { status: "reserved" }, ["failed"]);
  }
  const needsIdeation = failed.some((c) => c.stage === "topic");
  await store.updateJob(jobId, { stage: needsIdeation ? "ideation" : "production", ideation_attempts: 0, error: null });
  return store.getJob(jobId);
}

export async function cancelJob(jobId: string) {
  const store = getStore();
  const job = await store.getJob(jobId);
  if (!job) throw Errors.notFound("งาน");
  if (!["queued", "running"].includes(job.status)) return job;
  const carousels = await store.listCarousels(jobId);
  for (const c of carousels.filter((x) => x.status === "queued")) {
    await store.updateCarousel(c.id, c.version, { status: "cancelled", error: "ยกเลิกโดยผู้ใช้" });
    await store.updateTopicsForCarousel(c.id, { status: "discarded" }, ["reserved"]);
  }
  const done = carousels.filter((c) => c.status === "completed").length;
  return store.updateJob(jobId, {
    status: done > 0 ? "partial" : "cancelled",
    stage: "done",
    finished_at: new Date().toISOString(),
    error: "ยกเลิกโดยผู้ใช้",
  });
}

async function restoreJobStatus(jobId: string) {
  const store = getStore();
  const carousels = await store.listCarousels(jobId);
  const done = carousels.filter((c) => c.status === "completed").length;
  await store.updateJob(jobId, {
    status: done === carousels.length ? "completed" : done ? "partial" : "failed",
    stage: "done",
    finished_at: new Date().toISOString(),
  });
}
