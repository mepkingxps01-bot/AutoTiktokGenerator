import type { Usage } from "../ai/types";
import type { Store } from "../store/types";

export async function trackUsage(
  store: Store,
  usage: Usage,
  ctx: { jobId: string | null; carouselId: string | null; stage: string; mock: boolean },
) {
  await store.recordUsage({
    job_id: ctx.jobId,
    carousel_id: ctx.carouselId,
    stage: ctx.stage,
    model: usage.model,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    images: usage.images,
    cost_usd: usage.costUsd,
    estimated: usage.estimated,
    mock: ctx.mock,
  });
  if (usage.costUsd > 0) await store.addCost(ctx.jobId, ctx.carouselId, usage.costUsd);
}
