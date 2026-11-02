import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { JobView } from "@/components/dashboard/job-view";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="space-y-4">
      <Link href="/" className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:text-primary">
        <ArrowLeft className="size-4" /> กลับแดชบอร์ด
      </Link>
      <JobView jobId={id} />
    </div>
  );
}
