"use client";
import { useCallback, useState } from "react";
import { GeneratePanel } from "./generate-panel";
import { JobView } from "./job-view";
import { RecentJobs } from "./recent-jobs";
import { UsageBar } from "./usage-bar";
import type { JobDTO } from "@/lib/api/serialize";
import { BRAND } from "@/lib/brand";

export function Dashboard({ initialJobId }: { initialJobId: string | null }) {
  const [jobId, setJobId] = useState<string | null>(initialJobId);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const onActiveChange = useCallback((active: boolean) => {
    setBusy((prev) => {
      if (prev && !active) setRefreshKey((k) => k + 1);
      return active;
    });
  }, []);

  function onCreated(job: JobDTO) {
    setJobId(job.id);
    setBusy(true);
    setRefreshKey((k) => k + 1);
    window.history.replaceState(null, "", `/?job=${job.id}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold md:text-3xl">
            โรงงาน <span className="gold-text">Carousel</span> สอนเทรด
          </h1>
          <p className="text-muted-foreground text-sm">
            {BRAND.tagline} · สร้าง ตรวจ ดาวน์โหลด แล้วโพสต์ลง TikTok ด้วยตัวเอง
          </p>
        </div>
        <UsageBar refreshKey={refreshKey} />
      </div>
      <GeneratePanel busy={busy} onCreated={onCreated} />
      {jobId ? (
        <JobView key={jobId} jobId={jobId} onActiveChange={onActiveChange} />
      ) : (
        <div className="text-muted-foreground rounded-xl border border-dashed p-10 text-center">
          ยังไม่มีงานสร้าง กด <span className="text-primary font-semibold">สร้าง 5 Carousel</span> เพื่อเริ่มต้น
        </div>
      )}
      <RecentJobs activeId={jobId} refreshKey={refreshKey} />
    </div>
  );
}
