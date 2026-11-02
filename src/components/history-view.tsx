"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, ApiError, formatThaiDate } from "@/lib/client/api";
import { TOPIC_STATUS_LABELS } from "@/lib/labels";
import { CATEGORIES, CATEGORY_LABELS, type TopicRecord, type TopicStatus } from "@/lib/types";

type Row = Omit<TopicRecord, "embedding">;
const PAGE = 30;

const selectClass = "h-11 rounded-md border bg-black/40 px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40";

export function HistoryView() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | TopicStatus>("");
  const [category, setCategory] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ items: Row[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      const sp = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
      if (q.trim()) sp.set("q", q.trim());
      if (status) sp.set("status", status);
      if (category) sp.set("category", category);
      api<{ items: Row[]; total: number }>(`/api/topics?${sp}`)
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e) => setError(e instanceof ApiError ? e.message : "โหลดประวัติไม่สำเร็จ"));
    }, 300);
    return () => clearTimeout(handle);
  }, [q, status, category, offset]);

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 md:flex-row">
          <div className="relative flex-1">
            <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input className="pl-9" placeholder="ค้นหาหัวข้อ มุมมอง หรือสรุปเนื้อหา" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} aria-label="ค้นหา" />
          </div>
          <select className={selectClass} value={status} onChange={(e) => { setStatus(e.target.value as TopicStatus | ""); setOffset(0); }} aria-label="สถานะ">
            <option value="">ทุกสถานะ</option>
            {Object.entries(TOPIC_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select className={selectClass} value={category} onChange={(e) => { setCategory(e.target.value); setOffset(0); }} aria-label="หมวดหมู่">
            <option value="">ทุกหมวดหมู่</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </div>
        {error && <p className="text-sm text-red-300">{error}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-muted-foreground text-left text-xs">
              <tr className="border-b">
                <th className="py-2 pr-3 font-medium">หัวข้อ</th>
                <th className="py-2 pr-3 font-medium">หมวดหมู่ / มุมมอง</th>
                <th className="py-2 pr-3 font-medium">สถานะ</th>
                <th className="py-2 pr-3 font-medium">วันที่สร้าง</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((t) => (
                <tr key={t.id} className="border-b border-border/60 align-top">
                  <td className="py-2.5 pr-3">
                    {t.job_id ? (
                      <Link href={`/jobs/${t.job_id}`} className="font-semibold hover:text-primary">{t.title}</Link>
                    ) : (
                      <span className="font-semibold">{t.title}</span>
                    )}
                    {t.summary && <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">{t.summary}</p>}
                  </td>
                  <td className="py-2.5 pr-3">
                    {t.category && <Badge variant="gold">{CATEGORY_LABELS[t.category]}</Badge>}
                    {t.angle && <p className="text-muted-foreground mt-1 text-xs">{t.angle}</p>}
                  </td>
                  <td className="py-2.5 pr-3">
                    <Badge variant={t.status === "completed" ? "success" : t.status === "failed" ? "destructive" : t.status === "reserved" ? "gold" : "secondary"}>
                      {TOPIC_STATUS_LABELS[t.status]}
                    </Badge>
                    <span className="text-muted-foreground ml-1 text-[11px]">{t.source === "custom" ? "หัวข้อเอง" : "อัตโนมัติ"}</span>
                  </td>
                  <td className="text-muted-foreground py-2.5 pr-3 text-xs whitespace-nowrap">{formatThaiDate(t.created_at)}</td>
                </tr>
              ))}
              {data && !data.items.length && (
                <tr>
                  <td colSpan={4} className="text-muted-foreground py-8 text-center">ไม่พบหัวข้อ</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {data && data.total > PAGE && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {offset + 1}-{Math.min(offset + PAGE, data.total)} จาก {data.total}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>ก่อนหน้า</Button>
              <Button size="sm" variant="outline" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>ถัดไป</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
