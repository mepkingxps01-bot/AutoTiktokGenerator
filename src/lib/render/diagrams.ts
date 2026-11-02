import { BRAND } from "../brand";
import type { DiagramKind } from "../types";
import { rng, type Rng } from "./random";
import { layoutText, layoutToSvg } from "./text";

/**
 * Deterministic trading diagrams drawn as SVG. Charts are illustrative
 * (hypothetical) and labelled as such; they never show real results.
 */

const C = BRAND.colors;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Candle {
  o: number;
  h: number;
  l: number;
  c: number;
}

async function label(
  text: string,
  x: number,
  y: number,
  opts: { size?: number; color?: string; weight?: "regular" | "bold" | "extrabold"; anchor?: "start" | "middle" | "end"; bg?: string } = {},
) {
  const size = opts.size ?? 30;
  const layout = await layoutText(text, { size, weight: opts.weight ?? "bold", maxWidth: 2000, lineHeight: 1.2 }, opts.color ?? C.white);
  const w = layout.width;
  const left = opts.anchor === "middle" ? x - w / 2 : opts.anchor === "end" ? x - w : x;
  const top = y - size * 0.95;
  const pad = size * 0.35;
  const bg = opts.bg
    ? `<rect x="${(left - pad).toFixed(1)}" y="${(top - pad * 0.5).toFixed(1)}" width="${(w + pad * 2).toFixed(1)}" height="${(size * 1.45 + pad * 0.6).toFixed(1)}" rx="${(size * 0.3).toFixed(1)}" fill="${opts.bg}"/>`
    : "";
  return bg + layoutToSvg(layout, left, top);
}

/** Price path through pivot values with small noise -> OHLC candles. */
function candlesFromPivots(pivots: number[], perLeg: number, r: Rng, vol = 0.012): Candle[] {
  const closes: number[] = [pivots[0]];
  for (let i = 1; i < pivots.length; i++) {
    for (let k = 1; k <= perLeg; k++) {
      const t = k / perLeg;
      const base = pivots[i - 1] + (pivots[i] - pivots[i - 1]) * t;
      closes.push(k === perLeg ? pivots[i] : base + r.range(-vol, vol));
    }
  }
  const out: Candle[] = [];
  for (let i = 1; i < closes.length; i++) {
    const o = closes[i - 1];
    const c = closes[i];
    out.push({ o, c, h: Math.max(o, c) + r.range(0.002, vol), l: Math.min(o, c) - r.range(0.002, vol) });
  }
  return out;
}

function drawCandles(candles: Candle[], box: Box, min: number, max: number, startX?: number, step?: number) {
  const n = candles.length;
  const st = step ?? box.w / (n + 1);
  const bw = Math.max(6, st * 0.58);
  const y = (p: number) => box.y + box.h - ((p - min) / (max - min)) * box.h;
  return candles
    .map((k, i) => {
      const cx = (startX ?? box.x + st) + i * st;
      const bull = k.c >= k.o;
      const top = y(Math.max(k.o, k.c));
      const bot = y(Math.min(k.o, k.c));
      const fill = bull ? C.gold : C.charcoal2;
      const stroke = bull ? C.gold : "#8E8A82";
      return (
        `<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${y(k.h).toFixed(1)}" y2="${y(k.l).toFixed(1)}" stroke="${stroke}" stroke-width="3"/>` +
        `<rect x="${(cx - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(3, bot - top).toFixed(1)}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`
      );
    })
    .join("");
}

function priceY(box: Box, min: number, max: number) {
  return (p: number) => box.y + box.h - ((p - min) / (max - min)) * box.h;
}

function hline(x1: number, x2: number, y: number, color: string, dash = true, width = 3) {
  return `<line x1="${x1.toFixed(1)}" x2="${x2.toFixed(1)}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${color}" stroke-width="${width}" ${dash ? 'stroke-dasharray="14 10"' : ""}/>`;
}

function polyline(points: Array<[number, number]>, color: string, width = 5) {
  return `<polyline points="${points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"/>`;
}

function arrow(x1: number, y1: number, x2: number, y2: number, color: string) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const s = 22;
  const p1 = [x2 - s * Math.cos(a - 0.45), y2 - s * Math.sin(a - 0.45)];
  const p2 = [x2 - s * Math.cos(a + 0.45), y2 - s * Math.sin(a + 0.45)];
  return (
    `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="5" stroke-linecap="round"/>` +
    `<polygon points="${x2.toFixed(1)},${y2.toFixed(1)} ${p1[0].toFixed(1)},${p1[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}" fill="${color}"/>`
  );
}

function zigzag(box: Box, values: number[], min: number, max: number) {
  const y = priceY(box, min, max);
  const step = box.w / (values.length - 1);
  return values.map((v, i) => [box.x + i * step, y(v)] as [number, number]);
}

