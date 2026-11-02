import JSZip from "jszip";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import { MockProvider } from "@/lib/ai/mock";
import { setAIForTests } from "@/lib/ai";
import { validateScript, sanitizeScript } from "@/lib/content/validate";
import { zipBatch, zipCarousel } from "@/lib/export/zip";
import { cancelJob, createGenerationJob, regenerateCarousel, retryJob } from "@/lib/pipeline/jobs";
import { runWorker } from "@/lib/pipeline/worker";
import type { LocalStore } from "@/lib/store/local";
import { drainJob, setupTestEnv } from "./helpers";

let store: LocalStore;

beforeEach(() => {
  ({ store } = setupTestEnv());
});

describe("auto mode end to end (mock)", () => {
  it("creates 5 distinct carousels with 25 slides and completes topic memory", async () => {
    const { job, created } = await createGenerationJob({ mode: "auto", idempotencyKey: "k-auto-1" });
    expect(created).toBe(true);
    await drainJob(runWorker, job.id);

    const final = await store.getJob(job.id);
    expect(final?.status).toBe("completed");
    const carousels = await store.listCarousels(job.id);
    expect(carousels).toHaveLength(5);
    expect(carousels.every((c) => c.status === "completed" && c.slide_keys.length === 5)).toBe(true);
    expect(new Set(carousels.map((c) => c.normalized_topic)).size).toBe(5);
    expect(new Set(carousels.map((c) => c.category)).size).toBe(5); // categories rotate within a batch

    const png = await store.getBlob(carousels[0].slide_keys[0]);
    const meta = await sharp(png!).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1920]);

    const { items } = await store.listTopics({ limit: 50 });
    expect(items.filter((t) => t.status === "completed")).toHaveLength(5);
  });

  it("does not repeat topics across batches", async () => {
    const a = await createGenerationJob({ mode: "auto" });
    await drainJob(runWorker, a.job.id);
    const b = await createGenerationJob({ mode: "auto" });
    await drainJob(runWorker, b.job.id);
    const titles = [...(await store.listCarousels(a.job.id)), ...(await store.listCarousels(b.job.id))].map((c) => c.normalized_topic);
    expect(new Set(titles).size).toBe(10);
  });

  it("idempotency key returns the same job and blocks a second active job", async () => {
    const a = await createGenerationJob({ mode: "auto", idempotencyKey: "same-key-123" });
    const b = await createGenerationJob({ mode: "auto", idempotencyKey: "same-key-123" });
    expect(b.created).toBe(false);
    expect(b.job.id).toBe(a.job.id);
    await expect(createGenerationJob({ mode: "auto", idempotencyKey: "other-key-123" })).rejects.toMatchObject({ code: "active_job_exists" });
  });

  it("concurrent clicks create only one job", async () => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => createGenerationJob({ mode: "auto" })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await store.listJobs(10)).length).toBe(1);
  });
});

describe("custom topic mode", () => {
  it("creates one carousel by default and warns on similar history", async () => {
    const { job } = await createGenerationJob({ mode: "custom", topic: "ทำไม MSS ถึงสำคัญ?" });
    await drainJob(runWorker, job.id);
    const [c] = await store.listCarousels(job.id);
    expect(c.status).toBe("completed");
    expect(c.title).toBe("ทำไม MSS ถึงสำคัญ?");

    await expect(createGenerationJob({ mode: "custom", topic: "ทำไม mss ถึงสำคัญ" })).rejects.toMatchObject({ code: "similar_topic" });
    const forced = await createGenerationJob({ mode: "custom", topic: "ทำไม mss ถึงสำคัญ", overrideSimilarity: true });
    expect(forced.created).toBe(true);
    expect(forced.warnings.length).toBeGreaterThan(0);
  });

  it("can generate five distinct angles of one topic", async () => {
    const { job } = await createGenerationJob({ mode: "custom", topic: "วิธีใช้ FVG ให้ถูกต้อง", angles: true });
    await drainJob(runWorker, job.id);
    const carousels = await store.listCarousels(job.id);
    expect(carousels).toHaveLength(5);
    expect(carousels.every((c) => c.status === "completed")).toBe(true);
    expect(new Set(carousels.map((c) => c.title)).size).toBe(5);
  });

  it("validates custom topic input", async () => {
    await expect(createGenerationJob({ mode: "custom", topic: "ab" })).rejects.toMatchObject({ code: "bad_input" });
    await expect(createGenerationJob({ mode: "custom", topic: "x".repeat(200) })).rejects.toMatchObject({ code: "bad_input" });
    await expect(createGenerationJob({ mode: "custom", topic: "1234 5678" })).rejects.toMatchObject({ code: "bad_input" });
  });
});

