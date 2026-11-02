import sharp, { type OverlayOptions } from "sharp";
import { BRAND, SLIDE_HEIGHT as H, SLIDE_WIDTH as W, SLIDES_PER_CAROUSEL } from "../brand";
import { SLIDE_ROLE_LABELS, type CarouselScript, type LayoutVariant, type Slide } from "../types";
import { renderDiagram } from "./diagrams";
import { rng } from "./random";
import { fitText, layoutText, layoutToSvg, parseEmphasis, type TextLayout } from "./text";

const C = BRAND.colors;
const MARGIN = 88;
const CONTENT_W = W - MARGIN * 2;
/** Keep key content above the area TikTok covers with captions/buttons. */
const SAFE_BOTTOM = 1500;

export interface SlideRenderInput {
  script: CarouselScript;
  index: number; // 0-based
  layout: LayoutVariant;
  seed: string;
  artwork?: Buffer | null;
}

export interface SlidePlan {
  overlaySvg: string;
  backgroundSvg: string;
  artwork: { top: number; height: number; mode: "hero" | "faint" } | null;
  overflow: string[];
}

const SCALES = [1, 0.92, 0.85, 0.78, 0.72];

function backgroundSvg(layout: LayoutVariant, seed: string, index: number) {
  const r = rng(`${seed}:bg:${index}`);
  const gx = r.range(15, 85).toFixed(0);
  const gy = r.range(5, 40).toFixed(0);
  const pattern = r.pick(["grid", "dots", "diagonal", "none"] as const);
  let pat = "";
  if (pattern === "grid") {
    for (let x = 0; x <= W; x += 90) pat += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#FFFFFF" stroke-opacity="0.025"/>`;
    for (let y = 0; y <= H; y += 90) pat += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#FFFFFF" stroke-opacity="0.025"/>`;
  } else if (pattern === "dots") {
    for (let x = 45; x < W; x += 60) for (let y = 45; y < H; y += 60) pat += `<circle cx="${x}" cy="${y}" r="1.6" fill="#FFFFFF" fill-opacity="0.05"/>`;
  } else if (pattern === "diagonal") {
    for (let k = -H; k < W; k += 70) pat += `<line x1="${k}" y1="${H}" x2="${k + H}" y2="0" stroke="${C.gold}" stroke-opacity="0.025"/>`;
  }
  const frame =
    layout === "frame"
      ? `<rect x="36" y="36" width="${W - 72}" height="${H - 72}" rx="28" fill="none" stroke="${C.gold}" stroke-opacity="0.45" stroke-width="2"/>`
      : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="${C.charcoal}"/><stop offset="1" stop-color="${C.black}"/></linearGradient>
  <radialGradient id="glow" cx="${gx}%" cy="${gy}%" r="55%"><stop offset="0" stop-color="${C.gold}" stop-opacity="0.14"/><stop offset="1" stop-color="${C.gold}" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<rect width="${W}" height="${H}" fill="url(#glow)"/>
${pat}${frame}
</svg>`;
}

async function header(index: number) {
  const brand = await layoutText(
    [
      { text: "Dr.", color: C.white },
      { text: "Trader", color: C.gold },
    ],
    { size: 34, weight: "extrabold", maxWidth: 600, lineHeight: 1.2 },
  );
  const counter = await layoutText(`${String(index + 1).padStart(2, "0")} / ${String(SLIDES_PER_CAROUSEL).padStart(2, "0")}`, {
    size: 28,
    weight: "bold",
    maxWidth: 400,
    lineHeight: 1.2,
    letterSpacing: 2,
  }, C.grey);
  const y = 92;
  const mark = `<rect x="${MARGIN}" y="${y + 2}" width="44" height="44" rx="10" fill="${C.gold}"/><path d="M${MARGIN + 11} ${y + 34} L${MARGIN + 20} ${y + 22} L${MARGIN + 27} ${y + 28} L${MARGIN + 34} ${y + 12}" stroke="${C.black}" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  return mark + layoutToSvg(brand, MARGIN + 60, y - 2) + layoutToSvg(counter, W - MARGIN - counter.width, y + 4);
}

async function footer(index: number) {
  let dots = "";
  const total = SLIDES_PER_CAROUSEL;
  const dw = 46;
  const startX = MARGIN;
  for (let i = 0; i < total; i++) {
    dots += `<rect x="${startX + i * (dw + 10)}" y="1600" width="${dw}" height="6" rx="3" fill="${i <= index ? C.gold : "#3A3A3F"}"/>`;
  }
  const tag = await layoutText(BRAND.tagline, { size: 26, weight: "bold", maxWidth: 600, lineHeight: 1.2, letterSpacing: 1 }, C.grey);
  return dots + layoutToSvg(tag, W - MARGIN - tag.width, 1582);
}

