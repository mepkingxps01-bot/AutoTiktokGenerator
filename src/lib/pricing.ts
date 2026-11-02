/**
 * API cost estimates in USD. These are configurable defaults, NOT authoritative
 * prices. Verify on https://openai.com/api/pricing and override with the
 * OPENAI_PRICING_JSON env var, e.g.
 *   {"gpt-5":{"input":1.25,"output":10},"gpt-image-1-mini":{"perImage":{"medium":0.015}}}
 * Text prices are per 1M tokens.
 */
export interface ModelPrice {
  input?: number;
  output?: number;
  /** image models: price per 1024x1536 image by quality */
  perImage?: Partial<Record<"low" | "medium" | "high", number>>;
  /** image models: token pricing when the API reports usage */
  imageOutput?: number;
}

const DEFAULT_PRICES: Record<string, ModelPrice> = {
  "gpt-5": { input: 1.25, output: 10 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "text-embedding-3-small": { input: 0.02 },
  "text-embedding-3-large": { input: 0.13 },
  "gpt-image-1": { input: 5, imageOutput: 40, perImage: { low: 0.016, medium: 0.063, high: 0.25 } },
  "gpt-image-1-mini": { input: 2, imageOutput: 8, perImage: { low: 0.006, medium: 0.015, high: 0.052 } },
};

let overrides: Record<string, ModelPrice> | null = null;
function prices(): Record<string, ModelPrice> {
  if (overrides === null) {
    try {
      overrides = process.env.OPENAI_PRICING_JSON ? (JSON.parse(process.env.OPENAI_PRICING_JSON) as Record<string, ModelPrice>) : {};
    } catch {
      overrides = {};
    }
  }
  return { ...DEFAULT_PRICES, ...overrides };
}

function lookup(model: string): { price: ModelPrice; known: boolean } {
  const p = prices();
  if (p[model]) return { price: p[model], known: true };
  // dated snapshots, e.g. gpt-5-mini-2025-08-07
  const base = Object.keys(p)
    .sort((a, b) => b.length - a.length)
    .find((k) => model.startsWith(k));
  if (base) return { price: p[base], known: true };
  return { price: p["gpt-5"], known: false };
}

export function textCost(model: string, inputTokens: number, outputTokens: number) {
  const { price, known } = lookup(model);
  const cost = ((price.input ?? 0) * inputTokens + (price.output ?? 0) * outputTokens) / 1_000_000;
  return { cost, estimated: !known };
}

export function imageCost(
  model: string,
  quality: "low" | "medium" | "high",
  usage?: { input_tokens?: number; output_tokens?: number },
) {
  const { price, known } = lookup(model);
  if (usage?.output_tokens && price.imageOutput) {
    return {
      cost: ((price.input ?? 0) * (usage.input_tokens ?? 0) + price.imageOutput * usage.output_tokens) / 1_000_000,
      estimated: !known,
    };
  }
  return { cost: price.perImage?.[quality] ?? 0.05, estimated: true };
}

export interface EstimateInput {
  carousels: number;
  ideation: boolean;
  textModel: string;
  ideationModel: string;
  imageModel: string;
  imageQuality: "low" | "medium" | "high";
  imageMode: "ai" | "procedural";
  /** share of carousels expected to reuse library artwork (0..1) */
  expectedReuse: number;
  mock: boolean;
}

/** Rough per-batch estimate (tokens include reasoning-token headroom). */
export function estimateCost(i: EstimateInput) {
  if (i.mock) return { totalUsd: 0, breakdown: { ideation: 0, scripts: 0, images: 0, embeddings: 0 } };
  const ideation = i.ideation ? textCost(i.ideationModel, 3500, 6000).cost : 0;
  const scripts = i.carousels * textCost(i.textModel, 2500, 5000).cost * 1.15; // ~15% validation retries
  const images =
    i.imageMode === "ai" ? i.carousels * (1 - Math.max(0, Math.min(1, i.expectedReuse))) * imageCost(i.imageModel, i.imageQuality).cost : 0;
  const embeddings = textCost("text-embedding-3-small", 6000, 0).cost;
  const totalUsd = ideation + scripts + images + embeddings;
  return { totalUsd: round(totalUsd), breakdown: { ideation: round(ideation), scripts: round(scripts), images: round(images), embeddings: round(embeddings) } };
}

function round(n: number) {
  return Math.round(n * 10_000) / 10_000;
}
