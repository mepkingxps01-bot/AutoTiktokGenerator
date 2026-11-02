import JSZip from "jszip";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// after() needs a Next.js request scope; tests drive the worker explicitly instead.
vi.mock("@/lib/pipeline/kick", () => ({ scheduleWorker: vi.fn(), chainWorker: vi.fn() }));

import { POST as login } from "@/app/api/auth/login/route";
import { GET as listJobs, POST as createJob } from "@/app/api/jobs/route";
import { GET as getJob } from "@/app/api/jobs/[id]/route";
import { GET as downloadJob } from "@/app/api/jobs/[id]/download/route";
import { GET as downloadCarousel } from "@/app/api/carousels/[id]/download/route";
import { POST as regenerate } from "@/app/api/carousels/[id]/regenerate/route";
import { GET as asset } from "@/app/api/assets/[...key]/route";
import { POST as checkTopic } from "@/app/api/topics/check/route";
import { GET as topics } from "@/app/api/topics/route";
import { GET as getSettings, PUT as putSettings } from "@/app/api/settings/route";
import { GET as estimate } from "@/app/api/estimate/route";
import { GET as workerGet, POST as workerPost } from "@/app/api/worker/route";
import { proxy } from "@/proxy";
import { scheduleWorker } from "@/lib/pipeline/kick";
import { runWorker } from "@/lib/pipeline/worker";
import { drainJob, setupTestEnv, TEST_PASSWORD } from "./helpers";

const BASE = "http://localhost:3000";
let cookie = "";

function req(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string>; auth?: boolean } = {}) {
  const headers: Record<string, string> = { "x-forwarded-for": "10.0.0.1", ...(init.headers ?? {}) };
  if (init.auth !== false && cookie) headers.cookie = cookie;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}
const params = <T,>(p: T) => ({ params: Promise.resolve(p) });

async function doLogin() {
  const res = await login(req("/api/auth/login", { method: "POST", body: { password: TEST_PASSWORD }, auth: false }), undefined as never);
  expect(res.status).toBe(200);
  cookie = res.headers.get("set-cookie")!.split(";")[0];
}

beforeEach(async () => {
  setupTestEnv();
  cookie = "";
  vi.mocked(scheduleWorker).mockClear();
});

describe("auth", () => {
  it("rejects unauthenticated API calls with a Thai message", async () => {
    const res = await listJobs(req("/api/jobs", { auth: false }), undefined as never);
    expect(res.status).toBe(401);
    expect((await res.json()).error.message).toMatch(/เข้าสู่ระบบ/);
  });

  it("rejects a wrong password and rate-limits login attempts", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await login(req("/api/auth/login", { method: "POST", body: { password: "nope" }, auth: false }), undefined as never);
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("sets an httpOnly session cookie on success", async () => {
    const res = await login(req("/api/auth/login", { method: "POST", body: { password: TEST_PASSWORD }, auth: false }), undefined as never);
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/i);
  });

  it("proxy redirects pages to /login and blocks API without a session", async () => {
    const page = await proxy(req("/history", { auth: false }));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/login");
    const api = await proxy(req("/api/jobs", { auth: false }));
    expect(api.status).toBe(401);
    await doLogin();
    const ok = await proxy(req("/history"));
    expect(ok.headers.get("x-middleware-next")).toBe("1");
  });
});

