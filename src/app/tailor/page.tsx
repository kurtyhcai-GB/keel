import { TailorPanel } from "@/components/tailor-panel";

export const metadata = { title: "Tailor · Keel" };

export default function TailorPage() {
  return (
    <main>
      <h1>Tailor</h1>
      <p>
        Resume edits and the cover letter are limited to facts already in the baseline. Nothing here
        should invent employers, dates, or scope.
      </p>
      <TailorPanel />
    </main>
  );
}
