import OpenAI from "openai";
import { AppError, Errors } from "../errors";
import { imageCost, textCost } from "../pricing";
import { ScriptSchema, TopicCandidateSchema, type CarouselScript, type TopicCandidate } from "../types";
import { z } from "zod";
import {
  IDEATION_JSON_SCHEMA,
  IDEATION_SYSTEM,
  SCRIPT_JSON_SCHEMA,
  SCRIPT_SYSTEM,
  ideationUser,
  illustrationPrompt,
  scriptUser,
} from "./prompts";
import type { AIProvider, IdeationRequest, ImageRequest, ScriptRequest, Usage } from "./types";

interface OpenAIOptions {
  apiKey: string;
  textModel: string;
  ideationModel: string;
  imageModel: string;
  embeddingModel: string;
  embeddingDimensions: number;
  reasoningEffort: string;
  timeoutMs: number;
  maxRetries: number;
}

const MOTIF_DESCRIPTIONS: Record<string, string> = {
  candles: "elegant abstract candlestick chart rising and falling with soft gold light",
  shield: "a sleek protective shield symbolising capital protection",
  brain: "an abstract geometric brain made of fine gold lines symbolising discipline",
  chess: "a minimalist chess piece on a dark board symbolising strategy",
  compass: "a precise compass symbolising direction and planning",
  target: "a minimalist target with concentric gold rings symbolising precision",
  scale: "a balanced scale symbolising risk versus reward",
  mountain: "layered dark mountains with a gold ridge line symbolising market structure",
  waves: "flowing gold liquidity waves on black",
  lighthouse: "a lighthouse beam cutting through darkness symbolising guidance",
};

/** OpenAI implementation: Responses API with strict JSON schema, Images API, Embeddings API. */
export class OpenAIProvider implements AIProvider {
  readonly name = "openai" as const;
  readonly embeddingModel: string;
  private readonly client: OpenAI;

  constructor(private readonly o: OpenAIOptions) {
    this.client = new OpenAI({ apiKey: o.apiKey, timeout: o.timeoutMs, maxRetries: o.maxRetries });
    this.embeddingModel = o.embeddingModel;
  }

  private reasoningFor(model: string) {
    return /^(gpt-5|o\d)/.test(model) && this.o.reasoningEffort !== "none"
      ? { reasoning: { effort: this.o.reasoningEffort as "low" } }
      : {};
  }

  private async structured<T>(model: string, system: string, user: string, name: string, schema: object, maxOutputTokens: number) {
    try {
      const res = await this.client.responses.create({
        model,
        instructions: system,
        input: user,
        max_output_tokens: maxOutputTokens,
        text: { format: { type: "json_schema", name, schema: schema as Record<string, unknown>, strict: true } },
        ...this.reasoningFor(model),
      });
      if (res.status === "incomplete") {
        throw Errors.ai(`คำตอบไม่สมบูรณ์ (${res.incomplete_details?.reason ?? "unknown"})`, true);
      }
      const text = res.output_text;
      if (!text) throw Errors.ai("ไม่มีข้อความตอบกลับจาก AI", true);
      const inputTokens = res.usage?.input_tokens ?? 0;
      const outputTokens = res.usage?.output_tokens ?? 0;
      const { cost, estimated } = textCost(model, inputTokens, outputTokens);
      const usage: Usage = { model, inputTokens, outputTokens, images: 0, costUsd: cost, estimated };
      let parsed: T;
      try {
        parsed = JSON.parse(text) as T;
      } catch {
        throw Errors.ai("อ่าน JSON จาก AI ไม่ได้", true);
      }
      return { parsed, usage };
    } catch (e) {
      throw mapOpenAIError(e);
    }
  }

  async ideate(req: IdeationRequest) {
    const { parsed, usage } = await this.structured<{ candidates: unknown[] }>(
      this.o.ideationModel,
      IDEATION_SYSTEM,
      ideationUser(req),
      "topic_candidates",
      IDEATION_JSON_SCHEMA,
      12_000,
    );
    const candidates: TopicCandidate[] = z.array(TopicCandidateSchema).parse(parsed.candidates);
    return { candidates, usage };
  }

