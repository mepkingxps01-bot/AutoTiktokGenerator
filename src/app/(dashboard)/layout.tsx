import { AppHeader } from "@/components/app-header";
import { publicRuntimeInfo } from "@/lib/config";
import { BRAND } from "@/lib/brand";

export const dynamic = "force-dynamic";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const info = publicRuntimeInfo();
  return (
    <>
      <AppHeader mockAi={info.mockAi} storeKind={info.storeKind} />
      <main className="mx-auto max-w-7xl px-4 py-6 md:py-8">{children}</main>
      <footer className="text-muted-foreground mx-auto max-w-7xl px-4 pb-8 text-xs">
        {BRAND.name} / {BRAND.thaiName} · {BRAND.tagline} · {BRAND.disclaimer}
      </footer>
    </>
  );
}
