import { randomUUID } from "node:crypto";
import { getAI } from "../ai";
import { getConfig } from "../config";
import { getStore } from "../store";
import type { Carousel } from "../types";
import { finalizeJobIfDone, runCarouselStep, runIdeation, type StepContext } from "./steps";

export interface WorkerResult {
  status: "idle" | "progressed" | "busy";
  jobId?: string;
  /** true when work remains and another invocation should be scheduled */
  moreWork: boolean;
  steps: number;
}

/** Leave this much time for a step that starts near the end of the budget. */
const MIN_STEP_WINDOW_MS = 90_000;

function isRunnable(c: Carousel, now: string) {
  return c.status === "queued" && ["script", "illustrate", "render"].includes(c.stage) && (!c.next_attempt_at || c.next_attempt_at <= now);
}

/**
 * Durable worker: claims a job lease, runs pipeline steps until the time budget
 * is used, then releases the lease. All progress lives in the database, so any
 * later invocation (chained call, cron, or dashboard poll) resumes where this
 * one stopped.
 */
export async function runWorker(opts: { jobId?: string; budgetMs?: number; minStepWindowMs?: number } = {}): Promise<WorkerResult> {
  const cfg = getConfig();
  const store = getStore();
  const budget = opts.budgetMs ?? cfg.worker.budgetMs;
  const minWindow = Math.min(opts.minStepWindowMs ?? MIN_STEP_WINDOW_MS, budget / 2);
  const workerId = `w-${randomUUID()}`;
  const start = Date.now();

  const job = opts.jobId
    ? await store.claimJobById(opts.jobId, workerId, cfg.worker.leaseSeconds)
    : await store.claimJob(workerId, cfg.worker.leaseSeconds);
  if (!job) return { status: opts.jobId ? "busy" : "idle", moreWork: false, steps: 0 };

  const ctx: StepContext = { store, ai: getAI(), settings: await store.getSettings(), maxAttempts: cfg.worker.maxAttempts };
  let steps = 0;
  let moreWork = true;
  try {
    while (Date.now() - start < budget - minWindow) {
      const current = await store.getJob(job.id);
      if (!current || !["queued", "running"].includes(current.status)) {
        moreWork = false;
        break;
      }
      if (current.stage === "ideation") {
        await runIdeation(ctx, current);
        steps++;
        continue;
      }
      const now = new Date().toISOString();
      const carousels = await store.listCarousels(job.id);
      if (carousels.some((c) => c.stage === "topic" && c.status === "queued")) {
        await store.updateJob(job.id, { stage: "ideation" });
        continue;
      }
      const runnable = carousels.filter((c) => isRunnable(c, now)).slice(0, cfg.worker.concurrency);
      if (!runnable.length) {
        const waiting = carousels.filter((c) => c.status === "queued" && c.next_attempt_at);
        if (waiting.length) {
          const next = Math.min(...waiting.map((c) => Date.parse(c.next_attempt_at!)));
          const wait = next - Date.now();
          if (Date.now() - start + wait < budget - minWindow) {
            await new Promise((r) => setTimeout(r, Math.max(0, wait) + 50));
            continue;
          }
          break; // retry later in another invocation
        }
        moreWork = !(await finalizeJobIfDone(store, job.id));
        break;
      }
      await Promise.all(runnable.map((c) => runCarouselStep(ctx, current, c)));
      steps += runnable.length;
      // extend the lease while we still work
      await store.claimJobById(job.id, workerId, cfg.worker.leaseSeconds);
    }
    if (moreWork) moreWork = !(await finalizeJobIfDone(store, job.id));
  } finally {
    await store.releaseJob(job.id, workerId).catch(() => undefined);
  }
  return { status: "progressed", jobId: job.id, moreWork, steps };
}

/** Is an active job stalled (no live lease)? Used by polling to resume work. */
export function isStalled(job: { status: string; lease_expires_at: string | null }) {
  return ["queued", "running"].includes(job.status) && (!job.lease_expires_at || job.lease_expires_at < new Date().toISOString());
}
