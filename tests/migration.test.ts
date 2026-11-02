import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { vector } from "@electric-sql/pglite-pgvector";

/**
 * Runs the real Supabase migration on an embedded Postgres (PGlite + pgvector)
 * and exercises the atomic SQL functions the app relies on.
 */
let db: PGlite;

const vec = (i: number) => `[${Array.from({ length: 1536 }, (_, k) => (k === i ? 1 : 0)).join(",")}]`;

beforeAll(async () => {
  db = new PGlite({ extensions: { vector, pg_trgm } });
  // Minimal stand-ins for objects Supabase provides.
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean);
  `);
  const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/20261102000000_init.sql"), "utf8");
  await db.exec(sql);
});

async function createJob(key: string | null, carousels = 5, daily = 100, budget = 0) {
  const cs = JSON.stringify(Array.from({ length: carousels }, (_, i) => ({ position: i + 1, stage: "topic" })));
  const r = await db.query<{ job: { id: string; stage: string }; created: boolean }>(
    `select * from public.create_generation_job('auto', '{}'::jsonb, $1, 0.5, false, $2::jsonb, $3, $4)`,
    [key, cs, daily, budget],
  );
  return r.rows[0];
}

describe("supabase migration (PGlite)", () => {
  it("creates a job with carousels, honours idempotency and single active job", async () => {
    const a = await createJob("key-1");
    expect(a.created).toBe(true);
    expect(a.job.stage).toBe("ideation");
    const again = await createJob("key-1");
    expect(again.created).toBe(false);
    expect(again.job.id).toBe(a.job.id);
    await expect(createJob("key-2")).rejects.toThrow(/active_job/);
    const count = await db.query<{ n: number }>(`select count(*)::int n from carousels where job_id = $1`, [a.job.id]);
    expect(count.rows[0].n).toBe(5);
  });

  it("claims a job lease exactly once and releases it", async () => {
    const first = await db.query<{ id: string; status: string }>(`select * from claim_generation_job('w1', 60, null)`);
    expect(first.rows).toHaveLength(1);
    expect(first.rows[0].status).toBe("running");
    const second = await db.query(`select * from claim_generation_job('w2', 60, null)`);
    expect(second.rows).toHaveLength(0);
    const renew = await db.query(`select * from claim_generation_job('w1', 60, $1)`, [first.rows[0].id]);
    expect(renew.rows).toHaveLength(1);
    await db.query(`select release_generation_job($1, 'w1')`, [first.rows[0].id]);
    const third = await db.query(`select * from claim_generation_job('w2', 60, null)`);
    expect(third.rows).toHaveLength(1);
  });

  it("compare-and-set carousel updates reject stale versions", async () => {
    const c = await db.query<{ id: string }>(`select id from carousels order by position limit 1`);
    const id = c.rows[0].id;
    const ok = await db.query<{ version: number; title: string; hashtags: string[] }>(
      `select * from update_carousel_cas($1, 1, $2::jsonb)`,
      [id, JSON.stringify({ title: "ทดสอบ", hashtags: ["#DrTrader"], version: 2, stage: "script" })],
    );
    expect(ok.rows[0].version).toBe(2);
    expect(ok.rows[0].hashtags).toEqual(["#DrTrader"]);
    const stale = await db.query(`select * from update_carousel_cas($1, 1, $2::jsonb)`, [id, JSON.stringify({ title: "x" })]);
    expect(stale.rows).toHaveLength(0);
    const nulled = await db.query<{ error: string | null }>(`select * from update_carousel_cas($1, 2, $2::jsonb)`, [id, JSON.stringify({ error: null })]);
    expect(nulled.rows[0].error).toBeNull();
  });

  it("finds semantic matches with pgvector and excludes discarded topics", async () => {
    await db.query(
      `insert into topic_history (title, normalized_topic, embedding, embedding_model, status) values
       ('A', 'a', $1, 'm', 'completed'), ('B', 'b', $2, 'm', 'discarded'), ('C', 'c', $1, 'other', 'completed')`,
      [vec(1), vec(2)],
    );
    const r = await db.query<{ title: string; similarity: number }>(`select * from match_topics($1, 'm', 5, '{}')`, [vec(1)]);
    expect(r.rows.map((x) => x.title)).toEqual(["A"]);
    expect(Number(r.rows[0].similarity)).toBeCloseTo(1, 5);
  });

  it("enforces the daily quota atomically", async () => {
    await db.query(`update generation_jobs set status = 'completed'`);
    await expect(createJob(null, 5, 6)).rejects.toThrow(/quota_daily/); // 5 used today + 5 > 6
    await db.query(`select consume_carousel_quota(1, 6, 0)`);
    await expect(db.query(`select consume_carousel_quota(1, 6, 0)`)).rejects.toThrow(/quota_daily/);
  });

  it("enforces the monthly budget", async () => {
    await db.query(`insert into api_usage (stage, model, cost_usd) values ('script', 'gpt-5', 9.9)`);
    await expect(createJob(null, 1, 1000, 10)).rejects.toThrow(/quota_budget/);
  });

  it("rate limiter counts within a window", async () => {
    const hits = [];
    for (let i = 0; i < 3; i++) hits.push((await db.query<{ allowed: boolean }>(`select * from rate_limit_hit('k', 60, 2)`)).rows[0].allowed);
    expect(hits).toEqual([true, true, false]);
  });

  it("reactivates a finished job only when no other job is active", async () => {
    const jobs = await db.query<{ id: string }>(`select id from generation_jobs order by created_at limit 1`);
    const r = await db.query<{ status: string }>(`select * from reactivate_generation_job($1)`, [jobs.rows[0].id]);
    expect(r.rows[0].status).toBe("queued");
    await expect(createJob("key-3", 1, 1000, 0)).rejects.toThrow(/active_job/);
  });

  it("adds costs to job and carousel totals", async () => {
    const c = await db.query<{ id: string; job_id: string }>(`select id, job_id from carousels limit 1`);
    await db.query(`select add_generation_cost($1, $2, 0.25)`, [c.rows[0].job_id, c.rows[0].id]);
    const j = await db.query<{ actual_cost_usd: string }>(`select actual_cost_usd from generation_jobs where id = $1`, [c.rows[0].job_id]);
    expect(Number(j.rows[0].actual_cost_usd)).toBeCloseTo(0.25);
  });
});
