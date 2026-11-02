import "server-only";
import { after } from "next/server";
import { getConfig } from "../config";
import { runWorker } from "./worker";

/**
 * Process jobs after the response is sent (Vercel keeps the function alive up
 * to maxDuration). When work remains at the end of the time budget, chain a
 * fresh invocation of /api/worker so long batches finish without the browser.
 */
export function scheduleWorker(origin: string, jobId?: string) {
  after(async () => {
    try {
      const res = await runWorker({ jobId });
      if (res.moreWork) await chainWorker(origin, res.jobId);
    } catch (e) {
      console.error("[worker] failed", e);
    }
  });
}

export async function chainWorker(origin: string, jobId?: string) {
  const cfg = getConfig();
  const base = cfg.appUrl ?? origin;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cfg.workerSecret) headers["x-worker-secret"] = cfg.workerSecret;
  if (cfg.vercelBypassSecret) headers["x-vercel-protection-bypass"] = cfg.vercelBypassSecret;
  if (!cfg.workerSecret) {
    console.warn("[worker] WORKER_SECRET/CRON_SECRET not set: cannot chain; the dashboard poll or cron will resume the job");
    return;
  }
  try {
    // The worker route answers immediately and runs in after(), so this returns fast.
    await fetch(`${base}/api/worker`, { method: "POST", headers, body: JSON.stringify({ jobId }), signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    console.warn("[worker] chain request failed; polling/cron will resume", e);
  }
}