interface Block {
  height: number;
  svg: (y: number) => string;
}

async function kickerBlock(slide: Slide, align: "left" | "center"): Promise<Block> {
  const text = (slide.kicker || SLIDE_ROLE_LABELS[slide.role]).toUpperCase();
  const ascii = /^[\x20-\x7E]*$/.test(text);
  const l = await layoutText(text, { size: ascii ? 28 : 32, weight: "bold", maxWidth: CONTENT_W, lineHeight: 1.3, letterSpacing: ascii ? 3 : 0, align }, C.gold);
  const lineW = 56;
  return {
    height: 54,
    svg: (y) => {
      if (align === "center") return layoutToSvg(l, MARGIN, y, CONTENT_W);
      return `<rect x="${MARGIN}" y="${y + 18}" width="${lineW}" height="4" fill="${C.gold}"/>` + layoutToSvg(l, MARGIN + lineW + 18, y);
    },
  };
}

async function headlineBlock(slide: Slide, align: "left" | "center", size: number, maxLines: number, scale: number): Promise<Block & { layout: TextLayout }> {
  const runs = parseEmphasis(slide.headline, C.white, C.gold);
  const layout = await fitText(runs, {
    size: Math.round(size * scale),
    minSize: Math.round(size * scale * 0.8),
    weight: "extrabold",
    maxWidth: CONTENT_W,
    lineHeight: 1.28,
    align,
    maxLines,
  });
  return { layout, height: layout.height, svg: (y) => layoutToSvg(layout, MARGIN, y, CONTENT_W) };
}

async function bodyBlock(slide: Slide, align: "left" | "center", scale: number): Promise<Block> {
  const size = Math.round(48 * scale);
  const items: Array<{ badge: TextLayout | null; layout: TextLayout }> = [];
  const indent = align === "center" ? 0 : 62;
  for (const raw of slide.body) {
    const m = align === "center" ? null : raw.match(/^\s*(\d+)[.)]\s*(.*)$/);
    const text = m ? m[2] : raw;
    const layout = await layoutText(parseEmphasis(text, "#E9E5DC", C.gold), {
      size,
      weight: "regular",
      maxWidth: CONTENT_W - indent,
      lineHeight: 1.5,
      align,
    });
    const badge = m ? await layoutText(m[1], { size: 26, weight: "extrabold", maxWidth: 100, lineHeight: 1 }, C.black) : null;
    items.push({ badge, layout });
  }
  const gap = Math.round(26 * scale);
  const height = items.reduce((h, it) => h + it.layout.height, 0) + gap * Math.max(0, items.length - 1);
  return {
    height,
    svg: (y0) => {
      let y = y0;
      let out = "";
      for (const it of items) {
        if (align !== "center") {
          const cy = y + size * 0.62;
          out += it.badge
            ? `<circle cx="${MARGIN + 22}" cy="${cy}" r="22" fill="${C.gold}"/>` + layoutToSvg(it.badge, MARGIN + 22 - it.badge.width / 2, cy - 18)
            : `<rect x="${MARGIN + 12}" y="${cy - 8}" width="16" height="16" rx="4" fill="${C.gold}"/>`;
        }
        out += layoutToSvg(it.layout, MARGIN + indent, y, CONTENT_W - indent);
        y += it.layout.height + gap;
      }
      return out;
    },
  };
}

async function highlightBlock(text: string, scale: number): Promise<Block> {
  const layout = await layoutText(parseEmphasis(text, C.gold, C.white), {
    size: Math.round(40 * scale),
    weight: "bold",
    maxWidth: CONTENT_W - 80,
    lineHeight: 1.4,
  });
  const padY = 30;
  const height = layout.height + padY * 2;
  return {
    height,
    svg: (y) =>
      `<rect x="${MARGIN}" y="${y}" width="${CONTENT_W}" height="${height}" rx="24" fill="${C.gold}" fill-opacity="0.09" stroke="${C.gold}" stroke-opacity="0.7" stroke-width="2"/>` +
      `<rect x="${MARGIN}" y="${y}" width="10" height="${height}" rx="5" fill="${C.gold}"/>` +
      layoutToSvg(layout, MARGIN + 44, y + padY),
  };
}

