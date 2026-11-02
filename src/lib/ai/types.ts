import type { CarouselScript, Category, Motif, TopicCandidate } from "../types";

export interface Usage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  images: number;
  costUsd: number;
  estimated: boolean;
}

export interface IdeationRequest {
  count: number;
  /** recent topics for context; the model should avoid them */
  recentTitles: string[];
  /** categories ordered from least to most recently used */
  preferredCategories: Category[];
  /** titles rejected in earlier rounds, with reasons */
  rejected: Array<{ title: string; reason: string }>;
  /** custom "5 angles" mode: the user's seed topic */
  seedTopic?: string;
}

export interface ScriptRequest {
  title: string;
  category: Category | null;
  angle: string | null;
  learningObjective: string | null;
  /** validation errors from a previous attempt */
  feedback?: string[];
  /** seed to vary mock output */
  variation: number;
}

export interface ImageRequest {
  motif: Motif;
  category: Category | null;
  prompt: string;
  quality: "low" | "medium" | "high";
  seed: string;
}

export interface AIProvider {
  readonly name: "openai" | "mock";
  readonly embeddingModel: string;
  ideate(req: IdeationRequest): Promise<{ candidates: TopicCandidate[]; usage: Usage }>;
  writeScript(req: ScriptRequest): Promise<{ script: CarouselScript; usage: Usage }>;
  embed(texts: string[]): Promise<{ embeddings: number[][]; usage: Usage }>;
  /** PNG bytes, portrait ~2:3 */
  illustrate(req: ImageRequest): Promise<{ png: Buffer; usage: Usage; source: "openai" | "procedural" | "mock" }>;
}
