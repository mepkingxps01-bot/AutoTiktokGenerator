import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dr.Trader AI Carousel Factory",
  description: "โรงงานสร้าง Carousel สอนเทรดภาษาไทยสำหรับ TikTok",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#0A0A0B" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className="dark">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
