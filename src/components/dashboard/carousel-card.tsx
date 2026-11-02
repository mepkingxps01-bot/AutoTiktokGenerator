"use client";
import { useState } from "react";
import { AlertTriangle, Download, Eye, Loader2, RefreshCw, Shuffle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, ApiError, formatUsd } from "@/lib/client/api";
import type { CarouselDTO } from "@/lib/api/serialize";
import { CAROUSEL_STAGE_LABELS, carouselProgress } from "@/lib/labels";
import { CATEGORY_LABELS } from "@/lib/types";
import { SlideViewer } from "./slide-viewer";

export function CarouselCard({
  carousel,
  canRegenerate,
  allowNewTopic,
  onChanged,
}: {
  carousel: CarouselDTO;
  canRegenerate: boolean;
  allowNewTopic: boolean;
  onChanged: () => void;
}) {
  const [viewer, setViewer] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = carousel;
  const done = c.status === "completed" && c.slides.length === 5;
  const working = c.status === "queued";

  async function regenerate(newTopic: boolean) {
    setPending(true);
    setError(null);
    try {
      await api(`/api/carousels/${c.id}/regenerate`, { method: "POST", json: { newTopic } });
      setConfirm(false);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "สร้างใหม่ไม่สำเร็จ");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="gap-3 overflow-hidden py-0">
      <button
        type="button"
        className="group relative aspect-[9/16] w-full overflow-hidden bg-black text-left disabled:cursor-default"
        onClick={() => done && setViewer(true)}
        disabled={!done}
        aria-label={done ? `ดูสไลด์ ${c.title}` : undefined}
      >
        {done ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.slides[0]} alt={c.title ?? ""} className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" loading="lazy" />
            <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-gradient-to-t from-black/90 to-transparent py-3 text-sm font-semibold opacity-0 transition-opacity group-hover:opacity-100">
              <Eye className="size-4" /> ดูทีละสไลด์
            </span>
          </>
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-3 p-4">
            {working ? (
              <>
                <Skeleton className="absolute inset-0 rounded-none opacity-40" />
                <Loader2 className="relative size-8 animate-spin text-primary" />
                <span className="relative text-center text-sm">{CAROUSEL_STAGE_LABELS[c.stage]}</span>
                <Progress value={carouselProgress(c.stage, c.status) * 100} className="relative w-3/4" />
              </>
            ) : (
              <>
                <AlertTriangle className="size-8 text-destructive" />
                <span className="text-center text-sm">{c.status === "cancelled" ? "ยกเลิกแล้ว" : "สร้างไม่สำเร็จ"}</span>
              </>
            )}
          </div>
        )}
        <span className="absolute top-2 left-2 rounded-md bg-black/70 px-2 py-0.5 text-xs font-bold text-primary">#{c.position}</span>
      </button>

      <div className="flex flex-1 flex-col gap-2 px-3 pb-3">
        <p className="line-clamp-2 min-h-10 text-sm font-semibold leading-snug">{c.title ?? "กำลังเลือกหัวข้อ…"}</p>
        <div className="flex flex-wrap gap-1">
          {c.category && <Badge variant="gold">{CATEGORY_LABELS[c.category]}</Badge>}
          {c.status === "completed" && <Badge variant="success">เสร็จแล้ว</Badge>}
          {c.status === "failed" && <Badge variant="destructive">ล้มเหลว</Badge>}
          {c.similarity.some((m) => m.similarity >= 0.8) && (
            <Badge variant="warning" title={c.similarity.map((m) => `${m.title} (${(m.similarity * 100).toFixed(0)}%)`).join("\n")}>
              คล้ายหัวข้อเดิม
            </Badge>
          )}
        </div>
        {c.error && <p className={c.status === "failed" ? "text-xs text-red-300" : "text-xs text-amber-300"}>{c.error}</p>}
        {error && <p className="text-xs text-red-300">{error}</p>}
        <div className="mt-auto flex items-center justify-between gap-1 pt-1">
          <span className="text-muted-foreground text-[11px]">{c.costUsd > 0 ? formatUsd(c.costUsd) : ""}</span>
          <div className="flex gap-1">
            <Button size="icon" variant="outline" disabled={!canRegenerate || working || pending} onClick={() => setConfirm(true)} title="สร้างใหม่เฉพาะ carousel นี้" aria-label="สร้างใหม่">
              {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            </Button>
            <Button size="icon" variant="gold" disabled={!done} asChild={done} title="ดาวน์โหลด ZIP" aria-label="ดาวน์โหลด ZIP">
              {done ? (
                <a href={`/api/carousels/${c.id}/download`} download>
                  <Download />
                </a>
              ) : (
                <Download />
              )}
            </Button>
          </div>
        </div>
      </div>

      {done && <SlideViewer carousel={c} open={viewer} onOpenChange={setViewer} />}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>สร้าง carousel #{c.position} ใหม่</DialogTitle>
            <DialogDescription>สร้างใหม่เฉพาะ carousel นี้ อีก 4 carousel ในชุดจะไม่ถูกแก้ไข</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Button onClick={() => regenerate(false)} disabled={pending}>
              <RefreshCw /> หัวข้อเดิม เขียนเนื้อหาและภาพใหม่
            </Button>
            {allowNewTopic && (
              <Button variant="outline" onClick={() => regenerate(true)} disabled={pending}>
                <Shuffle /> เปลี่ยนเป็นหัวข้อใหม่ที่ไม่ซ้ำ
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