  async writeScript(req: ScriptRequest) {
    const { parsed, usage } = await this.structured<unknown>(
      this.o.textModel,
      SCRIPT_SYSTEM,
      scriptUser(req),
      "carousel_script",
      SCRIPT_JSON_SCHEMA,
      12_000,
    );
    const result = ScriptSchema.safeParse(parsed);
    if (!result.success) throw Errors.validation(result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
    const script: CarouselScript = result.data;
    return { script, usage };
  }

  async embed(texts: string[]) {
    try {
      const res = await this.client.embeddings.create({
        model: this.o.embeddingModel,
        input: texts,
        dimensions: this.o.embeddingDimensions,
      });
      const inputTokens = res.usage?.prompt_tokens ?? 0;
      const { cost, estimated } = textCost(this.o.embeddingModel, inputTokens, 0);
      return {
        embeddings: res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding),
        usage: { model: this.o.embeddingModel, inputTokens, outputTokens: 0, images: 0, costUsd: cost, estimated },
      };
    } catch (e) {
      throw mapOpenAIError(e);
    }
  }

  async illustrate(req: ImageRequest) {
    try {
      const prompt = illustrationPrompt(MOTIF_DESCRIPTIONS[req.motif] ?? req.motif, req.prompt);
      const res = await this.client.images.generate({
        model: this.o.imageModel,
        prompt,
        size: "1024x1536",
        quality: req.quality,
        output_format: "png",
        n: 1,
      });
      const b64 = res.data?.[0]?.b64_json;
      if (!b64) throw Errors.ai("ไม่ได้รับรูปภาพจาก AI", true);
      const u = res.usage as { input_tokens?: number; output_tokens?: number } | undefined;
      const { cost, estimated } = imageCost(this.o.imageModel, req.quality, u);
      return {
        png: Buffer.from(b64, "base64"),
        source: "openai" as const,
        usage: {
          model: this.o.imageModel,
          inputTokens: u?.input_tokens ?? 0,
          outputTokens: u?.output_tokens ?? 0,
          images: 1,
          costUsd: cost,
          estimated,
        },
      };
    } catch (e) {
      throw mapOpenAIError(e);
    }
  }
}

/** Map SDK errors to Thai AppErrors with correct retryability. */
export function mapOpenAIError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof z.ZodError) return Errors.validation(e.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  if (e instanceof OpenAI.AuthenticationError) return new AppError("ai_auth", "OPENAI_API_KEY ไม่ถูกต้องหรือหมดอายุ", 502, false);
  if (e instanceof OpenAI.PermissionDeniedError) return new AppError("ai_permission", "บัญชี OpenAI ไม่มีสิทธิ์ใช้โมเดลนี้", 502, false);
  if (e instanceof OpenAI.NotFoundError) return new AppError("ai_model", "ไม่พบโมเดล OpenAI ที่ตั้งค่าไว้ กรุณาตรวจสอบชื่อโมเดล", 502, false);
  if (e instanceof OpenAI.RateLimitError) {
    const quota = /quota|billing/i.test(e.message);
    return quota
      ? new AppError("ai_quota", "เครดิต OpenAI หมดหรือเกินวงเงิน กรุณาตรวจสอบ Billing", 502, false)
      : Errors.ai("ถูกจำกัดอัตราการเรียกใช้ชั่วคราว ระบบจะลองใหม่อัตโนมัติ", true);
  }
  if (e instanceof OpenAI.BadRequestError) {
    const safety = /safety|policy|moderation/i.test(e.message);
    return new AppError(
      safety ? "ai_safety" : "ai_bad_request",
      safety ? "คำขอถูกระบบความปลอดภัยของ OpenAI ปฏิเสธ" : `คำขอไม่ถูกต้อง: ${e.message.slice(0, 160)}`,
      502,
      safety, // a fresh script/prompt may pass; malformed requests will not
    );
  }
  if (e instanceof OpenAI.APIConnectionError) return Errors.ai("เชื่อมต่อ OpenAI ไม่ได้", true);
  if (e instanceof OpenAI.InternalServerError) return Errors.ai("เซิร์ฟเวอร์ OpenAI ขัดข้อง", true);
  if (e instanceof OpenAI.APIError) return Errors.ai(e.message.slice(0, 160), true);
  return Errors.ai(e instanceof Error ? e.message.slice(0, 160) : "unknown", true);
}
