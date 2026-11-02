"use client";
import { useEffect, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CarouselDTO } from "@/lib/api/serialize";
import { cn } from "@/lib/utils";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check /> : <Copy />} {done ? "คัดลอกแล้ว" : label}
    </Button>
  );
}

export function SlideViewer({ carousel, open, onOpenChange }: { carousel: CarouselDTO; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [index, setIndex] = useState(0);
  const total = carousel.slides.length;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setIndex((i) => Math.min(total - 1, i + 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, total]);

  const slideText = carousel.script?.slides[index];
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setIndex(0); }}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{carousel.title}</DialogTitle>
          <DialogDescription>
            สไลด์ {index + 1} / {total} · ใช้ปุ่มลูกศรเพื่อเลื่อน
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 md:grid-cols-[minmax(0,320px)_1fr]">
          <div className="space-y-3">
            <div className="relative mx-auto aspect-[9/16] w-full max-w-[320px] overflow-hidden rounded-lg border bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={carousel.slides[index]} alt={slideText ? slideText.headline.replace(/\*\*/g, "") : `slide ${index + 1}`} className="size-full object-contain" />
              <button
                className="absolute top-1/2 left-1 -translate-y-1/2 rounded-full bg-black/60 p-1.5 disabled:opacity-30"
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
                disabled={index === 0}
                aria-label="สไลด์ก่อนหน้า"
              >
                <ChevronLeft className="size-5" />
              </button>
              <button
                className="absolute top-1/2 right-1 -translate-y-1/2 rounded-full bg-black/60 p-1.5 disabled:opacity-30"
                onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
                disabled={index === total - 1}
                aria-label="สไลด์ถัดไป"
              >
                <ChevronRight className="size-5" />
              </button>
            </div>
            <div className="flex justify-center gap-1.5">
              {carousel.slides.map((src, i) => (
                <button
                  key={src}
                  onClick={() => setIndex(i)}
                  className={cn("aspect-[9/16] w-12 overflow-hidden rounded border-2", i === index ? "border-primary" : "border-transparent opacity-60 hover:opacity-100")}
                  aria-label={`ไปสไลด์ ${i + 1}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="size-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-4 text-sm">
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-bold text-primary">Caption</h3>
                <CopyButton text={carousel.caption ?? ""} label="คัดลอก caption" />
              </div>
              <p className="whitespace-pre-wrap rounded-md border bg-black/30 p-3">{carousel.caption}</p>
            </section>
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-bold text-primary">Hashtags</h3>
                <CopyButton text={carousel.hashtags.join(" ")} label="คัดลอก hashtags" />
              </div>
              <p className="rounded-md border bg-black/30 p-3">{carousel.hashtags.join(" ")}</p>
            </section>
            {slideText && (
              <section className="space-y-1">
                <h3 className="font-bold text-primary">ข้อความในสไลด์นี้</h3>
                <p className="font-semibold">{slideText.headline.replace(/\*\*/g, "")}</p>
                <ul className="text-muted-foreground list-disc pl-5">
                  {slideText.body.map((b) => (
                    <li key={b}>{b.replace(/\*\*/g, "")}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
