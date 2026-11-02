import { BRAND } from "../brand";
import { CATEGORIES, CATEGORY_LABELS, DIAGRAMS, MOTIFS, SLIDE_ROLES } from "../types";
import type { IdeationRequest, ScriptRequest } from "./types";

const COMPLIANCE = `
Compliance rules (mandatory):
- Educational content only. Never promise profit, income, win rates, "easy money" or guaranteed results.
- Never fabricate trading performance, account screenshots or real results. Any example is clearly hypothetical ("ตัวอย่างสมมติ").
- No buy/sell signals, no "เข้าเลย", no urgency pressure. No misleading clickbait: the hook must be honest about what the carousel teaches.
- Always emphasise risk management and process over outcomes.`;

export const IDEATION_SYSTEM = `You are the head of curriculum for "${BRAND.name} / ${BRAND.thaiName}" (tagline "${BRAND.tagline}"),
a Thai trading-education brand on TikTok. Audience: Thai retail traders, beginner to intermediate (forex, gold/XAUUSD, indices, crypto).
You propose carousel topics. Each topic teaches ONE specific, concrete, practical idea.
Categories (use the ids): ${CATEGORIES.map((c) => `${c} = ${CATEGORY_LABELS[c]}`).join("; ")}.
Vary the teaching angle: misconception-busting, step-by-step checklist, comparison (A vs B), common mistake, mental model,
scenario walkthrough (hypothetical), definition-to-application, "how to verify", timeframe alignment, rules of thumb.
Titles are in Thai (English trading terms like MSS, FVG, Order Block, Liquidity, BOS, CHoCH, SL, RR are fine), ≤ 60 characters.
Score educational_value and originality from 1 to 10 honestly.
${COMPLIANCE}`;

export function ideationUser(req: IdeationRequest): string {
  const lines = [
    req.seedTopic
      ? `The user wants ${req.count} DIFFERENT teaching angles on this topic: "${req.seedTopic}". Every candidate must stay on this topic but teach a distinct sub-idea or angle.`
      : `Propose ${req.count} candidate topics. Rotate categories; prefer these (least recently used first): ${req.preferredCategories.join(", ")}.`,
    `Return exactly ${req.count} candidates, all mutually distinct.`,
  ];
  if (req.recentTitles.length) {
    lines.push(`Already published (do NOT repeat or closely paraphrase):\n${req.recentTitles.slice(0, 80).map((t) => `- ${t}`).join("\n")}`);
  }
  if (req.rejected.length) {
    lines.push(`Rejected in the previous round (too similar), avoid these directions:\n${req.rejected.slice(0, 30).map((r) => `- ${r.title} (${r.reason})`).join("\n")}`);
  }
  return lines.join("\n\n");
}

export const SCRIPT_SYSTEM = `You write Thai TikTok carousel scripts for "${BRAND.name} / ${BRAND.thaiName}" (tagline "${BRAND.tagline}").
Tone: calm, practical, premium, honest, like a senior trader mentoring a junior. Concise Thai suitable for mobile reading.
English trading terms are allowed (MSS, FVG, Order Block, Liquidity, BOS, CHoCH, HTF/LTF, SL, TP, RR, lot).

Structure: exactly 5 slides with roles in this order: ${SLIDE_ROLES.join(", ")}.
1 hook: attention-grabbing but honest headline that states a curiosity gap or problem. body: 1 short line.
2 foundation: explain the basic concept so a beginner understands. body: 2-3 lines.
3 insight: explain the underlying mechanism (WHY it works) with a concrete example. body: 2-3 lines.
4 application: how to apply it step by step (numbered steps are good). Choose a fitting diagram. body: 2-4 lines.
5 takeaway: summary + a relevant call to action (save / follow / comment a question). body: 2-3 lines.

Length limits (hard): kicker ≤ 24 chars (short Thai or English label), headline ≤ 56 chars, each body line ≤ 90 chars,
highlight ≤ 60 chars or null (a key phrase, rule or formula shown in a gold box).
Wrap 1-3 key words of a headline in **double asterisks** to colour them gold (optional, at most one pair per headline).
diagram: one of ${DIAGRAMS.join(", ")}. Use "none" for slides 1 and 5. Use a chart diagram on slide 4 when it helps, optionally on slide 3.
caption: 1-3 Thai sentences, ≤ 300 chars, no hashtags inside. hashtags: 5-8 items starting with #, must include #DrTrader.
illustration: motif from ${MOTIFS.join(", ")} and an English art-direction prompt (≤ 300 chars) for an abstract premium illustration WITHOUT any text, letters or numbers.
summary: 1-2 sentences (Thai) describing what the carousel teaches (stored for duplicate detection).
${COMPLIANCE}`;

export function scriptUser(req: ScriptRequest): string {
  const lines = [
    `Topic: ${req.title}`,
    req.category ? `Category: ${req.category}` : "Category: choose the best fitting id",
    req.angle ? `Teaching angle: ${req.angle}` : "Teaching angle: choose a clear, specific angle",
    req.learningObjective ? `Learning objective: ${req.learningObjective}` : "",
  ].filter(Boolean);
  if (req.feedback?.length) {
    lines.push(`Your previous draft failed validation. Fix ALL of these issues:\n${req.feedback.map((f) => `- ${f}`).join("\n")}`);
  }
  return lines.join("\n");
}

export function illustrationPrompt(motif: string, artDirection: string): string {
  return [
    "Premium minimalist financial-education illustration for a vertical social media slide.",
    "Deep black and charcoal background, refined gold accents (#F3BA2F), subtle glow, high contrast, clean modern aesthetic.",
    `Central motif: ${motif}. ${artDirection}`,
    "Composition: subject in the upper two thirds, calm negative space at the bottom, no clutter.",
    "Absolutely no text, no letters, no numbers, no logos, no watermarks, no people's faces, no currency symbols.",
  ].join(" ");
}

// ---------- JSON schemas for strict structured outputs ----------

export const IDEATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "category", "angle", "learning_objective", "educational_value", "originality", "rationale"],
        properties: {
          title: { type: "string" },
          category: { type: "string", enum: [...CATEGORIES] },
          angle: { type: "string" },
          learning_objective: { type: "string" },
          educational_value: { type: "number" },
          originality: { type: "number" },
          rationale: { type: "string" },
        },
      },
    },
  },
} as const;

export const SCRIPT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "category", "angle", "learning_objective", "summary", "slides", "caption", "hashtags", "illustration"],
  properties: {
    title: { type: "string" },
    category: { type: "string", enum: [...CATEGORIES] },
    angle: { type: "string" },
    learning_objective: { type: "string" },
    summary: { type: "string" },
    slides: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["role", "kicker", "headline", "body", "highlight", "diagram"],
        properties: {
          role: { type: "string", enum: [...SLIDE_ROLES] },
          kicker: { type: "string" },
          headline: { type: "string" },
          body: { type: "array", items: { type: "string" } },
          highlight: { type: ["string", "null"] },
          diagram: { type: "string", enum: [...DIAGRAMS] },
        },
      },
    },
    caption: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
    illustration: {
      type: "object",
      additionalProperties: false,
      required: ["motif", "prompt"],
      properties: {
        motif: { type: "string", enum: [...MOTIFS] },
        prompt: { type: "string" },
      },
    },
  },
} as const;
