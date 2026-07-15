import { getJobsView } from "@/lib/jobs-monitor";
import { getDesignMode } from "@/lib/design-mode";
import { JobsClient } from "./jobs-client";
import { JobsFilament } from "./jobs-filament";

export const metadata = { title: "Jobs Monitor" };
export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const [jobs, design] = await Promise.all([getJobsView(), getDesignMode()]);
  return design === "filament" ? <JobsFilament jobs={jobs} /> : <JobsClient jobs={jobs} />;
}
