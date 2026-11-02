"use client";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { api, ApiError, formatThaiDate, formatUsd } from "@/lib/client/api";
import type { JobDTO } from "@/lib/api/serialize";
import type { SimilarityMatch } from "@/lib/types";

interface Estimate {
  totalUsd: number;
}

const EXAMPLES = ["ทำไม MSS ถึงสำคัญ?", "วิธีใช้ FVG ให้ถูกต้อง", "ทำไมเทรดเดอร์ส่วนใหญ่ขาดทุน?"];

export function GeneratePanel({ busy, onCreated }: { busy: boolean; onCreated: (job: JobDTO) => void }) {
  const [topic, setTopic] = useState("");
  const [angles, setAngles] = useState(false);
  const [override, setOverride] = useState(false);
  const [check, setCheck] = useState<{ topic: string; matches: SimilarityMatch[] }>({ topic: "", matches: [] });
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState<"auto" | "custom" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [estimates, setEstimates] = useState<{ auto?: Estimate; single?: Estimate }>({});
  // One idempotency key per intended job: repeated clicks / retries reuse it.
  const keyRef = useRef<{ key: string; sig: string } | null>(null);

  useEffect(() => {
    Promise.all([
      api<{ estimate: Estimate }>("/api/estimate?carousels=5&ideation=true"),
      api<{ estimate: Estimate }>("/api/estimate?carousels=1&ideation=false"),
    ])
      .then(([a, s]) => setEstimates({ auto: a.estimate, single: s.estimate }))
      .catch(() => undefined);
  }, []);

  // Debounced similarity check while typing
  useEffect(() => {
    const t = topic.trim();
    if (t.length < 4) return;
    const handle = setTimeout(async () => {
      setChecking(true);
      try {
        const res = await api<{ matches: SimilarityMatch[] }>("/api/topics/check", { method: "POST", json: { topic: t } });
        setCheck({ topic: t, matches: res.matches });
      } catch {
        /* the check is advisory; creation re-checks on the server */
      } finally {
        setChecking(false);
      }
    }, 700);
    return () => clearTimeout(handle);
  }, [topic]);

  function idempotencyKey(sig: string) {
    if (!keyRef.current || keyRef.current.sig !== sig) keyRef.current = { key: crypto.randomUUID(), sig };
    return keyRef.current.key;
  }

  async function create(mode: "auto" | "custom") {
    if (submitting) return;
    setSubmitting(mode);
    setError(null);
    const body =
      mode === "auto"
        ? { mode, idempotencyKey: idempotencyKey("auto") }
        : { mode, topic: topic.trim(), angles, overrideSimilarity: override, idempotencyKey: idempotencyKey(`custom:${topic.trim()}:${angles}:${override}`) };
    try {
      const res = await api<{ job: JobDTO }>("/api/jobs", { method: "POST", json: body });
      keyRef.current = null;
      if (mode === "custom") setTopic("");
      onCreated(res.job);
    } catch (e) {
      if (e instanceof ApiError && e.code === "similar_topic") {
        setCheck({ topic: topic.trim(), matches: (e.details as { matches: SimilarityMatch[] }).matches ?? [] });
        setError(e.message);
      } else if (e instanceof ApiError && e.code === "active_job_exists") {
        setError(e.message);
        const id = (e.details as { jobId?: string })?.jobId;
        if (id) onCreated({ id } as JobDTO);
      } else {
        setError(e instanceof ApiError ? e.message : "สร้างงานไม่สำเร็จ");
      }
      keyRef.current = null;
    } finally {
      setSubmitting(null);
    }
  }

  const matches = check.topic === topic.trim() ? check.matches : [];
  const disabled = busy || !!submitting;
  const needsOverride = matches.length > 0 && !override;

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card className="relative overflow-hidden lg:col-span-2">
        <div className="pointer-events-none absolute -top-20 -right-20 size-64 rounded-full bg-primary/15 blur-3xl" />
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" /> สร้างอัตโนมัติ
          </CardTitle>
          <CardDescription>
            AI คิดหัวข้อใหม่อย่างน้อย 10 หัวข้อ แล้วคัดที่ไม่ซ้ำกับคอนเทนต์เดิม 5 หัวข้อ แล้วสร้าง 5 carousel (25 สไลด์)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button size="lg" className="w-full text-base" onClick={() => create("auto")} disabled={disabled}>
            {submitting === "auto" ? <Loader2 className="animate-spin" /> : <Sparkles />}
            สร้าง 5 Carousel
          </Button>
          <p className="text-muted-foreground text-xs">
            ค่าใช้จ่ายโดยประมาณ: <span className="text-foreground font-semibold">{estimates.auto ? formatUsd(estimates.auto.totalUsd) : "…"}</span> ต่อชุด
          </p>
        </CardContent>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wand2 className="size-5 text-primary" /> ระบุหัวข้อเอง
          </CardTitle>
          <CardDescription className="flex flex-wrap gap-x-3 gap-y-1">
            <span>ตัวอย่าง:</span>
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                className="text-primary/90 hover:text-primary hover:underline"
                onClick={() => {
                  setTopic(ex);
                  setOverride(false);
                }}
              >
                {ex}
              </button>
            ))}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            className="flex flex-col gap-3 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              create("custom");
            }}
          >
            <Input value={topic} onChange={(e) => {
                setTopic(e.target.value);
                setOverride(false);
              }} placeholder="ระบุหัวข้อเอง เช่น ทำไม MSS ถึงสำคัญ?" maxLength={140} aria-label="ระบุหัวข้อเอง" />
            <Button type="submit" className="sm:w-48" disabled={disabled || topic.trim().length < 4 || needsOverride}>
              {submitting === "custom" ? <Loader2 className="animate-spin" /> : <Wand2 />}
              สร้างจากหัวข้อ
            </Button>
          </form>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Label className="cursor-pointer">
              <Switch checked={angles} onCheckedChange={setAngles} />
              สร้าง 5 มุมมองที่ต่างกัน (5 carousel)
            </Label>
            <span className="text-muted-foreground text-xs">
              ประมาณ {angles ? (estimates.auto ? formatUsd(estimates.auto.totalUsd) : "…") : estimates.single ? formatUsd(estimates.single.totalUsd) : "…"}
              {checking && " · กำลังตรวจหัวข้อซ้ำ…"}
            </span>
          </div>
          {matches.length > 0 && (
            <Alert variant="warning">
              <AlertTriangle />
              <AlertTitle>หัวข้อนี้คล้ายกับคอนเทนต์ที่เคยสร้าง</AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-0.5 pl-4">
                  {matches.map((m) => (
                    <li key={m.topic_id}>
                      {m.title} · {m.exact ? "ตรงกันทุกคำ" : `คล้าย ${(m.similarity * 100).toFixed(0)}%`} · {formatThaiDate(m.created_at)}
                    </li>
                  ))}
                </ul>
                <Label className="mt-2 cursor-pointer">
                  <Checkbox checked={override} onCheckedChange={(v) => setOverride(v === true)} />
                  ยืนยันสร้างต่อ (ฉันต้องการมุมมองใหม่ของหัวข้อนี้)
                </Label>
                <p className="text-xs opacity-70">ระบบตรวจความคล้ายด้วย AI ช่วยลดการซ้ำได้ แต่ไม่รับประกันว่าไม่ซ้ำ 100%</p>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive" className="lg:col-span-5">
          <AlertTriangle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
