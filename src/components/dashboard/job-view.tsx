"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Ban, Download, Loader2, RotateCcw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, formatThaiDate, formatUsd } from "@/lib/client/api";
import type { CarouselDTO, JobDTO } from "@/lib/api/serialize";
import { JOB_STATUS_LABELS, carouselProgress } from "@/lib/labels";
import { CarouselCard } from "./carousel-card";

interface JobResponse {
  job: JobDTO;
  carousels: CarouselDTO[];
}

const ACTIVE = ["queued", "running"];

export function JobView({ jobId, onActiveChange }: { jobId: string; onActiveChange?: (active: boolean) => void }) {
  const [data, setData] = useState<JobResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<"retry" | "cancel" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<JobResponse>(`/api/jobs/${jobId}`);
      setData(res);
      setError(null);
      return res;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "โหลดสถานะงานไม่สำเร็จ");
      return null;
    }
  }, [jobId]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const res = await load();
      if (cancelled) return;
      const active = !!res && ACTIVE.includes(res.job.status);
      onActiveChange?.(active);
      // poll quickly while active, slowly otherwise (picks up regenerations started elsewhere)
      timer.current = setTimeout(tick, active ? 2500 : res ? 15000 : 5000);
    };
    tick();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load, onActiveChange]);

  async function run(kind: "retry" | "cancel") {
    setAction(kind);
    try {
      await api(`/api/jobs/${jobId}/${kind}`, { method: "POST" });
      await load();
      if (kind === "retry") onActiveChange?.(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "ดำเนินการไม่สำเร็จ");
    } finally {
      setAction(null);
    }
  }

  if (!data) {
    return error ? (
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    ) : (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="aspect-[9/16]" />
        ))}
      </div>
    );
  }

  const { job, carousels } = data;
  const active = ACTIVE.includes(job.status);
  const progress = carousels.length ? (carousels.reduce((s, c) => s + carouselProgress(c.stage, c.status), 0) / carousels.length) * 100 : 0;
  const completed = carousels.filter((c) => c.status === "completed").length;
  const failed = carousels.filter((c) => c.status === "failed").length;
  const stageText =
    job.stage === "ideation" ? "กำลังคิดและคัดหัวข้อที่ไม่ซ้ำ…" : active ? `กำลังผลิต carousel (${completed}/${carousels.length} เสร็จแล้ว)` : JOB_STATUS_LABELS[job.status];
  const statusVariant = job.status === "completed" ? "success" : job.status === "failed" ? "destructive" : job.status === "partial" ? "warning" : "gold";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex flex-wrap items-center gap-2">
              {job.mode === "auto" ? "ชุดอัตโนมัติ 5 Carousel" : job.input.angles ? `5 มุมมอง: ${job.input.topic}` : `หัวข้อ: ${job.input.topic}`}
              <Badge variant={statusVariant}>{JOB_STATUS_LABELS[job.status]}</Badge>
              {job.mock && <Badge variant="warning">MOCK</Badge>}
            </CardTitle>
            <CardDescription>
              สร้างเมื่อ {formatThaiDate(job.createdAt)} · ประมาณการ {formatUsd(job.estimatedCostUsd)} · ใช้จริง {formatUsd(job.actualCostUsd)}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {active && (
              <Button variant="outline" size="sm" onClick={() => run("cancel")} disabled={!!action}>
                {action === "cancel" ? <Loader2 className="animate-spin" /> : <Ban />} ยกเลิก
              </Button>
            )}
            {!active && failed > 0 && (
              <Button variant="outline" size="sm" onClick={() => run("retry")} disabled={!!action}>
                {action === "retry" ? <Loader2 className="animate-spin" /> : <RotateCcw />} ลองใหม่ ({failed})
              </Button>
            )}
            <Button size="sm" disabled={completed === 0} asChild={completed > 0}>
              {completed > 0 ? (
                <a href={`/api/jobs/${job.id}/download`} download>
                  <Download /> ดาวน์โหลดทั้งชุด ({completed})
                </a>
              ) : (
                <span>
                  <Download /> ดาวน์โหลดทั้งชุด
                </span>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              {active && <Loader2 className="size-4 animate-spin text-primary" />}
              {stageText}
            </span>
            <span className="font-semibold text-primary">{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} />
          {job.error && (
            <p className={job.status === "failed" ? "text-sm text-red-300" : "text-sm text-amber-300"}>
              {job.error}
            </p>
          )}
          {error && <p className="text-sm text-red-300">{error}</p>}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {carousels.map((c) => (
          <CarouselCard
            key={`${c.id}:${c.version}`}
            carousel={c}
            canRegenerate={!active || c.status !== "queued"}
            allowNewTopic={job.mode === "auto" || !!job.input.angles}
            onChanged={load}
          />
        ))}
      </div>
    </div>
  );
}
