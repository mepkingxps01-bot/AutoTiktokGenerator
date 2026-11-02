"use client";
import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { api, ApiError } from "@/lib/client/api";
import type { Settings } from "@/lib/types";

function NumberField({ id, label, hint, value, step, min, max, onChange }: { id: string; label: string; hint: string; value: number; step: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" value={value} step={step} min={min} max={max} onChange={(e) => onChange(Number(e.target.value))} />
      <p className="text-muted-foreground text-xs">{hint}</p>
    </div>
  );
}

const selectClass = "h-11 w-full rounded-md border bg-black/40 px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40";

export function SettingsForm() {
  const [s, setS] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api<{ settings: Settings }>("/api/settings").then((r) => setS(r.settings)).catch(() => setMsg({ ok: false, text: "โหลดการตั้งค่าไม่สำเร็จ" }));
  }, []);

  if (!s) return <Loader2 className="size-6 animate-spin text-primary" />;

  const set = <K extends keyof Settings>(k: K, patch: Partial<Settings[K]>) => setS({ ...s, [k]: { ...s[k], ...patch } });

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const r = await api<{ settings: Settings }>("/api/settings", { method: "PUT", json: s });
      setS(r.settings);
      setMsg({ ok: true, text: "บันทึกการตั้งค่าแล้ว" });
    } catch (e) {
      const details = e instanceof ApiError && Array.isArray(e.details) ? ` (${(e.details as string[]).join(", ")})` : "";
      setMsg({ ok: false, text: (e instanceof ApiError ? e.message : "บันทึกไม่สำเร็จ") + details });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>ระบบกันหัวข้อซ้ำ</CardTitle>
          <CardDescription>ค่าความคล้าย (cosine similarity 0.5-1.0) ยิ่งต่ำยิ่งเข้มงวด</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <NumberField id="reject" label="เกณฑ์ปฏิเสธ (อัตโนมัติ)" hint="หัวข้อที่คล้ายประวัติเกินค่านี้จะถูกตัดทิ้ง" value={s.similarity.rejectThreshold} step={0.01} min={0.5} max={1} onChange={(v) => set("similarity", { rejectThreshold: v })} />
          <NumberField id="warn" label="เกณฑ์เตือน (หัวข้อเอง)" hint="แสดงคำเตือนเมื่อหัวข้อที่พิมพ์คล้ายของเดิม" value={s.similarity.warnThreshold} step={0.01} min={0.5} max={1} onChange={(v) => set("similarity", { warnThreshold: v })} />
          <NumberField id="batch" label="ความคล้ายในชุดเดียวกัน" hint="หัวข้อ 5 เรื่องในชุดต้องต่างกันอย่างน้อยเท่านี้" value={s.similarity.batchThreshold} step={0.01} min={0.5} max={1} onChange={(v) => set("similarity", { batchThreshold: v })} />
          <NumberField id="angle" label="ความคล้ายโหมด 5 มุมมอง" hint="มุมมองของหัวข้อเดียวกันจึงคล้ายกันได้มากกว่า" value={s.similarity.angleBatchThreshold} step={0.01} min={0.5} max={1} onChange={(v) => set("similarity", { angleBatchThreshold: v })} />
          <NumberField id="cand" label="จำนวนหัวข้อที่ให้ AI เสนอ" hint="อย่างน้อย 10 ต่อรอบ" value={s.ideation.candidateCount} step={1} min={10} max={30} onChange={(v) => set("ideation", { candidateCount: v })} />
          <NumberField id="rounds" label="จำนวนรอบเสนอหัวข้อสูงสุด" hint="ถ้าหัวข้อถูกตัดมาก จะให้ AI เสนอใหม่" value={s.ideation.maxRounds} step={1} min={1} max={5} onChange={(v) => set("ideation", { maxRounds: v })} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>ควบคุมค่าใช้จ่าย</CardTitle>
          <CardDescription>ระบบจะปฏิเสธงานใหม่เมื่อเกินโควตาหรืองบประมาณ (เวลาไทย)</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <NumberField id="daily" label="โควตา carousel ต่อวัน" hint="นับรวมการสร้างใหม่ (regenerate)" value={s.quotas.dailyCarousels} step={1} min={1} max={500} onChange={(v) => set("quotas", { dailyCarousels: v })} />
          <NumberField id="budget" label="งบประมาณต่อเดือน (USD)" hint="0 = ไม่จำกัด" value={s.quotas.monthlyBudgetUsd} step={1} min={0} max={10000} onChange={(v) => set("quotas", { monthlyBudgetUsd: v })} />
          <div className="space-y-1.5">
            <Label htmlFor="imgmode">ภาพประกอบ</Label>
            <select id="imgmode" className={selectClass} value={s.images.mode} onChange={(e) => set("images", { mode: e.target.value as Settings["images"]["mode"] })}>
              <option value="ai">AI (OpenAI Images)</option>
              <option value="procedural">กราฟิกอัตโนมัติ (ไม่มีค่าใช้จ่าย)</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="quality">คุณภาพภาพ AI</Label>
            <select id="quality" className={selectClass} value={s.images.quality} onChange={(e) => set("images", { quality: e.target.value as Settings["images"]["quality"] })}>
              <option value="low">low (ถูกที่สุด)</option>
              <option value="medium">medium</option>
              <option value="high">high (แพงที่สุด)</option>
            </select>
          </div>
          <Label className="cursor-pointer sm:col-span-2">
            <Switch checked={s.images.reuseArtwork} onCheckedChange={(v) => set("images", { reuseArtwork: v })} />
            ใช้ภาพประกอบเดิมซ้ำเมื่อหมวดหมู่และ motif ตรงกัน (ประหยัดค่าใช้จ่าย)
          </Label>
          <NumberField id="reuse" label="ใช้ภาพเดิมซ้ำได้สูงสุด (ครั้ง)" hint="หลังจากนั้นจะสร้างภาพใหม่" value={s.images.maxReusePerArtwork} step={1} min={1} max={100} onChange={(v) => set("images", { maxReusePerArtwork: v })} />
        </CardContent>
      </Card>

      <div className="flex items-center gap-3 lg:col-span-2">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />} บันทึกการตั้งค่า
        </Button>
        {msg && (
          <Alert variant={msg.ok ? "gold" : "destructive"} className="w-auto py-2">
            <AlertDescription>{msg.text}</AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
