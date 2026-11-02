import { Errors } from "@/lib/errors";
import { carouselFolderName, zipCarousel } from "@/lib/export/zip";
import { rateLimit, route } from "@/lib/http";
import { getStore } from "@/lib/store";

export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const { id } = await params;
  await rateLimit("download", req, 60, 3600);
  const store = getStore();
  const c = await store.getCarousel(id);
  if (!c) throw Errors.notFound("carousel");
  const zip = await zipCarousel(store, c);
  return new Response(new Uint8Array(zip), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="drtrader-${carouselFolderName(c)}.zip"`,
      "cache-control": "private, no-store",
    },
  });
});
