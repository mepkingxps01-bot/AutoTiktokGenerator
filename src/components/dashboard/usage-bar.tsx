"use client";
import { useEffect, useState } from "react";
import { Gauge, Wallet } from "lucide-react";
import { api, formatUsd } from "@/lib/client/api";

interface Status {
  runtime: { mockAi: boolean; storeKind: string; textModel: string; imageModel: string };
  usage: { monthCostUsd: number; monthBudgetUsd: number; todayCarousels: number; dailyQuota: number };
}

export function UsageBar({ refreshKey }: { refreshKey: number }) {
  const [s, setS] = useState<Status | null>(null);
  useEffect(() => {
    api<Status>("/api/status").then(setS).catch(() => undefined);
  }, [refreshKey]);
  if (!s) return null;
  return (
    <div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-xs">
      <span className="flex items-center gap-1.5">
        <Wallet className="size-3.5 text-primary" /> ค่าใช้จ่ายเดือนนี้ {formatUsd(s.usage.monthCostUsd)} / {formatUsd(s.usage.monthBudgetUsd)}
      </span>
      <span className="flex items-center gap-1.5">
        <Gauge className="size-3.5 text-primary" /> สร้างวันนี้ {s.usage.todayCarousels} / {s.usage.dailyQuota} carousel
      </span>
      <span>
        โมเดล: {s.runtime.textModel} · {s.runtime.imageModel}
      </span>
    </div>
  );
}
