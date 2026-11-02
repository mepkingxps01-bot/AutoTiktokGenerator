import { Errors } from "@/lib/errors";
import { zipBatch } from "@/lib/export/zip";
import { rateLimit, route } from "@/lib/http";
import { getStore } from "@/lib/store";

export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const { id } = await params;
  await rateLimit("download", req, 60, 3600);
  const store = getStore();
  const job = await store.getJob(id);
  if (!job) throw Errors.notFound("งาน");
  const zip = await zipBatch(store, await store.listCarousels(id));
  const name = `drtrader-batch-${job.created_at.slice(0, 10)}-${id.slice(0, 8)}.zip`;
  return new Response(new Uint8Array(zip), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "private, no-store",
    },
  });
});