describe("jobs API", () => {
  beforeEach(doLogin);

  it("creates a job, is idempotent, and schedules the worker", async () => {
    const body = { mode: "auto", idempotencyKey: "idem-key-0001" };
    const a = await createJob(req("/api/jobs", { method: "POST", body }), undefined as never);
    expect(a.status).toBe(201);
    const b = await createJob(req("/api/jobs", { method: "POST", body }), undefined as never);
    expect(b.status).toBe(200);
    expect((await a.json()).job.id).toBe((await b.json()).job.id);
    expect(scheduleWorker).toHaveBeenCalled();

    const conflict = await createJob(req("/api/jobs", { method: "POST", body: { mode: "auto", idempotencyKey: "idem-key-0002" } }), undefined as never);
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe("active_job_exists");
  });

  it("validates the request body", async () => {
    const res = await createJob(req("/api/jobs", { method: "POST", body: { mode: "weird" } }), undefined as never);
    expect(res.status).toBe(400);
    const bad = await createJob(req("/api/jobs", { method: "POST", body: { mode: "custom", topic: "a" } }), undefined as never);
    expect(bad.status).toBe(400);
  });

  it("reports progress, resumes stalled jobs and serves downloads", async () => {
    const created = await (await createJob(req("/api/jobs", { method: "POST", body: { mode: "auto" } }), undefined as never)).json();
    const id = created.job.id as string;

    vi.mocked(scheduleWorker).mockClear();
    const poll = await getJob(req(`/api/jobs/${id}`), params({ id }));
    const pollJson = await poll.json();
    expect(pollJson.carousels).toHaveLength(5);
    expect(pollJson.resumed).toBe(true); // nobody holds the lease -> poll resumes the job
    expect(scheduleWorker).toHaveBeenCalledTimes(1);

    await drainJob(runWorker, id);
    const done = await (await getJob(req(`/api/jobs/${id}`), params({ id }))).json();
    expect(done.job.status).toBe("completed");
    expect(done.carousels[0].slides).toHaveLength(5);
    expect(done.carousels[0].slides[0]).toMatch(/^\/api\/assets\/carousels\//);

    const zipRes = await downloadJob(req(`/api/jobs/${id}/download`), params({ id }));
    expect(zipRes.headers.get("content-type")).toBe("application/zip");
    const zip = await JSZip.loadAsync(await zipRes.arrayBuffer());
    expect(Object.keys(zip.files).filter((f) => f.endsWith(".png"))).toHaveLength(25);

    const cid = done.carousels[1].id as string;
    const one = await downloadCarousel(req(`/api/carousels/${cid}/download`), params({ id: cid }));
    expect(one.status).toBe(200);
    expect(one.headers.get("content-disposition")).toMatch(/attachment/);

    // slide image via asset route
    const key = (done.carousels[0].slides[0] as string).replace("/api/assets/", "").split("?")[0].split("/");
    const img = await asset(req(`/api/assets/${key.join("/")}`), params({ key }));
    expect(img.headers.get("content-type")).toBe("image/png");

    // regenerate one carousel
    const regen = await regenerate(req(`/api/carousels/${cid}/regenerate`, { method: "POST", body: { newTopic: false } }), params({ id: cid }));
    expect(regen.status).toBe(200);
    expect((await regen.json()).carousel.version).toBe(2);

    // history API lists the completed topics
    const hist = await (await topics(req("/api/topics?status=completed"), undefined as never)).json();
    expect(hist.total).toBeGreaterThanOrEqual(4);
    expect(hist.items[0].embedding).toBeUndefined();
  });

  it("rejects path traversal in the asset route", async () => {
    const res = await asset(req("/api/assets/../db.json"), params({ key: ["..", "db.json"] }));
    expect(res.status).toBe(400);
  });

  it("checks topic similarity and returns warnings", async () => {
    const created = await (await createJob(req("/api/jobs", { method: "POST", body: { mode: "custom", topic: "วิธีใช้ FVG ให้ถูกต้อง" } }), undefined as never)).json();
    await drainJob(runWorker, created.job.id);
    const res = await checkTopic(req("/api/topics/check", { method: "POST", body: { topic: "วิธีใช้ fvg ให้ถูกต้อง!" } }), undefined as never);
    const json = await res.json();
    expect(json.matches[0].exact).toBe(true);

    const blocked = await createJob(req("/api/jobs", { method: "POST", body: { mode: "custom", topic: "วิธีใช้ fvg ให้ถูกต้อง!" } }), undefined as never);
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error.code).toBe("similar_topic");
  });

  it("validates and saves settings; estimate reflects mock mode", async () => {
    const { settings } = await (await getSettings(req("/api/settings"), undefined as never)).json();
    const bad = await putSettings(req("/api/settings", { method: "PUT", body: { ...settings, similarity: { ...settings.similarity, rejectThreshold: 3 } } }), undefined as never);
    expect(bad.status).toBe(400);
    const good = await putSettings(req("/api/settings", { method: "PUT", body: { ...settings, quotas: { ...settings.quotas, dailyCarousels: 12 } } }), undefined as never);
    expect((await good.json()).settings.quotas.dailyCarousels).toBe(12);
    const est = await (await estimate(req("/api/estimate?carousels=5"), undefined as never)).json();
    expect(est.estimate.totalUsd).toBe(0);
  });
});

describe("worker endpoint", () => {
  it("requires the worker/cron secret or a session", async () => {
    const denied = await workerGet(req("/api/worker", { auth: false }));
    expect(denied.status).toBe(401);
    const cron = await workerGet(req("/api/worker", { auth: false, headers: { authorization: "Bearer worker-secret-for-tests" } }));
    expect(cron.status).toBe(202);
    const chained = await workerPost(req("/api/worker", { method: "POST", auth: false, body: {}, headers: { "x-worker-secret": "worker-secret-for-tests" } }));
    expect(chained.status).toBe(202);
  });
});
