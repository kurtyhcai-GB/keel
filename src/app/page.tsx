import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <h1>Keel</h1>
      <p>
        Keel is a self-hosted job search that scores roles against a source-cited record of your
        work. Resumes and evaluations stay on this machine unless you configure a model provider.
      </p>
      <p>This version has no sign-in. Every row is stored for one local user so an account can be added later.</p>
      <ol>
        <li>
          <Link href="/baseline">Baseline</Link> — upload a resume or add facts by hand.
        </li>
        <li>
          <Link href="/preferences">Preferences</Link> — location, worksite, commute, and a Microsoft level range.
        </li>
        <li>
          <Link href="/evaluate">Evaluate</Link> — paste a posting or a URL and read the fit score.
        </li>
        <li>
          <Link href="/jobs">Tracked jobs</Link> — the ranked list of roles you chose to keep.
        </li>
        <li>
          <Link href="/tailor">Tailor</Link> — resume edits and a cover letter limited to the baseline.
        </li>
      </ol>
      <p>
        The pages are a working skeleton. See the README for how to run it and <code>docs/design.md</code>{" "}
        for the data model and the AI adapter.
      </p>
    </main>
  );
}
