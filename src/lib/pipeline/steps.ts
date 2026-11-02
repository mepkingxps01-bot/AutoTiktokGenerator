import { randomUUID } from "node:crypto";
import type { AIProvider } from "../ai/types";
import { checkScriptFits, pickLayout, renderSlide } from "../render/slide";
import { renderProceduralArtwork } from "../render/artwork";
import { sanitizeScript, validateScript } from "../content/validate";
import { AppError, Errors, toAppError } from "../errors";
import type { Store } from "../store/types";
import { normalizeTopic, topicEmbeddingText } from "../topics/normalize";
import type { Carousel, CarouselScript, Job, Settings } from "../types";
import { ideateTopics } from "./ideation";
import { trackUsage } from "./usage";
import { addSeconds, nowIso } from "../time";

export interface StepContext {
  store: Store;
  ai: AIProvider;
  settings: Settings;
  maxAttempts: number;
}

export function slideKey(c: Pick<Carousel, "id" | "version">, index: number) {
  return `carousels/${c.id}/v${c.version}/slide-${String(index + 1).padStart(2, "0")}.png`;
}

/** Ensure the topic-history row for a carousel exists (resumable after crashes). */
async function ensureTopicRow(ctx: StepContext, job: Job, c: Carousel, script?: CarouselScript) {
  const rows = await ctx.store.getTopicsForCarousel(c.id);
  const existing = rows.find((t) => t.carousel_id === c.id && t.status !== "discarded" && t.status !== "failed");
  const title = c.title ?? script?.title ?? "";
  const patch = {
    category: script?.category ?? c.category,
    angle: script?.angle ?? c.angle,
    learning_objective: script?.learning_objective ?? c.learning_objective,
    summary: script?.summary ?? null,
  };
  if (existing) {
    await ctx.store.updateTopicsForCarousel(c.id, patch, ["reserved", "completed"]);
    return;
  }
  const emb = await ctx.ai.embed([topicEmbeddingText({ title, ...patch })]);
  await trackUsage(ctx.store, emb.usage, { jobId: job.id, carouselId: c.id, stage: "embedding", mock: job.mock });
  await ctx.store.insertTopic({
    carousel_id: c.id,
    job_id: job.id,
    title,
    normalized_topic: c.normalized_topic ?? normalizeTopic(title),
    ...patch,
    embedding: emb.embeddings[0],
    embedding_model: ctx.ai.embeddingModel,
    status: "reserved",
    source: job.mode,
  });
}

// ---------------------------------------------------------------------------
// Stage 1+2 (job level): ideation + duplicate detection
// ---------------------------------------------------------------------------
export async function runIdeation(ctx: StepContext, job: Job) {
  const all = await ctx.store.listCarousels(job.id);
  const pending = all.filter((c) => c.stage === "topic" && c.status === "queued");
  if (!pending.length) {
    await ctx.store.updateJob(job.id, { stage: "production" });
    return;
  }
  await ctx.store.updateJob(job.id, { ideation_attempts: job.ideation_attempts + 1 });
  const siblings = all.filter((c) => c.stage !== "topic" && c.status !== "cancelled");
  try {
    const result = await ideateTopics({ store: ctx.store, ai: ctx.ai, job, settings: ctx.settings, needed: pending.length, siblings });
    for (let i = 0; i < pending.length; i++) {
      const c = pending[i];
      const t = result.selected[i];
      if (!t) {
        await ctx.store.updateCarousel(c.id, c.version, {
          status: "failed",
          error: "หาหัวข้อที่ไม่ซ้ำกับคอนเทนต์เดิมไม่ได้ในรอบนี้ ลองกด 'ลองใหม่' หรือปรับเกณฑ์ความคล้ายในหน้าตั้งค่า",
        });
        continue;
      }
      const updated = await ctx.store.updateCarousel(c.id, c.version, {
        title: t.title,
        normalized_topic: t.normalized,
        category: t.category,
        angle: t.angle,
        learning_objective: t.learning_objective,
        stage: "script",
        similarity: t.nearest ? [t.nearest] : [],
      });
      if (!updated) continue; // superseded by a regenerate
      await ctx.store.insertTopic({
        carousel_id: c.id,
        job_id: job.id,
        title: t.title,
        normalized_topic: t.normalized,
        category: t.category,
        angle: t.angle,
        learning_objective: t.learning_objective,
        summary: null,
        embedding: t.embedding,
        embedding_model: ctx.ai.embeddingModel,
        status: "reserved",
        source: job.mode,
      });
    }
    await ctx.store.updateJob(job.id, { stage: "production", error: null });
  } catch (e) {
    const err = toAppError(e);
    if (!err.retryable || job.ideation_attempts + 1 >= ctx.maxAttempts) {
      for (const c of pending) await ctx.store.updateCarousel(c.id, c.version, { status: "failed", error: err.thaiMessage });
      await ctx.store.updateJob(job.id, { stage: "production", error: err.thaiMessage });
    } else {
      await ctx.store.updateJob(job.id, { error: `${err.thaiMessage} (กำลังลองใหม่)` });
    }
  }
}

