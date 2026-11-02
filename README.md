# Dr.Trader AI Carousel Factory

A private web dashboard that makes Thai trading-education carousels for TikTok. The brand is **Dr.Trader / เบิ้ลพอร์ต ลอตใหญ่**, with the tagline *Survive First. Scale Later.*

- **Mode A, automatic.** "สร้าง 5 Carousel" makes AI propose 12 or more topics. It drops any that duplicate past content, keeps 5 distinct topics and builds 5 carousels: 25 slides at 1080×1920, plus captions and hashtags.
- **Mode B, custom topic.** Type a topic. You get one carousel, or 5 different teaching angles. If the topic resembles earlier content, the app warns you and you can choose to continue anyway.
- You download everything as ZIP files and post to TikTok yourself. The app has **no TikTok integration**.

> The previous Python version (V1) is kept unchanged in `legacy/python-v1/`. Its GitHub Actions workflow is now `.github/workflows/legacy-v1-daily.yml`.

## Architecture

| Layer | Implementation |
|---|---|
| UI | Next.js 16 (App Router) + TypeScript, Tailwind CSS 4, shadcn/ui (Radix). All UI text is in Thai. |
| Auth | Password login with a signed httpOnly JWT cookie (`jose`). `src/proxy.ts` guards every page and API route, and each API route checks again. |
| AI | OpenAI Responses API with **strict JSON Schema** outputs, the Images API (`gpt-image-*`) and Embeddings (`text-embedding-3-small`). |
| Data | Supabase Postgres + **pgvector**, and a private Supabase Storage bucket. Without Supabase credentials, a file-based local store in `.data/` is used. |
| Rendering | HarfBuzz (WASM) shapes the Thai text and converts it to SVG paths. Line breaks use `Intl.Segmenter("th")`. Trading diagrams are deterministic SVG. Sharp rasterizes to PNG. No system fonts are needed, so the same output comes out locally and on Vercel. |
| Export | JSZip: `slide-01..05.png`, `caption.txt`, `hashtags.txt`. |

### Pipeline (one stage per step, resumable)

1. **Topic ideation.** One AI call proposes 12 or more candidates (configurable, at least 10).
2. **Duplicate detection.** Each candidate is checked by exact normalized match against history, then by semantic similarity against history using pgvector cosine distance, then against the other topics chosen for the same batch. Category rotation favours categories you haven't used recently. If too many candidates are rejected, the AI is asked again with the rejection reasons.
3. **Thai script.** Strict JSON schema: 5 slides (hook, foundation, insight, application, takeaway), caption, hashtags and an art direction.
4. **Validation.** Structure, length limits, a check that the text is mainly Thai, and a compliance filter that blocks profit promises, fabricated results and buy/sell signals. It also measures whether the text fits each slide. Problems go back to the model as feedback for a rewrite.
5. **Illustration.** The app reuses library artwork when the category and motif match, which saves money. Otherwise it calls `gpt-image-*`. If image generation fails, a procedural brand graphic is used instead, so a finished script is never lost.
6. **Rendering.** Deterministic Sharp + SVG. Four layout variants and seeded background patterns make carousels look different from each other. The AI never draws Thai text.
7. **Storage.** Slides go to Supabase Storage. A topic is marked `completed` in topic memory **only after rendering succeeds**.

### Durable background jobs on Vercel (no extra service)

- Job and carousel state live in Postgres. Each step commits with **compare-and-set** on `carousels.version`, so finished stages are never redone and a regenerated carousel can't be overwritten by an outdated worker.
- `/api/worker` takes a **lease** on the job (`FOR UPDATE SKIP LOCKED`). It runs steps in `after()` within `maxDuration = 300s`, then **calls itself again** if work remains.
- Stalled jobs restart automatically in two ways: the dashboard checks the job every 2.5s and restarts it when no worker holds the lease, and Vercel Cron calls `/api/worker` as a safety net.
- A failed step is retried with exponential backoff, up to `STEP_MAX_ATTEMPTS` times. "ลองใหม่" re-runs only the failed carousels, starting from the stage that failed.
- Repeated button clicks can't start duplicate jobs. Each request has an idempotency key, and a unique partial index allows only **one active job at a time**.

Semantic matching lowers the chance of repeated topics. **It does not guarantee every topic is unique.**

## Local setup

Requirements: Node.js 20.9 or newer (22 LTS recommended).

```bash
npm install
```

```bash
cp .env.example .env.local
```

In `.env.local`, set at least `DASHBOARD_PASSWORD` and `SESSION_SECRET` (32 or more random characters). To generate a secret:

```bash
openssl rand -base64 48
```

```bash
npm run dev
```

Open http://localhost:3000. With no `OPENAI_API_KEY` and no Supabase variables, the app runs in **mock mode** with the **local file store**. Both are labelled in the header. Mock mode makes no API calls and costs nothing, so you can test the whole interface. Mock content is placeholder text marked `[MOCK]`. Don't publish it.

To render sample slides for every layout into `.data/sample/`:

```bash
npm run render:sample
```

