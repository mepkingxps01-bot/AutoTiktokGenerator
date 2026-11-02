import sharp from "sharp";
import { BRAND } from "../brand";
import type { Motif } from "../types";
import { rng, type Rng } from "./random";

/**
 * Procedural (no-cost) artwork in the brand style. Used in MOCK mode, when the
 * image mode is "procedural", and as a fallback when AI image generation fails.
 */
const W = 1024;
const H = 1536;
const G = BRAND.colors.gold;

function motifSvg(motif: Motif, r: Rng): string {
  const cx = W / 2 + r.range(-80, 80);
  const cy = H * 0.38 + r.range(-60, 60);
  switch (motif) {
    case "candles": {
      let s = "";
      const n = 14;
      let p = 0.6;
      for (let i = 0; i < n; i++) {
        const x = 90 + i * ((W - 180) / (n - 1));
        const o = p;
        p = Math.max(0.2, Math.min(0.85, p + r.range(-0.12, 0.08) - i * 0.004));
        const top = H * Math.min(o, p);
        const h = Math.max(12, Math.abs(o - p) * H);
        s += `<line x1="${x}" x2="${x}" y1="${top - r.range(20, 70)}" y2="${top + h + r.range(20, 70)}" stroke="${G}" stroke-opacity="0.55" stroke-width="3"/>`;
        s += `<rect x="${x - 16}" y="${top}" width="32" height="${h}" rx="4" fill="${p < o ? G : "none"}" fill-opacity="${0.35 + i / n / 2}" stroke="${G}" stroke-width="3"/>`;
      }
      return s;
    }
    case "shield":
      return [0, 40, 80].map((d, i) => `<path d="M${cx} ${cy - 300 + d} L${cx + 240 - d} ${cy - 200 + d / 2} L${cx + 220 - d} ${cy + 80} Q${cx + 160 - d} ${cy + 260 - d} ${cx} ${cy + 340 - d} Q${cx - 160 + d} ${cy + 260 - d} ${cx - 220 + d} ${cy + 80} L${cx - 240 + d} ${cy - 200 + d / 2} Z" fill="${i === 2 ? G : "none"}" fill-opacity="0.12" stroke="${G}" stroke-opacity="${0.9 - i * 0.25}" stroke-width="${6 - i * 2}"/>`).join("");
    case "brain": {
      const nodes = Array.from({ length: 34 }, () => [cx + r.range(-300, 300), cy + r.range(-260, 260)] as const);
      let s = "";
      nodes.forEach(([x, y], i) => {
        const j = (i * 7 + 3) % nodes.length;
        const k = (i * 11 + 5) % nodes.length;
        s += `<line x1="${x}" y1="${y}" x2="${nodes[j][0]}" y2="${nodes[j][1]}" stroke="${G}" stroke-opacity="0.25" stroke-width="2"/>`;
        s += `<line x1="${x}" y1="${y}" x2="${nodes[k][0]}" y2="${nodes[k][1]}" stroke="${G}" stroke-opacity="0.15" stroke-width="2"/>`;
      });
      nodes.forEach(([x, y]) => (s += `<circle cx="${x}" cy="${y}" r="${r.range(4, 11)}" fill="${G}" fill-opacity="0.8"/>`));
      return s;
    }
    case "chess":
      return `<g fill="${G}" fill-opacity="0.18" stroke="${G}" stroke-width="5"><circle cx="${cx}" cy="${cy - 230}" r="70"/><path d="M${cx - 60} ${cy - 150} L${cx + 60} ${cy - 150} L${cx + 95} ${cy + 180} L${cx - 95} ${cy + 180} Z"/><rect x="${cx - 170}" y="${cy + 180}" width="340" height="70" rx="20"/><rect x="${cx - 210}" y="${cy + 250}" width="420" height="60" rx="20"/></g>`;
    case "compass": {
      let s = `<circle cx="${cx}" cy="${cy}" r="300" fill="none" stroke="${G}" stroke-width="5"/><circle cx="${cx}" cy="${cy}" r="250" fill="none" stroke="${G}" stroke-opacity="0.4" stroke-width="2"/>`;
      for (let i = 0; i < 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        const len = i % 9 === 0 ? 36 : 14;
        s += `<line x1="${cx + 300 * Math.cos(a)}" y1="${cy + 300 * Math.sin(a)}" x2="${cx + (300 - len) * Math.cos(a)}" y2="${cy + (300 - len) * Math.sin(a)}" stroke="${G}" stroke-width="3"/>`;
      }
      const a = r.range(-0.8, -0.3);
      s += `<polygon points="${cx + 230 * Math.cos(a)},${cy + 230 * Math.sin(a)} ${cx + 22 * Math.cos(a + 1.57)},${cy + 22 * Math.sin(a + 1.57)} ${cx - 120 * Math.cos(a)},${cy - 120 * Math.sin(a)} ${cx + 22 * Math.cos(a - 1.57)},${cy + 22 * Math.sin(a - 1.57)}" fill="${G}"/>`;
      return s;
    }
    case "target":
      return [320, 250, 180, 110, 40].map((rad, i) => `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="${i === 4 ? G : "none"}" stroke="${G}" stroke-opacity="${0.3 + i * 0.15}" stroke-width="${4 + i}"/>`).join("");
    case "scale":
      return `<g stroke="${G}" stroke-width="6" fill="none"><line x1="${cx}" y1="${cy - 280}" x2="${cx}" y2="${cy + 260}"/><line x1="${cx - 300}" y1="${cy - 180}" x2="${cx + 300}" y2="${cy - 220}"/><path d="M${cx - 380} ${cy + 20} Q${cx - 300} ${cy + 110} ${cx - 220} ${cy + 20}"/><path d="M${cx + 220} ${cy - 20} Q${cx + 300} ${cy + 70} ${cx + 380} ${cy - 20}"/><line x1="${cx - 300}" y1="${cy - 180}" x2="${cx - 380}" y2="${cy + 20}"/><line x1="${cx - 300}" y1="${cy - 180}" x2="${cx - 220}" y2="${cy + 20}"/><line x1="${cx + 300}" y1="${cy - 220}" x2="${cx + 220}" y2="${cy - 20}"/><line x1="${cx + 300}" y1="${cy - 220}" x2="${cx + 380}" y2="${cy - 20}"/><rect x="${cx - 160}" y="${cy + 260}" width="320" height="40" rx="12" fill="${G}" fill-opacity="0.2"/></g>`;
    case "mountain": {
      let s = "";
      for (let layer = 0; layer < 4; layer++) {
        const base = H * (0.42 + layer * 0.08);
        const pts: string[] = [`0,${H}`];
        for (let x = 0; x <= W; x += 64) pts.push(`${x},${base - Math.abs(Math.sin(x / 140 + layer)) * r.range(80, 220)}`);
        pts.push(`${W},${H}`);
        s += `<polygon points="${pts.join(" ")}" fill="${layer === 0 ? G : "#141416"}" fill-opacity="${layer === 0 ? 0.25 : 0.9}" stroke="${G}" stroke-opacity="${0.8 - layer * 0.18}" stroke-width="3"/>`;
      }
      return s;
    }
    case "waves": {
      let s = "";
      for (let i = 0; i < 18; i++) {
        const y0 = H * 0.2 + i * 34;
        let d = `M0 ${y0}`;
        for (let x = 0; x <= W; x += 32) d += ` L${x} ${y0 + Math.sin(x / (90 + i * 3) + i * 0.4) * (40 + i * 3)}`;
        s += `<path d="${d}" fill="none" stroke="${G}" stroke-opacity="${0.15 + (i / 18) * 0.6}" stroke-width="${2 + (i % 3)}"/>`;
      }
      return s;
    }
    case "lighthouse":
      return `<polygon points="${cx},${cy - 200} ${W},${cy - 420} ${W},${cy + 60}" fill="${G}" fill-opacity="0.16"/><g fill="#141416" stroke="${G}" stroke-width="5"><path d="M${cx - 50} ${cy - 160} L${cx + 50} ${cy - 160} L${cx + 90} ${cy + 380} L${cx - 90} ${cy + 380} Z"/><rect x="${cx - 60}" y="${cy - 250}" width="120" height="90" rx="10" fill="${G}" fill-opacity="0.85"/></g>`;
  }
}

export function proceduralArtworkSvg(motif: Motif, seed: string): string {
  const r = rng(`${seed}:${motif}`);
  const gx = r.range(0.3, 0.7) * 100;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="glow" cx="${gx}%" cy="36%" r="60%">
      <stop offset="0" stop-color="${G}" stop-opacity="0.28"/>
      <stop offset="0.5" stop-color="${G}" stop-opacity="0.05"/>
      <stop offset="1" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#121214"/><stop offset="1" stop-color="#050506"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  ${motifSvg(motif, r)}
</svg>`;
}

export async function renderProceduralArtwork(motif: Motif, seed: string): Promise<Buffer> {
  return sharp(Buffer.from(proceduralArtworkSvg(motif, seed))).png({ compressionLevel: 8 }).toBuffer();
}
