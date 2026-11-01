import { EvaluateForm } from "@/components/evaluate-form";

export const metadata = { title: "Evaluate · Keel" };

export default function EvaluatePage() {
  return (
    <main>
      <h1>Evaluate</h1>
      <p>
        Paste a job description or give a URL. If a site blocks the fetch, paste the text. The score
        splits skills and experience from preferences, and it cites the baseline.
      </p>
      <EvaluateForm />
    </main>
  );
}