async function brandBlock(): Promise<Block> {
  const name = await layoutText(
    [
      { text: "Dr.", color: C.white },
      { text: "Trader", color: C.gold },
    ],
    { size: 72, weight: "extrabold", maxWidth: CONTENT_W, lineHeight: 1.2 },
  );
  const thai = await layoutText(BRAND.thaiName, { size: 40, weight: "bold", maxWidth: CONTENT_W, lineHeight: 1.3 }, C.white);
  const tag = await layoutText(BRAND.tagline, { size: 34, weight: "bold", maxWidth: CONTENT_W, lineHeight: 1.3, letterSpacing: 1 }, C.gold);
  const h = 60 + name.height + 14 + thai.height + 18 + tag.height + 50;
  return {
    height: h,
    svg: (y) =>
      `<rect x="${MARGIN}" y="${y}" width="${CONTENT_W}" height="${h}" rx="32" fill="#111113" stroke="${C.gold}" stroke-opacity="0.55" stroke-width="2"/>` +
      layoutToSvg(name, MARGIN + 50, y + 50) +
      layoutToSvg(thai, MARGIN + 50, y + 50 + name.height + 14) +
      layoutToSvg(tag, MARGIN + 50, y + 50 + name.height + 14 + thai.height + 18),
  };
}

async function disclaimerSvg() {
  const l = await layoutText(BRAND.disclaimer, { size: 24, weight: "regular", maxWidth: CONTENT_W, lineHeight: 1.4 }, C.grey);
  return layoutToSvg(l, MARGIN, 1530);
}

