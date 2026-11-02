import type { Category, Settings, SimilarityMatch, TopicCandidate, TopicRecord } from "../types";
import { normalizeTopic } from "./normalize";

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface ScoredCandidate extends TopicCandidate {
  normalized: string;
  embedding: number[];
  /** highest similarity to a historical topic */
  historySimilarity: number;
  nearest?: SimilarityMatch;
  exactDuplicate: boolean;
  score: number;
  rejectedReason?: string;
}

export interface HistoryIndex {
  /** normalized topics that count as already used (completed or reserved) */
  normalized: Set<string>;
  /** nearest historical matches for an embedding */
  nearest(embedding: number[], count: number): SimilarityMatch[];
}

/** In-memory history index (used by the local store and in tests). */
export function buildHistoryIndex(history: TopicRecord[], embeddingModel: string): HistoryIndex {
  const active = history.filter((h) => h.status === "completed" || h.status === "reserved");
  return {
    normalized: new Set(active.map((h) => h.normalized_topic)),
    nearest(embedding, count) {
      return active
        .filter((h) => h.embedding && h.embedding_model === embeddingModel)
        .map((h) => ({
          topic_id: h.id,
          title: h.title,
          similarity: cosineSimilarity(embedding, h.embedding as number[]),
          exact: false,
          created_at: h.created_at,
        }))
        .sort((x, y) => y.similarity - x.similarity)
        .slice(0, count);
    },
  };
}

/**
 * Category rotation: categories used less recently get a bonus so the batch
 * keeps rotating through the curriculum. Returns 0..1.
 */
export function categoryFreshness(recent: Array<{ category: Category | null }>): (c: Category) => number {
  const window = recent.slice(0, 30);
  const counts = new Map<Category, number>();
  window.forEach((r, i) => {
    if (!r.category) return;
    // more recent usage weighs more
    counts.set(r.category, (counts.get(r.category) ?? 0) + (1 - i / (window.length + 1)));
  });
  const max = Math.max(1, ...counts.values());
  return (c) => 1 - (counts.get(c) ?? 0) / max;
}

export interface SelectionOptions {
  needed: number;
  rejectThreshold: number;
  batchThreshold: number;
  /** topics already chosen for this batch (e.g. sibling carousels when regenerating one) */
  alreadySelected?: Array<{ normalized: string; embedding: number[] | null; category: Category | null }>;
  freshness?: (c: Category) => number;
  /** prefer distinct categories in the batch (auto mode) */
  distinctCategories: boolean;
}

/**
 * Stage 2 duplicate detection + topic selection.
 * 1. exact normalized match against history -> reject
 * 2. semantic similarity against history >= rejectThreshold -> reject
 * 3. greedy pick by score, rejecting candidates too similar to already-picked ones
 * Semantic matching reduces repetition; it cannot guarantee perfect uniqueness.
 */
export function selectTopics(
  candidates: Array<TopicCandidate & { embedding: number[] }>,
  history: HistoryIndex,
  opts: SelectionOptions,
): { selected: ScoredCandidate[]; rejected: ScoredCandidate[] } {
  const fresh = opts.freshness ?? (() => 0.5);
  const scored: ScoredCandidate[] = candidates.map((c) => {
    const normalized = normalizeTopic(c.title);
    const nearest = history.nearest(c.embedding, 1)[0];
    const historySimilarity = nearest?.similarity ?? 0;
    const exactDuplicate = history.normalized.has(normalized);
    const edu = clamp01(c.educational_value / 10);
    const orig = clamp01(c.originality / 10);
    const score = 0.4 * edu + 0.25 * orig + 0.2 * fresh(c.category) + 0.15 * (1 - historySimilarity);
    return { ...c, normalized, historySimilarity, nearest, exactDuplicate, score };
  });

  const rejected: ScoredCandidate[] = [];
  const pool: ScoredCandidate[] = [];
  const seenNormalized = new Set<string>();
  for (const s of scored) {
    if (s.exactDuplicate) rejected.push({ ...s, rejectedReason: "ซ้ำกับหัวข้อที่เคยสร้าง (ตรงกันทุกคำ)" });
    else if (s.historySimilarity >= opts.rejectThreshold)
      rejected.push({ ...s, rejectedReason: `คล้ายหัวข้อเดิม ${(s.historySimilarity * 100).toFixed(0)}%: ${s.nearest?.title ?? ""}` });
    else if (seenNormalized.has(s.normalized)) rejected.push({ ...s, rejectedReason: "ซ้ำกับหัวข้ออื่นในชุดเดียวกัน" });
    else {
      seenNormalized.add(s.normalized);
      pool.push(s);
    }
  }

  pool.sort((a, b) => b.score - a.score);
  const selected: ScoredCandidate[] = [];
  const taken = [...(opts.alreadySelected ?? [])];
  const usedCategories = new Set(taken.map((t) => t.category).filter(Boolean) as Category[]);

  const tryPick = (requireNewCategory: boolean) => {
    for (const cand of pool) {
      if (selected.length >= opts.needed) return;
      if (selected.includes(cand) || rejected.includes(cand)) continue;
      if (requireNewCategory && usedCategories.has(cand.category)) continue;
      const tooClose = taken.find(
        (t) => t.normalized === cand.normalized || (t.embedding && cosineSimilarity(t.embedding, cand.embedding) >= opts.batchThreshold),
      );
      if (tooClose) {
        rejected.push({ ...cand, rejectedReason: "คล้ายหัวข้ออื่นในชุดเดียวกันมากเกินไป" });
        continue;
      }
      selected.push(cand);
      taken.push({ normalized: cand.normalized, embedding: cand.embedding, category: cand.category });
      usedCategories.add(cand.category);
    }
  };
  if (opts.distinctCategories) tryPick(true);
  tryPick(false);
  return { selected, rejected };
}

/** Matches for a custom topic: exact matches first, then semantic matches above the threshold. */
export function customTopicMatches(
  embeddingMatches: SimilarityMatch[],
  exactMatches: SimilarityMatch[],
  settings: Settings,
): SimilarityMatch[] {
  const out = new Map<string, SimilarityMatch>();
  for (const m of exactMatches) out.set(m.topic_id, { ...m, exact: true, similarity: 1 });
  for (const m of embeddingMatches) {
    if (m.similarity >= settings.similarity.warnThreshold && !out.has(m.topic_id)) out.set(m.topic_id, m);
  }
  return [...out.values()].sort((a, b) => b.similarity - a.similarity).slice(0, 5);
}

function clamp01(n: number) {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}
