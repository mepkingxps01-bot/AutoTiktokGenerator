import { Dashboard } from "@/components/dashboard/dashboard";
import { getStore } from "@/lib/store";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const { job } = await searchParams;
  let jobId = job && /^[0-9a-f-]{36}$/.test(job) ? job : null;
  if (!jobId) {
    const [latest] = await getStore().listJobs(1);
    jobId = latest?.id ?? null;
  }
  return <Dashboard initialJobId={jobId} />;
}
