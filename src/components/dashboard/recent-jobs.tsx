"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, formatThaiDate, formatUsd } from "@/lib/client/api";
import type { JobDTO } from "@/lib/api/serialize";
import { JOB_STATUS_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";

export function RecentJobs({ activeId, refreshKey, limit = 8 }: { activeId?: string | null; refreshKey?: number; limit?: number }) {
  const [jobs, setJobs] = useState<JobDTO[] | null>(null);
  useEffect(() => {
    api<{ jobs: JobDTO[] }>(`/api/jobs?limit=${limit}`)
      .then((r) => setJobs(r.jobs))
      .catch(() => setJobs([]));
  }, [refreshKey, limit]);
  if (!jobs?.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">ชุดที่สร้างล่าสุด</CardTitle>
      </CardHeader>
      <CardContent className="divide-y">
        {jobs.map((j) => (
          <Link
            key={j.id}
            href={`/jobs/${j.id}`}
            className={cn("flex items-center justify-between gap-3 py-2 text-sm hover:text-primary", j.id === activeId && "text-primary")}
          >
            <span className="truncate">
              {j.mode === "auto" ? "อัตโนมัติ 5 carousel" : j.input.topic}
              <span className="text-muted-foreground ml-2 text-xs">{formatThaiDate(j.createdAt)}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="text-muted-foreground text-xs">{formatUsd(j.actualCostUsd)}</span>
              <Badge variant={j.status === "completed" ? "success" : j.status === "failed" ? "destructive" : j.status === "partial" ? "warning" : "secondary"}>
                {JOB_STATUS_LABELS[j.status]}
              </Badge>
            </span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
