import type { AIProvider } from "../ai/types";
import type { Store } from "../store/types";
import { topicEmbeddingText } from "../topics/normalize";
import { categoryFreshness, selectTopics, type HistoryIndex, type ScoredCandidate } from "../topics/similarity";
import { CATEGORIES, type Carousel, type Category, type Job, type Settings, type SimilarityMatch } from "../types";
import { trackUsage } from "./usage";

export interface IdeationResult {
  selected: ScoredCandidate[];
  rejected: ScoredCandidate[];
  rounds: number;
}

/**
 * Stages 1 + 2: propose >= 10 candidates, detect duplicates (exact, semantic vs
 * history, within batch), select distinct topics. Repeats with feedback when
 * too many candidates are rejected.
 */
export async function ideateTopics(params: {
  store: Store;
  ai: AIProvider;
  job: Job;
  settings: Settings;
  needed: number;
  siblings: Carousel[];
}): Promise<IdeationResult> {
  const { store, ai, job, settings, needed, siblings } = params;
  const angleMode = job.mode === "custom" && !!job.input.angles;
  const recent = await store.recentTopics(settings.ideation.historyWindow);
  const usedNormalized = await store.usedNormalizedTopics(10_000);
  const freshness = categoryFreshness(recent);
  const preferred = [...CATEGORIES].sort((a, b) => freshness(b) - freshness(a)) as Category[];
  const jobCarouselIds = siblings.map((s) => s.id);

  // Sibling topics already chosen in this batch
  const siblingTopics = siblings.filter((s) => s.title && s.normalized_topic);
  const siblingEmbeddings = siblingTopics.length
    ? (await ai.embed(siblingTopics.map((s) => topicEmbeddingText({ title: s.title!, category: s.category, angle: s.angle, learning_objective: s.learning_objective })))).embeddings
    : [];
  const alreadySelected = siblingTopics.map((s, i) => ({ normalized: s.normalized_topic!, embedding: siblingEmbeddings[i] ?? null, category: s.category }));

  const selected: ScoredCandidate[] = [];
  const rejected: ScoredCandidate[] = [];
  let rounds = 0;
  while (selected.length < needed && rounds < settings.ideation.maxRounds) {
    rounds++;
    const { candidates, usage } = await ai.ideate({
      count: Math.max(settings.ideation.candidateCount, needed * 2),
      recentTitles: recent.map((r) => r.title),
      preferredCategories: preferred,
      rejected: rejected.map((r) => ({ title: r.title, reason: r.rejectedReason ?? "" })),
      seedTopic: angleMode ? job.input.topic : undefined,
    });
    await trackUsage(store, usage, { jobId: job.id, carouselId: null, stage: "ideation", mock: job.mock });
    if (!candidates.length) continue;

    const emb = await ai.embed(candidates.map((c) => topicEmbeddingText(c)));
    await trackUsage(store, emb.usage, { jobId: job.id, carouselId: null, stage: "embedding", mock: job.mock });
    const withEmb = candidates.map((c, i) => ({ ...c, embedding: emb.embeddings[i] }));

    // Semantic matches against history (pgvector in production)
    const matches = new Map<number[], SimilarityMatch[]>();
    for (const c of withEmb) {
      const exclude = angleMode ? jobCarouselIds : [];
      matches.set(c.embedding, await store.matchTopics(c.embedding, ai.embeddingModel, 3, exclude));
    }
    const history: HistoryIndex = {
      normalized: usedNormalized,
      nearest: (e, count) => (matches.get(e) ?? []).slice(0, count),
    };
    const skipHistoryReject = angleMode && job.input.overrideSimilarity;
    const result = selectTopics(withEmb, history, {
      needed: needed - selected.length,
      rejectThreshold: skipHistoryReject ? 1.01 : settings.similarity.rejectThreshold,
      batchThreshold: angleMode ? settings.similarity.angleBatchThreshold : settings.similarity.batchThreshold,
      alreadySelected: [
        ...alreadySelected,
        ...selected.map((s) => ({ normalized: s.normalized, embedding: s.embedding, category: s.category })),
      ],
      freshness,
      distinctCategories: !angleMode,
    });
    selected.push(...result.selected);
    rejected.push(...result.rejected);
    for (const s of result.selected) usedNormalized.add(s.normalized);
  }
  return { selected, rejected, rounds };
}