// ---------------------------------------------------------------------------
// Stages 3+4 (carousel level): script generation + validation
// ---------------------------------------------------------------------------
async function scriptStep(ctx: StepContext, job: Job, c: Carousel): Promise<Partial<Carousel>> {
  let feedback: string[] | undefined;
  const siblings = await ctx.store.listCarousels(job.id);
  const neighbourLayouts = siblings.filter((s) => Math.abs(s.position - c.position) === 1 && s.layout).map((s) => s.layout!);
  const layout = pickLayout(`${c.id}:${c.version}`, neighbourLayouts);
  for (let attempt = 0; attempt < 2; attempt++) {
    const { script: raw, usage } = await ctx.ai.writeScript({
      title: c.title ?? "",
      category: c.category,
      angle: c.angle,
      learningObjective: c.learning_objective,
      feedback,
      variation: c.version * 10 + c.position + attempt,
    });
    await trackUsage(ctx.store, usage, { jobId: job.id, carouselId: c.id, stage: "script", mock: job.mock });
    const script = sanitizeScript(raw);
    const issues = validateScript(script);
    if (!issues.length) issues.push(...(await checkScriptFits(script, layout, true)));
    if (!issues.length) {
      await ensureTopicRow(ctx, job, c, script);
      return {
        script,
        title: c.title ?? script.title,
        normalized_topic: c.normalized_topic ?? normalizeTopic(script.title),
        category: c.category ?? script.category,
        angle: c.angle ?? script.angle,
        learning_objective: c.learning_objective ?? script.learning_objective,
        caption: script.caption,
        hashtags: script.hashtags,
        layout,
        stage: "illustrate",
      };
    }
    feedback = issues;
  }
  throw Errors.validation(feedback ?? []);
}

