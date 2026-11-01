import type { PreferenceMismatch, PreferenceView, ScorePoint, WorkMode } from "@/lib/types";

export type PreferencePart = {
  id: "location" | "worksite" | "level" | "commute";
  label: string;
  score: number;
  detail: string;
  included: boolean;
  mismatch?: boolean;
};

const SEATTLE_PLACES = [
  "seattle",
  "redmond",
  "bellevue",
  "kirkland",
  "bothell",
  "issaquah",
  "renton",
  "sammamish",
  "mercer island",
];

const SEATTLE_COMMUTE_MINUTES: Record<string, number> = {
  seattle: 20,
  redmond: 28,
  bellevue: 22,
  kirkland: 25,
  bothell: 35,
  issaquah: 32,
  renton: 25,
  sammamish: 35,
  "mercer island": 18,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function inSeattleMetro(value: string | null | undefined): boolean {
  if (!value) return false;
  const lower = value.toLowerCase();
  return SEATTLE_PLACES.some((place) => lower.includes(place));
}

export function locationsMatch(jobLocation: string | null, preferred: string[]): boolean {
  if (!jobLocation || preferred.length === 0) return false;
  const job = jobLocation.toLowerCase();
  if (
    preferred.some((item) => {
      const wanted = item.toLowerCase();
      return job.includes(wanted) || wanted.includes(job);
    })
  ) {
    return true;
  }
  return inSeattleMetro(jobLocation) && preferred.some((item) => inSeattleMetro(item));
}

export function detectWorkModes(worksite: string | null, text: string): WorkMode[] {
  const blob = `${worksite ?? ""}\n${text}`;
  const modes: WorkMode[] = [];
  if (/\bremote\b/i.test(blob)) modes.push("remote");
  if (/\bhybrid\b/i.test(blob)) modes.push("hybrid");
  if (/on-?site|in[- ]office/i.test(blob)) modes.push("onsite");
  return modes;
}

export function primaryWorksite(modes: WorkMode[]): WorkMode | null {
  if (modes.includes("hybrid")) return "hybrid";
  if (modes.includes("onsite") && modes.includes("remote")) return "hybrid";
  if (modes.includes("onsite")) return "onsite";
  if (modes.includes("remote")) return "remote";
  return null;
}

export function findLocationAndWorksiteMismatches(input: {
  location: string | null;
  modes: WorkMode[];
  preferences: PreferenceView | null;
}): PreferenceMismatch[] {
  if (!input.preferences) return [];
  const mismatches: PreferenceMismatch[] = [];
  if (
    input.preferences.locations.length > 0 &&
    input.location &&
    !locationsMatch(input.location, input.preferences.locations)
  ) {
    mismatches.push({
      kind: "location",
      reason: `${input.location} is outside the locations you saved.`,
    });
  }
  const remoteOnly =
    input.preferences.workModes.length === 1 && input.preferences.workModes[0] === "remote";
  const worksite = primaryWorksite(input.modes);
  if (remoteOnly && worksite && worksite !== "remote") {
    mismatches.push({
      kind: "worksite",
      reason: `${worksite === "hybrid" ? "Hybrid" : "On-site"} is not remote, and remote is the only worksite you saved.`,
    });
  }
  return mismatches;
}

export function ruledOutReason(mismatches: PreferenceMismatch[]): string {
  return mismatches.map((mismatch) => mismatch.reason).join(" ");
}

function commuteMinutes(location: string | null, text: string): number | null {
  const explicit = text.match(/commute[^.\n]{0,40}?(\d{1,3})\s*(?:minutes|minute|mins|min)\b/i);
  if (explicit?.[1]) return Number(explicit[1]);
  if (!location || !inSeattleMetro(location)) return null;
  const lower = location.toLowerCase();
  const place = SEATTLE_PLACES.find((token) => lower.includes(token));
  return place ? (SEATTLE_COMMUTE_MINUTES[place] ?? null) : null;
}

function levelGap(
  mappedMin: number | null,
  mappedMax: number | null,
  targetMin: number,
  targetMax: number,
): number | null {
  if (mappedMin == null || mappedMax == null) return null;
  if (mappedMax < targetMin) return targetMin - mappedMax;
  if (targetMax < mappedMin) return mappedMin - targetMax;
  return 0;
}

export function scorePreferences(input: {
  location: string | null;
  modes: WorkMode[];
  jobText: string;
  microsoftLevelMin: number | null;
  microsoftLevelMax: number | null;
  levelLabel: string | null;
  preferences: PreferenceView;
  mismatches: PreferenceMismatch[];
}): { preferencesScore: number; parts: PreferencePart[]; dealBreakers: ScorePoint[]; warnings: string[] } {
  const locationMismatch = input.mismatches.some((item) => item.kind === "location");
  const worksiteMismatch = input.mismatches.some((item) => item.kind === "worksite");
  const worksite = primaryWorksite(input.modes);
  const locationHit =
    !locationMismatch && locationsMatch(input.location, input.preferences.locations);
  const awayFromSeattle = Boolean(input.location) && !inSeattleMetro(input.location);

  let locationScore = 0;
  let locationDetail = locationMismatch
    ? (input.mismatches.find((item) => item.kind === "location")?.reason ?? "Outside saved locations.")
    : input.preferences.locations.length === 0
      ? "No preferred locations are saved, so location is not scored."
      : input.location
        ? `${input.location} is outside the locations you saved.`
        : "The posting does not state a location.";
  let locationIncluded = !locationMismatch && input.preferences.locations.length > 0 && Boolean(input.location);
  if (locationHit && awayFromSeattle) {
    locationScore = 72;
    locationDetail = `${input.location} is a location you marked open. It is outside the Seattle area, so this is a relocation rather than a commute.`;
    locationIncluded = true;
  } else if (locationHit && inSeattleMetro(input.location)) {
    locationScore = 100;
    locationDetail = `${input.location} is in the Seattle-area locations you selected.`;
    locationIncluded = true;
  } else if (locationHit) {
    locationScore = 100;
    locationDetail = `${input.location} matches a location you saved.`;
    locationIncluded = true;
  }

  const worksiteSelected = worksite ? input.preferences.workModes.includes(worksite) : false;
  const worksiteScore = worksiteMismatch || !worksiteSelected ? 0 : 100;
  const worksiteDetail = worksiteMismatch
    ? (input.mismatches.find((item) => item.kind === "worksite")?.reason ?? "Worksite does not match.")
    : !worksite
      ? "The posting does not state a worksite."
      : worksiteSelected
        ? `${worksite} matches a worksite type you selected.`
        : `${worksite} is not among the worksite types you selected.`;

  const distance = levelGap(
    input.microsoftLevelMin,
    input.microsoftLevelMax,
    input.preferences.targetLevelMin,
    input.preferences.targetLevelMax,
  );
  const levelKnown = distance != null;
  const levelScore = !levelKnown ? 0 : distance === 0 ? 100 : distance === 1 ? 55 : 20;
  const levelLabel = input.levelLabel ?? "The mapped level";
  const levelDetail = !levelKnown
    ? "No Microsoft-equivalent level was mapped, so level is not scored."
    : distance === 0
      ? `${levelLabel} sits inside ${input.preferences.targetLevelMin}–${input.preferences.targetLevelMax}.`
      : distance === 1
        ? `${levelLabel} is one level outside ${input.preferences.targetLevelMin}–${input.preferences.targetLevelMax}. That is a stretch, not a deal-breaker.`
        : `${levelLabel} is ${distance} levels outside ${input.preferences.targetLevelMin}–${input.preferences.targetLevelMax}.`;

  const parts: PreferencePart[] = [
    {
      id: "location",
      label: "Location",
      score: locationScore,
      detail: locationDetail,
      included: locationIncluded,
      mismatch: locationMismatch,
    },
    {
      id: "worksite",
      label: "Worksite",
      score: worksiteScore,
      detail: worksiteDetail,
      included: !worksiteMismatch && Boolean(worksite),
      mismatch: worksiteMismatch,
    },
    {
      id: "level",
      label: "Level",
      score: levelScore,
      detail: levelDetail,
      included: levelKnown,
    },
  ];

  const minutes = commuteMinutes(input.location, input.jobText);
  const commuteApplies =
    locationHit && !awayFromSeattle && worksite !== "remote" && worksite !== null && minutes != null;
  if (worksite === "remote") {
    parts.push({
      id: "commute",
      label: "Commute",
      score: 100,
      detail: "Remote role. Commute tolerance is not applied.",
      included: true,
    });
  } else if (commuteApplies && minutes != null) {
    const tolerance = input.preferences.commuteToleranceMinutes ?? 45;
    const over = minutes - tolerance;
    const estimate = input.jobText.match(/commute[^.\n]{0,40}?(\d{1,3})\s*(?:minutes|minute|mins|min)\b/i)
      ? ""
      : " Estimated drive time for this Seattle-area city.";
    parts.push({
      id: "commute",
      label: "Commute",
      score: over <= 0 ? 100 : Math.max(0, 100 - over * 4),
      detail:
        over <= 0
          ? `About ${minutes} min, inside your ${tolerance} min tolerance.${estimate}`
          : `About ${minutes} min, ${over} min over your ${tolerance} min tolerance.${estimate}`,
      included: true,
    });
  } else {
    parts.push({
      id: "commute",
      label: "Commute",
      score: 0,
      detail: awayFromSeattle
        ? "Not applied. Outside the Seattle area this is scored as relocation."
        : "Not applied. Commute is only scored for a Seattle-area office role with a known drive time.",
      included: false,
    });
  }

  const included = parts.filter((part) => part.included);
  const preferencesScore =
    included.length === 0
      ? 100
      : Math.round(included.reduce((sum, part) => sum + part.score, 0) / included.length);

  const dealBreakers: ScorePoint[] = [];
  if (distance != null && distance >= 2) {
    dealBreakers.push({
      text: `Level is ${levelLabel}, ${distance} levels outside your Microsoft-equivalent range of ${input.preferences.targetLevelMin}–${input.preferences.targetLevelMax}.`,
      factIds: [],
    });
  }
  if (
    commuteApplies &&
    minutes != null &&
    (input.preferences.commuteToleranceMinutes ?? 45) < minutes
  ) {
    const tolerance = input.preferences.commuteToleranceMinutes ?? 45;
    dealBreakers.push({
      text: `Typical commute is about ${minutes} minutes, over your ${tolerance} minute tolerance.`,
      factIds: [],
    });
  }

  const warnings = [
    "Commute times for Seattle-area cities are estimates unless the posting states a commute.",
  ];
  return { preferencesScore, parts, dealBreakers, warnings };
}

export function overallFit(
  skillsScore: number,
  preferencesScore: number | null,
  skillsWeight: number,
  dealBreakerCount: number,
): number {
  const skills = clamp(Math.round(skillsScore), 0, 100);
  if (preferencesScore == null) return skills;
  const weight = clamp(Math.round(skillsWeight), 0, 100);
  const raw = Math.round(
    (skills * weight + clamp(preferencesScore, 0, 100) * (100 - weight)) / 100 -
      dealBreakerCount * 6,
  );
  return clamp(raw, 1, 99);
}
