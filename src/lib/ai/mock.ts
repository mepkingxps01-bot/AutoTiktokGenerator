import { createHash } from "node:crypto";
import { renderProceduralArtwork } from "../render/artwork";
import { normalizeTopic } from "../topics/normalize";
import { CATEGORIES, type CarouselScript, type Category, type TopicCandidate } from "../types";
import { LESSON_PACKS, MOCK_TOPICS } from "./mock-content";
import type { AIProvider, IdeationRequest, ImageRequest, ScriptRequest, Usage } from "./types";

const ZERO = (model: string): Usage => ({ model, inputTokens: 0, outputTokens: 0, images: 0, costUsd: 0, estimated: false });
export const MOCK_EMBEDDING_MODEL = "mock-trigram-1536";

/**
 * MOCK provider: no network calls, no cost. Deterministic output so the UI and
 * the pipeline can be tested end to end. Clearly labeled in the UI.
 */
export class MockProvider implements AIProvider {
  readonly name = "mock" as const;
  readonly embeddingModel = MOCK_EMBEDDING_MODEL;

  constructor(private readonly opts: { failRate?: number } = {}) {}

  private maybeFail(stage: string) {
    if (this.opts.failRate && Math.random() < this.opts.failRate) {
      throw new Error(`mock failure in ${stage}`);
    }
  }

  async ideate(req: IdeationRequest) {
    this.maybeFail("ideation");
    const used = new Set(req.recentTitles.map(normalizeTopic));
    const rejected = new Set(req.rejected.map((r) => normalizeTopic(r.title)));
    let pool: TopicCandidate[];
    if (req.seedTopic) {
      const seed = req.seedTopic.trim();
      const angles = [
        ["นิยามแบบเข้าใจง่าย", "definition-to-application"],
        ["ความเข้าใจผิดที่พบบ่อย", "misconception-busting"],
        ["เช็กลิสต์ใช้งานจริง", "checklist"],
        ["ตัวอย่างสมมติทีละขั้น", "scenario walkthrough"],
        ["ใช้ร่วมกับ Risk Management", "rules of thumb"],
        ["เปรียบเทียบแบบถูกและผิด", "comparison"],
        ["วิธีตรวจสอบก่อนใช้", "how to verify"],
        ["มุมมองจาก HTF ลง LTF", "timeframe alignment"],
        ["ข้อผิดพลาดที่ทำให้ขาดทุน", "common mistake"],
        ["สรุปกฎ 3 ข้อ", "rules of thumb"],
        ["คำถามที่มือใหม่ถามบ่อย", "FAQ"],
        ["แผนฝึกฝน 7 วัน", "practice plan"],
      ];
      const category = guessCategory(seed);
      pool = angles.map(([label, angle], i) => ({
        title: `${seed}: ${label}`,
        category,
        angle,
        learning_objective: `เข้าใจ "${seed}" ในมุม ${label}`,
        educational_value: 8 - (i % 3),
        originality: 7 + (i % 2),
        rationale: "mock angle",
      }));
    } else {
      pool = MOCK_TOPICS.filter((t) => !used.has(normalizeTopic(t.title)) && !rejected.has(normalizeTopic(t.title))).map((t, i) => ({
        ...t,
        educational_value: 7 + ((i * 7) % 3),
        originality: 6 + ((i * 5) % 4),
        rationale: "mock candidate",
      }));
      // When the curated list is exhausted, create numbered variations so mock mode never stalls.
      let n = 1;
      while (pool.length < req.count) {
        const base = MOCK_TOPICS[(n * 7) % MOCK_TOPICS.length];
        pool.push({ ...base, title: `${base.title} (ตอนที่ ${n + 1})`, educational_value: 6, originality: 5, rationale: "mock variation" });
        n++;
      }
    }
    return { candidates: pool.slice(0, Math.max(req.count, 10)), usage: ZERO("mock-ideation") };
  }