## Supabase setup

1. Create a Supabase project.
2. Run the migration in `supabase/migrations/20261102000000_init.sql`. Either paste it into the SQL Editor, or use the CLI:
   ```bash
   supabase link --project-ref <ref>
   ```
   ```bash
   supabase db push
   ```
   The migration enables `vector` and `pg_trgm` (in the `extensions` schema). It creates the tables, the atomic SQL functions, RLS with no policies (so the anon key has no access) and the private bucket `carousel-assets`.
3. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API). **The service-role key is server-only.** Never prefix it with `NEXT_PUBLIC_`.

## OpenAI configuration

1. Create an API key at https://platform.openai.com/api-keys. Set a monthly **usage limit** in the OpenAI billing settings.
2. Set `OPENAI_API_KEY` and `MOCK_MODE=false`.
3. Models can be changed with env vars. The defaults are `gpt-5` for scripts, `gpt-5-mini` for ideation, `gpt-image-1-mini` for illustrations and `text-embedding-3-small` for embeddings. Your organization may need verification before it can use the `gpt-image-*` models.
4. The prices in `src/lib/pricing.ts` are **estimates**. Check https://openai.com/api/pricing and override them with `OPENAI_PRICING_JSON` if needed. Actual cost is computed from the token usage each API call reports.

## Deploying to Vercel

1. Import the GitHub repository in Vercel. The framework preset is Next.js and no build settings need changing.
2. Add every variable from `.env.example` under Settings → Environment Variables. `CRON_SECRET` is required in production, because the worker uses it to call itself.
3. If **Deployment Protection** is on, also set `VERCEL_AUTOMATION_BYPASS_SECRET` so the worker can call itself.
4. Deploy. `vercel.json` sets up a **daily** safety-net cron, which the Hobby plan allows. On Pro, change it to `*/5 * * * *` for faster recovery. Normal progress doesn't depend on the cron, because it comes from `after()` and the self-calls.
5. Functions use `maxDuration = 300` (Fluid Compute). Fonts and the HarfBuzz WASM file are bundled via `outputFileTracingIncludes`.

## Cost controls

Settings page (`/settings`, stored in the database):

- **Daily carousel quota**: Asia/Bangkok day. Regenerations count toward it. Enforced atomically in SQL.
- **Monthly budget (USD)**: a new job is refused when spending so far plus the estimate would go over the budget.
- **Image mode**: `ai`, or `procedural` (free brand graphics). Image quality: low, medium or high.
- **Artwork reuse**: on or off, plus a maximum number of uses per artwork.
- **Similarity thresholds**: reject (auto mode), warn (custom topic), within a batch, and 5-angle mode. Candidate count and maximum ideation rounds are also set here.

Other safeguards:

- Per-IP rate limits: login 10 per 15 minutes, job creation 20 per hour, regenerate and retry 30 per hour.
- One active job at a time.
- Bounded retries: `STEP_MAX_ATTEMPTS`.
- The SDK retries only failures that can be retried. Authentication, permission, missing-model and billing-quota errors stop immediately with a Thai message.
- Each batch shows its estimated and actual cost. The header shows spending for the month and today's quota.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run lint` | ESLint (flat config, `eslint-config-next`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest (all tests) |
| `npm run check` | lint, then typecheck, then test, then build |

### Tests

- `tests/duplicates.test.ts`: normalization, cosine similarity, exact, semantic and in-batch rejection, sibling-aware selection, category rotation, custom-topic warnings.
- `tests/render.test.ts`: Thai line wrapping (no broken grapheme clusters), 1080×1920 PNG output for every layout, deterministic output, overflow detection.
- `tests/pipeline.test.ts`: auto and custom end to end (mock), no repeats across batches, idempotency, concurrent clicks, regenerating one carousel leaves the other four untouched, retry after failures, resume after a storage failure without redoing finished stages, cancel, quotas, ZIP contents, content validation.
- `tests/api.test.ts`: auth (401, wrong password, login rate limit, proxy redirects), job API (create, idempotency, conflict, validation, polling resume, downloads, assets, regenerate, history), path-traversal block, similarity warnings, settings validation, worker-secret auth.
- `tests/migration.test.ts`: runs the **real Supabase migration** on an embedded Postgres (PGlite + pgvector). It tests job creation and idempotency, the single-active-job index, leases, compare-and-set, pgvector matching, daily quota, monthly budget, the rate limiter, reactivation and cost accounting.

## Content policy built into the prompts and validators

Educational content only. No promises of profit or win rates, no fabricated performance, no buy/sell signals, and no misleading clickbait. Example charts carry the label "ตัวอย่างประกอบการสอน (สมมติ)" (hypothetical teaching example). The takeaway slide always shows the disclaimer: *เพื่อการศึกษาเท่านั้น ไม่ใช่คำแนะนำการลงทุน การเทรดมีความเสี่ยง* (for education only, not investment advice; trading carries risk).

## Fonts

Noto Sans Thai and Noto Sans, under the SIL Open Font License (`assets/fonts/OFL.txt`).
