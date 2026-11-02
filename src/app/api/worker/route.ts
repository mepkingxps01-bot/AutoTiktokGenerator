import { NextResponse, type NextRequest } from "next/server";
import { Errors } from "@/lib/errors";
import { isWorkerAuthorized, jsonError } from "@/lib/http";
import { scheduleWorker } from "@/lib/pipeline/kick";

export const maxDuration = 300;

/**
 * Durable worker entry point.
 * - GET: Vercel Cron (Authorization: Bearer CRON_SECRET) resumes stalled jobs.
 * - POST: chained self-invocation (x-worker-secret) or a dashboard "kick".
 * Responds immediately; the work runs in after() within maxDuration.
 */
async function handle(req: NextRequest) {
  try {
    if (!(await isWorkerAuthorized(req))) throw Errors.unauthorized();
    let jobId: string | undefined;
    if (req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { jobId?: unknown };
      if (typeof body.jobId === "string" && /^[0-9a-f-]{36}$/.test(body.jobId)) jobId = body.jobId;
    }
    scheduleWorker(new URL(req.url).origin, jobId);
    return NextResponse.json({ accepted: true }, { status: 202 });
  } catch (e) {
    return jsonError(e);
  }
}

export const GET = handle;
export const POST = handle;
