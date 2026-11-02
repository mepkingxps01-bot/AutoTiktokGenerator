import { SLIDE_ROLES, type CarouselScript } from "../types";
import { graphemeLength, stripEmphasis } from "../render/text";

/**
 * Stage 4: content validation. Structural rules, length limits, Thai-language
 * check and a compliance filter against profit promises / fabricated results.
 * Returns human-readable issues (fed back to the model on retry).
 */

export const LIMITS = {
  kicker: 28,
  headline: 64,
  bodyLine: 100,
  bodyLinesMin: 1,
  bodyLinesMax: 4,
  highlight: 70,
  caption: 400,
  hashtagsMin: 3,
  hashtagsMax: 10,
};

// Phrases that promise profit, guarantee results or imply real performance.
const BANNED_PATTERNS: Array<[RegExp, string]> = [
  [/การันตี|รับประกัน(ผล)?กำไร|กำไรแน่นอน|ไม่มีทางขาดทุน|ไม่มีขาดทุน/i, "ห้ามรับประกันผลกำไร"],
  [/รวยเร็ว|รวยไว|รวยง่าย|เงินง่าย|easy money|get rich/i, "ห้ามสื่อว่ารวยง่าย/รวยเร็ว"],
  [/ชนะทุกไม้|ไม่เคยแพ้|win\s*rate\s*(9\d|100)\s*%|100\s*%\s*(win|ชนะ|กำไร)/i, "ห้ามอ้างอัตราชนะที่เกินจริง"],
  [/กำไร\s*\d[\d,]*\s*(บาท|\$|usd|%)\s*(ต่อ|ใน)\s*(วัน|สัปดาห์|เดือน)/i, "ห้ามอ้างตัวเลขกำไรเป็นผลลัพธ์จริง"],
  [/พอร์ต(ผม|ของผม|ของเรา)\s*(โต|กำไร)|ผลงานจริง|สลิปกำไร/i, "ห้ามอ้างผลการเทรดจริง"],
  [/ซื้อเลยตอนนี้|ขายเลยตอนนี้|แจกสัญญาณ|สัญญาณเทรดฟรี|รับสัญญาณ/i, "ห้ามให้สัญญาณซื้อขาย"],
];

function thaiRatio(text: string) {
  const letters = text.replace(/[\s\d\p{P}\p{S}]/gu, "");
  if (!letters.length) return 0;
  const thai = (letters.match(/[฀-๿]/g) ?? []).length;
  return thai / letters.length;
}

export function validateScript(script: CarouselScript): string[] {
  const issues: string[] = [];
  if (script.slides.length !== 5) issues.push(`ต้องมี 5 สไลด์พอดี (ได้ ${script.slides.length})`);
  script.slides.forEach((s, i) => {
    const n = i + 1;
    if (SLIDE_ROLES[i] && s.role !== SLIDE_ROLES[i]) issues.push(`สไลด์ ${n} ต้องเป็น role "${SLIDE_ROLES[i]}" (ได้ "${s.role}")`);
    if (!stripEmphasis(s.headline).trim()) issues.push(`สไลด์ ${n}: ไม่มีหัวข้อ`);
    if (graphemeLength(s.headline) > LIMITS.headline) issues.push(`สไลด์ ${n}: headline ยาวเกิน ${LIMITS.headline} ตัวอักษร`);
    if (graphemeLength(s.kicker) > LIMITS.kicker) issues.push(`สไลด์ ${n}: kicker ยาวเกิน ${LIMITS.kicker} ตัวอักษร`);
    if (s.body.length < LIMITS.bodyLinesMin || s.body.length > LIMITS.bodyLinesMax)
      issues.push(`สไลด์ ${n}: body ต้องมี ${LIMITS.bodyLinesMin}-${LIMITS.bodyLinesMax} บรรทัด`);
    s.body.forEach((b, j) => {
      if (!b.trim()) issues.push(`สไลด์ ${n}: body บรรทัด ${j + 1} ว่าง`);
      if (graphemeLength(b) > LIMITS.bodyLine) issues.push(`สไลด์ ${n}: body บรรทัด ${j + 1} ยาวเกิน ${LIMITS.bodyLine} ตัวอักษร`);
    });
    if (s.highlight && graphemeLength(s.highlight) > LIMITS.highlight) issues.push(`สไลด์ ${n}: highlight ยาวเกิน ${LIMITS.highlight} ตัวอักษร`);
    if ((s.headline.match(/\*\*/g) ?? []).length % 2 !== 0) issues.push(`สไลด์ ${n}: เครื่องหมาย ** ไม่ครบคู่`);
    if ((s.role === "hook" || s.role === "takeaway") && s.diagram !== "none") issues.push(`สไลด์ ${n}: hook/takeaway ต้องใช้ diagram "none"`);
  });

  const allText = [
    script.title,
    ...script.slides.flatMap((s) => [s.kicker, s.headline, ...s.body, s.highlight ?? ""]),
    script.caption,
  ].join(" ");
  if (thaiRatio(allText) < 0.45) issues.push("เนื้อหาต้องเป็นภาษาไทยเป็นหลัก");
  for (const [re, msg] of BANNED_PATTERNS) if (re.test(allText)) issues.push(msg);

  if (!script.caption.trim()) issues.push("ไม่มี caption");
  if (graphemeLength(script.caption) > LIMITS.caption) issues.push(`caption ยาวเกิน ${LIMITS.caption} ตัวอักษร`);
  const tags = script.hashtags;
  if (tags.length < LIMITS.hashtagsMin || tags.length > LIMITS.hashtagsMax)
    issues.push(`hashtags ต้องมี ${LIMITS.hashtagsMin}-${LIMITS.hashtagsMax} รายการ`);
  if (tags.some((t) => !/^#[^\s#]+$/.test(t))) issues.push("hashtag ทุกตัวต้องขึ้นต้นด้วย # และไม่มีช่องว่าง");
  if (!script.summary.trim()) issues.push("ไม่มี summary");
  return [...new Set(issues)];
}

/** Light clean-up applied before validation (safe, deterministic fixes). */
export function sanitizeScript(script: CarouselScript): CarouselScript {
  const clean = (t: string) => t.replace(/[​-‍﻿]/g, "").replace(/\s+/g, " ").trim();
  const tags = [
    ...new Set(
      script.hashtags
        .map((t) => clean(t).replace(/\s+/g, ""))
        .filter(Boolean)
        .map((t) => (t.startsWith("#") ? t : `#${t}`)),
    ),
  ];
  if (!tags.some((t) => t.toLowerCase() === "#drtrader")) tags.unshift("#DrTrader");
  return {
    ...script,
    title: clean(script.title),
    caption: clean(script.caption.replace(/#[^\s#]+/g, "")),
    hashtags: tags.slice(0, LIMITS.hashtagsMax),
    slides: script.slides.map((s) => ({
      ...s,
      kicker: clean(s.kicker),
      headline: clean(s.headline),
      body: s.body.map(clean).filter(Boolean),
      highlight: s.highlight ? clean(s.highlight) || null : null,
    })),
  };
}
