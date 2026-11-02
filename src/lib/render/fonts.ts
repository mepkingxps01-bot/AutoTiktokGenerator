import { readFileSync } from "node:fs";
import path from "node:path";

export type Weight = "regular" | "bold" | "extrabold";

type HB = typeof import("harfbuzzjs");
type HBFont = InstanceType<HB["Font"]>;

export interface LoadedFont {
  name: string;
  font: HBFont;
  upem: number;
  ascender: number;
  descender: number;
  hasChar(cp: number): boolean;
  pathCache: Map<number, string>;
}

export interface FontSet {
  hb: HB;
  /** primary (Thai + basic Latin) and fallback (extended Latin/symbols) per weight */
  get(weight: Weight): { primary: LoadedFont; fallback: LoadedFont };
}

const FONT_FILES: Record<Weight, { primary: string; fallback: string }> = {
  regular: { primary: "NotoSansThai-Regular.ttf", fallback: "NotoSans-Regular.ttf" },
  bold: { primary: "NotoSansThai-Bold.ttf", fallback: "NotoSans-Bold.ttf" },
  extrabold: { primary: "NotoSansThai-ExtraBold.ttf", fallback: "NotoSans-Bold.ttf" },
};

export function fontDir() {
  // Fonts ship with the functions via outputFileTracingIncludes in next.config.ts.
  return process.env.FONT_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), "assets", "fonts");
}

let loading: Promise<FontSet> | null = null;

/** Loads HarfBuzz (WASM) and the bundled OFL fonts once per process. */
export function loadFonts(): Promise<FontSet> {
  if (!loading) {
    loading = (async () => {
      const hb = (await import("harfbuzzjs")) as HB;
      const cache = new Map<string, LoadedFont>();
      const load = (file: string): LoadedFont => {
        const hit = cache.get(file);
        if (hit) return hit;
        const data = readFileSync(path.join(/*turbopackIgnore: true*/ fontDir(), file));
        const blob = new hb.Blob(new Uint8Array(data));
        const face = new hb.Face(blob, 0);
        const font = new hb.Font(face);
        const ext = font.hExtents();
        const unicodes = new Set(face.collectUnicodes());
        const lf: LoadedFont = {
          name: file,
          font,
          upem: face.upem,
          ascender: ext.ascender,
          descender: ext.descender,
          hasChar: (cp) => unicodes.has(cp),
          pathCache: new Map(),
        };
        cache.set(file, lf);
        return lf;
      };
      return {
        hb,
        get(weight: Weight) {
          const f = FONT_FILES[weight];
          return { primary: load(f.primary), fallback: load(f.fallback) };
        },
      };
    })().catch((e) => {
      loading = null;
      throw e;
    });
  }
  return loading;
}
