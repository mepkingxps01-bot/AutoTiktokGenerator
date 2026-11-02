import { NextResponse } from "next/server";
import { rateLimit, readJson, route } from "@/lib/http";
import { checkTopicSimilarity, validateCustomTopic } from "@/lib/pipeline/jobs";

export const POST = route(async (req) => {
  await rateLimit("topic-check", req, 60, 60);
  const body = await readJson<{ topic?: unknown }>(req);
  const topic = validateCustomTopic(body.topic);
  const { matches, threshold } = await checkTopicSimilarity(topic);
  return NextResponse.json({ topic, matches, threshold });
});
