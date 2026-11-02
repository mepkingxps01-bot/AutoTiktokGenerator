import { HistoryView } from "@/components/history-view";
import { RecentJobs } from "@/components/dashboard/recent-jobs";

export default function HistoryPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold">ประวัติคอนเทนต์</h1>
        <p className="text-muted-foreground text-sm">
          หน่วยความจำหัวข้อที่ระบบใช้กันซ้ำ: ค้นหา กรองตามสถานะและหมวดหมู่ได้ (การตรวจความคล้ายช่วยลดการซ้ำ แต่ไม่รับประกันว่าไม่ซ้ำ 100%)
        </p>
      </div>
      <HistoryView />
      <RecentJobs limit={20} />
    </div>
  );
}
