import { NextResponse } from "next/server";
import { serializeJob } from "@/lib/api/serialize";
import { rateLimit, route } from "@/lib/http";
import { retryJob } from "@/lib/pipeline/jobs";
import { scheduleWorker } from "@/lib/pipeline/kick";

export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (req, { params }) => {
  const { id } = await params;
  await rateLimit("retry", req, 30, 3600);
  const job = await retryJob(id);
  scheduleWorker(new URL(req.url).origin, id);
  return NextResponse.json({ job: job ? serializeJob(job) : null });
});
