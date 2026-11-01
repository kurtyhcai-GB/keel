import { AppError } from "@/lib/errors";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "0.0.0.0",
  "::1",
  "metadata.google.internal",
]);

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function isPrivateIp(host: string): boolean {
  if (host.includes(":")) {
    const lowered = host.toLowerCase();
    return lowered === "::1" || lowered.startsWith("fe80:") || lowered.startsWith("fc") || lowered.startsWith("fd");
  }
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return true;
  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError("That URL could not be parsed.", 400);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError("Only http and https URLs can be fetched.", 400);
  }
  if (url.username || url.password) {
    throw new AppError("URLs with a username or password are not fetched.", 400);
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    BLOCKED_HOSTS.has(host) ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    isPrivateIp(host)
  ) {
    throw new AppError("That URL points at a local or private address. Paste the job text instead.", 400);
  }
  return url;
}

export async function fetchPostingText(
  raw: string,
): Promise<{ ok: true; text: string } | { ok: false; needsPaste: true; reason: string }> {
  let current: URL;
  try {
    current = assertPublicHttpUrl(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Invalid URL";
    return { ok: false, needsPaste: true, reason };
  }

  try {
    for (let hop = 0; hop < 5; hop += 1) {
      const response = await fetch(current, {
        redirect: "manual",
        headers: {
          Accept: "text/html, text/plain;q=0.9",
          "User-Agent": "Keel/0.1 (self-hosted; fetches a posting the operator asked for)",
        },
        signal: AbortSignal.timeout(12_000),
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          return { ok: false, needsPaste: true, reason: "The site redirected without a destination. Paste the job text instead." };
        }
        current = assertPublicHttpUrl(new URL(location, current).toString());
        continue;
      }
      if ([401, 403, 429, 503].includes(response.status)) {
        return {
          ok: false,
          needsPaste: true,
          reason: `The site returned ${response.status} and may be blocking fetches. Paste the job text instead.`,
        };
      }
      if (!response.ok) {
        return {
          ok: false,
          needsPaste: true,
          reason: `The site returned ${response.status}. Paste the job text instead.`,
        };
      }
      const type = response.headers.get("content-type") ?? "";
      if (type && !/text\/html|text\/plain|application\/xhtml\+xml/i.test(type)) {
        return {
          ok: false,
          needsPaste: true,
          reason: "The URL did not return text. Paste the job description instead.",
        };
      }
      const body = await response.text();
      const text = /html/i.test(type) || /<html/i.test(body) ? htmlToText(body) : body.replace(/\s+/g, " ").trim();
      if (text.length < 200 || /captcha|access denied|enable javascript|just a moment/i.test(text)) {
        return {
          ok: false,
          needsPaste: true,
          reason: "The page did not include a readable job description. Paste the text instead.",
        };
      }
      return { ok: true, text: text.slice(0, 100_000) };
    }
  } catch (error) {
    if (error instanceof AppError) {
      return { ok: false, needsPaste: true, reason: error.message };
    }
    return { ok: false, needsPaste: true, reason: "The site could not be reached. Paste the job text instead." };
  }
  return { ok: false, needsPaste: true, reason: "The URL redirected too many times. Paste the job text instead." };
}
