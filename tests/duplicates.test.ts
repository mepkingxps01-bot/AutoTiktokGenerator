import { describe, expect, it } from "vitest";
import { mockEmbedding } from "@/lib/ai/mock";
import { normalizeTopic } from "@/lib/topics/normalize";
import { buildHistoryIndex, categoryFreshness, cosineSimilarity, customTopicMatches, selectTopics } from "@/lib/topics/similarity";
import { DEFAULT_SETTINGS, type TopicCandidate, type TopicRecord } from "@/lib/types";

const cand = (title: string, category: TopicCandidate["category"] = "liquidity", edu = 8, orig = 8): TopicCandidate & { embedding: number[] } => ({
  title,
  category,
  angle: "a",
  learning_objective: "o",
  educational_value: edu,
  originality: orig,
  rationale: "",
  embedding: mockEmbedding(title),
});

const hist = (title: string, status: TopicRecord["status"] = "completed"): TopicRecord => ({
  id: title,
  carousel_id: null,
  job_id: null,
  title,
  normalized_topic: normalizeTopic(title),
  category: "liquidity",
  angle: null,
  learning_objective: null,
  summary: null,
  embedding: mockEmbedding(title),
  embedding_model: "mock-trigram-1536",
  status,
  source: "auto",
  created_at: new Date().toISOString(),
  completed_at: null,
});

describe("normalizeTopic", () => {
  it("treats punctuation, spacing, case and English synonyms as identical", () => {
    expect(normalizeTopic("ทำไม MSS ถึงสำคัญ?")).toBe(normalizeTopic("ทำไม  mss ถึงสำคัญ !!"));
    expect(normalizeTopic("วิธีใช้ Fair Value Gap")).toBe(normalizeTopic("วิธีใช้ FVG"));
    expect(normalizeTopic("Order Block คืออะไรครับ")).toBe(normalizeTopic("OB คืออะไร"));
  });
  it("keeps different topics different", () => {
    expect(normalizeTopic("FVG คืออะไร")).not.toBe(normalizeTopic("MSS คืออะไร"));
  });
});

describe("semantic similarity", () => {
  it("cosine similarity basics", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });
  it("mock embeddings score near-duplicates higher than unrelated topics", () => {
    const a = mockEmbedding("วิธีใช้ FVG ให้ถูกต้อง");
    const b = mockEmbedding("วิธีใช้ FVG ให้ถูกต้องสำหรับมือใหม่");
    const c = mockEmbedding("จิตวิทยาการเทรดหลังแพ้ติดกัน");
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.7);
    expect(cosineSimilarity(a, c)).toBeLessThan(0.3);
  });
});

describe("selectTopics (stage 2)", () => {
  const opts = { needed: 3, rejectThreshold: 0.88, batchThreshold: 0.85, distinctCategories: true };

  it("rejects exact duplicates of history", () => {
    const index = buildHistoryIndex([hist("Liquidity Sweep คืออะไร")], "mock-trigram-1536");
    const { selected, rejected } = selectTopics([cand("liquidity sweep คืออะไร?"), cand("FVG คืออะไร", "fair_value_gap")], index, opts);
    expect(selected.map((s) => s.title)).toEqual(["FVG คืออะไร"]);
    expect(rejected[0].rejectedReason).toMatch(/ตรงกันทุกคำ/);
  });

  it("rejects semantic near-duplicates of history above the threshold", () => {
    const index = buildHistoryIndex([hist("เสี่ยง 1% ต่อไม้ ทำไมพอร์ตถึงรอด")], "mock-trigram-1536");
    const { selected, rejected } = selectTopics(
      [cand("เสี่ยง 1% ต่อไม้ ทำไมพอร์ตถึงรอดได้", "risk_management"), cand("Order Block ที่ควรข้าม", "order_blocks")],
      index,
      { ...opts, rejectThreshold: 0.8 },
    );
    expect(selected.map((s) => s.title)).toEqual(["Order Block ที่ควรข้าม"]);
    expect(rejected[0].rejectedReason).toMatch(/คล้ายหัวข้อเดิม/);
  });

  it("ignores failed/discarded history and other embedding models", () => {
    const index = buildHistoryIndex([hist("FVG คืออะไร", "failed"), { ...hist("MSS คืออะไร"), embedding_model: "other" }], "mock-trigram-1536");
    const { selected } = selectTopics([cand("FVG คืออะไร", "fair_value_gap")], index, opts);
    expect(selected).toHaveLength(1);
    expect(index.nearest(mockEmbedding("MSS คืออะไร"), 1)).toHaveLength(0);
  });

  it("rejects candidates too similar to each other within the batch", () => {
    const index = buildHistoryIndex([], "m");
    const { selected } = selectTopics(
      [cand("วิธีใช้ FVG ให้ถูกต้อง", "fair_value_gap", 9), cand("วิธีใช้ FVG ให้ถูกต้องที่สุด", "fair_value_gap", 8), cand("Revenge Trade คืออะไร", "trading_psychology", 7)],
      index,
      { ...opts, batchThreshold: 0.7 },
    );
    expect(selected.map((s) => s.title)).toEqual(["วิธีใช้ FVG ให้ถูกต้อง", "Revenge Trade คืออะไร"]);
  });

  it("respects topics already selected for sibling carousels", () => {
    const index = buildHistoryIndex([], "m");
    const sib = { normalized: normalizeTopic("HTF บอกทิศ LTF บอกจังหวะ"), embedding: mockEmbedding("HTF บอกทิศ LTF บอกจังหวะ"), category: "multi_timeframe" as const };
    const { selected } = selectTopics([cand("HTF บอกทิศ LTF บอกจังหวะ", "multi_timeframe"), cand("Equal Highs คืออะไร")], index, { ...opts, alreadySelected: [sib] });
    expect(selected.map((s) => s.title)).toEqual(["Equal Highs คืออะไร"]);
  });

  it("prefers distinct categories and higher scores", () => {
    const index = buildHistoryIndex([], "m");
    const { selected } = selectTopics(
      [cand("Liquidity A", "liquidity", 10), cand("Liquidity B ต่างกันมาก", "liquidity", 9), cand("Psychology C", "trading_psychology", 5)],
      index,
      { ...opts, needed: 2 },
    );
    expect(selected.map((s) => s.category)).toEqual(["liquidity", "trading_psychology"]);
  });

  it("category freshness favours categories not used recently", () => {
    const fresh = categoryFreshness([{ category: "liquidity" }, { category: "liquidity" }, { category: "fair_value_gap" }]);
    expect(fresh("risk_management")).toBe(1);
    expect(fresh("liquidity")).toBeLessThan(fresh("fair_value_gap"));
  });
});

describe("custom topic warnings", () => {
  it("returns exact matches and semantic matches above the warn threshold only", () => {
    const now = new Date().toISOString();
    const matches = customTopicMatches(
      [
        { topic_id: "s1", title: "near", similarity: 0.9, exact: false, created_at: now },
        { topic_id: "s2", title: "far", similarity: 0.5, exact: false, created_at: now },
      ],
      [{ topic_id: "e1", title: "same", similarity: 1, exact: true, created_at: now }],
      DEFAULT_SETTINGS,
    );
    expect(matches.map((m) => m.topic_id)).toEqual(["e1", "s1"]);
  });
});
