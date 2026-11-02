import { LoginForm } from "@/components/login-form";
import { BRAND } from "@/lib/brand";

export const metadata = { title: "เข้าสู่ระบบ | Dr.Trader" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary shadow-[0_0_40px_-8px_rgba(243,186,47,0.7)]">
            <svg viewBox="0 0 64 64" className="size-9" aria-hidden>
              <path d="M14 46 L26 30 L36 38 L50 16" stroke="#0A0A0B" strokeWidth="7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 className="text-2xl font-extrabold">
            Dr.<span className="gold-text">Trader</span> Carousel Factory
          </h1>
          <p className="text-muted-foreground text-sm">
            {BRAND.thaiName} · {BRAND.tagline}
          </p>
        </div>
        <LoginForm next={safeNext} />
      </div>
    </main>
  );
}
