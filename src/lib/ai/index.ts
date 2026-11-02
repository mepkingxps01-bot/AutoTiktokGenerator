import { getConfig } from "../config";
import { Errors } from "../errors";
import { MockProvider } from "./mock";
import { OpenAIProvider } from "./openai";
import type { AIProvider } from "./types";

const g = globalThis as unknown as { __drtraderAI?: AIProvider; __drtraderAIOverride?: AIProvider };

export function getAI(): AIProvider {
  if (g.__drtraderAIOverride) return g.__drtraderAIOverride;
  if (g.__drtraderAI) return g.__drtraderAI;
  const cfg = getConfig();
  if (cfg.mockAi) {
    g.__drtraderAI = new MockProvider();
  } else {
    if (!cfg.openai.apiKey) throw Errors.config("ไม่มี OPENAI_API_KEY (หรือเปิด MOCK_MODE=true)");
    g.__drtraderAI = new OpenAIProvider({
      apiKey: cfg.openai.apiKey,
      textModel: cfg.openai.textModel,
      ideationModel: cfg.openai.ideationModel,
      imageModel: cfg.openai.imageModel,
      embeddingModel: cfg.openai.embeddingModel,
      embeddingDimensions: cfg.openai.embeddingDimensions,
      reasoningEffort: cfg.openai.reasoningEffort,
      timeoutMs: cfg.openai.timeoutMs,
      maxRetries: cfg.openai.maxRetries,
    });
  }
  return g.__drtraderAI;
}

export function setAIForTests(ai: AIProvider | undefined) {
  g.__drtraderAIOverride = ai;
}

export type { AIProvider } from "./types";