// ---------------------------------------------------------------------------
// Stage 5: illustration (reuse library artwork when possible)
// ---------------------------------------------------------------------------
async function illustrateStep(ctx: StepContext, job: Job, c: Carousel, finalAttempt: boolean): Promise<Partial<Carousel>> {
  const script = c.script!;
  const img = ctx.settings.images;
  if (img.mode === "procedural") return { artwork_id: null, stage: "render" };

  const siblings = await ctx.store.listCarousels(job.id);
  const siblingArt = siblings.map((s) => s.artwork_id).filter((x): x is string => !!x);
  if (img.reuseArtwork) {
    const reuse = await ctx.store.findReusableArtwork(c.category, script.illustration.motif, img.maxReusePerArtwork, siblingArt);
    if (reuse) {
      await ctx.store.incrementArtworkUse(reuse.id);
      return { artwork_id: reuse.id, stage: "render" };
    }
  }
  try {
    const { png, usage, source } = await ctx.ai.illustrate({
      motif: script.illustration.motif,
      category: c.category,
      prompt: script.illustration.prompt,
      quality: img.quality,
      seed: `${c.id}:${c.version}`,
    });
    await trackUsage(ctx.store, usage, { jobId: job.id, carouselId: c.id, stage: "image", mock: job.mock });
    const key = `artworks/${randomUUID()}.png`;
    await ctx.store.putBlob(key, png, "image/png");
    const art = await ctx.store.insertArtwork({
      category: c.category,
      motif: script.illustration.motif,
      source,
      prompt: script.illustration.prompt,
      storage_key: key,
    });
    await ctx.store.incrementArtworkUse(art.id);
    return { artwork_id: art.id, stage: "render" };
  } catch (e) {
    const err = toAppError(e);
    // Do not lose a finished script because of artwork: fall back to procedural art.
    if (!err.retryable || finalAttempt) return { artwork_id: null, stage: "render", error: `ใช้ภาพประกอบสำรอง: ${err.thaiMessage}` };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Stages 6+7: deterministic rendering + persistent storage
// ---------------------------------------------------------------------------
async function renderStep(ctx: StepContext, c: Carousel): Promise<Partial<Carousel>> {
  const script = c.script!;
  let artwork: Buffer | null = null;
  if (c.artwork_id) {
    const art = await ctx.store.getArtwork(c.artwork_id);
    artwork = art ? await ctx.store.getBlob(art.storage_key) : null;
  }
  if (!artwork) artwork = await renderProceduralArtwork(script.illustration.motif, `${c.id}:${c.version}`);
  const keys: string[] = [];
  for (let i = 0; i < script.slides.length; i++) {
    const { png } = await renderSlide({ script, index: i, layout: c.layout ?? "classic", seed: `${c.id}:${c.version}`, artwork });
    const key = slideKey(c, i);
    await ctx.store.putBlob(key, png, "image/png");
    keys.push(key);
  }
  return { slide_keys: keys, stage: "done", status: "completed", completed_at: nowIso(), next_attempt_at: null };
}

/**
 * Runs the next stage of one carousel. Each stage commits with a
 * compare-and-set on `version`, so completed work is never redone and a
 * regenerated carousel is never overwritten by a stale worker.
 */
export async function runCarouselStep(ctx: StepContext, job: Job, c: Carousel): Promise<void> {
  try {
    let patch: Partial<Carousel>;
    if (c.stage === "script") patch = await scriptStep(ctx, job, c);
    else if (c.stage === "illustrate") patch = await illustrateStep(ctx, job, c, c.attempts + 1 >= ctx.maxAttempts);
    else if (c.stage === "render") patch = await renderStep(ctx, c);
    else return;
    const stageChanged = patch.stage !== c.stage;
    const updated = await ctx.store.updateCarousel(c.id, c.version, {
      ...patch,
      attempts: stageChanged ? 0 : c.attempts,
      error: patch.error ?? null,
    });
    if (updated?.status === "completed") {
      await ctx.store.updateTopicsForCarousel(c.id, { status: "completed", completed_at: nowIso() }, ["reserved"]);
    }
  } catch (e) {
    await handleStepFailure(ctx, c, toAppError(e));
  }
}

async function handleStepFailure(ctx: StepContext, c: Carousel, err: AppError) {
  const attempts = c.attempts + 1;
  if (!err.retryable || attempts >= ctx.maxAttempts) {
    const updated = await ctx.store.updateCarousel(c.id, c.version, { attempts, status: "failed", error: err.thaiMessage, next_attempt_at: null });
    if (updated) await ctx.store.updateTopicsForCarousel(c.id, { status: "failed" }, ["reserved"]);
  } else {
    const backoff = Math.min(120, 5 * 2 ** attempts);
    await ctx.store.updateCarousel(c.id, c.version, {
      attempts,
      error: `${err.thaiMessage} (ลองใหม่ครั้งที่ ${attempts + 1}/${ctx.maxAttempts})`,
      next_attempt_at: addSeconds(nowIso(), backoff),
    });
  }
}

/** Marks the job finished when no carousel has work left. */
export async function finalizeJobIfDone(store: Store, jobId: string): Promise<boolean> {
  const job = await store.getJob(jobId);
  if (!job || !["queued", "running"].includes(job.status)) return true;
  if (job.stage === "ideation") return false;
  const carousels = await store.listCarousels(jobId);
  if (carousels.some((c) => c.status === "queued")) return false;
  const done = carousels.filter((c) => c.status === "completed").length;
  const status = done === carousels.length ? "completed" : done === 0 ? "failed" : "partial";
  await store.updateJob(jobId, {
    status,
    stage: "done",
    finished_at: nowIso(),
    error: status === "completed" ? null : `สำเร็จ ${done}/${carousels.length} carousel`,
    lease_owner: null,
    lease_expires_at: null,
  });
  return true;
}