  async writeScript(req: ScriptRequest): Promise<{ script: CarouselScript; usage: Usage }> {
    this.maybeFail("script");
    const category: Category = req.category ?? guessCategory(req.title);
    const pack = LESSON_PACKS[category];
    const v = req.variation;
    const title = req.title.length > 50 ? req.title.slice(0, 50) : req.title;
    const script: CarouselScript = {
      title: req.title,
      category,
      angle: req.angle ?? "definition-to-application",
      learning_objective: req.learningObjective ?? `เข้าใจ ${title} และนำไปใช้ได้อย่างมีวินัย`,
      summary: `[MOCK] สอนเรื่อง ${title}: แนวคิดพื้นฐาน กลไก และขั้นตอนนำไปใช้ พร้อมการคุมความเสี่ยง`,
      slides: [
        {
          role: "hook",
          kicker: "[MOCK] DR.TRADER",
          headline: emphasize(title),
          body: [v % 2 ? "เรื่องที่เทรดเดอร์ส่วนใหญ่มองข้าม" : "เข้าใจเรื่องนี้ ช่วยลดความผิดพลาดได้มาก"],
          highlight: null,
          diagram: "none",
        },
        { role: "foundation", kicker: "พื้นฐาน", headline: "เริ่มจาก **พื้นฐาน** ก่อน", body: pack.foundation, highlight: null, diagram: "none" },
        { role: "insight", kicker: "กลไกสำคัญ", headline: "ทำไมมัน **ได้ผล**", body: pack.insight, highlight: pack.highlight, diagram: pack.diagram3 },
        { role: "application", kicker: "นำไปใช้", headline: "ใช้จริง **3 ขั้นตอน**", body: pack.application, highlight: null, diagram: pack.diagram4 },
        {
          role: "takeaway",
          kicker: "สรุป",
          headline: "รอดก่อน แล้วค่อย **โต**",
          body: ["ฝึกบนบัญชีทดลองก่อนใช้เงินจริงเสมอ", "เซฟโพสต์นี้ไว้ทบทวน แล้วคอมเมนต์คำถามได้เลย"],
          highlight: null,
          diagram: "none",
        },
      ],
      caption: `[MOCK] ${title} สรุปให้เข้าใจใน 5 สไลด์ เพื่อการศึกษาเท่านั้น`,
      hashtags: ["#DrTrader", "#เทรดเดอร์", "#สอนเทรด", "#SMC", "#RiskManagement"],
      illustration: { motif: pack.motif, prompt: `abstract ${pack.motif} illustration` },
    };
    return { script, usage: ZERO("mock-script") };
  }

  async embed(texts: string[]) {
    return { embeddings: texts.map(mockEmbedding), usage: ZERO(MOCK_EMBEDDING_MODEL) };
  }

  async illustrate(req: ImageRequest) {
    this.maybeFail("illustrate");
    const png = await renderProceduralArtwork(req.motif, req.seed);
    return { png, source: "mock" as const, usage: ZERO("mock-image") };
  }
}

function emphasize(title: string) {
  const words = title.split(" ");
  if (words.length < 2) return title;
  return `**${words[0]}** ${words.slice(1).join(" ")}`;
}

function guessCategory(text: string): Category {
  const t = text.toLowerCase();
  const rules: Array<[RegExp, Category]> = [
    [/fvg|fair value|ช่องว่าง/, "fair_value_gap"],
    [/order block|\bob\b|ออเดอร์บล็อก/, "order_blocks"],
    [/liquidity|sweep|สภาพคล่อง/, "liquidity"],
    [/mss|bos|choch|structure|โครงสร้าง/, "market_structure"],
    [/htf|ltf|timeframe|ไทม์เฟรม/, "multi_timeframe"],
    [/risk|ลอต|sl|ความเสี่ยง|rr/, "risk_management"],
    [/จิต|อารมณ์|fomo|psych|revenge/, "trading_psychology"],
    [/ขาดทุน|ผิดพลาด|mistake/, "trading_mistakes"],
    [/ict|smc|smart money/, "ict_smc"],
  ];
  return rules.find(([re]) => re.test(t))?.[1] ?? CATEGORIES[CATEGORIES.length - 1];
}

/** Hashed character-trigram embedding: similar strings -> high cosine similarity. */
export function mockEmbedding(text: string): number[] {
  const dims = 1536;
  const v = new Array<number>(dims).fill(0);
  const s = ` ${normalizeTopic(text)} `;
  const chars = [...s];
  for (let i = 0; i + 3 <= chars.length; i++) {
    const gram = chars.slice(i, i + 3).join("");
    const h = createHash("md5").update(gram).digest();
    const idx = h.readUInt32BE(0) % dims;
    v[idx] += h[4] & 1 ? 1 : -1;
  }
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / norm);
}
