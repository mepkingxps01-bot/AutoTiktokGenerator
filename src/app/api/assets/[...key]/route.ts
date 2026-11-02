import { NextResponse } from "next/server";
import { Errors } from "@/lib/errors";
import { route } from "@/lib/http";
import { getStore } from "@/lib/store";

type Ctx = { params: Promise<{ key: string[] }> };

/** Serves private generated assets to the logged-in owner only. */
export const GET = route<Ctx>(async (_req, { params }) => {
  const { key } = await params;
  const path = key.map(decodeURIComponent).join("/");
  if (!/^(carousels|artworks)\/[A-Za-z0-9/_.-]+\.png$/.test(path) || path.includes("..")) throw Errors.badInput("ชื่อไฟล์ไม่ถูกต้อง");
  const store = getStore();
  if (store.signedBlobUrl) {
    const url = await store.signedBlobUrl(path, 3600);
    if (!url) throw Errors.notFound("ไฟล์");
    return NextResponse.redirect(url, { headers: { "cache-control": "private, max-age=600" } });
  }
  const data = await store.getBlob(path);
  if (!data) throw Errors.notFound("ไฟล์");
  return new Response(new Uint8Array(data), { headers: { "content-type": "image/png", "cache-control": "private, max-age=3600" } });
});
