import { PreferencesForm } from "@/components/preferences-form";

export const metadata = { title: "Preferences · Keel" };

export default function PreferencesPage() {
  return (
    <main>
      <h1>Preferences</h1>
      <p>
        Target pay is a Microsoft-equivalent level range, for example 63 to 65. The level map below
        is mostly example data. Verify it before you rely on a score.
      </p>
      <PreferencesForm />
    </main>
  );
}
