import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setAIForTests } from "@/lib/ai";
import { MockProvider } from "@/lib/ai/mock";
import { resetConfigForTests } from "@/lib/config";
import { setStoreForTests } from "@/lib/store";
import { LocalStore } from "@/lib/store/local";

export const TEST_SECRET = "test-session-secret-0123456789-abcdefghij";
export const TEST_PASSWORD = "correct horse battery staple";

/** Fresh isolated environment: temp local store + mock AI. */
export function setupTestEnv() {
  process.env.MOCK_MODE = "true";
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.DASHBOARD_PASSWORD = TEST_PASSWORD;
  process.env.WORKER_SECRET = "worker-secret-for-tests";
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const dir = mkdtempSync(path.join(tmpdir(), "drtrader-test-"));
  process.env.LOCAL_DATA_DIR = dir;
  resetConfigForTests();
  const store = new LocalStore(dir);
  const ai = new MockProvider();
  setStoreForTests(store);
  setAIForTests(ai);
  return { store, ai, dir };
}

/** Run the durable worker until the job has no work left. */
export async function drainJob(runWorker: (o: { jobId?: string; budgetMs?: number; minStepWindowMs?: number }) => Promise<{ moreWork: boolean }>, jobId: string, maxRuns = 30) {
  for (let i = 0; i < maxRuns; i++) {
    const r = await runWorker({ jobId, budgetMs: 60_000, minStepWindowMs: 1 });
    if (!r.moreWork) return;
  }
  throw new Error("job did not finish");
}