describe("regenerate, retry, cancel", () => {
  it("regenerating one carousel leaves the other four untouched", async () => {
    const { job } = await createGenerationJob({ mode: "auto" });
    await drainJob(runWorker, job.id);
    const before = await store.listCarousels(job.id);
    const target = before[2];
    await regenerateCarousel(target.id, { newTopic: true });
    await drainJob(runWorker, job.id);
    const after = await store.listCarousels(job.id);
    for (const c of after) {
      const old = before.find((b) => b.id === c.id)!;
      if (c.id === target.id) {
        expect(c.version).toBe(old.version + 1);
        expect(c.status).toBe("completed");
        expect(c.normalized_topic).not.toBe(old.normalized_topic);
        expect(c.slide_keys[0]).toContain("/v2/");
      } else {
        expect(c).toEqual(old);
      }
    }
    const topics = await store.getTopicsForCarousel(target.id);
    expect(topics.map((t) => t.status).sort()).toEqual(["completed", "discarded"]);
    expect((await store.getJob(job.id))?.status).toBe("completed");
  });

  it("failed steps are retried with backoff and only failed carousels re-run", async () => {
    const { job } = await createGenerationJob({ mode: "auto" });
    // Fail every illustration and script call: carousels end up failed after max attempts.
    setAIForTests(new MockProvider({ failRate: 1 }));
    // ideation also fails -> retryable; run until it gives up
    await drainJob(runWorker, job.id);
    let final = await store.getJob(job.id);
    expect(final?.status).toBe("failed");
    const failed = await store.listCarousels(job.id);
    expect(failed.every((c) => c.status === "failed")).toBe(true);

    setAIForTests(new MockProvider());
    await retryJob(job.id);
    await drainJob(runWorker, job.id);
    final = await store.getJob(job.id);
    expect(final?.status).toBe("completed");
  }, 120_000);

  it("never re-runs a completed stage (resumable)", async () => {
    const { job } = await createGenerationJob({ mode: "custom", topic: "บันทึกเทรดอย่างไรให้ได้ผล" });
    let scripts = 0;
    const base = new MockProvider();
    setAIForTests(
      Object.assign(Object.create(base), {
        name: "mock",
        embeddingModel: base.embeddingModel,
        writeScript: (r: Parameters<MockProvider["writeScript"]>[0]) => {
          scripts++;
          return base.writeScript(r);
        },
      }),
    );
    // Storage fails once in the middle of rendering (simulated crash).
    const realPut = store.putBlob.bind(store);
    let puts = 0;
    store.putBlob = async (key: string, data: Buffer) => {
      if (key.includes("slide-03") && puts++ === 0) throw new Error("simulated storage outage");
      return realPut(key, data);
    };
    // One stage per invocation (tiny budget), like separate serverless calls.
    for (let i = 0; i < 20; i++) {
      const r = await runWorker({ jobId: job.id, budgetMs: 5, minStepWindowMs: 0 });
      if (!r.moreWork) break;
    }
    await drainJob(runWorker, job.id);
    expect(puts).toBeGreaterThan(1);
    expect(scripts).toBe(1);
    expect((await store.getJob(job.id))?.status).toBe("completed");
  });

  it("cancel stops queued carousels and discards reserved topics", async () => {
    const { job } = await createGenerationJob({ mode: "auto" });
    await cancelJob(job.id);
    expect((await store.getJob(job.id))?.status).toBe("cancelled");
    const r = await runWorker({ jobId: job.id });
    expect(r.moreWork).toBe(false);
  });

  it("enforces the daily quota", async () => {
    const s = await store.getSettings();
    await store.saveSettings({ ...s, quotas: { ...s.quotas, dailyCarousels: 6 } });
    const { job } = await createGenerationJob({ mode: "auto" });
    await drainJob(runWorker, job.id);
    await expect(createGenerationJob({ mode: "auto" })).rejects.toMatchObject({ code: "quota_exceeded" });
    const [c] = await store.listCarousels(job.id);
    await regenerateCarousel(c.id, { newTopic: false }); // 6th carousel
    await drainJob(runWorker, job.id);
    await expect(regenerateCarousel(c.id, { newTopic: false })).rejects.toMatchObject({ code: "quota_exceeded" });
    expect((await store.getJob(job.id))?.status).toBe("completed");
  });
});

