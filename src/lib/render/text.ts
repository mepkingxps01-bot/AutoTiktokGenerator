import { loadFonts, type FontSet, type LoadedFont, type Weight } from "./fonts";

/**
 * Deterministic Thai typesetting:
 *  - HarfBuzz shapes text (correct placement of Thai vowels and tone marks)
 *  - Intl.Segmenter("th") finds word boundaries (Thai has no spaces between words)
 *  - Glyphs are emitted as SVG <path> outlines, so Sharp/librsvg needs no system fonts.
 */

export interface StyledRun {
  text: string;
  color: string;
}

export interface TextOptions {
  size: number;
  weight: Weight;
  maxWidth: number;
  lineHeight: number; // multiplier of font size
  align?: "left" | "center";
  letterSpacing?: number; // px
  maxLines?: number;
}

interface ShapedGlyph {
  font: LoadedFont;
  gid: number;
  x: number; // px offset within token
  dx: number;
  dy: number;
}

interface Token {
  text: string;
  color: string;
  isSpace: boolean;
  width: number;
  glyphs: ShapedGlyph[];
}

export interface LaidOutLine {
  tokens: Token[];
  width: number;
}

export interface TextLayout {
  lines: LaidOutLine[];
  width: number;
  height: number;
  lineAdvance: number;
  ascent: number;
  size: number;
  overflow: boolean;
  opts: TextOptions;
}

const wordSegmenter = new Intl.Segmenter("th", { granularity: "word" });
const graphemeSegmenter = new Intl.Segmenter("th", { granularity: "grapheme" });

/** Split "**gold** text" markup into colored runs. */
export function parseEmphasis(text: string, base: string, accent: string): StyledRun[] {
  const runs: StyledRun[] = [];
  const parts = text.split("**");
  parts.forEach((p, i) => {
    if (p) runs.push({ text: p, color: i % 2 === 1 ? accent : base });
  });
  return runs;
}

export function stripEmphasis(text: string) {
  return text.replace(/\*\*/g, "");
}

function sanitize(text: string) {
  return text
    .normalize("NFC")
    .replace(/[​-‍﻿]/g, "")
    .replace(/\s+/g, " ");
}

function shapeWithFont(fs: FontSet, lf: LoadedFont, text: string, size: number, letterSpacing: number) {
  const buf = new fs.hb.Buffer();
  buf.addText(text);
  buf.guessSegmentProperties();
  fs.hb.shape(lf.font, buf);
  const infos = buf.getGlyphInfos();
  const pos = buf.getGlyphPositions();
  const scale = size / lf.upem;
  const glyphs: ShapedGlyph[] = [];
  let x = 0;
  infos.forEach((g, i) => {
    glyphs.push({ font: lf, gid: g.codepoint, x, dx: pos[i].xOffset * scale, dy: pos[i].yOffset * scale });
    x += pos[i].xAdvance * scale;
    if (pos[i].xAdvance > 0) x += letterSpacing;
  });
  return { glyphs, width: x };
}

/** Shape a token, splitting into font runs (primary Thai font -> fallback Latin font). */
function shapeToken(fs: FontSet, text: string, weight: Weight, size: number, letterSpacing: number) {
  const { primary, fallback } = fs.get(weight);
  const pieces: Array<{ font: LoadedFont; text: string }> = [];
  for (const { segment } of graphemeSegmenter.segment(text)) {
    const cp = segment.codePointAt(0) ?? 32;
    const font = primary.hasChar(cp) ? primary : fallback.hasChar(cp) ? fallback : null;
    if (!font) continue; // unsupported glyph (e.g. emoji): drop instead of drawing tofu
    const last = pieces[pieces.length - 1];
    if (last && last.font === font) last.text += segment;
    else pieces.push({ font, text: segment });
  }
  const glyphs: ShapedGlyph[] = [];
  let width = 0;
  for (const p of pieces) {
    const shaped = shapeWithFont(fs, p.font, p.text, size, letterSpacing);
    for (const g of shaped.glyphs) glyphs.push({ ...g, x: g.x + width });
    width += shaped.width;
  }
  return { glyphs, width };
}

function tokenize(fs: FontSet, runs: StyledRun[], opts: TextOptions): Token[] {
  const tokens: Token[] = [];
  for (const run of runs) {
    for (const { segment } of wordSegmenter.segment(sanitize(run.text))) {
      const isSpace = /^\s+$/.test(segment);
      const shaped = shapeToken(fs, isSpace ? " " : segment, opts.weight, opts.size, opts.letterSpacing ?? 0);
      tokens.push({ text: segment, color: run.color, isSpace, ...shaped });
    }
  }
  return tokens;
}