/** Plans one slide: returns the SVG layers and any overflow problems. */
export async function planSlide(input: SlideRenderInput): Promise<SlidePlan> {
  const slide = input.script.slides[input.index];
  const align: "left" | "center" = input.layout === "centered" ? "center" : "left";
  const isHook = slide.role === "hook";
  const isTakeaway = slide.role === "takeaway";
  const hasArt = !!input.artwork;
  const artwork = hasArt && isHook ? { top: 0, height: 1100, mode: "hero" as const } : hasArt && isTakeaway ? { top: 0, height: H, mode: "faint" as const } : null;

  let overflow: string[] = [];
  let content = "";
  for (const scale of SCALES) {
    overflow = [];
    const blocks: Array<{ block: Block; gapBefore: number }> = [];
    const kicker = await kickerBlock(slide, align);
    blocks.push({ block: kicker, gapBefore: 0 });
    const headline = await headlineBlock(slide, align, isHook ? 104 : 84, isHook ? 4 : 3, scale);
    if (headline.layout.overflow) overflow.push(`สไลด์ ${input.index + 1}: หัวข้อยาวเกินพื้นที่`);
    blocks.push({ block: headline, gapBefore: 18 });
    const body = await bodyBlock(slide, align, scale);
    if (slide.body.length) blocks.push({ block: body, gapBefore: 44 });
    if (slide.highlight) blocks.push({ block: await highlightBlock(slide.highlight, scale), gapBefore: 44 });
    if (isTakeaway) blocks.push({ block: await brandBlock(), gapBefore: 56 });

    const textHeight = blocks.reduce((h, b) => h + b.gapBefore + b.block.height, 0);
    const wantsDiagram = slide.diagram !== "none" && !isHook && !isTakeaway;
    const minDiagram = 420;

    let y: number;
    if (isHook) {
      // anchor the hook text to the lower part (artwork above), but keep it inside the safe area
      y = Math.max(hasArt ? 960 : 520, SAFE_BOTTOM - 40 - textHeight);
      if (!hasArt) y = Math.min(y, 640);
    } else if (!wantsDiagram) {
      // no diagram: center the text block vertically in the safe area
      y = Math.max(220, Math.round((220 + SAFE_BOTTOM) / 2 - textHeight / 2 - 40));
    } else {
      y = 220;
    }
    const bottom = y + textHeight;
    const diagramSpace = SAFE_BOTTOM - bottom - 70;
    if (bottom > SAFE_BOTTOM) overflow.push(`สไลด์ ${input.index + 1}: ข้อความยาวเกินพื้นที่ปลอดภัย`);
    if (wantsDiagram && diagramSpace < minDiagram) overflow.push(`สไลด์ ${input.index + 1}: เหลือพื้นที่ไม่พอสำหรับไดอะแกรม`);

    if (overflow.length && scale !== SCALES[SCALES.length - 1]) continue;

    let parts = "";
    let cursor = y;
    for (const b of blocks) {
      cursor += b.gapBefore;
      parts += b.block.svg(cursor);
      cursor += b.block.height;
    }
    if (wantsDiagram && diagramSpace >= 300) {
      const dh = Math.min(700, diagramSpace);
      const dy = cursor + 60;
      parts += `<rect x="${MARGIN - 20}" y="${dy - 20}" width="${CONTENT_W + 40}" height="${dh + 40}" rx="30" fill="#0E0E10" fill-opacity="0.85" stroke="#2C2C31" stroke-width="2"/>`;
      parts += await renderDiagram(slide.diagram, { x: MARGIN + 10, y: dy + 10, w: CONTENT_W - 20, h: dh - 60 }, input.seed);
    }
    // editorial: big outline slide number watermark
    if (input.layout === "editorial" && !isHook) {
      const num = await layoutText(String(input.index + 1).padStart(2, "0"), { size: 300, weight: "extrabold", maxWidth: 800, lineHeight: 1 }, "#FFFFFF");
      parts = `<g opacity="0.04">${layoutToSvg(num, W - MARGIN - num.width, 150)}</g>` + parts;
    }
    if (input.layout === "classic" && !isHook) {
      parts += `<rect x="${MARGIN - 40}" y="${y + 70}" width="6" height="${Math.min(260, headline.height)}" rx="3" fill="${C.gold}" fill-opacity="0.8"/>`;
    }
    content = parts;
    break;
  }

  // Overlay for artwork fades
  let fade = "";
  if (artwork?.mode === "hero") {
    fade = `<defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.black}" stop-opacity="0.55"/><stop offset="0.25" stop-color="${C.black}" stop-opacity="0"/><stop offset="1" stop-color="${C.black}" stop-opacity="0"/></linearGradient></defs><rect x="0" y="0" width="${W}" height="${artwork.height}" fill="url(#fade)"/>`;
  } else if (artwork?.mode === "faint") {
    fade = `<rect x="0" y="0" width="${W}" height="${H}" fill="${C.black}" fill-opacity="0.84"/>`;
  }

  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${fade}${await header(input.index)}${content}${isTakeaway ? await disclaimerSvg() : ""}${await footer(input.index)}</svg>`;
  return { overlaySvg: overlay, backgroundSvg: backgroundSvg(input.layout, input.seed, input.index), artwork, overflow };
}

/** Stage 6: deterministic rendering of one slide to a 1080x1920 PNG. */
export async function renderSlide(input: SlideRenderInput): Promise<{ png: Buffer; overflow: string[] }> {
  const plan = await planSlide(input);
  const layers: OverlayOptions[] = [];
  if (plan.artwork && input.artwork) {
    const h = plan.artwork.height;
    const mask =
      plan.artwork.mode === "hero"
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}"><defs><linearGradient id="m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset="0.6" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect width="${W}" height="${h}" fill="url(#m)"/></svg>`
        : null;
    let pipeline = sharp(input.artwork).resize(W, h, { fit: "cover", position: "centre" }).ensureAlpha();
    if (mask) pipeline = sharp(await pipeline.png().toBuffer()).composite([{ input: Buffer.from(mask), blend: "dest-in" }]);
    const art = await pipeline.png().toBuffer();
    layers.push({ input: art, top: plan.artwork.top, left: 0 });
  }
  layers.push({ input: Buffer.from(plan.overlaySvg), top: 0, left: 0 });
  const png = await sharp(Buffer.from(plan.backgroundSvg))
    .composite(layers)
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
  return { png, overflow: plan.overflow };
}

/** Used by validation: does every slide fit the template? */
export async function checkScriptFits(script: CarouselScript, layout: LayoutVariant, withArtwork: boolean): Promise<string[]> {
  const issues: string[] = [];
  const fakeArt = withArtwork ? Buffer.alloc(1) : null;
  for (let i = 0; i < script.slides.length; i++) {
    const plan = await planSlide({ script, index: i, layout, seed: "fit-check", artwork: fakeArt });
    issues.push(...plan.overflow);
  }
  return issues;
}

export function pickLayout(seed: string, avoid: LayoutVariant[] = []): LayoutVariant {
  const options: LayoutVariant[] = ["classic", "centered", "editorial", "frame"];
  const pool = options.filter((o) => !avoid.includes(o));
  return rng(`${seed}:layout`).pick(pool.length ? pool : options);
}
