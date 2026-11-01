import { EvaluateForm } from "@/components/evaluate-form";

export const metadata = { title: "Evaluate · Keel" };

export default function EvaluatePage() {
  return (
    <main>
      <h1>Evaluate</h1>
      <p>
        Paste a job description or give a URL. If the location is outside your list, or the role is
        hybrid or on-site while you want remote only, Keel stops and asks before it scores. If a
        site blocks the fetch, paste the text.
      </p>
      <EvaluateForm />
    </main>
  );
}
