/** US full-time year used when a posting states an hourly range. */
export const HOURS_PER_YEAR = 2080;

export type PayKind = "base" | "total";

export type StoredPayRange = {
  min: number;
  max: number;
  currency: string;
  period: "year";
  kind: PayKind | null;
  scope: "us" | "location" | "other";
  label: string;
};

export type ParsedPay = {
  payMin: number | null;
  payMax: number | null;
  payCurrency: string | null;
  payPeriod: "year" | null;
  payRaw: string | null;
  payKind: PayKind | null;
  payRanges: StoredPayRange[];
};

export const EMPTY_PAY: ParsedPay = {
  payMin: null,
  payMax: null,
  payCurrency: null,
  payPeriod: null,
  payRaw: null,
  payKind: null,
  payRanges: [],
};

type FoundRange = StoredPayRange & { index: number };

const RANGE_RE =
  /(?:(?:USD|US\$|CAD|EUR|GBP)\s*)?([$£€])?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(k)?\s*(?:-|–|—|to)\s*(?:(?:USD|US\$|CAD|EUR|GBP)\s*)?([$£€])?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(k)?/gi;

function currencyOf(raw: string): string {
  if (/£|\bGBP\b/i.test(raw)) return "GBP";
  if (/€|\bEUR\b/i.test(raw)) return "EUR";
  if (/\bCAD\b/i.test(raw)) return "CAD";
  return "USD";
}

function amountOf(rawNumber: string, kilo: string | undefined): number {
  const value = Number(rawNumber.replace(/,/g, ""));
  if (!Number.isFinite(value)) return Number.NaN;
  return kilo ? value * 1000 : value;
}

/** Sentence break that ignores initials such as "U.S." */
function sentenceStart(prior: string): number {
  for (let i = prior.length - 1; i >= 0; i--) {
    if (prior[i] === "\n") return i + 1;
    if (prior[i] === "." && /\s/.test(prior[i + 1] ?? "")) {
      const prev = prior[i - 1] ?? "";
      const beforePrev = prior[i - 2] ?? "";
      if (/[A-Za-z]/.test(prev) && (beforePrev === "." || beforePrev === "" || /\s/.test(beforePrev))) continue;
      return i + 2;
    }
  }
  return 0;
}

function clauseBefore(text: string, index: number): string {
  const prior = text.slice(Math.max(0, index - 280), index);
  const start = sentenceStart(prior);
  return prior.slice(start).replace(/\s+/g, " ").trim();
}

function sentenceAround(text: string, index: number, length: number): string {
  const before = text.slice(0, index);
  const start = sentenceStart(before);
  let end = text.length;
  for (let i = index + length; i < text.length; i++) {
    if (text[i] === "\n") {
      end = i;
      break;
    }
    if (text[i] === "." && /\s/.test(text[i + 1] ?? "") || (text[i] === "." && i === text.length - 1)) {
      const prev = text[i - 1] ?? "";
      const beforePrev = text[i - 2] ?? "";
      if (/[A-Za-z]/.test(prev) && (beforePrev === "." || /\s/.test(beforePrev))) continue;
      end = i + 1;
      break;
    }
  }
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function scopeOf(clause: string): StoredPayRange["scope"] {
  const location = /san francisco|new york|bay area|\bnyc\b|those locations|specific work locations/i.test(clause);
  const us = /across the u\.?s\.?|united states|nationwide|u\.s\. base/i.test(clause);
  if (location && !us) return "location";
  if (location && /different range|specific work|those locations/i.test(clause)) return "location";
  if (us) return "us";
  return "other";
}

function kindOf(clause: string): PayKind | null {
  if (/base pay|base salary|base range/i.test(clause)) return "base";
  if (/total compensation|total comp|\bOTE\b/i.test(clause)) return "total";
  return null;
}

function periodOf(text: string, index: number, length: number): "year" | "hour" {
  const after = text.slice(index + length, index + length + 40);
  if (/per\s+hour|\ban\s+hour|\/\s*hr\b|hourly/i.test(after)) return "hour";
  return "year";
}

function annualize(amount: number, period: "year" | "hour"): number {
  return Math.round(period === "hour" ? amount * HOURS_PER_YEAR : amount);
}

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatMoney(amount: number, currency: string): string {
  if (currency.toUpperCase() === "USD") return formatUsd(amount);
  const formatted = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(amount);
  return `${currency.toUpperCase()} ${formatted}`;
}

export function formatPayLabel(input: {
  payMin?: number | null;
  payMax?: number | null;
  payCurrency?: string | null;
  payPeriod?: string | null;
  payRaw?: string | null;
}): string | null {
  if (input.payMin == null && input.payMax == null) return null;
  const currency = input.payCurrency ?? "USD";
  const min = input.payMin ?? input.payMax!;
  const max = input.payMax ?? input.payMin!;
  const body =
    min === max ? formatMoney(min, currency) : `${formatMoney(min, currency)} - ${formatMoney(max, currency)}`;
  const period = input.payPeriod === "hour" ? "/ hr" : "/ yr";
  const basis = input.payRaw && /base pay|base salary/i.test(input.payRaw) ? " base" : "";
  return `${body} ${period}${basis}`;
}

/**
 * Pull a posted pay range out of job text. The general U.S. range is primary.
 * Location-specific ranges are kept on `payRanges`. Hourly ranges are stored
 * as annual pay (40 hours × 52 weeks).
 */
export function parsePay(text: string): ParsedPay {
  const found: FoundRange[] = [];
  for (const match of text.matchAll(RANGE_RE)) {
    const raw = match[0];
    const hasCurrency = /USD|US\$|CAD|EUR|GBP|[$£€]/i.test(raw);
    const hasK = Boolean(match[3] || match[6]);
    if (!hasCurrency && !hasK) continue;
    const index = match.index ?? 0;
    const left = amountOf(match[2] ?? "", match[3]);
    const right = amountOf(match[5] ?? "", match[6]);
    if (!Number.isFinite(left) || !Number.isFinite(right)) continue;
    const stated = periodOf(text, index, raw.length);
    const low = Math.min(left, right);
    const high = Math.max(left, right);
    if (stated === "year" && high < 1000 && !match[3] && !match[6]) continue;
    const clause = clauseBefore(text, index);
    found.push({
      index,
      min: annualize(low, stated),
      max: annualize(high, stated),
      currency: currencyOf(raw),
      period: "year",
      kind: kindOf(`${clause} ${text.slice(index, index + raw.length + 24)}`),
      scope: scopeOf(clause),
      label: clause.slice(0, 160),
    });
  }
  if (found.length === 0) return EMPTY_PAY;

  const primary = found.find((range) => range.scope === "us") ?? found.find((range) => range.scope !== "location") ?? found[0]!;
  const secondary = found.filter((range) => range !== primary).map(({ index: _index, ...range }) => range);
  return {
    payMin: primary.min,
    payMax: primary.max,
    payCurrency: primary.currency,
    payPeriod: "year",
    payRaw: sentenceAround(text, primary.index, 1),
    payKind: primary.kind,
    payRanges: secondary,
  };
}
