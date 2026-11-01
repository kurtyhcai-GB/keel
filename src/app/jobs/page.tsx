import { JobsTable } from "@/components/jobs-table";

export const metadata = { title: "Tracked jobs · Keel" };

export default function JobsPage() {
  return (
    <main>
      <h1>Tracked jobs</h1>
      <p>Only jobs you chose to track are listed. Sort by any column. Open a title to read the evaluation.</p>
      <JobsTable />
    </main>
  );
}