/** Break a single over-long token by grapheme clusters. */
function splitLongToken(fs: FontSet, token: Token, opts: TextOptions): Token[] {
  const out: Token[] = [];
  let cur = "";
  for (const { segment } of graphemeSegmenter.segment(token.text)) {
    const next = cur + segment;
    const w = shapeToken(fs, next, opts.weight, opts.size, opts.letterSpacing ?? 0).width;
    if (cur && w > opts.maxWidth) {
      out.push({ ...token, text: cur, ...shapeToken(fs, cur, opts.weight, opts.size, opts.letterSpacing ?? 0) });
      cur = segment;
    } else cur = next;
  }
  if (cur) out.push({ ...token, text: cur, ...shapeToken(fs, cur, opts.weight, opts.size, opts.letterSpacing ?? 0) });
  return out;
}

export async function layoutText(input: string | StyledRun[], opts: TextOptions, defaultColor = "#FFFFFF"): Promise<TextLayout> {
  const fs = await loadFonts();
  const runs = typeof input === "string" ? [{ text: input, color: defaultColor }] : input;
  const tokens = tokenize(fs, runs, opts).flatMap((t) => (!t.isSpace && t.width > opts.maxWidth ? splitLongToken(fs, t, opts) : [t]));

  const lines: LaidOutLine[] = [];
  let cur: Token[] = [];
  let width = 0;
  const flush = () => {
    while (cur.length && cur[cur.length - 1].isSpace) width -= cur.pop()!.width;
    if (cur.length) lines.push({ tokens: cur, width });
    cur = [];
    width = 0;
  };
  for (const t of tokens) {
    if (t.text === "\n") {
      flush();
      continue;
    }
    if (!cur.length && t.isSpace) continue; // never start a line with a space
    if (width + t.width > opts.maxWidth && cur.length) {
      flush();
      if (t.isSpace) continue;
    }
    cur.push(t);
    width += t.width;
  }
  flush();

  const { primary } = fs.get(opts.weight);
  const scale = opts.size / primary.upem;
  const lineAdvance = opts.size * opts.lineHeight;
  const ascent = primary.ascender * scale;
  const overflow = opts.maxLines !== undefined && lines.length > opts.maxLines;
  return {
    lines,
    width: Math.max(0, ...lines.map((l) => l.width)),
    height: lines.length ? (lines.length - 1) * lineAdvance + opts.size * 1.25 : 0,
    lineAdvance,
    ascent,
    size: opts.size,
    overflow,
    opts,
  };
}

/**
 * Try decreasing font sizes until the text fits in maxLines/maxHeight.
 * Returns the last attempt (with overflow=true) if nothing fits.
 */
export async function fitText(
  input: string | StyledRun[],
  opts: TextOptions & { minSize: number; maxHeight?: number },
  defaultColor?: string,
): Promise<TextLayout> {
  let size = opts.size;
  let layout = await layoutText(input, { ...opts, size }, defaultColor);
  while ((layout.overflow || (opts.maxHeight !== undefined && layout.height > opts.maxHeight)) && size > opts.minSize) {
    size = Math.max(opts.minSize, size - 4);
    layout = await layoutText(input, { ...opts, size }, defaultColor);
  }
  const tooTall = opts.maxHeight !== undefined && layout.height > opts.maxHeight;
  return { ...layout, overflow: layout.overflow || tooTall };
}

function glyphPath(g: ShapedGlyph): string {
  let d = g.font.pathCache.get(g.gid);
  if (d === undefined) {
    d = g.font.font.glyphToPath(g.gid);
    g.font.pathCache.set(g.gid, d);
  }
  return d;
}

/** Emit SVG for a layout whose first line's top is at (x, y). */
export function layoutToSvg(layout: TextLayout, x: number, y: number, containerWidth?: number): string {
  const parts: string[] = [];
  layout.lines.forEach((line, i) => {
    const baseline = y + layout.ascent + i * layout.lineAdvance;
    let cx = x;
    if (layout.opts.align === "center" && containerWidth) cx = x + (containerWidth - line.width) / 2;
    for (const t of line.tokens) {
      if (!t.isSpace) {
        const paths: string[] = [];
        for (const g of t.glyphs) {
          const d = glyphPath(g);
          if (!d) continue;
          const s = layout.size / g.font.upem;
          const gx = cx + g.x + g.dx;
          const gy = baseline - g.dy;
          paths.push(`<path transform="translate(${gx.toFixed(2)} ${gy.toFixed(2)}) scale(${s.toFixed(5)} ${(-s).toFixed(5)})" d="${d}"/>`);
        }
        if (paths.length) parts.push(`<g fill="${t.color}">${paths.join("")}</g>`);
      }
      cx += t.width;
    }
  });
  return parts.join("");
}

/** Convenience: measure the width of a single line of text. */
export async function measureText(text: string, size: number, weight: Weight, letterSpacing = 0) {
  const l = await layoutText(text, { size, weight, maxWidth: 1e9, lineHeight: 1, letterSpacing });
  return l.width;
}

/** Grapheme count (what users perceive as characters) for length limits. */
export function graphemeLength(text: string) {
  let n = 0;
  for (const _ of graphemeSegmenter.segment(stripEmphasis(text))) n++;
  return n;
}
