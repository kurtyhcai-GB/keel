export function scoreBand(score: number): "strong" | "mixed" | "weak" {
  if (score >= 80) return "strong";
  if (score >= 65) return "mixed";
  return "weak";
}

export function fitLabel(score: number): string {
  const band = scoreBand(score);
  if (band === "strong") return "Strong fit";
  if (band === "mixed") return "Mixed fit";
  return "Weak fit";
}

export function scoreTextClass(score: number): string {
  const band = scoreBand(score);
  if (band === "strong") return "text-emerald-700 dark:text-emerald-300";
  if (band === "mixed") return "text-amber-700 dark:text-amber-300";
  return "text-rose-700 dark:text-rose-300";
}

export function scoreStrokeClass(score: number): string {
  const band = scoreBand(score);
  if (band === "strong") return "stroke-emerald-600 dark:stroke-emerald-400";
  if (band === "mixed") return "stroke-amber-500 dark:stroke-amber-400";
  return "stroke-rose-600 dark:stroke-rose-400";
}

export function scoreBarClass(score: number): string {
  const band = scoreBand(score);
  if (band === "strong") return "bg-emerald-600 dark:bg-emerald-400";
  if (band === "mixed") return "bg-amber-500 dark:bg-amber-400";
  return "bg-rose-600 dark:bg-rose-400";
}

export function scoreChipClass(score: number): string {
  const band = scoreBand(score);
  if (band === "strong") {
    return "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:ring-emerald-900";
  }
  if (band === "mixed") {
    return "bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-100 dark:ring-amber-900";
  }
  return "bg-rose-50 text-rose-800 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-100 dark:ring-rose-900";
}
