import type { Carousel, Job } from "../types";

export function assetUrl(key: string) {
  return `/api/assets/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export function serializeCarousel(c: Carousel) {
  return {
    id: c.id,
    jobId: c.job_id,
    position: c.position,
    version: c.version,
    stage: c.stage,
    status: c.status,
    title: c.title,
    category: c.category,
    angle: c.angle,
    learningObjective: c.learning_objective,
    caption: c.caption,
    hashtags: c.hashtags,
    layout: c.layout,
    error: c.error,
    attempts: c.attempts,
    similarity: c.similarity,
    costUsd: Number(c.cost_usd.toFixed(4)),
    slides: c.slide_keys.map((k) => `${assetUrl(k)}?v=${c.version}`),
    script: c.script ? { slides: c.script.slides.map((s) => ({ role: s.role, headline: s.headline, body: s.body })) } : null,
    completedAt: c.completed_at,
  };
}

export function serializeJob(j: Job) {
  return {
    id: j.id,
    mode: j.mode,
    status: j.status,
    stage: j.stage,
    input: j.input,
    error: j.error,
    estimatedCostUsd: Number(j.estimated_cost_usd.toFixed(4)),
    actualCostUsd: Number(j.actual_cost_usd.toFixed(4)),
    mock: j.mock,
    createdAt: j.created_at,
    startedAt: j.started_at,
    finishedAt: j.finished_at,
    working: !!j.lease_expires_at && j.lease_expires_at > new Date().toISOString(),
  };
}

export type CarouselDTO = ReturnType<typeof serializeCarousel>;
export type JobDTO = ReturnType<typeof serializeJob>;
