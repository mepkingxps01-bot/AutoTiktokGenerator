import { NextResponse } from "next/server";
import { route } from "@/lib/http";
import { getStore } from "@/lib/store";
import { CATEGORIES, type Category, type TopicStatus } from "@/lib/types";

const STATUSES: TopicStatus[] = ["reserved", "completed", "failed", "discarded"];

export const GET = route(async (req) => {
  const sp = new URL(req.url).searchParams;
  const status = sp.get("status") as TopicStatus | null;
  const category = sp.get("category") as Category | null;
  const result = await getStore().listTopics({
    q: sp.get("q")?.slice(0, 100) || undefined,
    status: status && STATUSES.includes(status) ? status : undefined,
    category: category && CATEGORIES.includes(category) ? category : undefined,
    limit: Math.min(100, Math.max(1, Number(sp.get("limit") ?? 50) || 50)),
    offset: Math.max(0, Number(sp.get("offset") ?? 0) || 0),
  });
  return NextResponse.json({
    total: result.total,
    items: result.items.map(({ embedding: _e, ...t }) => t),
  });
});
