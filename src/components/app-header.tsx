"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FlaskConical, History, LayoutDashboard, LogOut, Settings } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "แดชบอร์ด", icon: LayoutDashboard },
  { href: "/history", label: "ประวัติคอนเทนต์", icon: History },
  { href: "/settings", label: "ตั้งค่า", icon: Settings },
];

export function AppHeader({ mockAi, storeKind }: { mockAi: boolean; storeKind: "supabase" | "local" }) {
  const pathname = usePathname();
  const router = useRouter();
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary">
            <svg viewBox="0 0 64 64" className="size-6" aria-hidden>
              <path d="M14 46 L26 30 L36 38 L50 16" stroke="#0A0A0B" strokeWidth="7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="hidden leading-tight sm:block">
            <span className="block text-base font-extrabold">
              Dr.<span className="gold-text">Trader</span>
            </span>
            <span className="text-muted-foreground block text-[11px]">AI Carousel Factory</span>
          </span>
        </Link>
        {mockAi && (
          <Badge variant="warning" title="ไม่มีการเรียก OpenAI จริง เนื้อหาเป็นตัวอย่างสำหรับทดสอบระบบเท่านั้น">
            <FlaskConical /> โหมดจำลอง (MOCK)
          </Badge>
        )}
        {storeKind === "local" && (
          <Badge variant="secondary" title="ข้อมูลเก็บในไฟล์บนเครื่อง (.data) ไม่ได้ใช้ Supabase">
            ฐานข้อมูลในเครื่อง
          </Badge>
        )}
        <nav className="ml-auto flex items-center gap-1">
          {NAV.map((n) => {
            const active = n.href === "/" ? pathname === "/" || pathname.startsWith("/jobs") : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active ? "bg-accent text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <n.icon className="size-4" />
                <span className="hidden md:inline">{n.label}</span>
              </Link>
            );
          })}
          <Button variant="ghost" size="icon" onClick={logout} aria-label="ออกจากระบบ" title="ออกจากระบบ">
            <LogOut />
          </Button>
        </nav>
      </div>
    </header>
  );
}
