import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MockProvider } from "@/lib/ai/mock";
import { renderSlide, checkScriptFits } from "@/lib/render/slide";
import { renderProceduralArtwork } from "@/lib/render/artwork";
import { layoutText, graphemeLength } from "@/lib/render/text";
import { LAYOUTS, type LayoutVariant } from "@/lib/types";

describe("thai text layout", () => {
  it("wraps Thai text at word boundaries without splitting clusters", async () => {
    const text = "ทำไมเทรดเดอร์ส่วนใหญ่ถึงขาดทุนทั้งที่วิเคราะห์ทิศทางถูกต้อง";
    const l = await layoutText(text, { size: 60, weight: "bold", maxWidth: 500, lineHeight: 1.3 });
    expect(l.lines.length).toBeGreaterThan(1);
    const rebuilt = l.lines.map((ln) => ln.tokens.map((t) => t.text).join("")).join("");
    expect(rebuilt).toBe(text);
    for (const line of l.lines) {
      expect(line.width).toBeLessThanOrEqual(500 + 0.01);
      // a line must never start with a Thai combining mark / following vowel
      expect(line.tokens[0].text).not.toMatch(/^[ัิ-ฺ็-๎ะาำๅ]/);
    }
  });

  it("counts graphemes, not code points", () => {
    expect(graphemeLength("ที่")).toBe(1);
    expect(graphemeLength("**FVG**")).toBe(3);
  });
});

describe("slide rendering", () => {
  it("renders 1080x1920 PNGs for every layout", async () => {
    const ai = new MockProvider();
    const { script } = await ai.writeScript({ title: "วิธีใช้ FVG ให้ถูกต้อง", category: "fair_value_gap", angle: null, learningObjective: null, variation: 1 });
    const art = await renderProceduralArtwork("candles", "test");
    const outDir = path.join(process.cwd(), ".data", "sample");
    if (process.env.RENDER_SAMPLE) mkdirSync(outDir, { recursive: true });
    for (const layout of LAYOUTS as readonly LayoutVariant[]) {
      expect(await checkScriptFits(script, layout, true)).toEqual([]);
      for (let i = 0; i < 5; i++) {
        if (!process.env.RENDER_SAMPLE && layout !== "classic" && i > 0) continue; // keep CI fast
        const { png, overflow } = await renderSlide({ script, index: i, layout, seed: `t-${layout}`, artwork: art });
        expect(overflow).toEqual([]);
        const meta = await sharp(png).metadata();
        expect(meta.width).toBe(1080);
        expect(meta.height).toBe(1920);
        expect(meta.format).toBe("png");
        if (process.env.RENDER_SAMPLE) writeFileSync(path.join(outDir, `${layout}-slide-0${i + 1}.png`), png);
      }
    }
  });

  it("is deterministic for the same seed", async () => {
    const ai = new MockProvider();
    const { script } = await ai.writeScript({ title: "เสี่ยง 1% ต่อไม้", category: "risk_management", angle: null, learningObjective: null, variation: 2 });
    const a = await renderSlide({ script, index: 3, layout: "frame", seed: "same" });
    const b = await renderSlide({ script, index: 3, layout: "frame", seed: "same" });
    expect(a.png.equals(b.png)).toBe(true);
  });

  it("reports overflow for text that cannot fit", async () => {
    const ai = new MockProvider();
    const { script } = await ai.writeScript({ title: "x", category: "liquidity", angle: null, learningObjective: null, variation: 0 });
    script.slides[1].body = Array.from({ length: 12 }, () => "ข้อความยาวมากเพื่อทดสอบการล้นพื้นที่ของสไลด์ ".repeat(3));
    const issues = await checkScriptFits(script, "classic", false);
    expect(issues.length).toBeGreaterThan(0);
  });
});
