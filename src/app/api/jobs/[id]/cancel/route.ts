import { NextResponse } from "next/server";
import { serializeJob } from "@/lib/api/serialize";
import { route } from "@/lib/http";
import { cancelJob } from "@/lib/pipeline/jobs";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (_req, { params }) => {
  const { id } = await params;
  const job = await cancelJob(id);
  return NextResponse.json({ job: serializeJob(job) });
});
