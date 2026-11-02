import { NextResponse } from "next/server";
import { route } from "@/lib/http";
import { batchEstimate } from "@/lib/pipeline/jobs";
import { getStore } from "@/lib/store";

export const GET = route(async (req) => {
  const sp = new URL(req.url).searchParams;
  const carousels = Math.min(5, Math.max(1, Number(sp.get("carousels") ?? 5) || 5));
  const ideation = sp.get("ideation") !== "false";
  const settings = await getStore().getSettings();
  return NextResponse.json({ estimate: batchEstimate(settings, carousels, ideation) });
});
