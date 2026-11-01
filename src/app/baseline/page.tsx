import { BaselinePanel } from "@/components/baseline-panel";

export const metadata = { title: "Baseline · Keel" };

export default function BaselinePage() {
  return (
    <main>
      <h1>Baseline</h1>
      <p>
        Upload a PDF, DOCX, or text file, or add a role by hand. Extracted facts stay in draft until
        you confirm them. If two documents disagree on dates, Keel asks instead of merging them.
      </p>
      <BaselinePanel />
    </main>
  );
}
