import { NextResponse } from "next/server";
import { z } from "zod";
import { serializeCarousel } from "@/lib/api/serialize";
import { rateLimit, readJson, route } from "@/lib/http";
import { regenerateCarousel } from "@/lib/pipeline/jobs";
import { scheduleWorker } from "@/lib/pipeline/kick";

export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };
const Body = z.object({ newTopic: z.boolean().optional() });

export const POST = route<Ctx>(async (req, { params }) => {
  const { id } = await params;
  await rateLimit("regenerate", req, 30, 3600);
  const body = Body.safeParse(await readJson(req).catch(() => ({})));
  const c = await regenerateCarousel(id, { newTopic: body.success ? !!body.data.newTopic : false });
  scheduleWorker(new URL(req.url).origin, c.job_id);
  return NextResponse.json({ carousel: serializeCarousel(c) });
});