type Builder = (box: Box, r: Rng) => Promise<string>;

const builders: Record<Exclude<DiagramKind, "none">, Builder> = {
  async market_structure(box, r) {
    const vals = [0.15, 0.42, 0.3, 0.6, 0.47, 0.8, 0.66, 0.92].map((v) => v + r.range(-0.03, 0.03));
    const pts = zigzag({ ...box, x: box.x + 30, w: box.w - 60, y: box.y + 60, h: box.h - 120 }, vals, 0, 1);
    const names = ["", "HH", "HL", "HH", "HL", "HH", "HL", "HH"];
    let svg = polyline(pts, C.gold);
    for (let i = 1; i < pts.length; i++) {
      const up = names[i] === "HH";
      svg += `<circle cx="${pts[i][0].toFixed(1)}" cy="${pts[i][1].toFixed(1)}" r="9" fill="${up ? C.gold : C.white}"/>`;
      svg += await label(names[i], pts[i][0], pts[i][1] + (up ? -24 : 54), { size: 28, anchor: "middle", color: up ? C.gold : C.white });
    }
    return svg;
  },

  async mss(box, r) {
    const pivots = [0.85, 0.55, 0.7, 0.35, 0.52, 0.18, 0.62, 0.45, 0.8];
    const candles = candlesFromPivots(pivots, 3, r);
    const inner = { ...box, y: box.y + 40, h: box.h - 80 };
    const y = priceY(inner, 0.05, 0.95);
    const step = inner.w / (candles.length + 1);
    const lhY = y(0.52);
    let svg = drawCandles(candles, inner, 0.05, 0.95);
    svg += hline(inner.x + step * 12, inner.x + inner.w, lhY, C.gold);
    svg += await label("LH", inner.x + step * 12, lhY - 16, { size: 28, color: C.white });
    svg += await label("MSS", inner.x + inner.w - 10, lhY - 18, { size: 32, color: C.black, anchor: "end", bg: C.gold });
    svg += await label("LL", inner.x + step * 15, y(0.12) + 46, { size: 28, color: C.white, anchor: "middle" });
    return svg;
  },

  async liquidity_sweep(box, r) {
    const pivots = [0.3, 0.7, 0.5, 0.7, 0.45, 0.7, 0.55, 0.82, 0.35, 0.2];
    const candles = candlesFromPivots(pivots, 2, r, 0.008);
    const inner = { ...box, y: box.y + 70, h: box.h - 110 };
    const y = priceY(inner, 0.1, 0.9);
    let svg = drawCandles(candles, inner, 0.1, 0.9);
    svg += hline(inner.x, inner.x + inner.w * 0.78, y(0.71), C.gold);
    svg += await label("Equal Highs = Liquidity", inner.x, y(0.71) - 22, { size: 28, color: C.gold });
    const step = inner.w / (candles.length + 1);
    svg += await label("Sweep", inner.x + step * 14, y(0.86) - 14, { size: 30, color: C.black, anchor: "middle", bg: C.gold });
    svg += arrow(inner.x + step * 15.5, y(0.6), inner.x + step * 17.5, y(0.3), C.white);
    return svg;
  },

  async fvg(box, r) {
    const pre = candlesFromPivots([0.3, 0.22, 0.3], 3, r, 0.01);
    const impulse: Candle[] = [
      { o: 0.3, c: 0.33, h: 0.35, l: 0.27 },
      { o: 0.33, c: 0.62, h: 0.64, l: 0.32 },
      { o: 0.62, c: 0.66, h: 0.7, l: 0.5 },
    ];
    const post = candlesFromPivots([0.66, 0.74, 0.47, 0.84], 2, r, 0.01);
    const candles = [...pre, ...impulse, ...post];
    const inner = { ...box, y: box.y + 40, h: box.h - 80 };
    const y = priceY(inner, 0.15, 0.92);
    const step = inner.w / (candles.length + 1);
    const gapTop = y(0.5);
    const gapBot = y(0.35);
    const gx = inner.x + step * (pre.length + 1) - step * 0.5;
    let svg = `<rect x="${gx.toFixed(1)}" y="${gapTop.toFixed(1)}" width="${(inner.x + inner.w - gx).toFixed(1)}" height="${(gapBot - gapTop).toFixed(1)}" fill="${C.gold}" fill-opacity="0.18" stroke="${C.gold}" stroke-opacity="0.6" stroke-dasharray="10 8" stroke-width="2"/>`;
    svg += drawCandles(candles, inner, 0.15, 0.92);
    svg += await label("FVG", inner.x + inner.w - 12, (gapTop + gapBot) / 2 + 12, { size: 32, color: C.black, anchor: "end", bg: C.gold });
    return svg;
  },

  async order_block(box, r) {
    const pre = candlesFromPivots([0.55, 0.4, 0.48, 0.32], 2, r, 0.01);
    const ob: Candle = { o: 0.36, c: 0.28, h: 0.37, l: 0.25 };
    const impulse = candlesFromPivots([0.28, 0.7], 3, r, 0.006);
    const post = candlesFromPivots([0.7, 0.4, 0.88], 3, r, 0.01);
    const candles = [...pre, ob, ...impulse, ...post];
    const inner = { ...box, y: box.y + 40, h: box.h - 80 };
    const y = priceY(inner, 0.15, 0.95);
    const step = inner.w / (candles.length + 1);
    const obX = inner.x + step * (pre.length + 1) - step * 0.5;
    let svg = `<rect x="${obX.toFixed(1)}" y="${y(0.37).toFixed(1)}" width="${(inner.x + inner.w - obX).toFixed(1)}" height="${(y(0.25) - y(0.37)).toFixed(1)}" fill="${C.gold}" fill-opacity="0.16" stroke="${C.gold}" stroke-width="2"/>`;
    svg += drawCandles(candles, inner, 0.15, 0.95);
    svg += hline(inner.x + step * 2, inner.x + inner.w, y(0.55), C.white);
    svg += await label("BOS", inner.x + step * 2, y(0.55) - 16, { size: 28, color: C.white });
    svg += await label("Order Block", inner.x + inner.w - 10, y(0.25) + 50, { size: 28, color: C.gold, anchor: "end" });
    return svg;
  },

  async multi_timeframe(box, r) {
    const gap = 30;
    const w = (box.w - gap) / 2;
    const left = { x: box.x, y: box.y + 60, w, h: box.h - 90 };
    const right = { x: box.x + w + gap, y: box.y + 60, w, h: box.h - 90 };
    let svg = `<rect x="${left.x}" y="${box.y}" width="${w}" height="${box.h}" rx="22" fill="${C.charcoal2}" fill-opacity="0.6"/>`;
    svg += `<rect x="${right.x}" y="${box.y}" width="${w}" height="${box.h}" rx="22" fill="${C.charcoal2}" fill-opacity="0.6"/>`;
    svg += await label("HTF (H4)", left.x + 24, box.y + 46, { size: 28, color: C.gold });
    svg += await label("LTF (M15)", right.x + 24, box.y + 46, { size: 28, color: C.gold });
    const zoneY = priceY(left, 0, 1);
    svg += `<rect x="${left.x + 10}" y="${zoneY(0.42)}" width="${w - 20}" height="${zoneY(0.28) - zoneY(0.42)}" fill="${C.gold}" fill-opacity="0.15"/>`;
    svg += polyline(zigzag({ ...left, x: left.x + 20, w: w - 40 }, [0.1, 0.55, 0.35, 0.8, 0.38], 0, 1), C.gold, 5);
    svg += drawCandles(candlesFromPivots([0.8, 0.4, 0.55, 0.25, 0.75], 2, r, 0.01), { ...right, x: right.x + 4, w: right.w - 8 }, 0.1, 0.9);
    svg += await label("Zone", left.x + w - 20, zoneY(0.28) + 40, { size: 26, color: C.gold, anchor: "end" });
    svg += await label("MSS", right.x + right.w - 20, right.y + 40, { size: 26, color: C.black, anchor: "end", bg: C.gold });
    return svg;
  },

  async risk_reward(box) {
    const x = box.x + 40;
    const w = box.w - 80;
    const entry = box.y + box.h * 0.62;
    const sl = box.y + box.h * 0.86;
    const tp = box.y + box.h * 0.14;
    let svg = `<rect x="${x}" y="${tp}" width="${w}" height="${entry - tp}" fill="${C.green}" fill-opacity="0.2" stroke="${C.green}" stroke-width="2"/>`;
    svg += `<rect x="${x}" y="${entry}" width="${w}" height="${sl - entry}" fill="${C.red}" fill-opacity="0.2" stroke="${C.red}" stroke-width="2"/>`;
    svg += hline(x, x + w, entry, C.white, false, 4);
    svg += await label("TP  (2R)", x + 24, tp + 50, { size: 32, color: C.white });
    svg += await label("Entry", x + 24, entry - 16, { size: 30, color: C.white });
    svg += await label("SL  (1R)", x + 24, sl - 18, { size: 30, color: C.white });
    svg += await label("RR 1 : 2", x + w - 24, (tp + entry) / 2 + 20, { size: 46, color: C.black, anchor: "end", bg: C.gold, weight: "extrabold" });
    return svg;
  },

  async position_sizing(box) {
    const cw = (box.w - 80) / 3;
    const cy = box.y + box.h / 2;
    const items = [
      ["Risk", "เงินที่ยอมเสีย"],
      ["SL", "ระยะ Stop Loss"],
      ["Lot", "ขนาดลอต"],
    ];
    let svg = "";
    for (let i = 0; i < 3; i++) {
      const x = box.x + i * (cw + 40);
      const hi = i === 2;
      svg += `<rect x="${x}" y="${cy - 150}" width="${cw}" height="300" rx="28" fill="${hi ? C.gold : C.charcoal2}" stroke="${C.gold}" stroke-width="3"/>`;
      svg += await label(items[i][0], x + cw / 2, cy - 10, { size: 64, color: hi ? C.black : C.gold, anchor: "middle", weight: "extrabold" });
      svg += await label(items[i][1], x + cw / 2, cy + 70, { size: 28, color: hi ? C.black : C.white, anchor: "middle", weight: "regular" });
      if (i < 2) svg += await label(i === 0 ? "÷" : "=", x + cw + 20, cy + 22, { size: 60, color: C.white, anchor: "middle" });
    }
    return svg;
  },

  async drawdown(box) {
    // Recovery math: a loss of L% needs L/(1-L) gain to break even (a mathematical fact, not a result claim).
    const rows = [10, 20, 30, 50];
    const rowH = (box.h - 70) / rows.length;
    let svg = await label("ขาดทุน  →  ต้องกำไรเท่าไรถึงคืนทุน", box.x, box.y + 36, { size: 30, color: C.grey, weight: "regular" });
    for (let i = 0; i < rows.length; i++) {
      const loss = rows[i];
      const need = Math.round((loss / (100 - loss)) * 100);
      const y = box.y + 70 + i * rowH;
      const barMax = box.w - 260;
      svg += await label(`-${loss}%`, box.x, y + rowH * 0.62, { size: 38, color: C.red, weight: "extrabold" });
      svg += `<rect x="${box.x + 150}" y="${y + rowH * 0.2}" width="${(barMax * need) / 100}" height="${rowH * 0.55}" rx="12" fill="${C.gold}" fill-opacity="${0.45 + i * 0.15}"/>`;
      svg += await label(`+${need}%`, box.x + 170 + (barMax * need) / 100, y + rowH * 0.62, { size: 36, color: C.white, weight: "bold" });
    }
    return svg;
  },

  async psychology_cycle(box) {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const rad = Math.min(box.w, box.h) * 0.36;
    const nodes = ["แพ้ 1 ไม้", "อารมณ์ร้อน", "เอาคืน / เพิ่มลอต", "แพ้หนักขึ้น"];
    let svg = `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="none" stroke="${C.gold}" stroke-opacity="0.35" stroke-width="4" stroke-dasharray="6 14"/>`;
    for (let i = 0; i < nodes.length; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 2;
      const nx = cx + rad * Math.cos(a);
      const ny = cy + rad * Math.sin(a);
      const a2 = a + Math.PI / 2 - 0.5;
      svg += arrow(cx + rad * Math.cos(a + 0.5), cy + rad * Math.sin(a + 0.5), cx + rad * Math.cos(a2), cy + rad * Math.sin(a2), C.gold);
      svg += await label(nodes[i], nx, ny + 12, { size: 30, color: i === 3 ? C.white : C.black, anchor: "middle", bg: i === 3 ? C.red : C.gold });
    }
    svg += await label("STOP", cx, cy + 22, { size: 56, color: C.white, anchor: "middle", weight: "extrabold" });
    return svg;
  },

  async checklist(box) {
    const items = ["HTF Bias ชัดเจน", "เห็น Liquidity / โซนสำคัญ", "มีจุดเข้าตามแผน", "Risk ไม่เกิน 1%"];
    const rowH = box.h / items.length;
    let svg = "";
    for (let i = 0; i < items.length; i++) {
      const y = box.y + i * rowH + rowH / 2;
      svg += `<rect x="${box.x + 10}" y="${y - 34}" width="68" height="68" rx="16" fill="${C.gold}"/>`;
      svg += `<polyline points="${box.x + 28},${y} ${box.x + 41},${y + 14} ${box.x + 62},${y - 14}" fill="none" stroke="${C.black}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`;
      svg += await label(items[i], box.x + 110, y + 14, { size: 38, color: C.white, weight: "bold" });
    }
    return svg;
  },
};

export async function renderDiagram(kind: DiagramKind, box: Box, seed: string): Promise<string> {
  if (kind === "none") return "";
  const r = rng(`${seed}:${kind}`);
  const body = await builders[kind](box, r);
  const note = ["risk_reward", "position_sizing", "drawdown", "psychology_cycle", "checklist"].includes(kind)
    ? ""
    : await label("ตัวอย่างประกอบการสอน (สมมติ)", box.x + box.w, box.y + box.h + 34, { size: 22, color: C.grey, anchor: "end", weight: "regular" });
  return `<g>${body}${note}</g>`;
}
