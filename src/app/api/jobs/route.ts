import { NextResponse } from "next/server";
import { z } from "zod";
import { serializeJob } from "@/lib/api/serialize";
import { Errors } from "@/lib/errors";
import { rateLimit, readJson, route } from "@/lib/http";
import { createGenerationJob } from "@/lib/pipeline/jobs";
import { scheduleWorker } from "@/lib/pipeline/kick";
import { getStore } from "@/lib/store";

export const maxDuration = 300;

const CreateSchema = z.object({
  mode: z.enum(["auto", "custom"]),
  topic: z.string().max(500).optional(),
  angles: z.boolean().optional(),
  overrideSimilarity: z.boolean().optional(),
  idempotencyKey: z.string().min(8).max(100).optional(),
});

export const GET = route(async (req) => {
  const limit = Math.min(50, Math.max(1, Number(new URL(req.url).searchParams.get("limit") ?? 20) || 20));
  const jobs = await getStore().listJobs(limit);
  return NextResponse.json({ jobs: jobs.map(serializeJob) });
});

export const POST = route(async (req) => {
  await rateLimit("create-job", req, 20, 3600);
  const parsed = CreateSchema.safeParse(await readJson(req));
  if (!parsed.success) throw Errors.badInput("ข้อมูลคำขอไม่ถูกต้อง", parsed.error.issues.map((i) => i.message));
  const idempotencyKey = parsed.data.idempotencyKey ?? req.headers.get("idempotency-key") ?? null;
  const { job, created, warnings } = await createGenerationJob({ ...parsed.data, idempotencyKey });
  scheduleWorker(new URL(req.url).origin, job.id);
  return NextResponse.json({ job: serializeJob(job), created, warnings }, { status: created ? 201 : 200 });
});
