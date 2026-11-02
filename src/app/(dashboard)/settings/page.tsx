import { SettingsForm } from "@/components/settings-form";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold">ตั้งค่า</h1>
        <p className="text-muted-foreground text-sm">เกณฑ์ตรวจหัวข้อซ้ำ โควตา งบประมาณ และการสร้างภาพประกอบ</p>
      </div>
      <SettingsForm />
    </div>
  );
}
