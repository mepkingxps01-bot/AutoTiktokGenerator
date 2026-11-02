import { NextResponse } from "next/server";
import { serializeCarousel, serializeJob } from "@/lib/api/serialize";
import { Errors } from "@/lib/errors";
import { route } from "@/lib/http";
import { scheduleWorker } from "@/lib/pipeline/kick";
import { isStalled } from "@/lib/pipeline/worker";
import { getStore } from "@/lib/store";

export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const { id } = await params;
  const store = getStore();
  const job = await store.getJob(id);
  if (!job) throw Errors.notFound("งาน");
  const carousels = await store.listCarousels(id);
  // Polling doubles as a resume signal: if no worker holds the lease, continue the job.
  const resumed = isStalled(job);
  if (resumed) scheduleWorker(new URL(req.url).origin, job.id);
  return NextResponse.json({ job: serializeJob(job), carousels: carousels.map(serializeCarousel), resumed });
});