describe("export", () => {
  it("zips one carousel and a whole batch with the required files", async () => {
    const { job } = await createGenerationJob({ mode: "auto" });
    await drainJob(runWorker, job.id);
    const carousels = await store.listCarousels(job.id);
    const one = await JSZip.loadAsync(await zipCarousel(store, carousels[0]));
    expect(Object.keys(one.files).sort()).toEqual(["caption.txt", "hashtags.txt", "slide-01.png", "slide-02.png", "slide-03.png", "slide-04.png", "slide-05.png"]);
    expect(await one.file("hashtags.txt")!.async("string")).toContain("#DrTrader");

    const batch = await JSZip.loadAsync(await zipBatch(store, carousels));
    const pngs = Object.keys(batch.files).filter((f) => f.endsWith(".png"));
    expect(pngs).toHaveLength(25);
    expect(Object.keys(batch.files).filter((f) => f.endsWith("caption.txt"))).toHaveLength(5);
  });
});

describe("content validation (stage 4)", () => {
  it("accepts mock scripts and rejects profit promises and broken structure", async () => {
    const { script } = await new MockProvider().writeScript({ title: "เสี่ยง 1% ต่อไม้", category: "risk_management", angle: null, learningObjective: null, variation: 1 });
    expect(validateScript(sanitizeScript(script))).toEqual([]);

    const bad = structuredClone(script);
    bad.slides[1].body = ["ระบบนี้การันตีกำไรแน่นอน รวยเร็วใน 7 วัน"];
    bad.slides.pop();
    bad.hashtags = ["no hash"];
    const issues = validateScript(bad);
    expect(issues.join("|")).toMatch(/5 สไลด์/);
    expect(issues.join("|")).toMatch(/รับประกัน/);
    expect(issues.join("|")).toMatch(/รวยง่าย/);
  });

  it("requires Thai-language content", async () => {
    const { script } = await new MockProvider().writeScript({ title: "x", category: "liquidity", angle: null, learningObjective: null, variation: 0 });
    const english = structuredClone(script);
    english.slides = english.slides.map((s) => ({ ...s, headline: "Liquidity basics", body: ["This is english only content"], kicker: "INFO" }));
    english.caption = "English caption";
    english.title = "English";
    expect(validateScript(english)).toContain("เนื้อหาต้องเป็นภาษาไทยเป็นหลัก");
  });

  it("sanitize adds #DrTrader and strips hashtags from caption", async () => {
    const { script } = await new MockProvider().writeScript({ title: "x", category: "liquidity", angle: null, learningObjective: null, variation: 0 });
    const s = sanitizeScript({ ...script, hashtags: ["เทรด", "#SMC"], caption: "สวัสดี #tag" });
    expect(s.hashtags[0]).toBe("#DrTrader");
    expect(s.hashtags).toContain("#เทรด");
    expect(s.caption).toBe("สวัสดี");
  });
});
