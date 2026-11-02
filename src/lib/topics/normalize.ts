/**
 * Topic normalization for exact-duplicate matching.
 * Maps common English trading terms to canonical abbreviations, strips
 * punctuation, whitespace and Thai polite/question particles.
 */

const SYNONYMS: Array<[RegExp, string]> = [
  [/smart\s*money\s*concepts?/g, "smc"],
  [/fair\s*value\s*gaps?/g, "fvg"],
  [/market\s*structure\s*shift/g, "mss"],
  [/break\s*of\s*structure/g, "bos"],
  [/change\s*of\s*character/g, "choch"],
  [/order\s*blocks?/g, "ob"],
  [/multi[\s-]*time\s*frames?(\s*analysis)?/g, "mtf"],
  [/risk\s*(to|:|\/)\s*reward/g, "rr"],
  [/risk\s*management/g, "riskmanagement"],
  [/stop\s*loss/g, "sl"],
  [/take\s*profit/g, "tp"],
  [/liquidity\s*sweeps?/g, "liquiditysweep"],
  [/สต็อปลอส|สตอปลอส/g, "sl"],
  [/ออเดอร์\s*บล็อก|ออเดอร์บล็อค/g, "ob"],
];

// Particles that do not change the meaning of a topic title.
const THAI_FILLERS = ["ครับ", "ค่ะ", "คะ", "นะ", "จ้า", "หรือไม่", "ไหม", "มั้ย", "กันแน่", "จริงๆ", "จริง ๆ"];

export function normalizeTopic(input: string): string {
  let s = input.normalize("NFC").toLowerCase().trim();
  for (const [re, rep] of SYNONYMS) s = s.replace(re, rep);
  for (const f of THAI_FILLERS) s = s.split(f).join(" ");
  // Keep Thai letters/marks (U+0E00–U+0E7F), latin letters and digits only.
  s = s.replace(/[^฀-๿a-z0-9]+/g, "");
  // Thai repetition mark and stray zero-width chars
  s = s.replace(/ๆ/g, "").replace(/[​-‍﻿]/g, "");
  return s;
}

/** Text used for embeddings: richer than the title alone so angle/objective count. */
export function topicEmbeddingText(t: {
  title: string;
  category?: string | null;
  angle?: string | null;
  learning_objective?: string | null;
}): string {
  return [t.title, t.angle, t.learning_objective, t.category].filter(Boolean).join(" | ");
}

export function slugify(input: string, max = 40): string {
  const ascii = normalizeTopic(input).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return (ascii || "carousel").slice(0, max);
}
