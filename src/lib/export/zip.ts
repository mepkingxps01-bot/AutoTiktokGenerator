import JSZip from "jszip";
import { Errors } from "../errors";
import type { Store } from "../store/types";
import { slugify } from "../topics/normalize";
import type { Carousel } from "../types";

function captionText(c: Carousel) {
  return `${(c.caption ?? "").trim()}\n`;
}

function hashtagsText(c: Carousel) {
  return `${c.hashtags.join(" ")}\n`;
}

async function addCarousel(store: Store, zip: JSZip, c: Carousel) {
  if (c.status !== "completed" || c.slide_keys.length !== 5) throw Errors.badInput(`carousel ${c.position} ยังสร้างไม่เสร็จ`);
  for (let i = 0; i < c.slide_keys.length; i++) {
    const data = await store.getBlob(c.slide_keys[i]);
    if (!data) throw Errors.storage(`ไม่พบไฟล์ ${c.slide_keys[i]}`);
    zip.file(`slide-${String(i + 1).padStart(2, "0")}.png`, data);
  }
  zip.file("caption.txt", captionText(c));
  zip.file("hashtags.txt", hashtagsText(c));
}

export function carouselFolderName(c: Carousel) {
  return `carousel-${String(c.position).padStart(2, "0")}-${slugify(c.title ?? "")}`;
}

/** One carousel: slide-01..05.png + caption.txt + hashtags.txt at the archive root. */
export async function zipCarousel(store: Store, c: Carousel): Promise<Buffer> {
  const zip = new JSZip();
  await addCarousel(store, zip, c);
  return zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
}

/** Whole batch: one folder per completed carousel. */
export async function zipBatch(store: Store, carousels: Carousel[]): Promise<Buffer> {
  const done = carousels.filter((c) => c.status === "completed");
  if (!done.length) throw Errors.badInput("ยังไม่มี carousel ที่สร้างเสร็จให้ดาวน์โหลด");
  const zip = new JSZip();
  for (const c of done) await addCarousel(store, zip.folder(carouselFolderName(c))!, c);
  return zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
}
